import { argon2, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  existingPassword,
  passwordPair,
  profileSchema,
  validateNewPassword,
} from "../../packages/shared/phase2.ts";
import { ensure } from "./game.ts";
import type { Store } from "./db.ts";
import { configuredAccountMail, type AccountMail } from "./account-mail.ts";
const derive = (value: string, salt: Buffer) =>
  new Promise<Buffer>((ok, fail) =>
    argon2(
      "argon2id",
      {
        message: value,
        nonce: salt,
        parallelism: 1,
        tagLength: 32,
        memory: 32768,
        passes: 3,
      },
      (e, b) => (e ? fail(e) : ok(b)),
    ),
  );
export async function hashPassword(value: string) {
  const salt = randomBytes(16);
  return [
    "a2",
    salt.toString("hex"),
    (await derive(value, salt)).toString("hex"),
  ].join("$");
}
export async function matches(value: string, stored: string) {
  if (!stored.startsWith("a2$")) return bcrypt.compare(value, stored);
  const [, salt, hash] = stored.split("$");
  return timingSafeEqual(
    Buffer.from(hash, "hex"),
    await derive(value, Buffer.from(salt, "hex")),
  );
}
type User = (r: FastifyRequest) => Record<string, any>;
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
const windowMs = 600000;
const invalidLink = "Ссылка недействительна, уже использована или просрочена";
const changeSchema = passwordPair.extend({ old: existingPassword });
const linkCode = z.string().regex(/^[\w-]{43}$/, invalidLink);
const linkSchema = z.discriminatedUnion("purpose", [
  z.object({ purpose: z.literal("verify"), code: linkCode }),
  passwordPair.extend({ purpose: z.literal("reset"), code: linkCode }),
]);
type AccountSessions = {
  active: (r: FastifyRequest, uid: string) => boolean;
  issue: (uid: string) => string;
  setCookie: (reply: FastifyReply, key: string) => void;
  close: (uid: string) => void;
};
export function accountApi(
  app: FastifyInstance,
  db: Store,
  user: User,
  sessions: AccountSessions,
  limit: (k: string, n: number, t: number) => void,
  mail = configuredAccountMail(),
) {
  const { one, run, transaction } = db;
  const account = (id: string) =>
    one("SELECT password,name,email FROM users WHERE id=?", id)!;
  function checkPassword(
    p: z.infer<typeof passwordPair>,
    u: ReturnType<typeof account>,
  ) {
    const issue = validateNewPassword(p, u.name, u.email || "")[0];
    ensure(!issue, issue?.message || "");
  }
  async function send(
    adapter: AccountMail,
    id: string,
    email: string,
    purpose: "reset" | "verify",
  ) {
    const code = randomBytes(32).toString("base64url");
    const hash = digest(code);
    transaction(() => {
      run(
        "DELETE FROM account_links WHERE user_id=? AND purpose=?",
        id,
        purpose,
      );
      run(
        "INSERT INTO account_links VALUES (?,?,?,?)",
        hash,
        id,
        purpose,
        Date.now() + 1800000,
      );
    });
    try {
      await adapter.deliver({
        to: email,
        subject:
          purpose === "reset" ? "Смена пароля URE" : "Подтверждение почты URE",
        text: adapter.origin + "/#" + purpose + "=" + code,
      });
    } catch {
      run("DELETE FROM account_links WHERE hash=?", hash);
      ensure(false, "Шлюз не принял запрос на отправку письма", 502);
    }
  }
  let pendingMail = 0;
  app.get("/api/profile", async (r) => {
    const u = user(r);
    return {
      ...one(
        "SELECT name,display,email,avatar,bio,public_profile,verified FROM users WHERE id=?",
        u.id,
      ),
      mail: Boolean(mail),
    };
  });
  app.get("/api/profiles/:id", async (r) => {
    user(r);
    const p = one(
      "SELECT display,avatar,bio FROM users WHERE id=? AND public_profile=1",
      (r.params as { id: string }).id,
    );
    ensure(p, "Профиль закрыт", 404);
    return p;
  });
  app.post("/api/profile", async (r) => {
    const u = user(r),
      p = profileSchema.parse(r.body);
    run(
      "UPDATE users SET display=?,avatar=?,bio=?,public_profile=? WHERE id=?",
      p.display,
      p.avatar,
      p.bio,
      +p.publicProfile,
      u.id,
    );
    return { ok: true };
  });
  app.post("/api/profile/password", async (r, reply) => {
    const u = user(r);
    limit("pw:ip:" + r.ip, 20, windowMs);
    limit("pw:user:" + u.id, 8, windowMs);
    const p = changeSchema.parse(r.body);
    const current = account(u.id);
    checkPassword(p, current);
    ensure(
      await matches(p.old, current.password),
      "Неверный текущий пароль",
      403,
    );
    ensure(
      p.old !== p.password && !(await matches(p.password, current.password)),
      "Новый пароль должен отличаться от текущего",
    );
    const hash = await hashPassword(p.password);
    const key = transaction(() => {
      ensure(sessions.active(r, u.id), "Требуется вход", 401);
      ensure(
        run(
          "UPDATE users SET password=? WHERE id=? AND password=?",
          hash,
          u.id,
          current.password,
        ).changes,
        "Пароль уже изменён",
        409,
      );
      run("DELETE FROM account_links WHERE user_id=?", u.id);
      run("DELETE FROM sessions WHERE user_id=?", u.id);
      return sessions.issue(u.id);
    });
    sessions.close(u.id);
    sessions.setCookie(reply, key);
    return { ok: true };
  });
  app.get("/api/recovery", async () => ({ enabled: Boolean(mail) }));
  app.post("/api/recovery", async (r) => {
    limit("recover:ip:" + r.ip, 5, windowMs);
    const email = z
      .email("Введите адрес электронной почты")
      .max(254)
      .parse((r.body as any)?.email)
      .toLowerCase();
    ensure(mail, "Доставка писем не настроена", 503);
    limit("recover:email:" + digest(email), 3, windowMs);
    if (pendingMail >= 16) return { ok: true };
    pendingMail++;
    setImmediate(() => {
      void (async () => {
        const u = one(
          "SELECT id FROM users WHERE email=? AND verified=1",
          email,
        );
        if (u) await send(mail, u.id, email, "reset");
      })()
        .catch(() => {})
        .finally(() => pendingMail--);
    });
    return { ok: true };
  });
  app.post("/api/profile/verify", async (r) => {
    const u = user(r);
    limit("mail:" + u.id, 4, windowMs);
    ensure(mail, "Доставка писем не настроена", 503);
    const email = one("SELECT email FROM users WHERE id=?", u.id)?.email;
    ensure(email, "В профиле отсутствует адрес");
    await send(mail, u.id, email, "verify");
    return { ok: true };
  });
  app.post("/api/account/link", async (r, reply) => {
    limit("account-link:ip:" + r.ip, 10, windowMs);
    const p = linkSchema.parse(r.body);
    const hash = digest(p.code);
    limit("account-link:code:" + hash, 8, windowMs);
    const activeLink = () =>
      one(
        "SELECT user_id FROM account_links WHERE hash=? AND purpose=? AND expires>?",
        hash,
        p.purpose,
        Date.now(),
      );
    const link = activeLink();
    ensure(link, invalidLink);
    let newHash: string | undefined;
    if (p.purpose === "reset") {
      checkPassword(p, account(link.user_id));
      newHash = await hashPassword(p.password);
    }
    const ownCookie = sessions.active(r, link.user_id);
    transaction(() => {
      ensure(activeLink(), invalidLink);
      run("DELETE FROM account_links WHERE hash=?", hash);
      if (p.purpose === "verify")
        run("UPDATE users SET verified=1 WHERE id=?", link.user_id);
      else if (newHash) {
        run("UPDATE users SET password=? WHERE id=?", newHash, link.user_id);
        run("DELETE FROM account_links WHERE user_id=?", link.user_id);
        run("DELETE FROM sessions WHERE user_id=?", link.user_id);
      }
    });
    if (p.purpose === "reset") {
      sessions.close(link.user_id);
      if (ownCookie) sessions.setCookie(reply, "");
    }
    return { ok: true };
  });
}

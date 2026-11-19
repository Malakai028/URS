import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setImmediate } from "node:timers/promises";
import { createApp } from "../apps/server/app.ts";

const form = {
  name: "alice",
  password: "a much longer phrase",
  confirmation: "a much longer phrase",
  email: "alice@example.test",
  display: "Картограф",
  accepted: true,
  avatar: "moon",
};
const next = "my replacement phrase";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const cookieOf = (r: { headers: Record<string, unknown> }) =>
  String(r.headers["set-cookie"]).split(";")[0];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "ure-recovery-"));
  const file = join(dir, "accounts.sqlite");
  const messages: string[] = [];
  const mail = { fail: false };
  const app = createApp(file, {
    accountMail: {
      origin: "https://game.example.test",
      async deliver(message) {
        messages.push(message.text);
        if (mail.fail) throw Error("Test gateway unavailable");
      },
    },
  });
  const db = new DatabaseSync(file);
  function api(
    path: string,
    payload?: unknown,
    cookie = "",
    remoteAddress?: string,
  ) {
    return app.inject({
      url: "/api/" + path,
      method: payload ? "POST" : "GET",
      headers: { cookie },
      payload: payload as Record<string, unknown> | undefined,
      remoteAddress,
    });
  }
  const login = (password = form.password, cookie = "") =>
    api("auth/login", { name: form.name, password }, cookie);
  const getCode = (purpose: string) =>
    new URLSearchParams(new URL(messages.at(-1)!).hash.slice(1)).get(purpose)!;
  async function close() {
    await setImmediate();
    db.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
  return { api, login, db, getCode, messages, mail, close };
}

test("verified recovery is generic, expires, replaces links and consumes a token atomically", async () => {
  const { api, login, db, getCode, messages, close } = fixture();
  try {
    const register = await api("auth/register", form);
    const cookie = cookieOf(register);
    const other = cookieOf(await login());
    const unrelated = cookieOf(
      await api("auth/register", {
        ...form,
        name: "maptester",
        email: "second@example.test",
      }),
    );
    assert.equal((await api("profile/verify", {}, cookie)).statusCode, 200);
    const verify = { code: getCode("verify"), purpose: "verify" };
    assert.equal((await api("account/link", verify)).statusCode, 200);
    assert.equal((await api("account/link", verify)).statusCode, 400);

    const request = (email = form.email) => api("recovery", { email });
    const absent = await request("absent@example.test");
    const requested = await request();
    assert.equal(requested.statusCode, absent.statusCode);
    assert.equal(requested.body, absent.body);
    await setImmediate();
    const first = getCode("reset");
    const reset = (code: string, password = next, confirmation = password) =>
      api(
        "account/link",
        { purpose: "reset", code, password, confirmation },
        cookie,
      );
    const stored = db.prepare("SELECT hash FROM account_links").get();
    assert.equal(stored?.hash, digest(first));
    assert.equal(requested.body.includes(first), false);
    assert.equal(requested.headers["referrer-policy"], "no-referrer");
    db.prepare("UPDATE account_links SET expires=?").run(Date.now() - 1);
    assert.equal((await reset(first)).statusCode, 400);
    await Promise.all([request(), request()]);
    await setImmediate();
    const earlier = new URLSearchParams(
      new URL(messages.at(-2)!).hash.slice(1),
    ).get("reset")!;
    const code = getCode("reset");
    assert.notEqual(earlier, code);
    assert.equal((await reset(earlier)).statusCode, 400);
    const invalid = await reset(randomBytes(32).toString("base64url"));
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.body, (await reset(first)).body);
    assert.equal((await reset(code, "too short")).statusCode, 400);
    assert.equal((await reset(code, next, form.password)).statusCode, 400);
    const results = await Promise.all([reset(code), reset(code)]);
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 400]);
    const output = results.find((response) => response.statusCode === 200)!;
    assert.match(
      String(output.headers["set-cookie"]),
      /ure_session=;.*Max-Age=0/,
    );
    for (const response of [...results, invalid])
      for (const secret of [code, next])
        assert.equal(response.body.includes(secret), false);
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM account_links").get()?.n,
      0,
    );
    assert.equal((await api("me", undefined, cookie)).statusCode, 401);
    assert.equal((await api("me", undefined, other)).statusCode, 401);
    assert.equal((await api("me", undefined, unrelated)).statusCode, 200);
    assert.equal((await login()).statusCode, 401);
    assert.equal((await login(next)).statusCode, 200);
  } finally {
    await close();
  }
});

test("password change rotates the current cookie, revokes other sessions and keeps account data", async () => {
  const { api, login, db, close } = fixture();
  try {
    const r = await api("auth/register", form);
    const uid = r.json().id;
    const cookie = cookieOf(r);
    const other = cookieOf(await login());
    const before = (await api("profile", undefined, cookie)).json();
    const change = (old: string, password: string, confirmation = password) =>
      api("profile/password", { old, password, confirmation }, cookie);
    assert.equal((await change("wrong", next)).statusCode, 403);
    assert.equal((await change(form.password, "too short")).statusCode, 400);
    assert.equal(
      (await change(form.password, next, form.password)).statusCode,
      400,
    );
    assert.equal((await change(form.password, form.password)).statusCode, 400);
    assert.equal((await api("logout/all", {})).statusCode, 401);
    const changed = await change(form.password, next);
    assert.equal(changed.statusCode, 200);
    const session = cookieOf(changed);
    assert.notEqual(session, cookie);
    assert.match(
      String(changed.headers["set-cookie"]),
      /Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800/,
    );
    assert.deepEqual((await api("profile", undefined, session)).json(), before);
    const sessions = db
      .prepare("SELECT token FROM sessions WHERE user_id=?")
      .all(uid);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].token, digest(session.split("=")[1]));
    assert.equal((await api("me", undefined, cookie)).statusCode, 401);
    assert.equal((await api("me", undefined, other)).statusCode, 401);
    assert.equal((await login()).statusCode, 401);
    const replaced = cookieOf(await login(next, session));
    assert.equal((await api("me", undefined, session)).statusCode, 401);
    const spare = cookieOf(await login(next));
    assert.equal((await api("logout", {}, spare)).statusCode, 200);
    assert.equal((await api("me", undefined, spare)).statusCode, 401);
    assert.equal((await api("me", undefined, replaced)).statusCode, 200);
    const last = cookieOf(await login(next));
    const logout = await api("logout/all", {}, replaced);
    assert.equal(logout.statusCode, 200);
    assert.match(String(logout.headers["set-cookie"]), /Max-Age=0/);
    assert.equal((await api("me", undefined, last)).statusCode, 401);
    assert.equal((await api("me", undefined, replaced)).statusCode, 401);
    assert.equal(
      db.prepare("SELECT id FROM users WHERE id=?").get(uid)?.id,
      uid,
    );
  } finally {
    await close();
  }
});

test("recovery throttles verified and absent addresses equally and clears failed delivery links", async (t) => {
  const { api, db, getCode, mail, messages, close } = fixture();
  const now = Date.now();
  let time = now;
  t.mock.method(Date, "now", () => time);
  try {
    const r = await api("auth/register", form);
    const cookie = cookieOf(r);
    assert.equal((await api("profile/verify", {}, cookie)).statusCode, 200);
    await api("account/link", { code: getCode("verify"), purpose: "verify" });
    mail.fail = true;
    const existing = (i: number) =>
      api("recovery", { email: form.email }, "", "192.0.2." + i);
    const absent = (i: number) =>
      api("recovery", { email: "absent@example.test" }, "", "192.0.2." + i);
    for (let i = 1; i <= 3; i++) {
      const a = await existing(i),
        b = await absent(i);
      assert.equal(a.statusCode, 200);
      assert.equal(a.body, b.body);
    }
    await setImmediate();
    assert.equal(messages.length, 4);
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM account_links").get()?.n,
      0,
    );
    const limited = await existing(4),
      absentLimited = await absent(4);
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.body, absentLimited.body);
    assert.equal(limited.headers["retry-after"], "600");
    time += 600001;
    assert.equal((await existing(5)).statusCode, 200);
    await setImmediate();
    assert.equal((await absent(5)).statusCode, 200);
    time += 604800001;
    assert.equal((await api("me", undefined, cookie)).statusCode, 401);
  } finally {
    await close();
  }
});

test("sign-in applies the same rejection and rate window to known and unknown names", async (t) => {
  const { api, close } = fixture();
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  try {
    const r = await api("auth/register", form);
    assert.equal(r.statusCode, 200);
    const attempt = (name: string, ip: number) =>
      api("auth/login", { name, password: "incorrect" }, "", "192.0.2." + ip);
    const known = await attempt(form.name, 1);
    const unknown = await attempt("absent", 1);
    assert.equal(known.statusCode, 401);
    assert.equal(known.body, unknown.body);
    for (let i = 2; i <= 10; i++)
      assert.equal((await attempt("ALICE", i)).statusCode, 401);
    const limited = await attempt(form.name, 11);
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.headers["retry-after"], "600");
    now += 600001;
    assert.equal((await attempt(form.name, 11)).statusCode, 401);
  } finally {
    await close();
  }
});

test("configured HTTPS mail gateway gets the fragment link and the browser response does not", async (t) => {
  const values = {
    ACCOUNT_MAIL_URL: "https://mail.example.test/submit",
    ACCOUNT_MAIL_KEY: "fixture-only",
    PUBLIC_ORIGIN: "https://game.example.test",
  };
  const previous = new Map(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, values);
  const outbound = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(null, { status: 202 }),
  );
  const app = createApp(":memory:");
  try {
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: form,
    });
    assert.equal(r.statusCode, 200);
    assert.match(String(r.headers["set-cookie"]), /Max-Age=604800; Secure/);
    const link = await app.inject({
      method: "POST",
      url: "/api/profile/verify",
      headers: { cookie: cookieOf(r) },
      payload: {},
    });
    assert.equal(link.statusCode, 200);
    assert.deepEqual(link.json(), { ok: true });
    assert.equal(outbound.mock.callCount(), 1);
    const [url, request] = outbound.mock.calls[0].arguments as unknown as [
      URL,
      RequestInit,
    ];
    assert.equal(url.href, values.ACCOUNT_MAIL_URL);
    assert.equal(request.redirect, "error");
    const mail = JSON.parse(String(request.body));
    assert.equal(mail.to, form.email);
    assert.match(new URL(mail.text).hash, /^#verify=[\w-]{43}$/);
    assert.equal(link.body.includes(mail.text), false);
  } finally {
    await app.close();
    for (const [key, value] of previous)
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});

import { heroApi } from "./heroes.ts";
import {
  advance,
  creatureGround,
  details,
  freshScene,
  ground,
  positions,
  type Scene,
} from "./adventure.ts";
import {
  creatureCanSee,
  inspectCreature,
  isCreature,
  simulateCreatures,
  visibleCreatures,
} from "./creatures.ts";
import { creatureStepMs, type Area } from "../../packages/shared/creatures.ts";
import type { CreatureView } from "../../packages/shared/creatures.ts";
import {
  creatureJournal,
  discover,
  journalSpecies,
  knowledgeStage,
  learnedCreature,
  projectCreature,
} from "./creature-knowledge.ts";
import { attributes } from "../../packages/engine/attributes.ts";
import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import { WebSocketServer, WebSocket } from "ws";
import { randomBytes, randomInt, randomUUID, createHash } from "node:crypto";
import { isIP } from "node:net";
import { accountApi, hashPassword, matches } from "./accounts.ts";
import type { AccountMail } from "./account-mail.ts";
import {
  credentials,
  registration,
  channelOf,
} from "../../packages/shared/phase2.ts";
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { z, ZodError } from "zod";
import {
  actions,
  worldSchema,
  characterSchema,
  commandSchema,
  type Character,
  type EventRecord,
} from "../../packages/shared/index.ts";
import { atlas } from "../../packages/content/atlas.ts";
import { planSchema, worldPlan, help } from "./director.ts";
import { size, rules, resolveAction } from "../../packages/engine/index.ts";
import { openDb } from "./db.ts";
import {
  GameError,
  apply,
  ensure,
  newCharacter,
  characterView,
} from "./game.ts";
import { generate } from "./narrator.ts";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(24).toString("base64url");
const inviteRoles = z.enum(["player", "spectator", "gm"]);
type Request = FastifyRequest;
function params(r: Request) {
  return r.params as { id: string };
}
function cookie(raw?: string) {
  return /(?:^|;\s*)ure_session=([\w-]+)/.exec(raw || "")?.[1] || "";
}
const fields = {
  race: ["R-001", "R-009"],
  profession: ["C-001", "C-022"],
  flaw: ["Утомляемость", "Рассеянность"],
};
const fieldSchema = z.enum(["race", "profession", "flaw"]);
const sessionAge = 604800;
const dummyPasswordHash = "a2$" + "00".repeat(16) + "$" + "00".repeat(32);
class RateLimitError extends GameError {
  readonly retryAfter: number;
  constructor(retryAfter: number) {
    super("Слишком много запросов. Повторите позже.", 429);
    this.retryAfter = retryAfter;
  }
}
export function createApp(
  file?: string,
  {
    accountMail,
    onCreatureTick,
  }: {
    accountMail?: AccountMail;
    onCreatureTick?: (sample: {
      durationMs: number;
      delayMs: number;
      active: number;
      updated: string[];
      sceneWrites: number;
      characterWrites: number;
      notifications: number;
    }) => void;
  } = {},
) {
  const proxy = process.env.TRUSTED_PROXY;
  if (proxy && !isIP(proxy))
    throw Error("TRUSTED_PROXY должен содержать один IP-адрес прокси");
  const app = Fastify({ bodyLimit: 16384, logger: false, trustProxy: proxy || false });
  const store = openDb(file);
  const { one, all, run, transaction } = store;
  const sockets = new Map<
    WebSocket,
    { world: string; user: string; session: string }
  >();
  const limits = new Map<string, { until: number; count: number }>();
  function limit(key: string, max: number, period: number) {
    const now = Date.now();
    let v = limits.get(key);
    if (!v || v.until <= now) {
      if (!v && limits.size >= 20000) throw new RateLimitError(60);
      v = { until: now + period, count: 0 };
      limits.set(key, v);
    }
    if (v.count >= max)
      throw new RateLimitError(Math.ceil((v.until - now) / 1000));
    v.count++;
  }
  function session(raw?: string) {
    return one(
      "SELECT u.id,u.name,u.display,u.avatar FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.token=? AND s.expires>?",
      digest(cookie(raw)),
      Date.now(),
    );
  }
  function user(r: Request) {
    const u = session(r.headers.cookie);
    ensure(u, "Требуется вход", 401);
    return u;
  }
  function member(id: string, uid: string) {
    const m = one(
      "SELECT role FROM members WHERE world_id=? AND user_id=?",
      id,
      uid,
    );
    ensure(m, "Нет доступа к миру", 403);
    return m.role as string;
  }
  function context(r: Request) {
    const u = user(r),
      id = params(r).id,
      role = member(id, u.id);
    return { u, id, role };
  }
  function world(id: string) {
    const w = one("SELECT * FROM worlds WHERE id=?", id)!;
    return {
      ...w,
      seed: String(w.seed),
      land: String(w.land),
      draft: JSON.parse(w.draft),
    };
  }
  function state(id: string, uid: string): Character | undefined {
    const row = one(
      "SELECT state FROM characters WHERE world_id=? AND user_id=?",
      id,
      uid,
    );
    return row ? JSON.parse(row.state) : undefined;
  }
  function broadcast(id: string) {
    let sent = 0;
    for (const [ws, s] of sockets)
      if (s.world === id && ws.readyState === WebSocket.OPEN) {
        ws.send("changed");
        sent++;
      }
    return sent;
  }
  function sessionCookie(key: string, age: number) {
    return (
      "ure_session=" +
      key +
      "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" +
      age +
      (process.env.PUBLIC_ORIGIN?.startsWith("https://") ? "; Secure" : "")
    );
  }
  function setSessionCookie(reply: FastifyReply, key: string) {
    reply.header("Set-Cookie", sessionCookie(key, key ? sessionAge : 0));
  }
  function issueSession(uid: string) {
    const key = token();
    run(
      "INSERT INTO sessions VALUES (?,?,?)",
      digest(key),
      uid,
      Date.now() + sessionAge * 1000,
    );
    return key;
  }
  function revokeSocketSessions(
    predicate: (s: { user: string; session: string }) => boolean,
  ) {
    for (const [ws, s] of sockets)
      if (predicate(s)) {
        ws.close(4001, "Session ended");
      }
  }
  function originOk(origin: string | undefined, host: string | undefined) {
    if (!origin) return true;
    try {
      return process.env.PUBLIC_ORIGIN
        ? origin === process.env.PUBLIC_ORIGIN
        : ["http://" + host, "https://" + host].includes(origin);
    } catch {
      return false;
    }
  }
  app.addHook("onRequest", async (r, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Frame-Options", "DENY");
    if (r.url.startsWith("/api/")) {
      reply.header("Cache-Control", "no-store");
      limit(r.ip, 1200, 60000);
      if (r.method !== "GET")
        ensure(
          originOk(r.headers.origin, r.headers.host),
          "Недопустимый источник",
          403,
        );
    }
  });
  app.setErrorHandler((e: Error & { statusCode?: number }, _r, reply) => {
    if (e instanceof RateLimitError) reply.header("Retry-After", e.retryAfter);
    const code = e instanceof ZodError ? 400 : e.statusCode || 500;
    reply.code(code).send({
      error:
        e instanceof ZodError
          ? e.issues.map((x) => x.message).join(" · ")
          : code < 500
            ? e.message
            : "Ошибка сервера",
    });
  });
  heroApi(app, store, user, context, broadcast);
  function scene(id: string): Scene {
    const row = one("SELECT state FROM scenes WHERE world_id=?", id);
    return row ? JSON.parse(row.state) : freshScene();
  }
  function saveScene(id: string, sc: Scene) {
    run("INSERT OR REPLACE INTO scenes VALUES (?,?)", id, JSON.stringify(sc));
  }
  function canObserve(
    actor: Character,
    target: CreatureView,
    walkable: ReturnType<typeof creatureGround>,
  ) {
    return (
      details(actor).area === target.area &&
      Math.max(
        Math.abs(actor.x - target.position.x),
        Math.abs(actor.y - target.position.y),
      ) <= 3 &&
      creatureCanSee(walkable, target.area, actor, target.position)
    );
  }
  function persist(id: string, c: Character) {
    const json = JSON.stringify(c);
    run(
      "UPDATE characters SET state=? WHERE world_id=? AND user_id=?",
      json,
      id,
      c.userId,
    );
    run(
      "UPDATE heroes SET state=? WHERE id=(SELECT hero_id FROM active_heroes WHERE world_id=? AND user_id=?)",
      json,
      id,
      c.userId,
    );
  }
  accountApi(
    app,
    store,
    user,
    {
      active: (r, uid) => session(r.headers.cookie)?.id === uid,
      issue: issueSession,
      setCookie: setSessionCookie,
      close: (uid) => revokeSocketSessions((s) => s.user === uid),
    },
    limit,
    accountMail,
  );
  app.post("/api/auth/:op", async (r, reply) => {
    const op = (r.params as { op: string }).op;
    ensure(op === "login" || op === "register", "Маршрут не найден", 404);
    limit("auth:" + op + ":ip:" + r.ip, op === "login" ? 30 : 12, 600000);
    let u;
    if (op === "register") {
      const form = registration.parse(r.body);
      const password = await hashPassword(form.password);
      const id = randomUUID();
      const inserted = run(
        "INSERT INTO users(id,name,password,email,display,avatar) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING",
        id,
        form.name,
        password,
        form.email,
        form.display,
        form.avatar,
      );
      ensure(
        inserted.changes === 1,
        "Не удалось создать аккаунт с этими данными",
        409,
      );
      u = { id, name: form.name };
    } else {
      const data = credentials.parse(r.body);
      limit("auth:login:name:" + digest(data.name.toLowerCase()), 10, 600000);
      u = one("SELECT * FROM users WHERE name=?", data.name);
      const stored: string | undefined = u?.password;
      const [valid] = await Promise.all([
        matches(data.password, stored ?? dummyPasswordHash),
        stored && !stored.startsWith("a2$")
          ? matches(data.password, dummyPasswordHash)
          : undefined,
      ]);
      ensure(u && valid, "Неверное имя или пароль", 401);
    }
    const previous = digest(cookie(r.headers.cookie));
    const key = transaction(() => {
      if (op === "login")
        ensure(
          one(
            "SELECT id FROM users WHERE id=? AND password=?",
            u!.id,
            u!.password,
          ),
          "Неверное имя или пароль",
          401,
        );
      run("DELETE FROM sessions WHERE token=?", previous);
      return issueSession(u!.id);
    });
    revokeSocketSessions((s) => s.session === previous);
    setSessionCookie(reply, key);
    return { id: u!.id, name: u!.name };
  });
  app.post("/api/logout", async (r, reply) => {
    const key = digest(cookie(r.headers.cookie));
    run("DELETE FROM sessions WHERE token=?", key);
    revokeSocketSessions((s) => s.session === key);
    setSessionCookie(reply, "");
    return { ok: true };
  });
  app.post("/api/logout/all", async (r, reply) => {
    const u = user(r);
    run("DELETE FROM sessions WHERE user_id=?", u.id);
    revokeSocketSessions((s) => s.user === u.id);
    setSessionCookie(reply, "");
    return { ok: true };
  });
  app.get("/api/me", async (r) => user(r));
  app.get("/api/catalog", async (r) => {
    const u = user(r);
    const query = z
      .object({ world: z.string().max(100).optional() })
      .parse(r.query);
    if (query.world) member(query.world, u.id);
    const c = query.world ? state(query.world, u.id) : undefined;
    const knowledge = c?.extra?.creatureKnowledge;
    return {
      ...atlas,
      bestiary: atlas.bestiary.map((row) =>
        journalSpecies.has(row.id) && knowledgeStage(knowledge?.[row.id]) < 2
          ? {
              id: row.id,
              name: row.name,
              category: row.category,
              description:
                "Сведения открываются после наблюдения в экспедиции.",
              source: row.source,
            }
          : row,
      ),
    };
  });
  app.get("/api/worlds", async (r) => {
    const u = user(r);
    return {
      mine: all(
        "SELECT w.id,w.name,w.land,w.description,m.role,c.state,(SELECT max(rowid) FROM events e WHERE e.world_id=w.id AND e.user_id=m.user_id) lastEvent FROM worlds w JOIN members m ON m.world_id=w.id LEFT JOIN characters c ON c.world_id=w.id AND c.user_id=m.user_id WHERE m.user_id=? ORDER BY lastEvent DESC,w.rowid DESC",
        u.id,
      ).map(({ state, ...w }) => ({
        ...w,
        character: state ? JSON.parse(state).name : null,
      })),
      listed: all(
        "SELECT id,name FROM worlds WHERE access='listed' AND id NOT IN (SELECT world_id FROM members WHERE user_id=?)",
        u.id,
      ),
    };
  });
  app.post("/api/world-plan", async (r) => {
    const u = user(r);
    limit("plan:" + u.id, 12, 60000);
    const p = worldSchema.parse(r.body);
    return worldPlan(p.name, p.seed, p.land, p.description, p.ai);
  });
  app.post("/api/assistant", async (r) => {
    const u = user(r);
    limit("assistant:" + u.id, 20, 60000);
    const input = z
      .object({
        topic: z.string().max(40),
        question: z.string().max(500),
        world: z.string().max(80),
        ai: z.boolean(),
      })
      .strict()
      .parse(r.body);
    let summary = "";
    if (input.world) {
      member(input.world, u.id);
      const c = state(input.world, u.id);
      summary = c
        ? c.name +
          ", уровень " +
          c.level +
          ", позиция " +
          c.x +
          ", " +
          c.y +
          "."
        : "";
    }
    return help(input.topic, input.question, summary, input.ai);
  });
  app.post("/api/worlds", async (r) => {
    const u = user(r);
    limit("world:" + u.id, 12, 60000);
    const input = worldSchema
        .extend({ plan: planSchema.optional() })
        .parse(r.body),
      id = randomUUID();
    const { draft, provider } = await generate(
      input.seed,
      input.land,
      input.description,
      input.ai,
    );
    transaction(() => {
      run(
        "INSERT INTO worlds VALUES (?,?,?,?,?,?,?,?,?,?)",
        id,
        u.id,
        input.name,
        input.description,
        input.seed,
        input.land,
        input.access,
        JSON.stringify({ ...draft, plan: input.plan }),
        provider,
        rules.version,
      );
      run("INSERT INTO members VALUES (?,?,?)", id, u.id, "owner");
    });
    return { id };
  });
  app.post("/api/worlds/:id/watch", async (r) => {
    const u = user(r),
      id = params(r).id;
    ensure(
      one("SELECT id FROM worlds WHERE id=? AND access='listed'", id),
      "Мир закрыт",
      403,
    );
    run("INSERT OR IGNORE INTO members VALUES (?,?,'spectator')", id, u.id);
    return { id };
  });
  const audience =
    "((?=1 AND json_extract(record,'$.visibility')<>'private') OR user_id=? OR json_extract(record,'$.visibility')='world' OR json_extract(record,'$.audit.recipient')=? OR EXISTS (SELECT 1 FROM json_each(json_extract(record,'$.audit.recipients')) WHERE value=?))";
  app.get("/api/worlds/:id/history", async (r) => {
    const { id, u, role } = context(r);
    const q = z
      .object({
        q: z.string().max(100).default(""),
        channel: z
          .enum([
            "all",
            "ic",
            "ooc",
            "actions",
            "narrative",
            "system",
            "private",
          ])
          .default("all"),
        before: z.coerce
          .number()
          .int()
          .positive()
          .default(Number.MAX_SAFE_INTEGER),
      })
      .parse(r.query);
    return all(
      "SELECT rowid cursor,record FROM events WHERE world_id=? AND " +
        audience +
        " AND rowid<? AND (?='all' OR json_extract(record,'$.audit.channel')=?) AND instr(lower(json_extract(record,'$.text')),lower(?))>0 ORDER BY rowid DESC LIMIT 50",
      id,
      Number(role === "owner" || role === "gm"),
      u.id,
      u.id,
      u.id,
      q.before,
      q.channel,
      q.channel,
      q.q,
    ).map((r) => ({ ...JSON.parse(r.record), cursor: r.cursor }));
  });
  app.get("/api/worlds/:id", async (r) => {
    const { u, id, role } = context(r),
      w = world(id),
      c = state(id, u.id);
    const privileged = role === "owner" || role === "gm";
    const seen = new Set(c?.explored || []);
    function visible(x: number, y: number) {
      if (!c && !privileged)
        return Math.max(Math.abs(12 - x), Math.abs(12 - y)) <= 2;
      return (
        privileged ||
        (!!c && Math.max(Math.abs(c.x - x), Math.abs(c.y - y)) <= 3)
      );
    }
    const area = c ? details(c).area : "field",
      extent = area === "field" ? size : 16,
      side = Math.min(25, extent);
    const offset = {
      x: Math.max(0, Math.min(extent - side, (c?.x ?? 12) - 12)),
      y: Math.max(0, Math.min(extent - side, (c?.y ?? 12) - 12)),
    };
    const tiles = Array.from({ length: side }, (_, j) =>
      Array.from({ length: side }, (_, i) => {
        const x = i + offset.x,
          y = j + offset.y;
        return visible(x, y) ||
          seen.has((area === "field" ? "" : area + ":") + x + "," + y)
          ? { kind: ground(w.seed, w.land, area, x, y), lit: visible(x, y) }
          : null;
      }),
    );
    const party = all("SELECT state FROM characters WHERE world_id=?", id)
      .map((r) => JSON.parse(r.state) as Character)
      .map((p) => ({
        name: p.name,
        userId: p.userId,
        look: details(p).look,
        race: p.race,
        armored: details(p).gear.some((g) => g.kind === "vest" && g.equipped),
        armed: details(p).gear.some((g) => g.kind === "blade" && g.equipped),
        ...(details(p).area === area && visible(p.x, p.y)
          ? { x: p.x, y: p.y }
          : {}),
      }));
    const events = all(
      "SELECT record FROM events WHERE world_id=? AND " +
        audience +
        " ORDER BY rowid DESC LIMIT 120",
      id,
      Number(privileged),
      u.id,
      u.id,
      u.id,
    )
      .reverse()
      .map((e) => JSON.parse(e.record) as EventRecord);
    const room = one("SELECT id FROM rooms WHERE world_id=?", id);
    const pending = one(
      "SELECT mode,state FROM builds WHERE world_id=? AND user_id=?",
      id,
      u.id,
    );
    const sc = scene(id);
    const walkable = creatureGround(w.seed, w.land);
    const creatures = visibleCreatures(sc, area, id).filter(
      ({ position }) =>
        visible(position.x, position.y) &&
        (privileged || !c || creatureCanSee(walkable, area, c, position)),
    );
    const objects = [
      ...positions(sc, area, w.draft.npc).filter(
        (p) => visible(p.x, p.y) && !isCreature(p.id),
      ),
      ...creatures
        .map((raw) => projectCreature(raw, c?.extra))
        .map((creature) => ({
          id: creature.id,
          name: creature.name,
          kind: "monster",
          ...creature.position,
          creature,
        })),
    ];
    return {
      pendingBuild: pending
        ? { ...JSON.parse(pending.state), mode: pending.mode }
        : null,
      world: {
        id,
        name: (w as any).name,
        description: (w as any).description,
        land: w.land,
        provider: (w as any).provider,
        access: (w as any).access,
        ruleset: rules.version,
        draft: {
          plan: privileged ? w.draft.plan : undefined,
          location: w.draft.location,
          description: w.draft.description,
          ...(privileged || c?.talked ? { hook: w.draft.hook } : {}),
        },
      },
      role,
      room: room ?? null,
      character: c ? characterView(c) : null,
      activeHeroId: c
        ? one("SELECT hero_id FROM active_heroes WHERE world_id=? AND user_id=?", id, u.id)?.hero_id ?? u.id
        : null,
      tiles,
      party,
      config: w.draft.config || { pvp: false, minLevel: 0, maxLevel: 5000 },
      area,
      extent,
      offset,
      beacon: sc.beacon,
      cacheOpened: sc.opened,
      objects,
      creatureJournal: c?.extra ? creatureJournal(c.extra) : [],
      events,
    };
  });
  app.get("/api/worlds/:id/creatures/:creature", async (r) => {
    const { id, role, u } = context(r);
    const gm =
      (role === "owner" || role === "gm") &&
      (r.query as { mode?: string }).mode === "gm";
    const name = (r.params as { creature: string }).creature;
    const result = inspectCreature(scene(id), name, id, gm);
    ensure(result, "Существо не найдено", 404);
    if (!gm) {
      const actor = state(id, u.id),
        creature = result.creature;
      const w = world(id);
      ensure(
        actor && canObserve(actor, creature, creatureGround(w.seed, w.land)),
        "Существо вне поля наблюдения",
        404,
      );
      return {
        ...result,
        creature: projectCreature(creature, actor.extra),
        learned: learnedCreature(creature, actor.extra),
      };
    }
    return result;
  });
  app.post("/api/worlds/:id/settings", async (r) => {
    const { id, role } = context(r);
    ensure(role === "owner", "Только владелец", 403);
    const cfg = z
      .object({
        pvp: z.boolean(),
        minLevel: z.number().int().min(0).max(5000),
        maxLevel: z.number().int().min(0).max(5000),
      })
      .strict()
      .parse(r.body);
    ensure(cfg.maxLevel >= cfg.minLevel, "Проверьте диапазон уровней");
    const w = world(id);
    w.draft.config = cfg;
    run("UPDATE worlds SET draft=? WHERE id=?", JSON.stringify(w.draft), id);
    broadcast(id);
    return { ok: true };
  });
  app.post("/api/worlds/:id/consent", async (r) => {
    const { id, u, role } = context(r);
    ensure(role !== "spectator", "Нет доступа", 403);
    const c = state(id, u.id);
    ensure(c, "Сначала создайте героя");
    const { duel } = z.object({ duel: z.boolean() }).strict().parse(r.body);
    ensure(
      !duel || world(id).draft.config?.pvp,
      "Поединки отключены владельцем",
    );
    details(c).duel = duel;
    transaction(() => persist(id, c));
    broadcast(id);
    return { ok: true };
  });
  app.post("/api/worlds/:id/room", async (r) => {
    const { id, role } = context(r);
    ensure(["owner", "gm"].includes(role), "Нужны права мастера", 403);
    run("INSERT OR IGNORE INTO rooms VALUES (?,?)", randomUUID(), id);
    broadcast(id);
    return { ok: true };
  });
  app.post("/api/worlds/:id/invite", async (r) => {
    const { id, role } = context(r);
    ensure(["owner", "gm"].includes(role), "Нужны права мастера", 403);
    const grant = inviteRoles.parse((r.body as any)?.role);
    ensure(
      grant !== "gm" || role === "owner",
      "Только владелец назначает мастера",
      403,
    );
    const room = one("SELECT id FROM rooms WHERE world_id=?", id);
    ensure(room, "Сначала откройте комнату");
    const code = token();
    run(
      "INSERT INTO invites VALUES (?,?,?,?)",
      digest(code),
      room.id,
      grant,
      Date.now() + 86400000,
    );
    return { code };
  });
  app.post("/api/join", async (r) => {
    const u = user(r);
    const code = z
      .string()
      .max(100)
      .parse((r.body as any)?.code);
    const invite = one(
      "SELECT r.world_id,i.role FROM invites i JOIN rooms r ON r.id=i.room_id WHERE token=? AND expires>?",
      digest(code),
      Date.now(),
    );
    ensure(invite, "Код недействителен или истёк", 404);
    run(
      "INSERT INTO members VALUES (?,?,?) ON CONFLICT(world_id,user_id) DO UPDATE SET role=CASE WHEN members.role='spectator' OR (members.role='player' AND excluded.role='gm') THEN excluded.role ELSE members.role END",
      invite.world_id,
      u.id,
      invite.role,
    );
    return { id: invite.world_id };
  });
  app.post("/api/worlds/:id/build", async (r) => {
    const { u, id, role } = context(r);
    ensure(
      role !== "spectator" && !state(id, u.id),
      "Создание недоступно",
      403,
    );
    const { mode, field } = z
      .object({
        mode: z.enum(["partial", "random"]),
        field: fieldSchema.optional(),
      })
      .strict()
      .parse(r.body);
    const existing = one(
      "SELECT * FROM builds WHERE world_id=? AND user_id=?",
      id,
      u.id,
    );
    if (existing) ensure(existing.mode === mode, "Режим генерации уже выбран");
    const pick = (values: string[]) => values[randomInt(values.length)];
    const draft = existing
      ? JSON.parse(existing.state)
      : {
          race: pick(fields.race),
          profession: pick(fields.profession),
          flaw: pick(fields.flaw),
          used: [],
        };
    draft.fate = 15 - 5 * draft.used.length;
    if (field) {
      ensure(draft.fate >= 5, "Недостаточно очков судьбы");
      ensure(
        mode === "partial" && !draft.used.includes(field),
        "Замена уже использована или недоступна",
      );
      draft[field] = pick(fields[field].filter((v) => v !== draft[field]));
      draft.used.push(field);
      draft.fate -= 5;
    }
    run(
      "INSERT OR REPLACE INTO builds VALUES (?,?,?,?)",
      id,
      u.id,
      mode,
      JSON.stringify(draft),
    );
    return { ...draft, mode };
  });
  app.post("/api/worlds/:id/character", async (r) => {
    const { u, id, role } = context(r);
    ensure(role !== "spectator", "Роль наблюдателя", 403);
    ensure(!state(id, u.id), "Персонаж уже существует", 409);
    ensure(
      !(world(id).draft.config?.minLevel > 0),
      "Для этого мира выберите героя подходящего уровня",
    );
    const input = characterSchema.parse(r.body);
    const saved = one(
      "SELECT * FROM builds WHERE world_id=? AND user_id=?",
      id,
      u.id,
    );
    if (saved || input.mode !== "manual") {
      ensure(saved && saved.mode === input.mode, "Сначала создайте заготовку");
      const d = JSON.parse(saved.state);
      ensure(
        Object.keys(fields).every(
          (k) => d[k] === input[k as keyof typeof input],
        ),
        "Несогласованная сборка",
      );
    }
    transaction(() => {
      const hero = randomUUID(),
        c = newCharacter(u.id, input);
      details(c);
      const json = JSON.stringify(c);
      run("INSERT INTO characters VALUES (?,?,?)", id, u.id, json);
      run("INSERT INTO heroes VALUES (?,?,?,0)", hero, u.id, json);
      run("INSERT INTO active_heroes VALUES (?,?,?)", id, u.id, hero);
    });
    broadcast(id);
    return { ok: true };
  });
  app.post("/api/worlds/:id/action", async (r) => {
    const { u, id, role } = context(r);
    ensure(role !== "spectator", "Наблюдатель не может действовать", 403);
    const { key, action } = commandSchema.parse(r.body);
    const result = transaction(() => {
      const old = one(
        "SELECT record FROM events WHERE world_id=? AND user_id=? AND command_key=?",
        id,
        u.id,
        key,
      );
      if (old) return JSON.parse(old.record);
      ensure(
        one("SELECT id FROM rooms WHERE world_id=?", id),
        "Комната ещё закрыта",
      );
      const c = state(id, u.id);
      ensure(c, "Создайте персонажа");
      let result;
      try {
        const w = world(id),
          sc = scene(id),
          now = Date.now(),
          hero =
            one(
              "SELECT hero_id FROM active_heroes WHERE world_id=? AND user_id=?",
              id,
              u.id,
            )?.hero_id || u.id;
        if (action.type === "level" && action.expected) {
          ensure(
            action.expected.hero === hero && action.expected.level === c.level,
            "Герой или уровень изменился. Проверьте лист персонажа перед повышением.",
            409,
          );
        }
        if (
          action.type === "ability" ||
          action.type === "gear" ||
          action.type === "move"
        ) {
          let recipient =
            action.type === "gear" && action.recipient
              ? state(id, action.recipient)
              : undefined;
          if (
            action.type === "ability" &&
            action.skill === "attack" &&
            action.target &&
            !isCreature(action.target)
          ) {
            ensure(w.draft.config?.pvp, "Поединки между игроками отключены");
            recipient = state(id, action.target);
            ensure(recipient, "Нет доступной цели");
          }
          result = advance(
            c,
            action.type === "move"
              ? { type: "ability", skill: "walk", dx: action.dx, dy: action.dy }
              : action,
            sc,
            { ...w, id },
            now,
            hero,
            recipient,
          );
          saveScene(id, sc);
          if (recipient) persist(id, recipient);
        } else if (
          action.type === "ic" ||
          action.type === "whisper" ||
          action.type === "group" ||
          action.type === "chat"
        ) {
          if (action.type === "group")
            for (const recipient of action.recipients) member(id, recipient);
          if (action.type === "whisper") member(id, action.recipient);
          result = {
            text: action.text,
            audit: {
              actor: action.type === "ic" ? c.name : u.display || u.name,
              avatar: action.type === "ic" ? details(c).look.cloak : u.avatar,
              ...(action.type === "whisper"
                ? { recipient: action.recipient }
                : action.type === "group"
                  ? { recipients: action.recipients }
                  : action.type === "ic"
                    ? { look: details(c).look, race: c.race }
                    : {}),
              method: "speech",
            },
          };
        } else {
          if (["survey", "talk", "intent"].includes(action.type))
            ensure(details(c).area === "field", "Вернитесь на тракт");
          result = apply(c, actions.parse(action), w, role, now, sc);
        }
      } catch (e) {
        if (e instanceof GameError) throw e;
        throw new GameError((e as Error).message);
      }
      const rec: EventRecord = {
        id: randomUUID(),
        worldId: id,
        actor: u.id,
        action: action.type,
        timestamp: new Date().toISOString(),
        visibility:
          action.type === "whisper" || action.type === "group"
            ? "private"
            : action.type === "ability" || action.type === "gear"
              ? "actor"
              : action.type === "move" ||
                  action.type === "survey" ||
                  action.type === "talk" ||
                  action.type === "intent"
                ? "actor"
                : "world",
        text: result.text,
        audit: {
          ...result.audit,
          heroId: one(
            "SELECT hero_id FROM active_heroes WHERE world_id=? AND user_id=?",
            id,
            u.id,
          )?.hero_id,
          channel: channelOf(action.type),
        },
      };
      persist(id, c);
      run(
        "INSERT INTO events VALUES (?,?,?,?,?)",
        rec.id,
        id,
        u.id,
        key,
        JSON.stringify(rec),
      );
      return rec;
    });
    broadcast(id);
    return result;
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 });
  let draining = false;
  app.server.on("upgrade", (req, socket, head) => {
    if (draining) {
      socket.destroy();
      return;
    }
    const url = new URL(req.url || "/", "http://localhost");
    const id = url.searchParams.get("world") || "",
      u = session(req.headers.cookie);
    if (
      url.pathname !== "/live" ||
      !u ||
      !originOk(req.headers.origin, req.headers.host) ||
      !one("SELECT role FROM members WHERE world_id=? AND user_id=?", id, u.id)
    ) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.set(ws, {
        world: id,
        user: u.id,
        session: digest(cookie(req.headers.cookie)),
      });
      ws.on("close", () => sockets.delete(ws));
      ws.on("error", () => ws.terminate());
      ws.on("message", () => ws.close(1008));
      ws.send("ready");
    });
  });
  let simulationCursor = 0;
  let lastTickAt = performance.now();
  const simulation = setInterval(() => {
    const started = performance.now();
    const delayMs = Math.max(0, started - lastTickAt - creatureStepMs);
    lastTickAt = started;
    const updated: string[] = [];
    let sceneWrites = 0,
      characterWrites = 0,
      notifications = 0;
    const active = new Map<string, Set<string>>();
    for (const [ws, client] of sockets) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (!active.has(client.world)) active.set(client.world, new Set());
      active.get(client.world)!.add(client.user);
    }
    const worlds = [...active.keys()];
    const count = Math.min(worlds.length, 8);
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      const id = worlds[(simulationCursor + i) % worlds.length];
      try {
        const actors = [...active.get(id)!]
          .slice(0, 32)
          .map((uid) => state(id, uid))
          .filter((c): c is Character => Boolean(c));
        const areas = new Set<Area>(actors.map((c) => details(c).area));
        if (!areas.size) continue;
        const w = world(id);
        const walkable = creatureGround(w.seed, w.land);
        const byUser = new Map(actors.map((c) => [c.userId, c]));
        const sensed = actors
          .filter((c) => {
            const e = details(c);
            return e.hp > 0 && !(e.guard === "stealth" && e.guardUntil > now);
          })
          .map((c) => ({
            id: c.userId,
            area: details(c).area,
            x: c.x,
            y: c.y,
          }));
        const changed = transaction(() => {
          const sc = scene(id);
          const dirty = new Set<Character>();
          const moved = simulateCreatures(
            sc,
            areas,
            sensed,
            walkable,
            now,
            randomInt,
            (creature, target, profile) => {
              const victim = byUser.get(target.id);
              if (!victim || details(victim).hp <= 0) return false;
              const e = details(victim);
              const combat = resolveAction("probabilistic", true, [
                {
                  capacity: profile.aptitude,
                  difficulty: victim.capacity + victim.level,
                  modifier: 0,
                  roll: randomInt(1, 101),
                },
              ]);
              const guard =
                e.guardUntil > now
                  ? e.guard === "block"
                    ? 3
                    : e.guard === "dodge"
                      ? 2
                      : 1
                  : 0;
              const damage = combat.success
                ? Math.max(
                    0,
                    profile.damage -
                      attributes(victim).resistance.current -
                      guard,
                  )
                : 0;
              if (damage) {
                e.hp = Math.max(0, e.hp - damage);
                dirty.add(victim);
              }
              if (
                discover(
                  e,
                  { ...creature, worldId: id },
                  "ability",
                  now,
                  profile.ability,
                )
              )
                dirty.add(victim);
              return true;
            },
          );
          for (const area of areas)
            for (const creature of visibleCreatures(sc, area, id))
              for (const actor of actors)
                if (
                  canObserve(actor, creature, walkable) &&
                  discover(details(actor), creature, "seen", now)
                )
                  dirty.add(actor);
          if (moved) {
            saveScene(id, sc);
            sceneWrites++;
          }
          for (const actor of dirty) {
            persist(id, actor);
            characterWrites += 2;
          }
          return moved || dirty.size > 0;
        });
        updated.push(id);
        if (changed) notifications += broadcast(id);
      } catch (error) {
        app.log.error(error, "Creature simulation update failed");
      }
    }
    if (count) simulationCursor = (simulationCursor + count) % worlds.length;
    onCreatureTick?.({
      durationMs: performance.now() - started,
      delayMs,
      active: worlds.length,
      updated,
      sceneWrites,
      characterWrites,
      notifications,
    });
  }, creatureStepMs);
  simulation.unref();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of limits) if (v.until <= now) limits.delete(k);
    revokeSocketSessions(
      (s) =>
        !one(
          "SELECT token FROM sessions WHERE token=? AND expires>?",
          s.session,
          now,
        ),
    );
    run("DELETE FROM sessions WHERE expires<=?", now);
    run("DELETE FROM account_links WHERE expires<=?", now);
  }, 60000);
  sweep.unref();
  app.addHook("preClose", async () => {
    draining = true;
    clearInterval(simulation);
    clearInterval(sweep);
    // Upgraded sockets must finish before Fastify can close its HTTP server.
    const deadline = setTimeout(() => {
      for (const socket of wss.clients) socket.terminate();
    }, 1500);
    try {
      for (const socket of wss.clients) socket.close(1012, "Server restart");
      await new Promise<void>((done) => wss.close(() => done()));
    } finally {
      clearTimeout(deadline);
    }
  });
  app.addHook("onClose", async () => {
    store.db.close();
  });
  const root = resolve("dist");
  app.get("/healthz", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      one("SELECT id FROM worlds LIMIT 1");
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });
  app.get("/*", async (r, reply: FastifyReply) => {
    const raw = (r.params as { "*": string })["*"];
    const file = resolve(root, raw || "index.html");
    ensure(
      file.startsWith(root + sep) && existsSync(file),
      "Страница не найдена",
      404,
    );
    const types: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript",
      ".css": "text/css",
      ".png": "image/png",
      ".svg": "image/svg+xml",
    };
    return reply
      .type(types[extname(file)] || "application/octet-stream")
      .send(readFileSync(file));
  });
  return app;
}

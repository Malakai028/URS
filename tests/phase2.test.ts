import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../apps/server/app.ts";
import { newCharacter } from "../apps/server/game.ts";
import { advance, details, freshScene } from "../apps/server/adventure.ts";
import { standardLook } from "../packages/shared/phase2.ts";
import { validateTraits } from "../packages/engine/attributes.ts";
const identity = {
  name: "Север",
  race: "R-001",
  profession: "C-001",
  flaw: "Утомляемость",
  mode: "manual",
};
test("v1 upgrade preserves bcrypt login, veteran XP, world membership and appearance through selection", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ure-upgrade-")),
    file = join(dir, "world.sqlite");
  const raw = new DatabaseSync(file);
  raw.exec(
    readFileSync(new URL("../apps/server/001.sql", import.meta.url), "utf8"),
  );
  const uid = randomUUID(),
    wid = randomUUID(),
    password = "veteran-old";
  const c = newCharacter(uid, identity);
  c.level = 3;
  c.xp = "987";
  c.x = 14;
  raw
    .prepare("INSERT INTO users VALUES (?,?,?)")
    .run(uid, "Veteran", await bcrypt.hash(password, 4));
  raw
    .prepare("INSERT INTO worlds VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(
      wid,
      uid,
      "Test",
      "",
      "abc",
      "Лес",
      "invite",
      JSON.stringify({
        location: "Тракт",
        description: "Дорога",
        npc: "Лада",
        hook: "Маяк",
      }),
      "Template",
      "0.6",
    );
  raw.prepare("INSERT INTO members VALUES (?,?,?)").run(wid, uid, "owner");
  raw
    .prepare("INSERT INTO characters VALUES (?,?,?)")
    .run(wid, uid, JSON.stringify(c));
  raw.close();
  const app = createApp(file);
  let cookie = "";
  const api = (url: string, payload?: any) =>
    app.inject({
      url: "/api/" + url,
      method: payload ? "POST" : "GET",
      headers: { cookie },
      payload,
    });
  try {
    const login = await api("auth/login", { name: "Veteran", password });
    assert.equal(login.statusCode, 200);
    cookie = String(login.headers["set-cookie"]).split(";")[0];
    const list = (await api("heroes")).json();
    assert.equal(list.length, 1);
    const id = list[0].id;
    assert.equal(list[0].xp, "987");
    const path = "worlds/" + wid;
    await api("heroes/" + id, {
      op: "edit",
      name: "Дозорный",
      look: { ...standardLook, cloak: "amber" },
    });
    assert.equal((await api(path)).json().character.extra.look.cloak, "amber");
    assert.equal((await api(path + "/select", { hero: null })).statusCode, 200);
    assert.equal((await api(path)).json().character, null);
    await api(path + "/select", { hero: id });
    const resumed = (await api(path)).json().character;
    assert.deepEqual([resumed.level, resumed.xp, resumed.x], [3, "987", 14]);
    await api("heroes/" + id, { op: "duplicate" });
    const clone = (await api("heroes")).json().find((v: any) => v.id !== id);
    assert.equal(clone.level, 0);
    assert.ok(!clone.worldId);
    assert.equal(
      (await api("heroes/" + id, { op: "archive" })).statusCode,
      400,
    );
    assert.equal(
      (await api("heroes/" + clone.id, { op: "archive" })).statusCode,
      200,
    );
    assert.equal(
      (await api("heroes/" + clone.id, { op: "delete", confirmation: "wrong" }))
        .statusCode,
      400,
    );
    assert.equal(
      (
        await api("heroes/" + clone.id, {
          op: "delete",
          confirmation: clone.name,
        })
      ).statusCode,
      200,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("account validation, public privacy, session rotation and logout", async () => {
  const app = createApp(":memory:");
  let cookie = "";
  const api = (path: string, payload?: any) =>
    app.inject({
      url: "/api/" + path,
      method: payload ? "POST" : "GET",
      headers: { cookie },
      payload,
    });
  const f = {
    name: "Tester",
    email: "profile@example.test",
    display: "Картограф",
    password: "Двенадцать длинных слов",
    confirmation: "Двенадцать длинных слов",
    accepted: true,
    avatar: "moon",
  };
  try {
    for (const wrong of [
      { email: "bad" },
      { password: "password123456", confirmation: "password123456" },
      { confirmation: "incorrect" },
      { accepted: false },
    ])
      assert.equal(
        (await api("auth/register", { ...f, ...wrong })).statusCode,
        400,
      );
    const r = await api("auth/register", f);
    assert.equal(r.statusCode, 200);
    cookie = String(r.headers["set-cookie"]).split(";")[0];
    const uid = r.json().id;
    assert.equal((await api("auth/register", f)).statusCode, 409);
    assert.equal(
      (await api("auth/login", { name: f.name, password: "wrong" })).statusCode,
      401,
    );
    assert.equal((await api("profiles/" + uid)).statusCode, 404);
    await api("profile", {
      display: "Новое имя",
      bio: "Тракт",
      avatar: "peak",
      publicProfile: true,
    });
    assert.deepEqual((await api("profiles/" + uid)).json(), {
      display: "Новое имя",
      bio: "Тракт",
      avatar: "peak",
    });
    const pass = "Другая хорошая парольная фраза";
    assert.equal(
      (
        await api("profile/password", {
          old: f.password,
          password: pass,
          confirmation: pass,
        })
      ).statusCode,
      200,
    );
    assert.equal((await api("me")).statusCode, 401);
    const l = await api("auth/login", { name: f.name, password: pass });
    cookie = String(l.headers["set-cookie"]).split(";")[0];
    await api("logout", {});
    assert.equal((await api("me")).statusCode, 401);
  } finally {
    await app.close();
  }
});
test("shared cache, equipment, traversal, combat, loot and beacon have persistent consequences", () => {
  const c = newCharacter("player", identity),
    s = freshScene(),
    w = { seed: "A", land: "Лес", draft: { npc: "Лада" } };
  let now = 10000;
  const ability = (skill: any, target?: any, dx?: number, dy?: number) =>
    advance(
      c,
      { type: "ability", skill, target, dx, dy },
      s,
      w,
      (now += 2000),
      c.userId,
    );
  const equip = (op: any, item: string) =>
    advance(c, { type: "gear", op, item }, s, w, (now += 2000), c.userId);
  ability("interact", "cache");
  assert.throws(() => ability("interact", "cache"));
  for (const l of [...s.loot]) {
    equip("take", l.id);
    equip("equip", l.id);
  }
  assert.equal(details(c).gear.length, 2);
  assert.equal(s.loot.length, 0);
  ability("run", undefined, 1, 0);
  assert.equal(c.x, 14);
  ability("jump", undefined, 0, 1);
  assert.equal(c.y, 14);
  assert.equal(details(c).stamina < 12, true);
  ability("interact", "gate");
  assert.equal(details(c).area, "vault");
  ability("run", undefined, 1, 0);
  ability("jump", undefined, 0, 1);
  const health = [];
  for (let i = 0; i < 100 && s.guardian > 0; i++) {
    ability("rest");
    ability("block");
    ability("attack", "sentinel");
    health.push(details(c).hp);
  }
  assert.equal(s.guardian, 0);
  assert.ok(health.every((h) => h > 0));
  assert.equal(s.claimed.length, 1);
  ability("walk", undefined, 1, 0);
  ability("interact", "beacon");
  assert.equal(s.beacon, true);
  assert.throws(() => ability("interact", "beacon"));
  assert.equal(c.xp, "115");
  c.x = 1;
  c.y = 1;
  assert.throws(() => ability("walk", undefined, -1, 0));
  assert.equal(validateTraits(["fatigue", "fatigue"]), false);
});

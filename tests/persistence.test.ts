import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../apps/server/app.ts";
import { apply, newCharacter, characterView } from "../apps/server/game.ts";
import { details, freshScene } from "../apps/server/adventure.ts";

const identity = {
  name: "Ветеран",
  race: "R-009",
  profession: "C-022",
  flaw: "Рассеянность",
  mode: "manual",
};

test("FIX-01C level advancement records the implemented effects without inventing bonuses", () => {
  const c = newCharacter(randomUUID(), identity);
  details(c);
  c.xp = "100";
  const before = structuredClone(characterView(c));
  const event = apply(
    c,
    { type: "level" },
    {
      seed: "x",
      land: "Лес",
      draft: {
        location: "Тракт",
        description: "Дорога",
        npc: "Лада",
        hook: "Маяк",
      },
    },
    "owner",
    Date.now(),
  );
  const after = characterView(c);
  assert.equal(c.level, 1);
  assert.equal(c.xp, "0");
  assert.equal(event.audit.spent, "100");
  assert.equal(
    after.attributes.strength.normal,
    before.attributes.strength.normal + 1,
  );
  assert.equal(
    after.attributes.carry.normal,
    before.attributes.carry.normal + 2,
  );
  assert.equal(
    after.attributes.perception.normal,
    before.attributes.perception.normal + 1,
  );
  assert.equal(c.maxEnergy, before.maxEnergy + 1);
  assert.equal(c.energy, c.maxEnergy);
  assert.equal(c.tier, before.tier);
  assert.equal(c.rank, before.rank);
  assert.equal(c.q, before.q);
  assert.deepEqual(c.extra, before.extra);
  assert.equal(
    after.attributes.health.maximum,
    before.attributes.health.maximum,
  );
});

test("FIX-01C snapshots, hero switching, late join, logout and restart retain rich fixture state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ure-persist-")),
    file = join(dir, "save.sqlite");
  let app = createApp(file);
  const api = (cookie: string, path: string, payload?: any) =>
    app.inject({
      method: payload === undefined ? "GET" : "POST",
      url: "/api/" + path,
      headers: { cookie },
      payload,
    });
  const signup = async (name: string) => {
    const r = await api("", "auth/register", {
      name,
      display: name,
      email: name + "@example.test",
      password: "testing-password",
      confirmation: "testing-password",
      avatar: "leaf",
      accepted: true,
    });
    assert.equal(r.statusCode, 200);
    return {
      id: r.json().id,
      cookie: String(r.headers["set-cookie"]).split(";")[0],
    };
  };
  try {
    const a = await signup("veteran"),
      b = await signup("newcomer");
    const world = (
      await api(a.cookie, "worlds", {
        name: "Сохранённый мир",
        description: "Тракт",
        seed: "persistent",
        land: "Лес",
        access: "invite",
        ai: false,
      })
    ).json().id;
    const path = "worlds/" + world;
    await api(a.cookie, path + "/room", {});
    await api(a.cookie, path + "/character", identity);
    const h = (await api(a.cookie, "heroes")).json()[0];
    // Rich state is seeded only in this temporary database to exercise every persisted field.
    const fixture = new DatabaseSync(file);
    const c = JSON.parse(
      fixture
        .prepare("SELECT state FROM characters WHERE world_id=? AND user_id=?")
        .get(world, a.id)!.state as string,
    );
    c.level = 2;
    c.xp = "123";
    c.tier = 21;
    c.rank = 1;
    c.q = 222;
    c.x = 4;
    c.y = 5;
    c.talked = true;
    c.surveyed = true;
    c.inventory = 1;
    c.currency = "321";
    c.rewards = ["Награда"];
    c.extra.area = "lodge";
    c.extra.hp = 11;
    c.extra.stamina = 7;
    c.extra.guard = "block";
    c.extra.duel = false;
    c.extra.guardUntil = Date.now() + 60000;
    c.extra.uses.jump = 3;
    c.extra.cooldown.jump = Date.now() + 1000;
    c.extra.look.cloak = "plum";
    c.extra.gear = [{ id: randomUUID(), kind: "vest", equipped: true }];
    const scene = {
      ...freshScene(),
      opened: true,
      guardian: 0,
      beacon: true,
      claimed: [h.id],
    };
    fixture.exec("BEGIN IMMEDIATE");
    fixture
      .prepare("UPDATE characters SET state=? WHERE world_id=? AND user_id=?")
      .run(JSON.stringify(c), world, a.id);
    fixture
      .prepare("UPDATE heroes SET state=? WHERE id=?")
      .run(JSON.stringify(c), h.id);
    fixture
      .prepare("INSERT INTO scenes VALUES (?,?)")
      .run(world, JSON.stringify(scene));
    fixture.exec("COMMIT");
    fixture.close();
    await api(a.cookie, path + "/settings", {
      pvp: true,
      minLevel: 0,
      maxLevel: 50,
    });
    const before = (await api(a.cookie, path)).json();
    assert.equal(before.extent, 16);
    assert.equal(before.tiles.length, 16);
    const invite = (
      await api(a.cookie, path + "/invite", { role: "player" })
    ).json().code;
    await api(b.cookie, "join", { code: invite });
    await api(b.cookie, path + "/character", { ...identity, name: "Новичок" });
    assert.equal((await api(b.cookie, path)).json().beacon, true);
    assert.deepEqual(
      (await api(a.cookie, path)).json().character,
      before.character,
    );
    const second = (
      await api(a.cookie, "heroes", {
        ...identity,
        name: "Запасной",
        look: c.extra.look,
      })
    ).json().id;
    assert.equal(
      (await api(a.cookie, path + "/select", { hero: second })).statusCode,
      200,
    );
    assert.equal(
      (await api(a.cookie, path + "/select", { hero: h.id })).statusCode,
      200,
    );
    const returned = (await api(a.cookie, path)).json();
    assert.deepEqual(returned.character, before.character);
    await api(a.cookie, "logout", {});
    const login = await api("", "auth/login", {
      name: "veteran",
      password: "testing-password",
    });
    a.cookie = String(login.headers["set-cookie"]).split(";")[0];
    assert.deepEqual(
      (await api(a.cookie, path)).json().character,
      returned.character,
    );
    const saved = (await api(a.cookie, path)).json();
    await app.close();
    app = createApp(file);
    const restored = (await api(a.cookie, path)).json();
    assert.deepEqual(restored, saved);
    const check = new DatabaseSync(file, { readOnly: true });
    assert.deepEqual(
      JSON.parse(
        check.prepare("SELECT state FROM scenes WHERE world_id=?").get(world)!
          .state as string,
      ),
      scene,
    );
    assert.equal(check.prepare("SELECT count(*) n FROM heroes").get()!.n, 3);
    check.close();
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("FIX-01C concurrent unique loot and retried rewards execute once", async () => {
  const app = createApp(":memory:");
  const api = (cookie: string, path: string, payload?: any) =>
    app.inject({
      method: payload === undefined ? "GET" : "POST",
      url: "/api/" + path,
      headers: { cookie },
      payload,
    });
  try {
    const cookies: string[] = [];
    for (const name of ["alice", "bruno"]) {
      const r = await api("", "auth/register", {
        name,
        display: name,
        email: name + "@example.test",
        password: "testing-password",
        confirmation: "testing-password",
        avatar: "leaf",
        accepted: true,
      });
      cookies.push(String(r.headers["set-cookie"]).split(";")[0]);
    }
    const [a, b] = cookies;
    const id = (
        await api(a, "worlds", {
          name: "Общий тайник",
          description: "",
          seed: "race",
          land: "Лес",
          access: "invite",
          ai: false,
        })
      ).json().id,
      path = "worlds/" + id;
    await api(a, path + "/room", {});
    const code = (await api(a, path + "/invite", { role: "player" })).json()
      .code;
    await api(b, "join", { code });
    for (const cookie of cookies)
      await api(cookie, path + "/character", identity);
    const action = (cookie: string, action: any, key = randomUUID()) =>
      api(cookie, path + "/action", { key, action });
    const key = randomUUID();
    const retries = await Promise.all(
      Array.from({ length: 8 }, () => action(a, { type: "talk" }, key)),
    );
    assert.ok(retries.every((r) => r.statusCode === 200));
    assert.equal(new Set(retries.map((r) => r.json().id)).size, 1);
    assert.equal((await api(a, path)).json().character.xp, "40");
    await action(a, { type: "ability", skill: "interact", target: "cache" });
    const item = (await api(a, path))
      .json()
      .objects.find((o: any) => o.kind === "loot").id;
    const claims = await Promise.all(
      cookies.map((cookie) =>
        action(cookie, { type: "gear", op: "take", item }),
      ),
    );
    assert.deepEqual(claims.map((r) => r.statusCode).sort(), [200, 400]);
    const snapshots = await Promise.all(
      cookies.map(async (cookie) => (await api(cookie, path)).json()),
    );
    assert.equal(
      snapshots.reduce(
        (n, s) =>
          n + s.character.extra.gear.filter((g: any) => g.id === item).length,
        0,
      ),
      1,
    );
    assert.ok(
      snapshots.every((s) => !s.objects.some((o: any) => o.id === item)),
    );
    assert.equal(
      (
        await action(b, {
          type: "move",
          dx: 1,
          dy: 0,
          state: snapshots[0].character,
        })
      ).statusCode,
      400,
    );
    const stable = (await api(a, path)).json();
    await Promise.all(Array.from({ length: 8 }, () => api(a, path)));
    assert.deepEqual((await api(a, path)).json(), stable);
  } finally {
    await app.close();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../apps/server/app.ts";

test("FIX-20A an advancement purchases the displayed level once, unlocks sprint and survives restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ure-level-"));
  const file = join(dir, "world.sqlite");
  let app = createApp(file);
  let cookie = "";
  const api = (path: string, payload?: object) =>
    app.inject({
      method: payload === undefined ? "GET" : "POST",
      url: "/api/" + path,
      headers: { cookie },
      payload,
    });
  try {
    const account = await api("auth/register", {
      name: "Wayfarer",
      display: "Путешественник",
      email: "rpg@example.test",
      password: "testing-password",
      confirmation: "testing-password",
      avatar: "leaf",
      accepted: true,
    });
    assert.equal(account.statusCode, 200);
    cookie = String(account.headers["set-cookie"]).split(";")[0];
    const world = (
      await api("worlds", {
        name: "Перевал",
        seed: "level",
        description: "",
        land: "Лес",
        access: "invite",
        ai: false,
      })
    ).json().id;
    const path = "worlds/" + world;
    const template = {
      name: "Странник",
      race: "R-009",
      profession: "C-022",
      flaw: "Рассеянность",
      mode: "manual",
    };
    assert.equal((await api(path + "/room", {})).statusCode, 200);
    assert.equal((await api(path + "/character", template)).statusCode, 200);
    const before = (await api(path)).json();
    const hero = before.activeHeroId;
    const action = (value: object, key = randomUUID()) =>
      api(path + "/action", { action: value, key });
    const level = { type: "level", expected: { level: 0, hero } };
    const sprint = { type: "ability", skill: "sprint", dx: 1, dy: 0 };
    assert.equal((await action(sprint)).statusCode, 400);
    assert.equal((await action(level)).statusCode, 400);

    // Two consecutive levels are affordable. Only one was displayed in the two tabs.
    const db = new DatabaseSync(file);
    try {
      db.prepare(
        "UPDATE characters SET state=json_set(state,'$.xp','1000','$.energy',2) WHERE world_id=? AND user_id=?",
      ).run(world, account.json().id);
    } finally {
      db.close();
    }
    const keys = [randomUUID(), randomUUID()];
    const results = await Promise.all(keys.map((key) => action(level, key)));
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
    const winner = results.findIndex((r) => r.statusCode === 200);
    const event = results[winner].json();
    assert.equal(event.audit.spent, "100");
    assert.equal((await action(level, keys[winner])).json().id, event.id);
    const after = (await api(path)).json().character;
    assert.deepEqual(
      [after.level, after.xp, after.energy, after.maxEnergy],
      [1, "900", 9, 9],
    );
    assert.deepEqual(after.rewards, ["base"]);
    assert.equal(
      after.attributes.carry.current,
      before.character.attributes.carry.current + 2,
    );
    assert.equal((await action(sprint)).statusCode, 200);
    assert.equal((await api(path)).json().character.x, before.character.x + 3);

    const spare = (
      await api("heroes", {
        ...template,
        name: "Спутник",
        look: after.extra.look,
      })
    ).json().id;
    assert.equal(
      (await api(path + "/select", { hero: spare })).statusCode,
      200,
    );
    assert.equal((await action(level)).statusCode, 409);
    assert.equal((await api(path)).json().character.level, 0);
    assert.equal((await api(path + "/select", { hero })).statusCode, 200);
    await app.close();
    app = createApp(file);
    const saved = (await api(path)).json();
    assert.equal(saved.activeHeroId, hero);
    assert.deepEqual([saved.character.level, saved.character.xp], [1, "900"]);
    assert.equal(
      saved.events.filter((e: { action: string }) => e.action === "level")
        .length,
      1,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

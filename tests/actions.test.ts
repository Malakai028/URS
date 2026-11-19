import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../apps/server/app.ts";
import { advance, freshScene } from "../apps/server/adventure.ts";
import { newCharacter } from "../apps/server/game.ts";
import { standardLook } from "../packages/shared/phase2.ts";
import { targetSelection } from "../packages/shared/targeting.ts";

const hero = {
  name: "Следопыт",
  race: "R-001",
  profession: "C-001",
  flaw: "Утомляемость",
  mode: "manual",
};
test("FIX-01A invalid explicit target cannot silently execute a nearby interaction", () => {
  const c = newCharacter(randomUUID(), hero),
    scene = freshScene();
  assert.throws(
    () =>
      advance(
        c,
        { type: "ability", skill: "interact", target: randomUUID() },
        scene,
        { seed: "fix", land: "Лес", draft: { npc: "Проводник" } },
        Date.now(),
        c.userId,
      ),
    /Недопустимая цель/,
  );
  assert.equal(scene.opened, false);
  assert.equal(c.talked, false);
});

test("FIX-01A action validation, replay, roll audit and persisted state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ure-actions-")),
    file = join(dir, "test.sqlite");
  let app = createApp(file);
  const api = (path: string, body?: Record<string, unknown>, cookie = "") =>
    app.inject({
      method: body === undefined ? "GET" : "POST",
      url: "/api/" + path,
      headers: { cookie },
      payload: body,
    });
  try {
    const auth = await api("auth/register", {
      name: "actions",
      display: "Испытатель",
      email: "actions@example.test",
      password: "testing-password",
      confirmation: "testing-password",
      avatar: "leaf",
      accepted: true,
    });
    assert.equal(auth.statusCode, 200);
    const cookie = String(auth.headers["set-cookie"]).split(";")[0];
    const w = (
      await api(
        "worlds",
        {
          name: "Проверка",
          description: "",
          seed: "fix",
          land: "Лес",
          access: "invite",
          ai: false,
        },
        cookie,
      )
    ).json().id;
    const path = "worlds/" + w;
    await api(path + "/room", {}, cookie);
    assert.equal(
      (await api(path + "/character", hero, cookie)).statusCode,
      200,
    );
    const act = (action: unknown, key = randomUUID(), session = cookie) =>
      api(path + "/action", { key, action }, session);
    assert.equal(
      (await act({ type: "roll" }, randomUUID(), "")).statusCode,
      401,
    );
    const before = (await api(path, undefined, cookie)).json();
    assert.equal(
      (await act({ type: "ability", skill: "interact", target: randomUUID() }))
        .statusCode,
      400,
    );
    assert.equal(
      (await act({ type: "ability", skill: "attack" })).statusCode,
      400,
    );
    assert.equal((await act({ type: "move", dx: 3, dy: 0 })).statusCode, 400);
    assert.deepEqual(
      (await api(path, undefined, cookie)).json().character,
      before.character,
    );
    const key = randomUUID();
    const opened = await act(
      { type: "ability", skill: "interact", target: "cache" },
      key,
    );
    assert.equal(opened.statusCode, 200);
    assert.deepEqual(
      (
        await act({ type: "ability", skill: "interact", target: "cache" }, key)
      ).json(),
      opened.json(),
    );
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const r = await act({ type: "roll" });
      assert.equal(r.statusCode, 200);
      const event = r.json(),
        roll = event.audit.attempts[0].roll;
      assert.ok(Number.isInteger(roll) && roll >= 1 && roll <= 100);
      assert.equal(event.audit.channel, "actions");
      ids.add(event.id);
    }
    assert.equal(ids.size, 20);
    const saved = (await api(path, undefined, cookie)).json();
    const rolls = saved.events.filter((e: any) => e.action === "roll");
    assert.equal(rolls.length, 20);
    await app.close();
    app = createApp(file);
    const restored = (await api(path, undefined, cookie)).json();
    assert.deepEqual(restored.character, saved.character);
    assert.deepEqual(restored.events, saved.events);
    // Independent targetless use remains compatible with the existing hero library.
    assert.equal(
      (await api("heroes", { ...hero, look: standardLook }, cookie)).statusCode,
      200,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("FIX-01A shared targeting forms validate their required arguments", () => {
  for (const selection of [
    { mode: "none" },
    { mode: "self" },
    { mode: "nearest" },
    { mode: "direction", dx: 1, dy: 0 },
    { mode: "entity", id: "guide" },
    { mode: "point", x: 1, y: 2 },
    { mode: "area", id: "vault" },
    { mode: "multiple", ids: ["guide", "cache"] },
  ])
    assert.equal(targetSelection.safeParse(selection).success, true);
  assert.equal(
    targetSelection.safeParse({ mode: "direction", dx: 1, dy: 1 }).success,
    false,
  );
  assert.equal(targetSelection.safeParse({ mode: "entity" }).success, false);
});

test("FIX-01A automatic interaction and selected inspection use the intended object", () => {
  const c = newCharacter(randomUUID(), hero);
  const world = { seed: "fix", land: "Лес", draft: { npc: "Проводник" } };
  const scene = freshScene(), now = Date.now();
  const automatic = advance(c, { type: "ability", skill: "interact" }, scene, world, now, c.userId);
  assert.equal(automatic.audit.target, "guide");
  assert.equal(c.talked, true);
  const inspected = advance(c, { type: "ability", skill: "observe", target: "cache" }, scene, world, now, c.userId);
  assert.match(inspected.text, /Тайник/);
  assert.doesNotMatch(inspected.text, /Проводник/);
  assert.throws(() => advance(c, { type: "ability", skill: "observe", target: "cave" },
    scene, world, now + 1000, c.userId), /вне дистанции/);
});

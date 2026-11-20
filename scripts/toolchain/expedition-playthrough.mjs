import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { createApp } from "../../apps/server/app.ts";

// A fresh party drives the real HTTP routes. No seed XP, fixture positions or SQL edits.
const dir = await mkdtemp(join(tmpdir(), "ure-journey-"));
const file = join(dir, "party.sqlite");
let app = createApp(file);
let address;
async function request(cookie, path, body) {
  const response = await fetch(address + "/api/" + path, {
    signal: AbortSignal.timeout(15000),
    method: body === undefined ? "GET" : "POST",
    headers: {
      cookie,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(
    response.status,
    200,
    path + ": " + (data.error || "запрос отклонён"),
  );
  return { data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
async function register(name) {
  const password = randomUUID();
  return (
    await request("", "auth/register", {
      name,
      display: name,
      email: name + "@example.test",
      password,
      confirmation: password,
      accepted: true,
      avatar: "leaf",
    })
  ).cookie;
}
try {
  address = await app.listen({ host: "127.0.0.1", port: 0 });
  const owner = await register("Pathfinder");
  const friend = await register("Traveller");
  const world = (
    await request(owner, "worlds", {
      name: "Путь к маяку",
      description: "",
      access: "invite",
      land: "Лес",
      seed: "A",
      ai: false,
    })
  ).data.id;
  const path = "worlds/" + world;
  await request(owner, path + "/room", {});
  const code = (await request(owner, path + "/invite", { role: "player" })).data
    .code;
  await request(friend, "join", { code });
  for (const [cookie, name] of [
    [owner, "Руна"],
    [friend, "Ива"],
  ])
    await request(cookie, path + "/character", {
      name,
      mode: "manual",
      race: "R-001",
      profession: "C-001",
      flaw: "Утомляемость",
    });
  const snapshot = async (cookie) => (await request(cookie, path)).data;
  if (process.argv.includes("--browser")) {
    const { playBrowserExpedition } =
      await import("../../tests/browser-expedition.mjs");
    await playBrowserExpedition({
      address,
      world,
      owner,
      friend,
      snapshot,
      restart: async () => {
        const port = Number(new URL(address).port);
        await app.close();
        app = createApp(file);
        await app.listen({ host: "127.0.0.1", port });
      },
    });
  } else {
    const act = async (action) =>
      (await request(owner, path + "/action", { key: randomUUID(), action }))
        .data;
    const use = (skill, extra = {}) =>
      act({ type: "ability", skill, ...extra });
    assert.equal((await snapshot(owner)).character.xp, "0");
    await act({ type: "talk" });
    await use("interact", { target: "cache" });
    const camp = await snapshot(friend);
    assert.equal(camp.cacheOpened, true);
    const loot = camp.objects.filter((o) => o.kind === "loot");
    assert.equal(loot.length, 2);
    for (const item of loot) {
      await act({ type: "gear", op: "take", item: item.id });
      await act({ type: "gear", op: "equip", item: item.id });
    }
    const traverse = async () => {
      await use("run", { dx: 1, dy: 0 });
      await pause(650);
      await use("jump", { dx: 0, dy: 1 });
      await pause(650);
    };
    await traverse();
    await use("interact", { target: "gate" });
    await traverse();
    for (let turn = 0; turn < 100; turn++) {
      await use("rest");
      await use("block");
      await use("attack", { target: "sentinel" });
      const guard = (await snapshot(owner)).objects.find(
        (o) => o.id === "sentinel",
      );
      if (!guard || !guard.creature.alive) break;
      await pause(1550);
    }
    await use("walk", { dx: 1, dy: 0 });
    await use("interact", { target: "beacon" });
    assert.equal((await snapshot(friend)).beacon, true);
    const speak = async (action) =>
      (await request(friend, path + "/action", { key: randomUUID(), action }))
        .data;
    const greeting = await speak({ type: "talk" });
    assert.match(greeting.text, /Маяк горит/);
    assert.equal(greeting.audit.xpAward, 40);
    const repeated = await speak({
      type: "ability",
      skill: "interact",
      target: "guide",
    });
    assert.equal(repeated.text, greeting.text);
    assert.equal(repeated.audit.xpAward, 0);
    assert.equal((await snapshot(friend)).character.xp, "40");
    const before = await snapshot(owner);
    await act({
      type: "level",
      expected: { level: 0, hero: before.activeHeroId },
    });
    const advanced = await snapshot(owner);
    assert.equal(advanced.character.level, 1);
    assert.equal(
      BigInt(advanced.character.xp),
      BigInt(before.character.xp) - 100n,
    );
    await app.close();
    app = createApp(file);
    address = await app.listen({ host: "127.0.0.1", port: 0 });
    const restored = await snapshot(owner);
    assert.deepEqual(restored.character, advanced.character);
    const party = await snapshot(friend);
    assert.equal(party.beacon, true);
    assert.equal(party.character.level, 0);
    console.log(
      "PASS · новая партия, тайник, снаряжение, страж, маяк, " +
        before.character.xp +
        " заработанных XP, уровень 1, перезапуск.",
    );
  }
} finally {
  await app.close();
  await rm(dir, { recursive: true, force: true });
}

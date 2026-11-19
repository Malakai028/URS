import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout } from "node:timers/promises";
import { chromium } from "playwright-core";
import { createApp } from "../apps/server/app.ts";
import { details } from "../apps/server/adventure.ts";

const dir = mkdtempSync(join(tmpdir(), "ure-browser-creatures-"));
const database = join(dir, "world.sqlite");
const exe = [
  process.env.BROWSER_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((candidate) => candidate && existsSync(candidate));
let app = createApp(database),
  browser,
  origin;
try {
  assert.ok(exe, "Set BROWSER_PATH to an installed Chrome");
  origin = await app.listen({ host: "127.0.0.1", port: 0 });
  browser = await chromium.launch({ executablePath: exe, headless: true });
  const a = await browser.newPage({ viewport: { width: 1400, height: 960 } });
  const b = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const errors = [];
  for (const page of [a, b]) {
    page.on("pageerror", (error) => errors.push(error.message));
    await page
      .context()
      .route("**/*", (route) =>
        new URL(route.request().url()).origin === origin
          ? route.continue()
          : route.abort(),
      );
    await page.routeWebSocket("**/*", (socket) => {
      if (
        socket
          .url()
          .replace(/^ws:/, "http:")
          .startsWith(origin + "/")
      )
        socket.connectToServer();
      else socket.close();
    });
  }
  const get = (page, path) => page.request.get(origin + "/api/" + path);
  async function post(page, path, data) {
    const result = await page.request.post(origin + "/api/" + path, { data });
    assert.equal(
      result.status(),
      200,
      path + " " + (result.ok() ? "" : await result.text()),
    );
    return result.json();
  }
  async function register(page, name) {
    return post(page, "auth/register", {
      name,
      email: name + "@example.test",
      display: name,
      avatar: "leaf",
      password: "Вереск глина щавель картон",
      confirmation: "Вереск глина щавель картон",
      accepted: true,
    });
  }
  const first = await register(a, "creatureowner"),
    second = await register(b, "creatureguest");
  const { id } = await post(a, "worlds", {
    name: "Звери тракта",
    description: "",
    seed: "creatures",
    land: "Лес",
    access: "invite",
    ai: false,
  });
  const world = "worlds/" + id;
  const address = () => origin + "/?world=" + id;
  await post(a, world + "/room", {});
  const invite = await post(a, world + "/invite", { role: "player" });
  await post(b, "join", { code: invite.code });
  const hero = {
    name: "Следопыт",
    race: "R-001",
    profession: "C-001",
    flaw: "Утомляемость",
    mode: "manual",
  };
  await post(a, world + "/character", { ...hero, name: "Путник" });
  await post(b, world + "/character", hero);
  function place(area) {
    const db = new DatabaseSync(database);
    try {
      for (const [user, x, y] of [
        [first.id, area === "field" ? 14 : 4, area === "field" ? 12 : 4],
        [second.id, area === "field" ? 14 : 5, area === "field" ? 12 : 3],
      ]) {
        const stored = db
          .prepare(
            "SELECT state FROM characters WHERE world_id=? AND user_id=?",
          )
          .get(id, user);
        const c = JSON.parse(stored.state);
        Object.assign(c, { x, y, capacity: 32768, xp: "42" });
        details(c).area = area;
        const state = JSON.stringify(c);
        db.prepare(
          "UPDATE characters SET state=? WHERE world_id=? AND user_id=?",
        ).run(state, id, user);
        db.prepare(
          "UPDATE heroes SET state=? WHERE id=(SELECT hero_id FROM active_heroes WHERE world_id=? AND user_id=?)",
        ).run(state, id, user);
      }
      if (area === "vault") {
        const sc = JSON.parse(
          db.prepare("SELECT state FROM scenes WHERE world_id=?").get(id).state,
        );
        sc.creatures.sentinel = {
          position: { x: 5, y: 4 },
          facing: { x: 0, y: -1 },
          routeIndex: 0,
          behavior: "alert",
          target: second.id,
          lastSeen: { x: 5, y: 3 },
          moved: false,
          lastAction: "notice",
          updatedAt: Date.now(),
        };
        db.prepare("UPDATE scenes SET state=? WHERE world_id=?").run(
          JSON.stringify(sc),
          id,
        );
      }
    } finally {
      db.close();
    }
  }
  const creature = async (page, uid) => {
    const snapshot = await (await get(page, world)).json();
    return snapshot.objects.find((item) => item.id === uid)?.creature;
  };
  const locate = (page, uid) => page.locator("[data-creature='" + uid + "']");
  const canvas = (page) =>
    page
      .getByRole("img", { name: /Карта мира/ })
      .or(page.locator("canvas[aria-label^='Карта мира']"));
  const enter = async (page) => {
    await page.goto(address());
    await page.getByRole("heading", { name: "Карта местности" }).waitFor();
  };
  const shotDir = process.env.URE_SCREENSHOT_DIR || "test-results/browser";
  mkdirSync(shotDir, { recursive: true });
  async function eventually(check) {
    for (let i = 0; i < 35; i++) {
      if (await check()) return;
      await setTimeout(250);
    }
    assert.fail("Creature snapshots did not converge");
  }

  place("field");
  const trail = "trail-scout";
  const initial = await creature(a, trail);
  assert.deepEqual((await creature(b, trail)).position, initial.position);
  assert.equal(initial.behavior, "idle");
  await Promise.all([enter(a), enter(b)]);
  await canvas(a).screenshot({
    path: join(shotDir, "creature-silhouettes.png"),
  });
  await eventually(async () => {
    const [one, two] = await Promise.all([
      creature(a, trail),
      creature(b, trail),
    ]);
    return (
      one &&
      two &&
      JSON.stringify(one.position) !== JSON.stringify(initial.position) &&
      JSON.stringify(one.position) === JSON.stringify(two.position) &&
      one.behavior === two.behavior &&
      one.behavior !== "idle"
    );
  });
  assert.equal((await creature(a, trail)).speciesId, null);
  const { position } = await creature(a, trail);
  await locate(a, trail)
    .getByText(position.x + ", " + position.y, { exact: true })
    .waitFor();
  // The DOM reflects the snapshot immediately. Let the canvas finish the step.
  await setTimeout(300);
  const goblinHead = await canvas(a).evaluate((el) => {
    const image = el.getContext("2d").getImageData(0, 0, el.width, el.height);
    let count = 0,
      x = 0,
      y = 0;
    for (let i = 0; i < image.data.length; i += 4) {
      if (
        image.data[i] !== 162 ||
        image.data[i + 1] !== 178 ||
        image.data[i + 2] !== 105
      )
        continue;
      count++;
      x += (i / 4) % el.width;
      y += Math.floor(i / 4 / el.width);
    }
    return count
      ? {
          x: ((x / count) * el.clientWidth) / el.width,
          y: ((y / count) * el.clientHeight) / el.height,
        }
      : null;
  });
  assert.ok(goblinHead, "The goblin sprite is painted on the live canvas");
  await canvas(a).hover({ position: goblinHead });
  await a
    .getByRole("region", { name: "Сведения о существе" })
    .getByText("Неопознанное существо", { exact: true })
    .waitFor();
  await canvas(a).click({ position: goblinHead });
  await locate(a, trail).locator("button[aria-pressed='true']").waitFor();
  await locate(b, trail).getByRole("button").tap();
  const quick = b.getByRole("region", { name: "Сведения о существе" });
  await quick.getByText("Неопознанное существо", { exact: true }).waitFor();
  assert.equal(
    await locate(b, trail).getByRole("button").getAttribute("aria-pressed"),
    "true",
  );
  await quick.getByRole("button", { name: "Подробный осмотр" }).tap();
  const mobileCard = b.getByRole("dialog", { name: "Осмотр существа" });
  await mobileCard
    .getByRole("heading", { name: "Неопознанное существо" })
    .waitFor();
  assert.equal(await mobileCard.getByRole("progressbar").count(), 0);
  assert.equal(
    await mobileCard
      .getByRole("button", { name: "Открыть в бестиарии" })
      .count(),
    0,
  );
  const identification = b.waitForResponse(
    (res) => res.url() === origin + "/api/" + world + "/action",
  );
  await mobileCard.getByRole("button", { name: "Определить вид" }).tap();
  const identified = await identification;
  assert.equal(identified.status(), 200, await identified.text());
  assert.equal((await identified.json()).audit.discovery, "Вид определён");
  await mobileCard.getByRole("heading", { name: "Гоблин-разведчик" }).waitFor();
  await mobileCard.screenshot({
    path: join(shotDir, "creature-mobile-inspection.png"),
  });
  assert.equal(
    await mobileCard.getByText("Данные мастера", { exact: true }).count(),
    0,
  );
  await mobileCard.getByRole("button", { name: "Открыть в бестиарии" }).tap();
  await b
    .getByRole("dialog", { name: "Энциклопедия" })
    .getByRole("heading", { name: "Гоблин-разведчик" })
    .waitFor();
  await b.getByRole("dialog", { name: "Энциклопедия" }).screenshot({
    path: join(shotDir, "creature-discovered-bestiary.png"),
  });
  assert.equal((await creature(a, trail)).speciesId, null);
  await canvas(a).screenshot({ path: join(shotDir, "creature-moved.png") });
  const publicCard = await (
    await get(b, world + "/creatures/" + trail + "?mode=gm")
  ).json();
  assert.equal(publicCard.knowledge, "observation");
  assert.equal(publicCard.simulation, undefined);
  assert.equal(publicCard.source, undefined);
  assert.equal(publicCard.creature.hp, null);
  const invalidDiscovery = await b.request.post(
    origin + "/api/" + world + "/action",
    {
      data: {
        key: randomUUID(),
        action: { type: "ability", skill: "observe", target: trail, stage: 4 },
      },
    },
  );
  assert.equal(invalidDiscovery.status(), 400);
  assert.equal((await get(b, world + "/creatures/sentinel")).status(), 404);
  assert.equal((await get(b, world + "/creatures/nonexistent")).status(), 404);
  assert.equal(
    (await (await get(a, world + "/creatures/" + trail + "?mode=gm")).json())
      .knowledge,
    "gm",
  );
  const left = (
    await (await get(a, "catalog?world=" + id)).json()
  ).bestiary.find((x) => x.id === "B-065");
  const right = (
    await (await get(b, "catalog?world=" + id)).json()
  ).bestiary.find((x) => x.id === "B-065");
  assert.match(left.description, /Сведения открываются/);
  assert.doesNotMatch(right.description, /Сведения открываются/);
  await b.getByRole("button", { name: "Закрыть окно" }).tap();
  const stepX = Math.sign(position.x - 14);
  const stepY = stepX ? 0 : Math.sign(position.y - 12);
  await post(b, world + "/action", {
    key: randomUUID(),
    action: { type: "move", dx: stepX, dy: stepY },
  });
  const scoutAction = {
    key: randomUUID(),
    action: { type: "ability", skill: "attack", target: trail },
  };
  const scoutHit = await post(b, world + "/action", scoutAction);
  assert.equal(scoutHit.audit.damage, 3);
  assert.equal((await post(b, world + "/action", scoutAction)).id, scoutHit.id);
  await eventually(
    async () => (await creature(a, trail))?.condition === "wounded",
  );
  assert.equal((await creature(a, trail)).hp, null);
  assert.equal((await creature(b, trail)).hp, 10);
  await b.getByRole("button", { name: "Журнал существ" }).tap();
  const journal = b.getByRole("dialog", { name: "Журнал существ" });
  await journal.getByText("Гоблин-разведчик", { exact: true }).waitFor();
  await journal.getByText(/Изучено/).waitFor();
  await journal.screenshot({ path: join(shotDir, "creature-journal.png") });
  await b.getByRole("button", { name: "Закрыть окно" }).tap();
  await quick.getByRole("button", { name: "Подробный осмотр" }).tap();
  await mobileCard.getByText("Здоровье 10/13", { exact: true }).waitFor();
  await mobileCard.screenshot({
    path: join(shotDir, "creature-scout-damaged.png"),
  });

  await Promise.all([a.goto("about:blank"), b.goto("about:blank")]);
  place("vault");
  await Promise.all([enter(a), enter(b)]);
  await locate(a, "sentinel").getByRole("button").click();
  await a.getByRole("button", { name: "Подробный осмотр" }).click();
  const guard = a.getByRole("dialog", { name: "Осмотр существа" });
  await guard.getByText("Здоровье 16/16").waitFor();
  await guard.screenshot({ path: join(shotDir, "creature-guard-before.png") });
  const command = {
    key: randomUUID(),
    action: { type: "ability", skill: "attack", target: "sentinel" },
  };
  const damage = await post(b, world + "/action", command);
  assert.ok(damage.audit.damage > 0 && damage.audit.damage < 16);
  const hp = 16 - damage.audit.damage;
  await guard.getByText("Здоровье " + hp + "/16").waitFor();
  assert.equal(
    await guard.getByRole("progressbar").getAttribute("value"),
    String(hp),
  );
  await guard.screenshot({ path: join(shotDir, "creature-guard-damaged.png") });
  const replay = await post(b, world + "/action", command);
  assert.equal(replay.id, damage.id);
  assert.equal((await creature(b, "sentinel")).hp, hp);
  await b.goto("about:blank");
  assert.equal((await creature(a, "sentinel")).hp, hp);
  await enter(b);
  assert.equal((await creature(b, "sentinel")).hp, hp);
  await Promise.all([a.goto("about:blank"), b.goto("about:blank")]);
  const saved = await creature(a, "sentinel");
  await app.close();
  const port = Number(new URL(origin).port);
  app = createApp(database);
  origin = await app.listen({ host: "127.0.0.1", port });
  const restored = await creature(a, "sentinel");
  assert.deepEqual(restored, saved);
  const state = await (await get(a, world)).json();
  assert.equal(state.character.xp, "42");
  await post(b, "logout", {});
  assert.equal((await get(b, world)).status(), 401);
  await post(b, "auth/login", {
    name: "creatureguest",
    password: "Вереск глина щавель картон",
  });
  const guestState = await (await get(b, world)).json();
  const otherIdentifier = await (
    await get(b, world + "?character=" + first.id)
  ).json();
  assert.deepEqual(otherIdentifier.creatureJournal, guestState.creatureJournal);
  assert.equal(
    guestState.creatureJournal.find((entry) => entry.speciesId === "B-065")
      .stage,
    3,
  );
  assert.equal(
    state.creatureJournal.some((entry) => entry.speciesId === "B-065"),
    false,
  );
  assert.equal(guestState.character.extra.creatureKnowledge, undefined);
  assert.equal(errors.length, 0);
  console.log(
    "PASS: two contexts, authoritative creatures, mobile inspection, guard damage, reconnect and cold restart.",
  );
} finally {
  await browser?.close();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}

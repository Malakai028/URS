import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { chromium } from "playwright-core";

export async function playBrowserExpedition({
  address,
  world,
  owner,
  friend,
  snapshot,
  restart,
}) {
  const executablePath = [
    process.env.BROWSER_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find((p) => p && existsSync(p));
  assert.ok(executablePath, "Set BROWSER_PATH");
  const browser = await chromium.launch({ executablePath });
  try {
    const url = address + "/?world=" + world;
    const errors = [];
    async function enter(cookie, width) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        hasTouch: width === 390,
      });
      page.on("pageerror", (err) => errors.push(err.message));
      const at = cookie.indexOf("=");
      await page.context().addCookies([
        {
          url: address,
          name: cookie.slice(0, at),
          value: cookie.slice(at + 1),
        },
      ]);
      await page.goto(url);
      await page.getByRole("heading", { name: "Карта местности" }).waitFor();
      return page;
    }
    const a = await enter(owner, 1280),
      b = await enter(friend, 390);
    const button = (page, name) =>
      page.getByRole("button", { name, exact: true });
    const bar = (page) =>
      page.getByRole("navigation", { name: "Панели экспедиции" });
    const canvas = a.locator(".mapcard canvas");
    async function perform(click, allowRange = false) {
      const [response] = await Promise.all([
        a.waitForResponse(
          (r) =>
            r.url() === address + "/api/worlds/" + world + "/action" &&
            r.request().method() === "POST",
          { timeout: 10000 },
        ),
        click(),
      ]);
      const result = await response.json();
      if (
        allowRange &&
        response.status() === 400 &&
        /соседней клетке/.test(result.error)
      ) {
        await button(a, "Закрыть сообщение").click();
        return false;
      }
      assert.equal(response.status(), 200, result.error);
      await a.waitForFunction(
        () => !document.querySelector('.hotbar button[title="Блок"]')?.disabled,
      );
      return true;
    }
    async function step(key) {
      await perform(async () => {
        await canvas.focus();
        await a.keyboard.press(key);
      });
      await pause(350);
    }
    const interact = async (id) => {
      await a.getByRole("combobox", { name: /Цель действия/ }).selectOption(id);
      await perform(() => button(a, "Действовать").click());
    };
    const use = (skill) =>
      perform(() => a.locator('.hotbar button[title="' + skill + '"]').click());
    assert.equal((await snapshot(owner)).character.xp, "0");
    await button(bar(b), "Задания").click();
    // Hold a real response after the server has applied the first conversation.
    // Target selection stays available while another action cannot be submitted.
    const endpoint = address + "/api/worlds/" + world + "/action";
    let release, received;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const pending = new Promise((resolve) => {
      received = resolve;
    });
    await a.route(
      endpoint,
      async (route) => {
        const response = await route.fetch();
        received();
        await gate;
        await route.fulfill({ response });
      },
      { times: 1 },
    );
    const talk = perform(() => button(a, "Поговорить").click());
    try {
      await Promise.race([pending, talk]);
      assert.equal(await button(a, "Действовать").isDisabled(), true);
    } finally {
      release();
      await talk;
    }
    await interact("cache");
    await b.getByText("Тайник открыт партией.", { exact: true }).waitFor();
    await button(bar(a), "Снаряжение").click();
    const gear = a.getByRole("dialog", { name: "Снаряжение" });
    for (const loot of (await snapshot(owner)).objects.filter(
      (o) => o.kind === "loot",
    )) {
      await perform(() => button(gear, "Подобрать: " + loot.name).click());
      await perform(() =>
        button(
          gear.locator("article").filter({
            has: gear
              .page()
              .getByRole("heading", { name: loot.name, exact: true }),
          }),
          "Надеть",
        ).click(),
      );
    }
    await button(gear, "Закрыть окно").click();
    await step("Shift+ArrowRight");
    await step("Shift+ArrowDown");
    await interact("gate");
    await step("Shift+ArrowRight");
    await step("Shift+ArrowDown");
    // Follow the server positions through the lit, traversable cells in the vault.
    async function approach(s, target) {
      const start = [s.character.x, s.character.y];
      const queue = [[...start, null]],
        seen = new Set([start.join(",")]);
      for (const [x, y, first] of queue) {
        if (Math.abs(x - target.x) + Math.abs(y - target.y) <= 1) {
          if (first) await step(first);
          return !!first;
        }
        for (const [dx, dy, key] of [
          [1, 0, "ArrowRight"],
          [-1, 0, "ArrowLeft"],
          [0, 1, "ArrowDown"],
          [0, -1, "ArrowUp"],
        ]) {
          const nx = x + dx,
            ny = y + dy,
            id = nx + "," + ny;
          const tile = s.tiles[ny - s.offset.y]?.[nx - s.offset.x];
          if (!seen.has(id) && tile && !["water", "rock"].includes(tile.kind)) {
            seen.add(id);
            queue.push([nx, ny, first || key]);
          }
        }
      }
      throw Error("Нет видимого пути к цели");
    }
    let defeated = false;
    for (let turn = 0; turn < 80; turn++) {
      const scene = await snapshot(owner);
      const guard = scene.objects.find((o) => o.id === "sentinel");
      assert.ok(guard, "Страж должен быть видим в башне");
      if (!guard.creature.alive) {
        defeated = true;
        break;
      }
      if (await approach(scene, guard)) continue;
      await use("Передышка");
      await use("Блок");
      await a
        .getByRole("combobox", { name: /Цель действия/ })
        .selectOption("sentinel");
      await perform(
        () => a.locator('.hotbar button[title="Удар"]').click(),
        true,
      );
      await pause(1550);
    }
    assert.ok(defeated, "Страж пережил предел игрового сценария");
    for (let n = 0; n < 32; n++) {
      const scene = await snapshot(owner);
      if (
        !(await approach(
          scene,
          scene.objects.find((o) => o.id === "beacon"),
        ))
      )
        break;
    }
    await interact("beacon");
    const done = "Маяк горит. Задание партии выполнено.";
    await b.getByText(done, { exact: true }).waitFor();
    const images = process.env.URE_SCREENSHOT_DIR || "test-results/browser";
    mkdirSync(images, { recursive: true });
    await b
      .getByRole("dialog", { name: "Задания" })
      .screenshot({ path: join(images, "beacon-party-mobile.png") });
    await button(
      b.getByRole("dialog", { name: "Задания" }),
      "Закрыть окно",
    ).click();
    await button(b, "Поговорить").click();
    await b
      .locator(".feedback")
      .filter({ hasText: "Маяк горит. Теперь с переправы снова видно дорогу" })
      .waitFor();
    const earned = BigInt((await snapshot(owner)).character.xp);
    await perform(() => button(a, "Повысить уровень").click());
    const after = await snapshot(owner);
    assert.equal(after.character.level, 1);
    assert.equal(BigInt(after.character.xp), earned - 100n);
    await Promise.all([a.goto("about:blank"), b.goto("about:blank")]);
    await restart();
    await Promise.all([a.goto(url), b.goto(url)]);
    await button(bar(b), "Задания").click();
    await b.getByText(done, { exact: true }).waitFor();
    await a.getByText("Что даст уровень 2", { exact: true }).waitFor();
    assert.equal((await snapshot(friend)).character.level, 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS · два браузера, 390 px, живой страж, общий маяк, " +
        earned +
        " XP, восстановление героя и задания.",
    );
  } finally {
    await browser.close();
  }
}

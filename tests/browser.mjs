import { chromium } from "playwright-core";
import { createApp } from "../apps/server/app.ts";
import { mkdirSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
const dir = mkdtempSync(join(tmpdir(), "ure-browser-"));
const screenshotDir = process.env.URE_SCREENSHOT_DIR || "docs/screenshots";
let app = createApp(join(dir, "world.sqlite"));
const connections = new Set();
let pauseLive = false;
app.server.on("upgrade", (_req, socket) => {
  connections.add(socket);
  socket.once("close", () => connections.delete(socket));
});
const url = await app.listen({ port: 0, host: "127.0.0.1" });
const executablePath = [
  process.env.BROWSER_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => p && existsSync(p));
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath });
  const a = await browser.newPage({ viewport: { width: 1400, height: 960 } });
  const b = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  const observer = await browser.newPage();
  for (const p of [a, b, observer]) {
    p.on("pageerror", (e) => errors.push(e.message));
    await p
      .context()
      .route("**/*", (route) =>
        new URL(route.request().url()).origin === url
          ? route.continue()
          : route.abort(),
      );
    await p.routeWebSocket("**/*", (socket) => {
      if (
        !pauseLive &&
        socket
          .url()
          .replace(/^ws:/, "http:")
          .startsWith(url + "/")
      )
        socket.connectToServer();
      else socket.close();
    });
  }
  const button = (page, name) =>
    page.getByRole("button", { name, exact: true });
  async function delayedPost(page, endpoint, trigger, pending) {
    let release;
    let received;
    let finished;
    const forwarded = new Promise((resolve) => {
      finished = resolve;
    });
    const ready = new Promise((resolve) => {
      received = resolve;
    });
    const hold = new Promise((resolve) => {
      release = resolve;
    });
    let count = 0;
    const routeHandler = async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      count++;
      received();
      await hold;
      try {
        await route.continue();
      } finally {
        finished();
      }
    };
    await page.route(endpoint, routeHandler);
    try {
      await trigger();
      await Promise.race([
        ready,
        new Promise((_, reject) => {
          const timer = setTimeout(
            () => reject(Error("POST did not arrive: " + endpoint)),
            15000,
          );
          timer.unref();
        }),
      ]);
      await pending();
    } finally {
      release();
      if (count) await forwarded;
      await page.unroute(endpoint, routeHandler);
    }
    assert.equal(count, 1);
  }
  async function account(page, name) {
    await page.goto(url);
    await button(page, "Зарегистрироваться").click();
    await button(page, "Уже есть аккаунт? Войти").click();
    await button(page, "Зарегистрироваться").click();
    await page.getByLabel("Аватар").selectOption("moon");
    await page
      .getByText("Условия экспедиции и приватность", { exact: true })
      .click();
    await page.getByText(/Публичный профиль включается/).waitFor();
    await page.getByLabel("Имя игрока").fill(name);
    await page.getByLabel("Отображаемое имя").fill(name);
    await page
      .getByLabel("Электронная почта")
      .fill(
        (name === "Картограф"
          ? "map"
          : name === "Путник"
            ? "trail"
            : "observer") + "@example.test",
      );
    const password = page.getByLabel("Пароль", { exact: true });
    const eye = button(page, "Показать: Пароль");
    const checks = page.getByRole("region", { name: "Требования к паролю" });
    await password.fill("123456789987654321");
    await checks.getByText("Длина 18/128 · Слабый").waitFor();
    assert.equal(
      await checks
        .locator("li")
        .filter({ hasText: "локальном списке" })
        .getAttribute("data-state"),
      "fail",
    );
    await password.fill("BrowserTest-123");
    await checks.getByText(/Очень сильный/).waitFor();
    assert.equal(
      await checks
        .locator("li")
        .filter({ hasText: "Не менее 15" })
        .getAttribute("data-state"),
      "pass",
    );
    await password.evaluate((e) => e.setSelectionRange(1, 5));
    await eye.click();
    assert.equal(
      await page.getByLabel("Пароль", { exact: true }).getAttribute("type"),
      "text",
    );
    assert.equal(await eye.getAttribute("aria-pressed"), "true");
    assert.deepEqual(
      await password.evaluate((e) => [e.selectionStart, e.selectionEnd]),
      [1, 5],
    );
    await eye.focus();
    await page.keyboard.press("Enter");
    assert.equal(await eye.getAttribute("aria-pressed"), "false");
    assert.equal(await password.getAttribute("type"), "password");
    assert.equal(await password.inputValue(), "BrowserTest-123");
    assert.equal(
      await button(page, "Показать: Пароль").evaluate(
        (e) => e === document.activeElement,
      ),
      true,
    );
    const confirmation = page.getByLabel("Подтверждение пароля", {
      exact: true,
    });
    assert.equal(await confirmation.getAttribute("aria-invalid"), null);
    await page.getByLabel("Принимаю условия экспедиции").check();
    await confirmation.fill("BrowserTest-12");
    assert.equal(await confirmation.getAttribute("aria-invalid"), "true");
    let posts = 0;
    const authUrl = url + "/api/auth/register";
    const count = (route) => {
      posts++;
      return route.continue();
    };
    await page.route(authUrl, count);
    await button(page, "Создать аккаунт →").click();
    assert.equal(posts, 0);
    assert.equal(await password.inputValue(), "BrowserTest-123");
    await page.unroute(authUrl, count);
    await confirmation.fill("BrowserTest-123");
    await button(page, "Показать: Подтверждение пароля").click();
    assert.equal(await confirmation.getAttribute("type"), "text");
    await button(page, "Показать: Подтверждение пароля").click();
    assert.equal(await confirmation.inputValue(), "BrowserTest-123");
    const eyeBox = await eye.boundingBox();
    assert.ok(eyeBox.width >= 44 && eyeBox.height >= 44);
    assert.equal(await password.getAttribute("autocomplete"), "new-password");
    if (name === "Путник") {
      mkdirSync(screenshotDir, { recursive: true });
      await checks.screenshot({
        path: join(screenshotDir, "registration-password.png"),
      });
      await page
        .locator(".pw")
        .first()
        .screenshot({
          path: join(screenshotDir, "registration-eye.png"),
        });
    }
    if (name === "Картограф") {
      const message = "<b>Регистрация отклонена</b>";
      const reject = (route) =>
        route.fulfill({ status: 409, json: { error: message } });
      await page.route(authUrl, reject);
      await button(page, "Создать аккаунт →").click();
      const rejection = page.getByRole("status").filter({ hasText: message });
      await rejection.waitFor();
      assert.equal(await rejection.locator("b").count(), 0);
      assert.equal(await confirmation.inputValue(), "BrowserTest-123");
      await page.unroute(authUrl, reject);
      const abort = (route) => route.abort();
      await page.route(authUrl, abort);
      await button(page, "Создать аккаунт →").click();
      await page
        .getByRole("status")
        .filter({ hasText: "Проверьте соединение" })
        .waitFor();
      assert.equal(await password.inputValue(), "BrowserTest-123");
      await page.unroute(authUrl, abort);
      await delayedPost(
        page,
        authUrl,
        () =>
          password.evaluate((e) => {
            e.form.requestSubmit();
            e.form.requestSubmit();
          }),
        async () =>
          assert.equal(await button(page, "Отправка…").isDisabled(), true),
      );
    } else await button(page, "Создать аккаунт →").click();
    await page.getByRole("heading", { name: "Мои миры" }).waitFor();
  }
  async function character(page, name) {
    await page.getByLabel("Имя персонажа").fill(name);
    await button(page, "Создать персонажа").click();
    await page.getByRole("heading", { name: "Карта местности" }).waitFor();
  }
  await account(a, "Картограф");
  await button(a, "＋ Создать мир").click();
  await a.getByLabel("Название мира").fill("Речной предел");
  await a.getByLabel("Зерно карты").fill("browser");
  await delayedPost(
    a,
    url + "/api/worlds",
    () =>
      a.getByLabel("Название мира").evaluate((e) => {
        e.form.requestSubmit();
        e.form.requestSubmit();
      }),
    async () => assert.equal(await button(a, "← Мои миры").isDisabled(), true),
  );
  // Wait for navigation only after the delayed response is released.
  await a.getByLabel("Имя персонажа").fill("Лис");
  const characterApi =
    url + "/api/worlds/" + new URL(a.url()).searchParams.get("world");
  await delayedPost(
    a,
    characterApi + "/character",
    () =>
      a.getByLabel("Имя персонажа").evaluate((e) => {
        e.form.requestSubmit();
        e.form.requestSubmit();
      }),
    async () => assert.equal(await button(a, "← Мои миры").isDisabled(), true),
  );
  await a.getByRole("heading", { name: "Карта местности" }).waitFor();
  await button(a, "Комната").click();
  await button(a, "Открыть комнату").click();
  await delayedPost(
    a,
    characterApi + "/invite",
    () =>
      button(a, "Создать приглашение").evaluate((e) => {
        e.form.requestSubmit();
        e.form.requestSubmit();
      }),
    async () => assert.equal(await button(a, "← Мои миры").isDisabled(), true),
  );
  await a.getByLabel("Ссылка на 24 часа").focus();
  assert.equal(
    await a
      .getByLabel("Ссылка на 24 часа")
      .evaluate((e) => e.selectionEnd - e.selectionStart === e.value.length),
    true,
  );
  const code = await a.getByLabel("Код приглашения").inputValue();
  await button(a, "Экспедиция").click();
  await account(b, "Путник");
  await b.getByLabel("Код или ссылка").fill(code);
  await button(b, "Войти в комнату").click();
  await character(b, "Астра");
  await account(observer, "Свидетель");
  await observer.getByLabel("Код или ссылка").fill(code);
  await button(observer, "Войти в комнату").click();
  await character(observer, "Иней");
  await b.getByText("Лис", { exact: true }).waitFor();
  const canvas = a.locator(".mapcard canvas");
  const toolsBar = a.getByRole("navigation", { name: "Панели экспедиции" });
  const mobileBar = b.getByRole("navigation", { name: "Панели экспедиции" });
  const draft = a.getByLabel("Сообщение", { exact: true });
  const focused = (locator) =>
    locator.evaluate((e) => e === document.activeElement);
  await button(mobileBar, "Чат").click();
  assert.equal(
    await focused(b.getByRole("textbox", { name: "Сообщение" })),
    true,
  );
  await button(mobileBar, "Карта").click();
  assert.equal(await focused(b.locator(".mapcard canvas")), true);
  await button(toolsBar, "Персонаж").click();
  assert.equal(await focused(a.locator("#character-sheet")), true);
  mkdirSync(screenshotDir, { recursive: true });
  await toolsBar.screenshot({ path: join(screenshotDir, "navigation.png") });
  for (const width of [390, 768, 1280, 1600]) {
    await a.setViewportSize({ width, height: 880 });
    for (const [menu, label, accessible] of [
      [toolsBar, "Снаряжение", "Снаряжение"],
      [a, "Персонажи", "Персонажи"],
      [a, "Энциклопедия", "Энциклопедия"],
      [a, "Картограф", "Профиль"],
    ]) {
      await button(menu, label).click();
      const dialog = a.getByRole("dialog", { name: accessible, exact: true });
      await dialog.waitFor();
      const bounds = await dialog.boundingBox();
      assert.ok(
        bounds.x >= 0 && bounds.x + bounds.width <= width + 1,
        accessible + " at " + width,
      );
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 881);
      assert.equal(
        await a.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      await a.keyboard.press("Escape");
    }
    await button(toolsBar, "Карта").click();
    const y = await a.evaluate(() => scrollY);
    await a.keyboard.press("Enter");
    assert.equal(await focused(draft), true);
    assert.equal(await a.evaluate(() => scrollY), y);
    assert.ok(
      (await draft.boundingBox()).width >= 120,
      "chat input at " + width,
    );
    assert.equal(
      await a.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await a.screenshot({ path: join(screenshotDir, "chat-" + width + ".png") });
    await a.keyboard.press("Escape");
    assert.equal(await focused(canvas), true);
  }
  await a.setViewportSize({ width: 1400, height: 960 });
  await button(toolsBar, "Чат").click();
  assert.equal(await focused(draft), true);
  await draft.fill("Черновик экспедиции");
  await button(toolsBar, "Карта").click();
  assert.equal(await focused(canvas), true);
  for (const [label, name] of [
    ["Снаряжение", "Снаряжение"],
    ["Способности", "Способности"],
    ["Задания", "Задания"],
    ["Журнал", "История"],
    ["Помощник", "Помощник"],
  ]) {
    const trigger = button(toolsBar, label);
    await trigger.focus();
    const scrollBefore = await a.evaluate(() => scrollY);
    await a.keyboard.press("Enter");
    const dialog = a.getByRole("dialog", { name, exact: true });
    await dialog.waitFor();
    assert.equal(
      await dialog.evaluate((e) => e.contains(document.activeElement)),
      true,
    );
    if (label === "Помощник") {
      await dialog.getByLabel("Использовать подключённый ИИ").uncheck();
      await dialog.getByLabel("Вопрос").fill("Как открыть карту?");
      await delayedPost(
        a,
        url + "/api/assistant",
        () =>
          dialog.getByLabel("Вопрос").evaluate((e) => {
            e.form.requestSubmit();
            e.form.requestSubmit();
          }),
        async () =>
          assert.equal(
            await button(dialog, "Готовим ответ…").isDisabled(),
            true,
          ),
      );
      await dialog.getByText("Сценарный мастер", { exact: true }).waitFor();
    }
    await a.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await focused(trigger), true);
    assert.equal(await a.evaluate(() => scrollY), scrollBefore);
  }
  assert.equal(await draft.inputValue(), "Черновик экспедиции");
  const grid = button(a, "Сетка");
  await grid.click();
  const gridState = await grid.getAttribute("aria-pressed");
  await button(a, "Комната").click();
  await button(a, "Экспедиция").click();
  assert.equal(await grid.getAttribute("aria-pressed"), gridState);
  assert.equal(await draft.inputValue(), "Черновик экспедиции");
  await draft.fill("");
  await button(a, "Картограф").click();
  const profile = a.getByRole("dialog", { name: "Профиль" });
  const display = profile.getByLabel("Отображаемое имя");
  const saveProfile = button(profile, "Сохранить профиль");
  await display.fill("");
  await saveProfile.click();
  assert.equal(await display.evaluate((e) => e.validity.valid), false);
  let profilePosts = 0;
  await a.route(url + "/api/profile", async (route) => {
    if (route.request().method() === "POST") profilePosts++;
    await route.continue();
  });
  await display.fill("  ");
  await saveProfile.click();
  await profile
    .getByRole("status")
    .filter({ hasText: /ожида|character|символ/i })
    .waitFor();
  assert.equal(await display.inputValue(), "  ");
  await display.fill("Картограф атласа");
  await display.evaluate((e) => {
    e.form.requestSubmit();
    e.form.requestSubmit();
  });
  await profile.getByText("Профиль сохранён", { exact: true }).waitFor();
  assert.equal(profilePosts, 2);
  await a.keyboard.press("Escape");
  await button(a, "Картограф атласа").waitFor();
  await canvas.focus();
  const scroll = await a.evaluate(() => scrollY);
  await a.keyboard.press("ArrowRight");
  await a.locator("dd").getByText("13, 12", { exact: true }).waitFor();
  assert.equal(await a.evaluate(() => scrollY), scroll);
  // Observe the remote token coordinates as exposed by the accessible map legend.
  await b
    .getByLabel("Позиция Лис")
    .getByText("13, 12", { exact: true })
    .waitFor();
  await a
    .getByLabel("Сообщение", { exact: true })
    .fill("Встретимся на переправе");
  await button(a, "Отправить").click();
  await b
    .locator("summary")
    .filter({ hasText: "Встретимся на переправе" })
    .waitFor();
  await button(a, "Поговорить").click();
  await a
    .locator("summary")
    .filter({ hasText: "показывает дорогу" })
    .first()
    .waitFor();
  await a
    .getByRole("combobox", { name: /Цель действия/ })
    .selectOption("cache");
  await button(a, "Действовать").click();
  await a.getByRole("alert").filter({ hasText: "Подойдите" }).waitFor();
  assert.equal(await a.locator(".feedback").count(), 0);
  await button(a, "Закрыть сообщение").click();
  await a.getByRole("combobox", { name: /Цель действия/ }).selectOption("");
  const rollResponse = a.waitForResponse(
    (r) =>
      r.url().endsWith("/action") &&
      r.request().postDataJSON()?.action?.type === "roll",
  );
  await button(a, "Бросить d100").click();
  const rolled = await (await rollResponse).json();
  assert.ok(Number.isInteger(rolled.audit.attempts[0].roll));
  await a
    .locator("summary")
    .filter({
      hasText: "d100: " + rolled.audit.attempts[0].roll,
    })
    .first()
    .waitFor();
  await a
    .locator("summary")
    .filter({ hasText: "наблюдательности" })
    .first()
    .click();
  await a.getByText("порог успеха", { exact: false }).first().waitFor();
  await button(a, "Паёк × 2").click();
  await button(a, "Паёк × 1").waitFor();
  await a.reload();
  await button(a, "Паёк × 1").waitFor();
  await a.locator("dd").getByText("13, 12", { exact: true }).waitFor();
  await button(a, "Справочник").click();
  const catalogPicker = a.getByRole("combobox", {
    name: "Каталог",
    exact: true,
  });
  for (const category of [
    "classes",
    "bestiary",
    "tiers",
    "ranks",
    "currencies",
    "skills",
  ]) {
    await catalogPicker.selectOption(category);
    const first = a.locator(".record").first();
    const title = await first.locator("span").innerText();
    await first.focus();
    await a.keyboard.press("Enter");
    await a.getByRole("heading", { name: title, exact: true }).waitFor();
    if (category === "tiers") {
      const article = a
        .locator("article")
        .filter({ has: a.getByRole("heading", { name: title, exact: true }) });
      const linked = article.getByRole("button").last();
      const next = await linked.innerText();
      await linked.click();
      await article
        .or(
          a.locator("article").filter({
            has: a.getByRole("heading", { name: next, exact: true }),
          }),
        )
        .getByRole("heading", { name: next, exact: true })
        .waitFor();
    }
    await button(a, "← К результатам").click();
    assert.equal(await focused(first), true);
  }
  await catalogPicker.selectOption("races");
  const firstRace = await a.locator(".record").first().innerText();
  await button(a, "Далее").click();
  assert.notEqual(await a.locator(".record").first().innerText(), firstRace);
  await button(a, "Назад").click();
  assert.equal(await a.locator(".record").first().innerText(), firstRace);
  await a
    .getByRole("textbox", { name: "Поиск", exact: true })
    .fill("нет-записи-460bb");
  await a
    .getByRole("status")
    .filter({ hasText: "Записи не найдены" })
    .waitFor();
  await a
    .getByRole("combobox", { name: "Каталог", exact: true })
    .selectOption("classes");
  await a
    .getByRole("combobox", { name: "Каталог", exact: true })
    .selectOption("races");
  await a.getByRole("textbox", { name: "Поиск", exact: true }).fill("Эльф");
  await a.locator(".record").first().waitFor();
  await a.locator(".record").first().click();
  await button(a, "В избранное").waitFor();
  mkdirSync(screenshotDir, { recursive: true });
  await a.screenshot({ path: join(screenshotDir, "encyclopedia.png") });
  await button(a, "← К результатам").click();
  assert.equal(
    await a.getByRole("textbox", { name: "Поиск", exact: true }).inputValue(),
    "Эльф",
  );
  assert.equal(await focused(a.locator(".record").first()), true);
  for (const socket of connections) socket.destroy();
  await b.getByText("Переподключение…", { exact: true }).waitFor();
  await a.getByText("Переподключение…", { exact: true }).waitFor();
  assert.equal(await a.locator(".feedback").count(), 0);
  await b.getByText("В сети", { exact: true }).waitFor();
  await button(a, "Экспедиция").click();
  await b.getByLabel("Сообщение", { exact: true }).fill("Связь восстановлена");
  await button(b, "Отправить").click();
  await a
    .locator("summary")
    .filter({ hasText: "Связь восстановлена" })
    .waitFor();
  await a.getByRole("combobox", { name: /Канал журнала/ }).selectOption("ic");
  await b.getByLabel("Канал", { exact: true }).selectOption("ic");
  await b
    .getByLabel("Сообщение", { exact: true })
    .fill("Астра говорит у тайника");
  await button(b, "Отправить").click();
  await a
    .locator("summary")
    .filter({ hasText: "Астра говорит у тайника" })
    .waitFor();
  const worldApi =
    url + "/api/worlds/" + new URL(a.url()).searchParams.get("world");
  const form = b.getByRole("form", { name: "Чат экспедиции" });
  const input = form.getByRole("textbox", { name: "Сообщение" });
  const send = button(form, "Отправить");
  const channel = form.getByRole("combobox", { name: "Канал", exact: true });
  await channel.selectOption("whisper");
  await form.getByLabel("Получатель").selectOption({ label: "Лис" });
  await input.fill("Личное письмо со стоянки");
  await send.click();
  await form
    .getByRole("status")
    .getByText("Отправлено", { exact: true })
    .waitFor();
  await channel.selectOption("group");
  await form.getByLabel("Участники группы").selectOption({ label: "Лис" });
  await input.fill("Запись для группы");
  await send.click();
  await form
    .getByRole("status")
    .getByText("Отправлено", { exact: true })
    .waitFor();
  for (const [page, allowed] of [
    [a, true],
    [b, true],
    [observer, false],
  ]) {
    const response = await page.request.get(
      worldApi + "/history?channel=private",
    );
    assert.equal(response.status(), 200);
    const rows = await response.json();
    for (const message of ["Личное письмо со стоянки", "Запись для группы"])
      assert.equal(
        rows.some((row) => row.text === message),
        allowed,
      );
    const snapshotResponse = await page.request.get(worldApi);
    assert.equal(snapshotResponse.status(), 200);
    const snap = await snapshotResponse.json();
    assert.equal(
      snap.events.some((row) => row.text === "Личное письмо со стоянки"),
      allowed,
    );
  }
  await channel.selectOption("chat");
  let writes = 0;
  let release;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  await b.route(worldApi + "/action", async (route) => {
    writes++;
    if (route.request().postDataJSON().action.text === "Задержанное сообщение")
      await hold;
    if (route.request().postDataJSON().action.text === "Сбой отправки")
      await route.abort();
    else await route.continue();
  });
  await input.fill("Задержанное сообщение");
  await input.evaluate((e) => {
    e.form.requestSubmit();
    e.form.requestSubmit();
  });
  await form.getByText("Отправка…", { exact: true }).waitFor();
  assert.equal(await send.isDisabled(), true);
  assert.equal(await button(b, "← Мои миры").isDisabled(), true);
  await button(b, "Комната").click();
  await button(b, "Экспедиция").click();
  assert.equal(await input.inputValue(), "Задержанное сообщение");
  release();
  await form.getByText("Отправлено", { exact: true }).waitFor();
  assert.equal(writes, 1);
  await input.fill("Сбой отправки");
  await send.click();
  await form.getByText(/Отправка не подтверждена/).waitFor();
  assert.equal(await input.inputValue(), "Сбой отправки");
  assert.equal(await send.isEnabled(), true);
  await input.fill("   ");
  await send.click();
  await form.getByText(/Отклонено/).waitFor();
  assert.equal(await input.inputValue(), "   ");
  await input.fill("");
  await b.unroute(worldApi + "/action");

  for (let i = 0; i < 51; i++) {
    const r = await a.request.post(worldApi + "/action", {
      data: {
        key: randomUUID(),
        action: { type: "chat", text: "Строка истории " + i },
      },
    });
    assert.equal(r.status(), 200);
  }
  await a.reload();
  await button(toolsBar, "Журнал").click();
  const history = a.getByRole("dialog", { name: "История" });
  const filter = history.getByLabel("Фильтр истории");
  await filter.selectOption("ooc");
  await history
    .getByRole("status")
    .getByText("50 событий", { exact: true })
    .waitFor();
  const older = button(history, "Предыдущие события");
  const olderUrl = (u) =>
    u.pathname.endsWith("/history") && u.searchParams.has("before");
  let releaseOlder;
  const oldPage = new Promise((resolve) => {
    releaseOlder = resolve;
  });
  await a.route(olderUrl, async (route) => {
    await oldPage;
    await route.continue();
  });
  const requestedOlder = a.waitForRequest((r) => olderUrl(new URL(r.url())));
  await older.click();
  await requestedOlder;
  await filter.selectOption("private");
  await history
    .locator("summary")
    .filter({ hasText: "Личное письмо со стоянки" })
    .waitFor();
  const olderDone = a.waitForResponse((r) => olderUrl(new URL(r.url())));
  releaseOlder();
  await olderDone;
  await a.unroute(olderUrl);
  assert.equal(await history.getByText(/Строка истории/).count(), 0);
  await filter.selectOption("ooc");
  await history
    .getByRole("status")
    .getByText("50 событий", { exact: true })
    .waitFor();
  await older.click();
  await history
    .locator("summary")
    .filter({ hasText: "Строка истории 0" })
    .waitFor();
  assert.equal(
    await history
      .locator("summary")
      .filter({ hasText: /^.*Строка истории \d+$/ })
      .count(),
    51,
  );
  const olderRows = await history.locator("summary").allTextContents();
  const ordered = olderRows.flatMap((row) =>
    Array.from(row.matchAll(/Строка истории (\d+)$/g), (m) => Number(m[1])),
  );
  assert.deepEqual(
    ordered,
    Array.from({ length: 51 }, (_, i) => 50 - i),
  );
  await filter.selectOption("private");
  await history
    .locator("summary")
    .filter({ hasText: "Личное письмо со стоянки" })
    .waitFor();
  await filter.selectOption("ic");
  await history
    .locator("summary")
    .filter({ hasText: "Астра говорит у тайника" })
    .waitFor();
  assert.equal(
    await history
      .getByText("Личное письмо со стоянки", { exact: false })
      .count(),
    0,
  );
  await a.keyboard.press("Escape");
  await b.getByLabel("Канал", { exact: true }).selectOption("chat");
  assert.equal(
    await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await canvas.focus();
  await a.keyboard.press("KeyD");
  await a.locator("dd").getByText("14, 12", { exact: true }).waitFor();
  await a.waitForTimeout(360);
  await a.keyboard.press("Shift+KeyS");
  await a.locator("dd").getByText("14, 14", { exact: true }).waitFor();
  await a.waitForTimeout(650);
  const scrollJump = await a.evaluate(() => scrollY);
  await a.keyboard.press("Space");
  await a.locator("dd").getByText("14, 16", { exact: true }).waitFor();
  assert.equal(await a.evaluate(() => scrollY), scrollJump);
  await a.waitForTimeout(650);
  await a.keyboard.press("ArrowDown");
  await a.locator("dd").getByText("14, 17", { exact: true }).waitFor();
  assert.equal(await a.evaluate(() => scrollY), scrollJump);
  await a.waitForTimeout(650);
  await a.keyboard.press("KeyW");
  await a.locator("dd").getByText("14, 16", { exact: true }).waitFor();
  await a.getByLabel("Сообщение", { exact: true }).fill("wasd ");
  await a.keyboard.press("ArrowLeft");
  await a.keyboard.type("x");
  assert.equal(
    await a.getByLabel("Сообщение", { exact: true }).inputValue(),
    "wasdx ",
  );
  await a.locator("dd").getByText("14, 16", { exact: true }).waitFor();
  await a
    .locator(".workspace")
    .screenshot({ path: join(screenshotDir, "expedition.png") });
  await button(a, "Инструменты").click();
  await a
    .getByRole("dialog")
    .locator("select")
    .first()
    .selectOption("currency");
  await a.getByLabel("Количество", { exact: true }).fill("30");
  await a
    .locator("output")
    .getByText(/3 · остаток 0/)
    .waitFor();
  await a.screenshot({ path: join(screenshotDir, "converter.png") });
  await b
    .getByRole("combobox", { name: /Цель действия/ })
    .selectOption("cache");
  await button(b, "Действовать").click();
  await a
    .locator(".workspace aside p")
    .filter({ hasText: "Открытый тайник" })
    .waitFor();
    await button(toolsBar, "Задания").click();
    await a.getByText("Тайник открыт партией.", { exact: true }).waitFor();
    await a.getByText("Маяк пока погашен.", { exact: true }).waitFor();
    await a.keyboard.press("Escape");
  await b
    .getByRole("combobox", { name: /Цель действия/ })
    .selectOption({ label: "Дорожный клинок" });
  await b.locator(".mapcard canvas").focus();
  await b.keyboard.press("KeyE");
  await button(b, "Снаряжение").click();
  await b
    .getByRole("heading", { name: "Дорожный клинок", exact: true })
    .waitFor();
  await button(b, "Надеть").click();
  await button(b, "Снять").waitFor();
  await b.reload();
  await button(b, "Снаряжение").click();
  await button(b, "Снять").waitFor();
  const worldRoute =
    "/api/worlds/" + new URL(a.url()).searchParams.get("world");
  const snapshot = (page) =>
    page.evaluate(async (route) => {
      const response = await fetch(route);
      if (!response.ok) throw Error("Snapshot HTTP " + response.status);
      return response.json();
    }, worldRoute);
  // Take the restart checkpoint while the world has no active simulation.
  pauseLive = true;
  await Promise.all(
    [...connections].map(
      (socket) =>
        new Promise((closed) => {
          socket.once("close", closed);
          socket.destroy();
        }),
    ),
  );
  await a.getByText("Переподключение…", { exact: true }).waitFor();
  assert.equal(await a.locator(".feedback").count(), 0);
  const savedA = await snapshot(a),
    savedB = await snapshot(b);
  const trainee = await snapshot(observer);
  await app.close();
  // Set a known opening balance in the third test hero's isolated save, while the server is stopped.
  const fixture = new DatabaseSync(join(dir, "world.sqlite"));
  try {
    fixture.exec("BEGIN");
    assert.equal(
      fixture
        .prepare(
          "UPDATE characters SET state=json_set(state,'$.xp','65') WHERE world_id=? AND user_id=?",
        )
        .run(trainee.world.id, trainee.character.userId).changes,
      1,
    );
    assert.equal(
      fixture
        .prepare(
          "UPDATE heroes SET state=json_set(state,'$.xp','65') WHERE id=?",
        )
        .run(trainee.activeHeroId).changes,
      1,
    );
    fixture.exec("COMMIT");
  } finally {
    fixture.close();
  }
  app = createApp(join(dir, "world.sqlite"));
  await app.listen({ host: "127.0.0.1", port: Number(new URL(url).port) });
  assert.deepEqual(await snapshot(a), savedA);
  assert.deepEqual(await snapshot(b), savedB);
  pauseLive = false;
  await a.getByText("В сети", { exact: true }).waitFor();
  await b.getByText("В сети", { exact: true }).waitFor();
  // Re-entry preserves player and world progress while living creatures continue moving.
  const progress = (state) => ({
    ...state,
    objects: state.objects.filter((object) => !object.creature),
    creatureJournal: undefined,
  });
  await a.reload();
  assert.deepEqual(progress(await snapshot(a)), progress(savedA));
  await button(a, "← Мои миры").click();
  await a.getByRole("heading", { name: "Мои миры" }).waitFor();
  await button(a, "Продолжить →").click();
  await a.getByRole("heading", { name: "Карта местности" }).waitFor();
  assert.deepEqual(progress(await snapshot(a)), progress(savedA));
  await button(a, "Выйти").click();
  await a.getByLabel("Имя игрока", { exact: true }).fill("Картограф");
  await a.getByLabel("Пароль", { exact: true }).fill("BrowserTest-123");
  const loginEye = button(a, "Показать: Пароль");
  assert.equal(
    await a.getByLabel("Пароль", { exact: true }).getAttribute("autocomplete"),
    "current-password",
  );
  await loginEye.click();
  assert.equal(
    await a.getByLabel("Пароль", { exact: true }).getAttribute("type"),
    "text",
  );
  await loginEye.click();
  assert.equal(
    await a.getByLabel("Пароль", { exact: true }).getAttribute("type"),
    "password",
  );
  await button(a, "Войти →").click();
  await a.getByRole("heading", { name: "Мои миры" }).waitFor();
  await button(a, "Продолжить →").click();
  await a.getByRole("heading", { name: "Карта местности" }).waitFor();
  assert.deepEqual(progress(await snapshot(a)), progress(savedA));
  await button(a, "Персонажи").click();
  await a.locator(".heroentry").first().waitFor();
  assert.equal(await a.locator(".heroentry").count(), 1);
  const originalHero = a.locator(".heroentry").filter({
    has: a.getByRole("heading", { name: "Лис", exact: true }),
  });
  await originalHero
    .getByRole("button", { name: "Копия шаблона", exact: true })
    .click();
  const spareHero = a.locator(".heroentry").filter({
    has: a.getByRole("heading", { name: "Лис · копия", exact: true }),
  });
  await spareHero.waitFor();
  await originalHero
    .getByRole("button", { name: "Отправить на отдых", exact: true })
    .click();
  await spareHero
    .getByRole("button", { name: "Выбрать для мира", exact: true })
    .click();
  await spareHero
    .getByRole("button", { name: "Отправить на отдых", exact: true })
    .waitFor();
  assert.equal((await snapshot(a)).character.name, "Лис · копия");
  await spareHero
    .getByRole("button", { name: "Отправить на отдых", exact: true })
    .click();
  await originalHero
    .getByRole("button", { name: "Выбрать для мира", exact: true })
    .click();
  await originalHero
    .getByRole("button", { name: "Отправить на отдых", exact: true })
    .waitFor();
  const expectedHero = structuredClone(savedA.character);
  expectedHero.lastMove = 0;
  expectedHero.extra.duel = false;
  assert.deepEqual((await snapshot(a)).character, expectedHero);
  await originalHero
    .getByText("Характеристики и состояние", { exact: true })
    .click();
  await originalHero.getByRole("table").waitFor();
  await originalHero.getByText("История героя", { exact: true }).click();
  await originalHero
    .getByText(/Строка истории/)
    .first()
    .waitFor();
  await button(spareHero, "Изменить").click();
  const heroName = a
    .getByRole("dialog", { name: "Персонажи" })
    .getByLabel("Имя героя");
  await heroName.fill("Запасной герой");
  const spareId = await a.request
    .get(url + "/api/heroes")
    .then((r) => r.json())
    .then((heroes) => heroes.find((hero) => hero.name === "Лис · копия").id);
  await delayedPost(
    a,
    url + "/api/heroes/" + spareId,
    () =>
      heroName.evaluate((e) => {
        e.form.requestSubmit();
        e.form.requestSubmit();
      }),
    async () =>
      a
        .getByRole("dialog", { name: "Персонажи" })
        .getByText("Сохранение…", { exact: true })
        .waitFor(),
  );
  await a
    .getByRole("heading", { name: "Запасной герой", exact: true })
    .waitFor();
  await button(b, "Снять").click();
  await button(b, "Надеть").waitFor();
  await observer.reload();
  const sheet = observer.getByRole("complementary", { name: "Лист персонажа" });
  await sheet.getByText("Что даст уровень 1", { exact: true }).click();
  await sheet.getByText(/Не хватает 35 XP/).waitFor();
  await sheet.getByText(/Откроется способность: Спринт/).waitFor();
  assert.equal(await button(sheet, "Повысить уровень").isEnabled(), false);
  await button(observer, "Поговорить").click();
  await sheet.getByText(/После оплаты останется 5 XP/).waitFor();
  await sheet.screenshot({ path: join(screenshotDir, "level-preview.png") });
  await button(sheet, "Повысить уровень").click();
  await sheet.getByText("Что даст уровень 2", { exact: true }).waitFor();
  await observer
    .locator("summary")
    .filter({ hasText: "Достигнут уровень 1. Потрачено 100 XP." })
    .first()
    .waitFor();
  await observer.reload();
  await sheet.getByText("5 / 880", { exact: true }).waitFor();
  const graduate = (await snapshot(observer)).character;
  assert.equal(
    graduate.attributes.strength.current,
    trainee.character.attributes.strength.current + 1,
  );
  assert.equal(graduate.level, 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: two Chrome sessions, join, reconnect, restart, movement, chat, d100, XP, cache, persistent equipment, reload and world re-entry.",
  );
} finally {
  await browser?.close();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}

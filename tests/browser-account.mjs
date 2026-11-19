import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { chromium } from "playwright-core";
import axe from "axe-core";
import { createApp } from "../apps/server/app.ts";

const dir = mkdtempSync(join(tmpdir(), "ure-account-browser-"));
let origin;
const messages = [];
const app = createApp(join(dir, "accounts.sqlite"), {
  accountMail: {
    get origin() {
      return origin;
    },
    async deliver(mail) {
      messages.push(mail);
    },
  },
});
const executablePath = [
  process.env.BROWSER_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((path) => path && existsSync(path));
let browser;
try {
  assert.ok(
    executablePath,
    "Provide an installed Chromium browser via BROWSER_PATH",
  );
  origin = await app.listen({ host: "127.0.0.1", port: 0 });
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
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
  const api = (path, data) =>
    data
      ? page.request.post(origin + "/api/" + path, { data })
      : page.request.get(origin + "/api/" + path);
  const button = (name) => page.getByRole("button", { name, exact: true });
  const status = (text) => page.getByRole("status").filter({ hasText: text });
  const field = (name) => page.getByLabel(name, { exact: true });
  const old = "Орхидея календарь волна фонарь";
  const changed = "Абрикос чернила мозаика кувшин";
  const reset = "Акварель окно вереск бастион";
  const name = "maptester";
  const email = "atlas@example.test";
  const scan = async () => {
    if (!(await page.evaluate(() => Boolean(window.axe))))
      await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () =>
      (await window.axe.run()).violations.map(({ id, impact }) => ({
        id,
        impact,
      })),
    );
    assert.deepEqual(violations, []);
  };
  async function nextMessage(index) {
    for (let i = 0; i < 100 && !messages[index]; i++) await setTimeout(50);
    assert.ok(messages[index], "Test-only mail was received");
    return messages[index].text;
  }

  assert.equal(
    (
      await api("auth/register", {
        name,
        email,
        password: old,
        confirmation: old,
        display: "Картограф",
        accepted: true,
        avatar: "leaf",
      })
    ).status(),
    200,
  );
  await page.goto(origin);
  await button("Картограф").click();
  const profile = page.getByRole("dialog", { name: "Профиль" });
  await button("Подтвердить email").click();
  await status("Почтовый шлюз принял запрос").waitFor();
  const verificationUrl = await nextMessage(0);
  const verify = new URLSearchParams(
    new URL(verificationUrl).hash.slice(1),
  ).get("verify");
  assert.equal(
    (await api("account/link", { purpose: "verify", code: verify })).status(),
    200,
  );
  await profile.getByText("Изменить пароль", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await field("Текущий пароль").fill("incorrect");
  const eye = button("Показать: Текущий пароль");
  await eye.focus();
  await page.keyboard.press("Space");
  assert.equal(await field("Текущий пароль").getAttribute("type"), "text");
  await page.keyboard.press("Space");
  assert.equal(await field("Текущий пароль").getAttribute("type"), "password");
  await field("Пароль").fill(changed);
  await page.getByRole("meter", { name: "Стойкость пароля" }).waitFor();
  await field("Подтверждение пароля").fill(old);
  await button("Сменить пароль").click();
  await status("Пароли не совпадают").waitFor();
  assert.equal(
    await field("Подтверждение пароля").evaluate(
      (e) => e === document.activeElement,
    ),
    true,
  );
  await field("Подтверждение пароля").fill(changed);
  await button("Сменить пароль").click();
  await status("Неверный текущий пароль").waitFor();
  await field("Текущий пароль").fill(old);
  await scan();
  const captures = process.env.URE_SCREENSHOT_DIR || "test-results/browser";
  mkdirSync(captures, { recursive: true });
  await profile
    .getByRole("region", { name: "Требования к паролю" })
    .screenshot({ path: join(captures, "change-password.png") });
  const changeResponse = page.waitForResponse(
    (response) => response.url() === origin + "/api/profile/password",
  );
  await button("Сменить пароль").click();
  assert.equal((await changeResponse).status(), 200);
  await status("Другие сеансы завершены").waitFor();
  assert.equal(await field("Пароль").inputValue(), "");
  assert.equal((await api("me")).status(), 200);

  await profile.getByText("Выйти со всех устройств", { exact: true }).click();
  await button("Завершить все сеансы").click();
  await status("Вы вышли со всех устройств").waitFor();
  await button("Забыли пароль?").click();
  await field("Электронная почта").fill(email);
  const recoveryEndpoint = origin + "/api/recovery";
  const abort = (route) => route.abort();
  await page.route(recoveryEndpoint, abort);
  await button("Отправить письмо").click();
  await status("Проверьте соединение").waitFor();
  assert.equal(await field("Электронная почта").inputValue(), email);
  await page.unroute(recoveryEndpoint, abort);
  await scan();
  await button("Отправить письмо").click();
  await status("Запрос принят").waitFor();
  const recoveryUrl = await nextMessage(1);
  const token = new URLSearchParams(new URL(recoveryUrl).hash.slice(1)).get(
    "reset",
  );
  await page.goto(recoveryUrl);
  await page.getByRole("heading", { name: "Новый пароль" }).waitFor();
  assert.equal(new URL(page.url()).hash, "");
  await field("Пароль").fill(reset);
  await field("Подтверждение пароля").fill(reset);
  assert.equal(
    await field("Пароль").getAttribute("autocomplete"),
    "new-password",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await scan();
  await button("Подтвердить").click();
  await status("Прежние сеансы завершены").waitFor();
  assert.equal((await api("me")).status(), 401);
  await field("Имя игрока").fill(name);
  await field("Пароль").fill(reset);
  await button("Войти →").click();
  await page.getByRole("heading", { name: "Мои миры" }).waitFor();
  await page.goto(recoveryUrl);
  await field("Пароль").fill(old);
  await field("Подтверждение пароля").fill(old);
  await button("Подтвердить").click();
  await status("уже использована или просрочена").waitFor();
  assert.ok(
    token &&
      !requests.some((url) => url.includes(token) || url.includes(reset)),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: account settings, change and reset, logout all, keyboard, 390px and axe (3 views).",
  );
} finally {
  await browser?.close();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}

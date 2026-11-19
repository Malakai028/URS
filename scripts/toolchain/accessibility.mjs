import { chromium } from "playwright-core";
import axe from "axe-core";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../apps/server/app.ts";

const executablePath = [
  process.env.BROWSER_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => p && existsSync(p));
if (!executablePath)
  throw Error(
    "Set BROWSER_PATH to an installed Chrome/Chromium/Edge executable",
  );
const dir = mkdtempSync(join(tmpdir(), "ure-a11y-"));
const app = createApp(join(dir, "test.sqlite"));
let browser;
try {
  const url = await app.listen({ host: "127.0.0.1", port: 0 });
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  await page
    .context()
    .route("**/*", (route) =>
      new URL(route.request().url()).origin === url
        ? route.continue()
        : route.abort(),
    );
  await page.goto(url);
  await page.getByLabel("Имя игрока").waitFor();
  const result = {};
  async function scan(name) {
    if (!(await page.evaluate(() => Boolean(window.axe))))
      await page.addScriptTag({ content: axe.source });
    result[name] = await page.evaluate(async () => {
      const scan = await window.axe.run(document);
      return {
        violations: scan.violations,
        incomplete: scan.incomplete.map((v) => ({
          id: v.id,
          impact: v.impact,
        })),
      };
    });
    console.log(
      "axe " +
        name +
        " — " +
        result[name].violations
          .map(
            (v) =>
              v.id +
              "[" +
              v.impact +
              "] " +
              v.nodes.map((n) => n.target.join(" ")).join(", "),
          )
          .join("; "),
    );
  }
  const button = (name) => page.getByRole("button", { name, exact: true });
  await scan("login");
  const registerButton = page.getByRole("button", {
    name: "Зарегистрироваться",
    exact: true,
  });
  await registerButton.click();
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("Саванна утюг астра фарфор");
  await page.getByRole("meter", { name: "Стойкость пароля" }).waitFor();
  await scan("registration");
  const post = async (path, data) => {
    const res = await page.request.post(url + "/api/" + path, { data });
    if (!res.ok()) throw Error(path + " HTTP " + res.status());
    return res.json();
  };
  await post("auth/register", {
    name: "a11ytester",
    display: "Картограф",
    email: "axe@example.test",
    password: "Accessibility-123",
    confirmation: "Accessibility-123",
    avatar: "leaf",
    accepted: true,
  });
  const { id } = await post("worlds", {
    name: "Атлас доступности",
    description: "",
    seed: "a11y",
    land: "Лес",
    access: "invite",
    ai: false,
  });
  await post("worlds/" + id + "/room", {});
  await post("worlds/" + id + "/character", {
    name: "Лис",
    race: "R-001",
    profession: "C-001",
    flaw: "Утомляемость",
    mode: "manual",
  });
  await page.reload();
  await button("Продолжить →").waitFor();
  await scan("dashboard");
  await button("Продолжить →").click();
  await page.getByRole("heading", { name: "Карта местности" }).waitFor();
  await scan("expedition");
  await button("Чат").click();
  await scan("chat");
  await page.keyboard.press("Escape");
  await button("Персонажи").click();
  await page
    .getByRole("dialog", { name: "Персонажи" })
    .getByRole("heading", { name: "Лис", exact: true })
    .waitFor();
  await scan("hero_library");
  await page.getByText("Характеристики и состояние", { exact: true }).click();
  await scan("hero_details");
  await page.keyboard.press("Escape");
  await button("Энциклопедия").click();
  await page.locator(".record").first().waitFor();
  await scan("encyclopedia");
  await page.keyboard.press("Escape");
  await button("Картограф").click();
  await button("Сохранить профиль").waitFor();
  await scan("profile");
  mkdirSync("test-results/toolchain", { recursive: true });
  writeFileSync(
    "test-results/toolchain/accessibility.json",
    JSON.stringify(result, null, 2),
  );
  const blocking = Object.values(result)
    .flatMap((scan) => scan.violations)
    .filter((v) => ["serious", "critical"].includes(v.impact));
  console.log(
    "axe — " +
      blocking.length +
      " serious/critical across " +
      Object.keys(result).length +
      " views",
  );
  if (blocking.length) process.exitCode = 1;
} finally {
  await browser?.close();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}

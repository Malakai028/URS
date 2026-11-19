import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";

if (process.platform !== "win32" || !process.argv[2])
  throw Error("Укажите Windows ZIP");
const dir = await mkdtemp(join(tmpdir(), "ure-zip-smoke-"));
const archive = resolve(process.argv[2]);
const stop = join(dir, "stop-sample");
const harness = join(dir, "shutdown.mjs");
const origin = "http://127.0.0.1:4183";
const credentials = { name: "JourneyTester", password: randomUUID() };
async function run(check) {
  const child = spawn("cmd.exe", ["/d", "/c", "Start-Game.cmd"], {
    cwd: dir,
    windowsHide: true,
    stdio: ["pipe", "pipe", "inherit"],
    env: {
      ...process.env,
      LOCALAPPDATA: join(dir, "isolated-profile"),
      NODE_OPTIONS: "--import=" + pathToFileURL(harness).href,
    },
  });
  child.stdin.end();
  const lines = createInterface({ input: child.stdout });
  const exit = once(child, "exit");
  try {
    await Promise.race([
      exit.then(() => {
        throw Error("Сервер завершился до готовности");
      }),
      (async () => {
        for await (const line of lines)
          if (line.trim() === "URE " + origin) return;
        throw Error("Адрес экземпляра не подтверждён");
      })(),
    ]);
    assert.equal((await fetch(origin + "/healthz")).status, 200);
    const html = await (await fetch(origin)).text();
    assert.match(html, /id="root"/);
    const asset = html.match(/src="([^"]+\.js)"/)[1];
    assert.equal((await fetch(origin + asset)).status, 200);
    await check();
  } finally {
    await writeFile(stop, "");
    await exit;
    lines.close();
    await rm(stop, { force: true });
  }
}
try {
  execFileSync("tar.exe", ["-xf", archive, "-C", dir]);
  await writeFile(
    harness,
    `import{existsSync}from'node:fs';const t=setInterval(()=>{if(existsSync(${JSON.stringify(stop)})){clearInterval(t);process.emit('SIGTERM')}},100);t.unref();`,
  );
  async function auth(route, fields) {
    const response = await fetch(origin + "/api/auth/" + route, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(fields),
    });
    assert.equal(response.status, 200);
    return (await response.json()).id;
  }
  let id;
  await run(async () => {
    id = await auth("register", {
      ...credentials,
      confirmation: credentials.password,
      email: "tester@example.test",
      avatar: "leaf",
      display: "Путник",
      accepted: true,
    });
  });
  await access(
    join(
      dir,
      "isolated-profile",
      "Universal RPG Engine",
      "local-game",
      "worlds.sqlite",
    ),
  );
  await run(async () => assert.equal(await auth("login", credentials), id));
  console.log(
    "PASS · распакованный ZIP, Start-Game.cmd, интерфейс, API, сохранение и повторный вход после перезапуска.",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}

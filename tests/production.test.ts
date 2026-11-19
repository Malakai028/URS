import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { WebSocket } from "ws";

const entry = new URL("../apps/server/start.ts", import.meta.url).href;
const origin = "https://game.example.test";

function boot(t: TestContext, cwd: string, publicOrigin = origin) {
  // Windows doesn't deliver POSIX SIGTERM to Node. Exercise the same signal
  // handler by IPC in this child only. On Linux deliver a real OS signal.
  const source =
    'if (process.platform === "win32") process.once("message", () => { process.disconnect(); process.emit("SIGTERM"); });' +
    "await import(" + JSON.stringify(entry) + ")";
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    cwd,
    env: {
      ...process.env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: "0",
      DATABASE_FILE: join(cwd, "stage.sqlite"), PUBLIC_ORIGIN: publicOrigin,
      TRUSTED_PROXY: "127.0.0.1", NARRATOR_URL: "", ACCOUNT_MAIL_URL: "",
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const exit = once(child, "exit");
  assert.ok(child.stderr && child.stdout);
  child.stderr.resume();
  const stdout = createInterface({ input: child.stdout });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exit;
    stdout.close();
  });
  return {
    async address() {
      const [line] = await Promise.race([
        once(stdout, "line", { signal: AbortSignal.timeout(20000) }),
        exit.then(() => { throw Error("Сервер завершился до готовности"); }),
      ]);
      assert.match(line, /^URE http:\/\/127\.0\.0\.1:\d+$/);
      return line.slice(4) as string;
    },
    async stop() {
      if (process.platform === "win32") child.send("stop");
      else child.kill("SIGTERM");
      const [code] = await once(child, "exit", { signal: AbortSignal.timeout(8000) });
      assert.equal(code, 0);
    },
    exit,
  };
}

test("production refuses HTTP origin before opening SQLite", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ure-origin-"));
  try {
    const process = boot(t, dir, "http://game.example.test");
    assert.equal((await process.exit)[0], 1);
    assert.equal(existsSync(join(dir, "stage.sqlite")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("production serves health, drains live sockets and resumes the same world and session", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ure-deploy-"));
  // This test runs before Vite build in a clean checkout. Only the startup
  // file requirement is exercised here; test:browser loads the real bundle.
  mkdirSync(join(dir, "dist"));
  writeFileSync(join(dir, "dist/index.html"), "<title>fixture</title>");
  try {
    const first = boot(t, dir);
    const address = await first.address();
    const health = await fetch(address + "/healthz");
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("cache-control"), "no-store");
    assert.deepEqual(await health.json(), { status: "ok" });
    const registered = await fetch(address + "/api/auth/register", {
      method: "POST", headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        name: "expedition", display: "Экспедиция", email: "expedition@example.test", avatar: "leaf",
        password: "testing-password", confirmation: "testing-password", accepted: true,
      }),
    });
    assert.equal(registered.status, 200);
    const setCookie = registered.headers.getSetCookie()[0];
    assert.match(setCookie, /; Secure(?:;|$)/);
    assert.match(setCookie, /; HttpOnly(?:;|$)/);
    const cookie = setCookie.split(";")[0];
    const world = await fetch(address + "/api/worlds", {
      method: "POST", headers: { "content-type": "application/json", cookie, origin },
      body: JSON.stringify({ name: "Экспедиция", description: "", access: "invite", land: "Лес", seed: "42", ai: false }),
    });
    assert.equal(world.status, 200);
    const { id } = await world.json();
    const socket = new WebSocket(address.replace("http:", "ws:") + "/live?world=" + id, { headers: { cookie, origin } });
    await once(socket, "open", { signal: AbortSignal.timeout(4000) });
    const closed = once(socket, "close", { signal: AbortSignal.timeout(8000) });
    const [[code]] = await Promise.all([closed, first.stop()]);
    assert.equal(code, 1012);
    const next = boot(t, dir);
    const reloaded = await fetch(await next.address() + "/api/worlds/" + id, { headers: { cookie } });
    assert.equal(reloaded.status, 200);
    assert.equal((await reloaded.json()).world.id, id);
    await next.stop();
  } finally {
    // An assertion may have interrupted the client while the DB was open.
    t.after(() => rmSync(dir, { recursive: true, force: true }));
  }
});

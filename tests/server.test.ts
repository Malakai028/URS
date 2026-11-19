import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../apps/server/app.ts";
import { WebSocket } from "ws";
import { once } from "node:events";
test("two accounts, roles, socket, validation, replay, reload and cold restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ure-test-")),
    file = join(dir, "save.sqlite");
  let app = createApp(file);
  const req = async (path: string, body?: any, cookie = "") =>
    app.inject({
      method: body === undefined ? "GET" : "POST",
      url: "/api/" + path,
      headers: { cookie },
      payload: body,
    });
  const auth = async (name: string) => {
    const r = await req("auth/register", {
      name,
      password: "testing-password",
      confirmation: "testing-password",
      display: name,
      email: name + "@example.test",
      avatar: "leaf",
      accepted: true,
    });
    assert.equal(r.statusCode, 200);
    return r.headers["set-cookie"]!.toString().split(";")[0];
  };
  try {
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const a = await auth("owner"),
      b = await auth("player"),
      s = await auth("spectator");
    const w = (
      await req(
        "worlds",
        {
          name: "Тест мира",
          description: "",
          access: "invite",
          land: "Лес",
          seed: "42",
          ai: false,
        },
        a,
      )
    ).json().id;
    const path = "worlds/" + w;
    assert.equal((await req(path, undefined, b)).statusCode, 403);
    assert.equal((await req(path)).statusCode, 401);
    assert.equal((await req(path, undefined, a)).json().room, null);
    await req(path + "/room", {}, a);
    for (const [cookie, role] of [
      [b, "player"],
      [s, "spectator"],
    ]) {
      const code = (await req(path + "/invite", { role }, a)).json().code;
      assert.equal((await req("join", { code }, cookie)).json().id, w);
    }
    const char = {
      name: "Руна",
      mode: "manual",
      race: "R-001",
      profession: "C-001",
      flaw: "Утомляемость",
    };
    assert.equal((await req(path + "/character", char, s)).statusCode, 403);
    await req(path + "/character", char, a);
    await req(path + "/character", { ...char, name: "Астра" }, b);
    const socket = new WebSocket(
      address.replace("http", "ws") + "/live?world=" + w,
      { headers: { cookie: b } },
    );
    await once(socket, "open");
    await new Promise((r) => setTimeout(r, 40));
    try {
      const notify = once(socket, "message");
      const key = randomUUID(),
        action = { type: "move", dx: 1, dy: 0 };
      const moved = await req(path + "/action", { key, action }, a);
      assert.equal(moved.statusCode, 200);
      await notify;
      assert.equal(
        (await req(path + "/action", { key, action }, a)).json().id,
        moved.json().id,
      );
      assert.equal((await req(path, undefined, a)).json().character.x, 13);
      assert.equal(
        (
          await req(
            path + "/action",
            { key: randomUUID(), action: { type: "move", dx: 3, dy: 1 } },
            a,
          )
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await req(
            path + "/action",
            { key: randomUUID(), action: { type: "gm", text: "x" } },
            b,
          )
        ).statusCode,
        403,
      );
      assert.equal(
        (await req(path + "/invite", { role: "gm" }, b)).statusCode,
        403,
      );
      assert.equal(
        (
          await req(
            path + "/action",
            { key: randomUUID(), action: { type: "roll", xp: 999 } },
            a,
          )
        ).statusCode,
        400,
      );
      const roll = (
        await req(
          path + "/action",
          { key: randomUUID(), action: { type: "roll" } },
          a,
        )
      ).json();
      assert.ok(roll.audit.attempts[0].roll >= 1);
      await req(
        path + "/action",
        {
          key: randomUUID(),
          action: { type: "chat", text: "Встреча у башни" },
        },
        b,
      );
      const talked = { key: randomUUID(), action: { type: "talk" } };
      await req(path + "/action", talked, a);
      const before = (await req(path, undefined, a)).json();
      await req(path + "/action", talked, a);
      assert.equal(
        (await req(path, undefined, a)).json().character.xp,
        before.character.xp,
      );
      assert.equal(
        (await req(path, undefined, b)).json().world.draft.hook,
        undefined,
      );
      assert.equal(
        (
          await req(
            path + "/action",
            { key: randomUUID(), action: { type: "roll" } },
            s,
          )
        ).statusCode,
        403,
      );
      socket.terminate();
      await app.close();
      app = createApp(file);
      const after = (await req(path, undefined, a)).json();
      assert.deepEqual(after.character, before.character);
      assert.deepEqual(after.events, before.events);
      assert.equal(after.party.length, 2);
    } finally {
      socket.terminate();
    }
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

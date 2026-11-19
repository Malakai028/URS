import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/server/app.ts";
test("OOC identity, IC portrait, private and group audience, history, replay, spectator and owner", async () => {
  const app = createApp(":memory:");
  const api = async (cookie: string, path: string, body?: any) =>
    app.inject({
      url: "/api/" + path,
      headers: { cookie },
      method: body ? "POST" : "GET",
      payload: body,
    });
  const signup = async (name: string) => {
    const r = await api("", "auth/register", {
      name,
      email: name + "@example.test",
      password: "testing-password",
      confirmation: "testing-password",
      avatar: "moon",
      accepted: true,
      display: "Игрок " + name,
    });
    return {
      cookie: String(r.headers["set-cookie"]).split(";")[0],
      id: r.json().id,
    };
  };
  try {
    const a = await signup("owner"),
      b = await signup("alice"),
      c = await signup("bob");
    const world = (
        await api(a.cookie, "worlds", {
          name: "Заповедник",
          land: "Лес",
          seed: "old",
          description: "",
          access: "invite",
          ai: false,
        })
      ).json().id,
      path = "worlds/" + world;
    await api(a.cookie, path + "/room", {});
    for (const u of [b, c]) {
      const code = (
        await api(a.cookie, path + "/invite", { role: "player" })
      ).json().code;
      await api(u.cookie, "join", { code });
    }
    for (const [i, u] of [a, b, c].entries())
      await api(u.cookie, path + "/character", {
        name: "Герой " + i,
        race: "R-009",
        profession: "C-022",
        flaw: "Рассеянность",
        mode: "manual",
      });
    const action = (u: typeof a, act: any, key = randomUUID()) =>
      api(u.cookie, path + "/action", { key, action: act });
    assert.equal(
      (await action(b, { type: "chat", text: "Сбор" })).json().audit.actor,
      "Игрок alice",
    );
    assert.equal(
      (await action(b, { type: "ic", text: "Иду" })).json().audit.actor,
      "Герой 1",
    );
    for (const act of [
      { type: "whisper", recipient: c.id },
      { type: "group", recipients: [c.id] },
    ]) {
      const e = (await action(b, { ...act, text: "закрытая беседа" })).json();
      assert.equal(e.visibility, "private");
      for (const u of [a, b, c]) {
        const seen = (await api(u.cookie, path))
          .json()
          .events.some((r: any) => r.id === e.id);
        const hist = (await api(u.cookie, path + "/history?channel=private"))
          .json()
          .some((r: any) => r.id === e.id);
        assert.equal(seen, u !== a);
        assert.equal(hist, seen);
      }
    }
    const key = randomUUID();
    const open = { type: "ability", skill: "interact", target: "cache" };
    const opened = (await action(a, open, key)).json();
    assert.equal((await action(a, open, key)).json().id, opened.id);
    const pick = (await api(b.cookie, path))
      .json()
      .objects.find((o: any) => o.kind === "loot");
    assert.ok(pick);
    assert.equal(
      (await action(b, { type: "gear", op: "take", item: pick.id })).statusCode,
      200,
    );
    assert.equal(
      (await action(c, { type: "gear", op: "take", item: pick.id })).statusCode,
      400,
    );
    await action(b, {
      type: "gear",
      op: "give",
      recipient: c.id,
      item: pick.id,
    });
    assert.equal(
      (await api(c.cookie, path)).json().character.extra.gear.length,
      1,
    );
    assert.equal(
      (await action(c, { type: "ability", skill: "attack", target: b.id }))
        .statusCode,
      400,
    );
    await api(a.cookie, path + "/settings", {
      pvp: true,
      minLevel: 0,
      maxLevel: 50,
    });
    await api(c.cookie, path + "/consent", { duel: true });
    assert.equal(
      (await action(c, { type: "ability", skill: "attack", target: b.id }))
        .statusCode,
      400,
    );
    await api(b.cookie, path + "/consent", { duel: true });
    assert.equal(
      (await action(c, { type: "ability", skill: "attack", target: b.id }))
        .statusCode,
      200,
    );
  } finally {
    await app.close();
  }
});

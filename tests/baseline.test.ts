import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../apps/server/app.ts";

test("FIX-00 HTTP boot, protected routes and origin rejection", async () => {
  const app = createApp(":memory:");
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const response = await fetch(address + "/api/recovery");
    assert.equal(response.status, 200);
    assert.equal(typeof (await response.json()).enabled, "boolean");
    for (const url of ["/api/me", "/api/heroes", "/api/worlds", "/api/profile"]) {
      assert.equal((await app.inject({ url })).statusCode, 401);
    }
    assert.equal(
      (await app.inject({
        method: "POST",
        url: "/api/logout",
        headers: { origin: "https://unrelated.example" },
        payload: {},
      })).statusCode,
      403,
    );
  } finally {
    await app.close();
  }
});

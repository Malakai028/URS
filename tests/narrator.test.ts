import test from "node:test";
import assert from "node:assert/strict";
import {generate} from "../apps/server/narrator.ts";

test("world drafts use a validated provider or deterministic fallback", async (t) => {
  const keys = ["NARRATOR_URL", "NARRATOR_MODEL", "NARRATOR_API_KEY"];
  const previous = keys.map(k => process.env[k]);
  try {
    Object.assign(process.env, {NARRATOR_URL:"https://example.invalid/api", NARRATOR_MODEL:"fixture", NARRATOR_API_KEY:"fixture-key"});
    const template = await generate("atlas", "Лес", "", false);
    const valid = {...template.draft, location:"Озёрная застава"};
    let proposal:unknown = valid;
    t.mock.method(globalThis, "fetch", async (_url:URL, request:RequestInit) => {
      assert.equal(new Headers(request.headers).get("Authorization"), "Bearer fixture-key");
      return Response.json({choices:[{message:{content:JSON.stringify(proposal)}}]});
    });
    const accepted = await generate("atlas", "Лес", "", true);
    assert.equal(accepted.provider, "LLM");
    assert.deepEqual(accepted.draft, valid);
    proposal = {...valid, xp:900};
    const fallback = await generate("atlas", "Лес", "", true);
    assert.match(fallback.provider, /резервный/);
    assert.deepEqual(fallback.draft, template.draft);
  } finally {
    keys.forEach((key,i) => {if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];});
  }
});

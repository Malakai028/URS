import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../apps/server/app.ts";
import { hashPassword, matches } from "../apps/server/accounts.ts";
import { registration } from "../packages/shared/phase2.ts";
import {
  assessRegistrationPassword,
  passwordLength,
} from "../packages/shared/registration-password.ts";

const exactMinimum = "A2!wE9-rT5?hQ+x";
const listed = "123456789987654321";
const form = (password: string, confirmation = password) => ({
  name: "trailkeeper",
  display: "Следопыт",
  email: "wayfinder@example.test",
  avatar: "leaf",
  accepted: true,
  password,
  confirmation,
});

test("registration policy counts code points, checks the offline list and allows strong phrases", () => {
  assert.equal(passwordLength(exactMinimum), 15);
  assert.equal(
    registration.safeParse(form(exactMinimum.slice(0, -1))).success,
    false,
  );
  assert.equal(registration.parse(form(exactMinimum)).password, exactMinimum);
  const unicode = "𝄞🌒🪴🧊🛰️💡🎨🏔️🏜️🧭🌍✨";
  assert.equal(passwordLength(unicode), 15);
  assert.equal(registration.safeParse(form(unicode)).success, true);
  const long = ("янтарный дирижабль летит к маяку " + exactMinimum).padEnd(
    128,
    " ",
  );
  assert.equal(passwordLength(long), 128);
  assert.equal(registration.parse(form(long)).password, long);
  assert.equal(registration.safeParse(form(long + "🪴")).success, false);
  assert.equal(
    registration.safeParse(form("  satellite café thermos polar  ")).success,
    true,
  );
  for (const password of [
    "abcabcabcabcabc",
    "qwertyuiopasdfghjkl",
    listed,
    "wayfinder123456",
    "trailkeeper1234",
  ]) {
    assert.equal(registration.safeParse(form(password)).success, false);
  }
  assert.equal(
    assessRegistrationPassword(listed, listed, "", "").checks.common,
    false,
  );
  assert.equal(
    assessRegistrationPassword(
      "wayfinder123456",
      "",
      "",
      "wayfinder@example.test",
    ).checks.identity,
    false,
  );
  assert.equal(
    registration.safeParse(form("Термос trailkeeper комета ландыш")).success,
    true,
  );
  assert.equal(
    registration.safeParse(form(exactMinimum + "\ud800")).success,
    false,
  );
  assert.equal(
    registration.safeParse(form(exactMinimum, exactMinimum + " ")).success,
    false,
  );
});

test("registration and login use the validated password without disclosure or duplicate accounts", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ure-registration-")),
    file = join(dir, "accounts.sqlite");
  const app = createApp(file);
  const log = t.mock.method(console, "log", () => {});
  const error = t.mock.method(console, "error", () => {});
  const warn = t.mock.method(console, "warn", () => {});
  const post = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/" + url, payload });
  const password = "  Сувенир café телескоп изгородь 🧊  ";
  try {
    for (const input of [
      form(listed),
      form(exactMinimum.slice(0, -1)),
      form("🪴".repeat(129)),
      form(password, "другое значение"),
    ]) {
      const r = await post("auth/register", input);
      assert.equal(r.statusCode, 400);
      assert.equal(r.body.includes(input.password), false);
    }
    const [first, duplicate] = await Promise.all([
      post("auth/register", form(password)),
      post("auth/register", form(password)),
    ]);
    assert.deepEqual(
      [first.statusCode, duplicate.statusCode].sort(),
      [200, 409],
    );
    const occupiedEmail = await post("auth/register", {
      ...form(password),
      name: "othername",
    });
    assert.equal(occupiedEmail.statusCode, 409);
    assert.equal(
      occupiedEmail.body,
      (first.statusCode === 409 ? first : duplicate).body,
    );
    assert.equal(
      (
        await post("auth/register", {
          ...form(password),
          name: "othername",
          email: "other@example.test",
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await post("auth/login", { name: form(password).name, password }))
        .statusCode,
      200,
    );
    assert.equal(
      (
        await post("auth/login", {
          name: form(password).name,
          password: password.trim(),
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await post("auth/login", {
          name: form(password).name,
          password: password.normalize("NFC"),
        })
      ).statusCode,
      401,
    );
    assert.equal((await post("profile/password", {})).statusCode, 401);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/register",
          headers: { origin: "https://outside.example" },
          payload: form(password),
        })
      ).statusCode,
      403,
    );
    const db = new DatabaseSync(file);
    try {
      const rows = db
        .prepare("SELECT password FROM users ORDER BY name")
        .all()
        .map((r) => String(r.password));
      assert.equal(rows.length, 2);
      for (const hash of rows) {
        assert.match(hash, /^a2\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
        assert.equal(hash.includes(password), false);
        assert.equal(await matches(password, hash), true);
      }
      assert.notEqual(rows[0].split("$")[1], rows[1].split("$")[1]);
      const old = "старый пароль";
      const legacy = await hashPassword(old);
      db.prepare("INSERT INTO users(id,name,password) VALUES (?,?,?)").run(
        "legacy-argon",
        "existing",
        legacy,
      );
      assert.equal(
        (await post("auth/login", { name: "existing", password: old }))
          .statusCode,
        200,
      );
      assert.equal(
        db.prepare("SELECT password FROM users WHERE id=?").get("legacy-argon")
          ?.password,
        legacy,
      );
    } finally {
      db.close();
    }
    const logs = [log, error, warn]
      .flatMap((spy) =>
        spy.mock.calls.map((call) => call.arguments.map(String).join(" ")),
      )
      .join("\n");
    assert.equal(logs.includes(password), false);
    assert.equal(
      first.body.includes(password) || duplicate.body.includes(password),
      false,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

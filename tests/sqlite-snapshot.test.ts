import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openDb } from "../apps/server/db.ts";

const snapshot = (from: string, to: string) =>
  spawnSync(
    process.execPath,
    ["scripts/toolchain/sqlite-snapshot.mjs", from, to],
    {
      encoding: "utf8",
    },
  );

test("Резервная копия и восстановление включают зафиксированные изменения WAL", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ure-backup-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, "original.db");
  const artifact = join(dir, "game-backup.sqlite");
  const restored = join(dir, "restored.sqlite");
  const store = openDb(source);
  try {
    store.db.exec("PRAGMA wal_autocheckpoint=0");
    store.run(
      "INSERT INTO users(id,name,password) VALUES ('tester','Traveller','fixture')",
    );
    store.run(
      "INSERT INTO worlds VALUES ('world','tester','Архипелаг','','seed','land','private','{}','local','v1')",
    );
    store.db.exec("BEGIN IMMEDIATE");
    try {
      store.run("UPDATE worlds SET name='Незавершённое изменение'");
      assert.ok(existsSync(source + "-wal"));
      const save = snapshot(source, artifact);
      assert.equal(save.status, 0, save.stderr);
    } finally {
      store.db.exec("ROLLBACK");
    }
  } finally {
    store.db.close();
  }
  const restore = snapshot(artifact, restored);
  assert.equal(restore.status, 0, restore.stderr);
  const reopened = openDb(restored);
  try {
    assert.equal(
      reopened.one("SELECT name FROM worlds WHERE owner='tester'")?.name,
      "Архипелаг",
    );
    assert.equal(reopened.one("PRAGMA user_version")?.user_version, 2);
  } finally {
    reopened.db.close();
  }
  const before = readFileSync(artifact);
  assert.notEqual(snapshot(restored, artifact).status, 0);
  assert.deepEqual(readFileSync(artifact), before);
  const occupied = join(dir, "old.sqlite");
  writeFileSync(occupied + "-wal", "existing sidecar");
  assert.notEqual(snapshot(artifact, occupied).status, 0);
  assert.ok(!existsSync(occupied));
});

test("Ошибки исходного файла и нарушения связей не публикуют резервную копию", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ure-backup-invalid-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, "missing.sqlite");
  const dest = join(dir, "backup.sqlite");
  assert.notEqual(snapshot(source, dest).status, 0);
  assert.ok(!existsSync(source));
  const store = openDb(source);
  store.db.close();
  const invalid = new DatabaseSync(source);
  try {
    invalid.exec(
      "PRAGMA foreign_keys=OFF; INSERT INTO sessions VALUES ('sample','absent',0)",
    );
  } finally {
    invalid.close();
  }
  assert.notEqual(snapshot(source, dest).status, 0);
  assert.ok(!existsSync(dest));
});

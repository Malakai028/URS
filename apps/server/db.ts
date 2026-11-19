import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { rules } from "../../packages/engine/index.ts";
export function openDb(file = process.env.DATABASE_FILE || "data/ure.sqlite") {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000",
  );
  const run = (sql: string, ...args: SQLInputValue[]) =>
    db.prepare(sql).run(...args);
  const one = (sql: string, ...args: SQLInputValue[]) =>
    db.prepare(sql).get(...args) as Record<string, any> | undefined;
  const all = (sql: string, ...args: SQLInputValue[]) =>
    db.prepare(sql).all(...args) as Record<string, any>[];
  function transaction<T>(fn: () => T) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  const version = Number(one("PRAGMA user_version")?.user_version);
  if (version > 2) throw Error("Неподдерживаемая версия БД");
  if (version === 0)
    transaction(() =>
      db.exec(readFileSync(new URL("./001.sql", import.meta.url), "utf8")),
    );
  if (version < 2)
    transaction(() => {
      db.exec(readFileSync(new URL("./002.sql", import.meta.url), "utf8"));
      for (const row of all("SELECT * FROM characters")) {
        const id = randomUUID();
        run("INSERT INTO heroes VALUES (?,?,?,0)", id, row.user_id, row.state);
        run(
          "INSERT INTO active_heroes VALUES (?,?,?)",
          row.world_id,
          row.user_id,
          id,
        );
      }
    });
  function seed() {
    transaction(() => {
      run(
        "INSERT OR IGNORE INTO definitions VALUES (?,?)",
        "ration",
        JSON.stringify({ name: "Походный паёк", energy: 3 }),
      );
      run(
        "INSERT OR IGNORE INTO definitions VALUES (?,?)",
        rules.version,
        JSON.stringify(rules, (_k, v) =>
          typeof v === "bigint" ? String(v) : v,
        ),
      );
    });
  }
  seed();
  return { db, run, one, all, transaction, seed };
}
export type Store = ReturnType<typeof openDb>;

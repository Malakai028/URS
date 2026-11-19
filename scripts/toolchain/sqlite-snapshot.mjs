import { backup, DatabaseSync } from "node:sqlite";
import { link, mkdtemp, open, rm, lstat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

// Use the SQLite backup API so committed rows in a live WAL are included.
// Publish only a closed, verified database, without replacing an existing file.
async function snapshot(source, destination) {
  const target = resolve(destination);
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    try {
      await lstat(target + suffix);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    throw Error(
      "Выберите новое имя назначения без файлов SQLite или журналов.",
    );
  }
  const db = new DatabaseSync(resolve(source), { readOnly: true });
  let work;
  try {
    work = await mkdtemp(join(dirname(target), ".ure-snapshot-"));
    const file = join(work, "snapshot.sqlite");
    const handle = await open(file, "wx", 0o600);
    await handle.close();
    await backup(db, file);
    const copy = new DatabaseSync(file);
    try {
      // Leave one portable file. The application re-enables WAL when opened.
      copy.exec("PRAGMA journal_mode=DELETE");
      if (
        copy.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" ||
        copy.prepare("PRAGMA foreign_key_check").get()
      ) {
        throw Error("Копия не прошла проверку целостности.");
      }
      const tables = copy
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('users','worlds','characters','events')",
        )
        .all();
      if (tables.length !== 4) throw Error("В копии отсутствуют таблицы URE.");
    } finally {
      copy.close();
    }
    await link(file, target);
  } finally {
    db.close();
    if (work) await rm(work, { recursive: true, force: true });
  }
}

try {
  if (process.argv.length !== 4)
    throw Error("Укажите исходный файл URE и новый файл назначения.");
  await snapshot(process.argv[2], process.argv[3]);
  console.log("Проверенная копия SQLite сохранена.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

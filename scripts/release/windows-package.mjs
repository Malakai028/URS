import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Input is a tested public export with dist built. Keep player saves and
// source manuscripts outside the bundle. Use a new output directory per release.
if (
  process.platform !== "win32" ||
  !process.env.npm_execpath ||
  process.argv.length !== 4
)
  throw Error(
    "npm run release:windows -- <собранная публичная копия> <новый каталог>",
  );
const source = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
mkdirSync(output);
const work = mkdtempSync(join(tmpdir(), "ure-package-"));
try {
  const copy = (path) =>
    cpSync(join(source, path), join(work, path), { recursive: true });
  for (const path of [
    "package.json",
    "package-lock.json",
    "apps/server",
    "packages",
    "dist",
  ])
    copy(path);
  for (const name of [
    "Bestiary_Catalog",
    "Classes_Catalog",
    "Races_Catalog",
    "Currencies_14",
    "Ranks_55",
    "Tiers_2520",
  ])
    copy("docs/reference/URE_Library_v0_6/" + name + ".csv");
  for (const name of ["03_Character_Races_Classes", "04_Bestiary"])
    copy("docs/reference/extracted/" + name + ".txt");
  execFileSync(
    process.execPath,
    [
      process.env.npm_execpath,
      "ci",
      "--omit=dev",
      "--ignore-scripts",
      "--workspaces=false",
      "--no-audit",
      "--no-fund",
    ],
    { cwd: work, stdio: "inherit" },
  );
  copyFileSync(
    fileURLToPath(new URL("./Start-Game.cmd", import.meta.url)),
    join(work, "Start-Game.cmd"),
  );
  writeFileSync(
    join(work, "START.txt"),
    "Распакуйте весь архив. Нужен Node.js 24.12+ ветки 24. Запустите Start-Game.cmd и откройте http://127.0.0.1:4183 на этом компьютере. Сборка и зависимости уже включены. Окно сервера показывает путь к сохранениям. Для остановки нажмите Ctrl+C.\r\n",
  );
  execFileSync(
    "tar.exe",
    ["-a", "-cf", join(output, "URS-Windows.zip"), "-C", work, "."],
    { stdio: "inherit" },
  );
  console.log(join(output, "URS-Windows.zip"));
} finally {
  rmSync(work, { recursive: true, force: true });
}

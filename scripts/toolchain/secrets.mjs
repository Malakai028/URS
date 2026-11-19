import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
const local = resolve(
  ".tools/gitleaks",
  process.platform === "win32" ? "gitleaks.exe" : "gitleaks",
);
const binary =
  process.env.GITLEAKS_PATH || (existsSync(local) ? local : "gitleaks");
mkdirSync("test-results/toolchain", { recursive: true });
const result = spawnSync(
  binary,
  [
    "git",
    ...(process.argv.includes("--staged")
      ? ["--staged"]
      : ["--log-opts=--all --full-history -m"]),
    "--no-banner",
    "--redact",
    "--report-format=json",
    process.argv.includes("--staged")
      ? "--report-path=test-results/toolchain/secrets-staged.json"
      : "--report-path=test-results/toolchain/secrets.json",
  ],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

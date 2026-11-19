import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

if (!process.env.npm_execpath) throw Error("Run with npm run verify");
const results = [];
for (const script of [
  "typecheck",
  "lint",
  "test",
  "test:expedition",
  "content:check",
  "build",
  "test:browser",
  "test:a11y",
  "security:audit",
  "security:secrets",
]) {
  console.log("\nURE verification — " + script);
  const result = spawnSync(
    process.execPath,
    [process.env.npm_execpath, "run", script],
    {
      stdio: "inherit",
      env: { ...process.env, URE_SCREENSHOT_DIR: "test-results/browser" },
    },
  );
  results.push({
    script,
    exitCode: result.status,
    error: result.error?.message,
  });
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    break;
  }
}
mkdirSync("test-results/toolchain", { recursive: true });
writeFileSync(
  "test-results/toolchain/verification.json",
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      results,
    },
    null,
    2,
  ),
);

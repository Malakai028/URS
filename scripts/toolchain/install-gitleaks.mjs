import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const versionNumber = "8.30.1";
const releases = {
  win32: {
    suffix: "windows_x64.zip",
    sha256: "d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e",
    command: "gitleaks.exe",
    tar: "tar.exe",
  },
  linux: {
    suffix: "linux_x64.tar.gz",
    sha256: "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
    command: "gitleaks",
    tar: "tar",
  },
};
const release = releases[process.platform];
if (!release || process.arch !== "x64")
  throw Error("Use GITLEAKS_PATH for platforms other than Windows/Linux x64");
const directory = resolve(".tools/gitleaks");
mkdirSync(directory, { recursive: true });
const name = "gitleaks_" + versionNumber + "_" + release.suffix;
const archive = resolve(directory, name);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (!existsSync(archive) || digest(readFileSync(archive)) !== release.sha256) {
  const response = await fetch(
    "https://github.com/gitleaks/gitleaks/releases/download/v" +
      versionNumber +
      "/" +
      name,
    { signal: AbortSignal.timeout(60000) },
  );
  if (!response.ok) throw Error("Gitleaks download HTTP " + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== release.sha256)
    throw Error("Gitleaks archive checksum mismatch");
  writeFileSync(archive, bytes);
}
const listing = spawnSync(release.tar, ["-tf", archive], { encoding: "utf8" });
if (listing.status !== 0) throw Error("Cannot inspect Gitleaks archive");
const members = listing.stdout.trim().split(/\r?\n/);
if (!members.includes(release.command))
  throw Error("Missing scanner in release archive");
for (const member of members) {
  if (![release.command, "LICENSE", "README.md"].includes(member))
    throw Error("Unexpected Gitleaks archive member");
}
const extraction = spawnSync(release.tar, ["-xf", archive, "-C", directory], {
  stdio: "inherit",
});
if (extraction.status !== 0) throw Error("Gitleaks extraction failed");
const version = spawnSync(resolve(directory, release.command), ["version"], {
  encoding: "utf8",
});
if (version.status !== 0 || version.stdout.trim() !== versionNumber)
  throw Error("Gitleaks version check failed");
console.log("Installed Gitleaks " + versionNumber + " in " + directory);

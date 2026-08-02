import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const baseline = "b598474d5ab41d72962198612c853a945fa16100";
const stem = "pms-api-console-v1-conformant-candidate";
const zipPath = resolve(root, `${stem}.zip`);
const shaPath = resolve(root, `${stem}.zip.sha256`);
const patchPath = resolve(root, `${stem}.patch`);
const included = [
  "apps/pms-api",
  "packages/pms-console-api-contract",
  "packages/pms-console-api-testkit",
  "scripts/pms-console-conformance",
  "reports/pms-console-api-v1-conformance",
  "docs/operations/PMS_CONSOLE_API.md",
  "DELIVERY_REPORT.md",
  "LOCAL_VALIDATION_REQUIRED.md",
  "package.json",
];

const patch = execFileSync("git", ["diff", "--binary", baseline, "--"], {
  cwd: root,
  maxBuffer: 64 * 1024 * 1024,
});
writeFileSync(patchPath, patch);

rmSync(zipPath, { force: true });
const zipped = spawnSync("zip", ["-q", "-X", "-r", zipPath, ...included], {
  cwd: root,
  encoding: "utf8",
});
if (zipped.status !== 0) {
  process.stderr.write(zipped.stderr);
  process.exit(1);
}
const tested = spawnSync("unzip", ["-t", zipPath], {
  cwd: root,
  encoding: "utf8",
});
if (tested.status !== 0) {
  process.stderr.write(tested.stdout);
  process.stderr.write(tested.stderr);
  process.exit(1);
}
const entries = execFileSync("zipinfo", ["-1", zipPath], { encoding: "utf8" })
  .split(/\r?\n/u)
  .filter(Boolean);
const forbidden = entries.filter((entry) => {
  const parts = entry.split("/");
  return (
    parts.includes("node_modules") ||
    parts.includes("dist") ||
    parts.includes("coverage") ||
    parts.includes(".git") ||
    parts.some((part) => part === ".env" || part.startsWith(".env."))
  );
});
if (forbidden.length > 0) {
  throw new Error(`PMS_CONSOLE_DELIVERY_FORBIDDEN_ENTRIES:${forbidden.join(",")}`);
}
const digest = createHash("sha256").update(readFileSync(zipPath)).digest("hex");
writeFileSync(shaPath, `${digest}  ${basename(zipPath)}\n`);
process.stdout.write(
  `${JSON.stringify(
    {
      zip: basename(zipPath),
      sha256: digest,
      patch: basename(patchPath),
      entryCount: entries.length,
      zipIntegrity: "passed",
      forbiddenEntryCount: forbidden.length,
    },
    null,
    2,
  )}\n`,
);

/* global console, process */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const reportRoot = "reports/pms-console-api-contract-v1";
const deliveryRoot = path.join(reportRoot, "delivery");
const baseName = "pms-console-api-contract-v1-frozen";
const zipPath = path.join(deliveryRoot, `${baseName}.zip`);
const checksumPath = `${zipPath}.sha256`;
const patchPath = path.join(deliveryRoot, `${baseName}.patch`);
const changedPathsFile = path.join(reportRoot, "FINAL_CHANGED_PATHS.txt");
fs.mkdirSync(deliveryRoot, { recursive: true });

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout;
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : entry.isFile() ? [target] : [];
  });
}

const obsoleteBlocked = [
  path.join(deliveryRoot, "pms-console-api-contract-v1-candidate3-blocked.zip"),
  path.join(deliveryRoot, "pms-console-api-contract-v1-candidate3-blocked.zip.sha256"),
  path.join(deliveryRoot, "pms-console-api-contract-v1-candidate3-blocked.patch"),
];
for (const target of [...obsoleteBlocked, zipPath, checksumPath, patchPath]) {
  fs.rmSync(target, { force: true });
}

const trackedChanges = git(["diff", "--name-only", "HEAD"]).split(/\r?\n/).filter(Boolean);
const untracked = git(["ls-files", "--others", "--exclude-standard"])
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => !file.startsWith(`${deliveryRoot}/`));
const expectedDelivery = [zipPath, checksumPath, patchPath];
const finalChangedPaths = [
  ...new Set([...trackedChanges, ...untracked, ...expectedDelivery]),
].sort();
fs.writeFileSync(changedPathsFile, `${finalChangedPaths.join("\n")}\n`);

const zipFiles = [
  ...walk("contracts/pms-console-api"),
  ...walk("packages/pms-console-api-contract"),
  ...walk("packages/pms-console-api-testkit"),
  ...walk("scripts/pms-console-contract"),
  ...walk("docs/adr").filter((file) => /pms-console/i.test(path.basename(file))),
  ...walk("docs/review").filter((file) => path.basename(file).startsWith("PMS_CONSOLE_API_")),
  ...walk(reportRoot).filter((file) => !file.startsWith(`${deliveryRoot}/`)),
  "DELIVERY_REPORT.md",
  "FREEZE_READINESS.md",
  "FREEZE_VALIDATION_REPORT.md",
  "FREEZE_BLOCKERS.md",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
]
  .filter((file) => fs.existsSync(file))
  .sort();

fs.writeFileSync(path.join(reportRoot, "DELIVERY_FILE_INVENTORY.txt"), `${zipFiles.join("\n")}\n`);

const zip = spawnSync("zip", ["-X", "-q", zipPath, ...zipFiles], { stdio: "inherit" });
if (zip.status !== 0) process.exit(zip.status ?? 1);

let patch = git(["diff", "--binary", "HEAD"]);
for (const file of untracked) {
  const result = spawnSync("git", ["diff", "--binary", "--no-index", "--", "/dev/null", file], {
    encoding: "utf8",
  });
  if (![0, 1].includes(result.status ?? 1)) throw new Error(result.stderr);
  patch += result.stdout;
}
fs.writeFileSync(patchPath, patch);

const checksum = crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
fs.writeFileSync(checksumPath, `${checksum}  ${path.basename(zipPath)}\n`);
console.log(JSON.stringify({ zipPath, checksum, patchPath, fileCount: zipFiles.length }, null, 2));

/* global process */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const action = process.argv[2] ?? "manifest";
const project = resolve(".");
const npcTankDelivery = process.env.NPC_TANK_DELIVERY === "1";
const output = resolve(
  process.env.NPC_TANK_DELIVERY_OUTPUT_DIR ?? process.env.UGV_DELIVERY_OUTPUT_DIR ?? "..",
);
const deliveryName = npcTankDelivery
  ? "sdar-mcp-tasks-provider-runtime-ugv-npc-provider-v1"
  : "sdar-mcp-tasks-provider-runtime-ugv-provider-v1";
const zipBasename = `${deliveryName}-work-delivery.zip`;
const zipPath = join(output, zipBasename);
const manifestPath = resolve("WORK_DELIVERY_MANIFEST.json");
const reportSummary = JSON.parse(
  await readFile(
    resolve(
      npcTankDelivery
        ? "reports/npc-tank-provider-v1/final-delivery-summary.json"
        : "reports/ugv-provider-v1/final-delivery-summary.json",
    ),
    "utf8",
  ),
);
const envelopeFiles = new Set(["WORK_DELIVERY_MANIFEST.json", "SHA256SUMS.txt"]);
const excludedPatterns = [
  ".git/",
  ".github/worktrees/",
  "node_modules/",
  "dist/",
  "coverage/",
  ".pnpm-store/",
  ".cache/",
  "tmp/",
  "*.log",
  ".env",
  ".env.* except .env.example",
  "private keys and runtime databases",
];

await mkdir(output, { recursive: true });
await writeManifest();
if (action === "manifest") process.stdout.write(`${manifestPath}\n`);
else if (action === "package") await packageDelivery();
else throw new Error(`UNKNOWN_UGV_DELIVERY_ACTION ${action}`);

async function writeManifest() {
  const existing = await readOptionalJson(manifestPath);
  const files = (await walk(project)).filter(
    (path) => !envelopeFiles.has(relative(project, path).replaceAll("\\", "/")),
  );
  const entries = await Promise.all(
    files.map(async (path) => {
      const bytes = await readFile(path);
      return {
        path: relative(project, path).replaceAll("\\", "/"),
        sizeBytes: bytes.length,
        sha256: sha(bytes),
      };
    }),
  );
  const canonical = entries.map((entry) => `${entry.sha256}  ${entry.path}\n`).join("");
  const manifest = {
    schemaVersion: "1.0",
    projectName: "sdar-mcp-tasks-provider-runtime",
    deliveryName,
    sourceProvenanceHint: reportSummary.sourceProvenanceHint,
    sourceInterfaceSha256: npcTankDelivery
      ? "a7b9e05744e17c413e2f6f8c74c4337b20d3c5a24f2bc7004c9deb47ce22e0dd"
      : "a67b7909ec7af7b3757e77cbaf5bae1c600fe348daa7faf239d8715d89fa375c",
    ...(npcTankDelivery
      ? {
          bundledInterfaceSha256: {
            npcTank: "a7b9e05744e17c413e2f6f8c74c4337b20d3c5a24f2bc7004c9deb47ce22e0dd",
            ugv: "b1700a78e18fc2d510a461abcc454b4aa81dbe7bbdc8b891d9e09726e11187f6",
            isrSimulation: "a67b7909ec7af7b3757e77cbaf5bae1c600fe348daa7faf239d8715d89fa375c",
          },
        }
      : {}),
    generatedAt:
      existing?.generatedAt ?? process.env.UGV_DELIVERY_GENERATED_AT ?? new Date().toISOString(),
    workMode: true,
    gitOperationsPerformed: false,
    tests: reportSummary.tests,
    claims: reportSummary.claims,
    blockers: reportSummary.blockers,
    includedFileCount: entries.length + 2,
    includedBytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    excludedPatterns: excludedPatterns,
    projectTreeSha256: sha(canonical),
    projectTreeHashScope:
      "all delivery files except the two self-referential envelope files WORK_DELIVERY_MANIFEST.json and SHA256SUMS.txt",
    zipSha256: "external-sidecar",
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    resolve("SHA256SUMS.txt"),
    `${manifest.projectTreeSha256}  PROJECT_TREE_CANONICAL_MANIFEST\n`,
  );
}

async function packageDelivery() {
  const staging = await mkdtemp(
    join(tmpdir(), npcTankDelivery ? "ugv-npc-delivery-stage-" : "ugv-delivery-stage-"),
  );
  const verification = await mkdtemp(
    join(tmpdir(), npcTankDelivery ? "ugv-npc-delivery-verify-" : "ugv-delivery-verify-"),
  );
  try {
    const root = join(staging, deliveryName);
    await mkdir(root, { recursive: true });
    for (const source of await walk(project)) {
      const rel = relative(project, source);
      const destination = join(root, rel);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(source, destination);
      await utimes(
        destination,
        new Date("2020-01-01T00:00:00.000Z"),
        new Date("2020-01-01T00:00:00.000Z"),
      );
    }
    const names = (await walk(staging, false))
      .map((path) => relative(staging, path).replaceAll("\\", "/"))
      .sort();
    await rm(zipPath, { force: true });
    const zipped = spawnSync("zip", ["-X", "-q", zipPath, "-@"], {
      cwd: staging,
      input: `${names.join("\n")}\n`,
      encoding: "utf8",
    });
    if (zipped.status !== 0)
      throw new Error(
        `DELIVERY_PACKAGE_FAILED status=${String(zipped.status)} stdout=${zipped.stdout} stderr=${zipped.stderr}`,
      );
    const zipHash = sha(await readFile(zipPath));
    await writeFile(`${zipPath}.sha256`, `${zipHash}  ${zipPath.split("/").at(-1)}\n`);
    const sidecar = {
      ...JSON.parse(await readFile(manifestPath, "utf8")),
      zipSha256: zipHash,
      zipSha256Scope: "authoritative external delivery envelope",
    };
    await writeFile(
      join(
        output,
        npcTankDelivery
          ? "ugv-npc-provider-v1-work-delivery-manifest.json"
          : "ugv-provider-v1-work-delivery-manifest.json",
      ),
      `${JSON.stringify(sidecar, null, 2)}\n`,
    );
    await copyFile(
      resolve("WORK_COMPLETION_REPORT.md"),
      join(
        output,
        npcTankDelivery
          ? "npc-tank-provider-v1-work-completion-report.md"
          : "ugv-provider-v1-work-completion-report.md",
      ),
    );
    const extracted = spawnSync("unzip", ["-q", zipPath, "-d", verification], { encoding: "utf8" });
    if (extracted.status !== 0)
      throw new Error(`DELIVERY_VERIFY_EXTRACT_FAILED ${extracted.stderr}`);
    const verifiedRoot = join(verification, deliveryName);
    const topLevel = await readdir(verification);
    if (topLevel.length !== 1 || topLevel[0] !== deliveryName)
      throw new Error(`DELIVERY_ROOT_INVALID ${topLevel.join(",")}`);
    for (const required of [
      "apps",
      "packages",
      "migrations",
      "proto",
      "protocol",
      "scripts",
      "tests",
      "docs",
      "reports",
      "deploy",
      "package.json",
      "pnpm-lock.yaml",
      "compose.yaml",
      "WORK_COMPLETION_REPORT.md",
      "WORK_DELIVERY_MANIFEST.json",
      "SHA256SUMS.txt",
    ])
      await stat(join(verifiedRoot, required));
    const unsafe = (await walk(verifiedRoot, false)).filter((path) =>
      unsafePath(relative(verifiedRoot, path).replaceAll("\\", "/")),
    );
    if (unsafe.length > 0) throw new Error(`DELIVERY_SENSITIVE_FILE_FOUND ${unsafe.join(",")}`);
    JSON.parse(await readFile(join(verifiedRoot, "package.json"), "utf8"));
    const verifiedManifest = JSON.parse(
      await readFile(join(verifiedRoot, "WORK_DELIVERY_MANIFEST.json"), "utf8"),
    );
    const verifiedFiles = await walk(verifiedRoot, false);
    if (verifiedFiles.length !== verifiedManifest.includedFileCount)
      throw new Error(
        `DELIVERY_FILE_COUNT_MISMATCH ${String(verifiedFiles.length)} ${String(verifiedManifest.includedFileCount)}`,
      );
    const verifiedEntries = await Promise.all(
      verifiedFiles
        .filter((path) => !envelopeFiles.has(relative(verifiedRoot, path).replaceAll("\\", "/")))
        .map(async (path) => ({
          path: relative(verifiedRoot, path).replaceAll("\\", "/"),
          sha256: sha(await readFile(path)),
        })),
    );
    const verifiedCanonical = verifiedEntries
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((entry) => `${entry.sha256}  ${entry.path}\n`)
      .join("");
    if (sha(verifiedCanonical) !== verifiedManifest.projectTreeSha256)
      throw new Error("DELIVERY_PROJECT_TREE_HASH_MISMATCH");
    if (sha(await readFile(zipPath)) !== zipHash) throw new Error("DELIVERY_ZIP_HASH_MISMATCH");
    process.stdout.write(
      `${JSON.stringify({ zipPath, zipSha256: zipHash, fileCount: names.length })}\n`,
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(verification, { recursive: true, force: true });
  }
}

async function walk(directory, applyExclusions = true) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const rel = relative(project, path).replaceAll("\\", "/");
    if (applyExclusions && unsafePath(rel)) continue;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) result.push(...(await walk(path, applyExclusions)));
    else if (entry.isFile()) result.push(path);
  }
  return result.sort((left, right) => left.localeCompare(right));
}
function unsafePath(path) {
  const parts = path.split("/");
  const name = parts.at(-1) ?? "";
  return (
    parts.some((part) =>
      [".git", "node_modules", "dist", "coverage", ".pnpm-store", ".cache", "tmp"].includes(part),
    ) ||
    path.startsWith(".github/worktrees/") ||
    name.endsWith(".log") ||
    (name.startsWith(".env") && name !== ".env.example") ||
    /(?:^|\/)(?:id_rsa|id_ed25519|.*\.key|.*\.pem|.*\.p12|.*\.pfx|.*\.sqlite|.*\.db)$/i.test(path)
  );
}
async function readOptionalJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}
function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

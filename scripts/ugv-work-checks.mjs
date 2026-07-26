/* global process */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(".");
const command = process.argv[2] ?? "reports-check";
const lockDir = resolve(process.env.UGV_WORK_LOCK_DIR ?? "reports/ugv-provider-v1/work-locks");
const excluded = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".pnpm-store",
  ".cache",
  "tmp",
]);

if (command === "baseline") {
  await mkdir(lockDir, { recursive: true });
  const manifest = await manifestFor(root);
  await writeFile(
    join(lockDir, "baseline-file-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(
    join(lockDir, "protected-file-hashes.json"),
    `${JSON.stringify(
      manifest.filter((entry) => protectedPath(entry.relativePath)),
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`${JSON.stringify({ status: "PASS", files: manifest.length })}\n`);
} else if (command === "protected-check") {
  const lock = JSON.parse(await readFile(join(lockDir, "protected-file-hashes.json"), "utf8"));
  const mismatches = [];
  for (const entry of lock) {
    const path = resolve(root, entry.relativePath);
    try {
      const content = await readFile(path);
      const hash = sha(content);
      if (hash !== entry.sha256)
        mismatches.push({ path: entry.relativePath, expected: entry.sha256, actual: hash });
    } catch {
      mismatches.push({ path: entry.relativePath, expected: entry.sha256, actual: "missing" });
    }
  }
  if (mismatches.length > 0)
    throw new Error(`PROTECTED_FILE_CHANGED ${JSON.stringify(mismatches)}`);
  process.stdout.write(`${JSON.stringify({ status: "PASS", protectedFiles: lock.length })}\n`);
} else if (command === "generated-self-check") {
  const before = await directoryHashes(resolve("packages/adapter-protocol/generated"));
  const generated = spawnSync(process.execPath, [resolve("scripts/generate-proto.mjs")], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  if (generated.status !== 0)
    throw new Error(`DETACHED_PROTO_GENERATION_FAILED ${generated.stderr || generated.stdout}`);
  const after = await directoryHashes(resolve("packages/adapter-protocol/generated"));
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error("DETACHED_GENERATED_OUTPUT_CHANGED");
  process.stdout.write(`${JSON.stringify({ status: "PASS", generatedFiles: before.length })}\n`);
} else if (command === "reports-check") {
  const reportRoot = resolve("reports/ugv-provider-v1");
  const required = [
    "baseline.json",
    "source-document-lock.json",
    "protocol-input-lock.json",
    "architecture.json",
    "manifest.json",
    "device-mcp-contract.json",
    "mqtt-contract.json",
    "component.json",
    "business-events.json",
    "recovery.json",
    "security.json",
    "telemetry.json",
    "compose-e2e.json",
    "external-interface-blocker.json",
    "final-delivery-summary.json",
    "final-delivery-report.md",
  ];
  const missing = [];
  for (const name of required)
    try {
      await stat(join(reportRoot, name));
    } catch {
      missing.push(name);
    }
  if (missing.length > 0) throw new Error(`UGV_REPORTS_MISSING ${missing.join(",")}`);
  const summary = JSON.parse(
    await readFile(join(reportRoot, "final-delivery-summary.json"), "utf8"),
  );
  if (!Array.isArray(summary.tests) || summary.tests.length === 0)
    throw new Error("UGV_REPORT_TEST_EVIDENCE_MISSING");
  process.stdout.write(`${JSON.stringify({ status: "PASS", reports: required.length })}\n`);
} else throw new Error(`UNKNOWN_UGV_WORK_COMMAND ${command}`);

async function manifestFor(directory) {
  const files = await walk(directory);
  const result = [];
  for (const path of files) {
    const content = await readFile(path);
    const info = await stat(path);
    const relativePath = relative(directory, path).replaceAll("\\", "/");
    result.push({
      relativePath,
      sizeBytes: info.size,
      sha256: sha(content),
      category: category(relativePath),
    });
  }
  return result;
}
async function directoryHashes(directory) {
  const files = await walk(directory);
  return Promise.all(
    files.map(async (path) => ({
      path: relative(directory, path).replaceAll("\\", "/"),
      sha256: sha(await readFile(path)),
    })),
  );
}
async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(path)));
    else if (entry.isFile() && !entry.name.endsWith(".log") && entry.name !== ".env")
      result.push(path);
  }
  return result.sort((left, right) => left.localeCompare(right));
}
function protectedPath(path) {
  return (
    path.startsWith("protocol/frozen/") ||
    path.startsWith("protocol/upstream/") ||
    [
      "protocol/sdar-business-events-v1.schema.json",
      "protocol/sdar-business-events-continuity-v1.schema.json",
      "protocol/sdar-business-events-relation-v1.schema.json",
      "proto/io/sdar/mcp/tasks/adapter/v1/adapter.proto",
      "proto/io/sdar/mcp/tasks/telemetry/v1/provider_telemetry.proto",
      "packages/observability/src/event-envelope.ts",
      "docs/requirements/SDAR_v1.2.2_Business_Events_Provider_Runtime_Requirements_V0.5.2.md",
    ].includes(path)
  );
}
function category(path) {
  if (path.startsWith("tests/")) return "test";
  if (path.startsWith("protocol/") || path.startsWith("proto/")) return "protocol";
  if (path.includes("/generated/")) return "generated";
  if (path.startsWith("reports/")) return "report";
  if (/^(package\.json|pnpm-lock\.yaml|compose\.yaml|tsconfig.*\.json|\.env\.example)$/.test(path))
    return "configuration";
  if (/\.(ts|js|mjs|sql|proto)$/.test(path)) return "source";
  return "other";
}
function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

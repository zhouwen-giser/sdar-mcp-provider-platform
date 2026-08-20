import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const baseline = "a241985f652894a70d41340d88029c2be8dd8290";
const reportRoot = join(root, "reports/ugv-provider-template-stabilization");
const deliveryRoot = join(reportRoot, "delivery");
const archiveName = "ugv-provider-template-stabilization-delivery.zip";
const patchName = "ugv-provider-template-stabilization.patch";
const archivePath = join(deliveryRoot, archiveName);
const patchPath = join(deliveryRoot, patchName);
const stage = await mkdtemp(join(tmpdir(), "ugv-provider-template-delivery-"));
const bundleName = "ugv-provider-template-stabilization-delivery";
const bundleRoot = join(stage, bundleName);

const requiredReports = [
  "BASELINE.json",
  "BASELINE_DRIFT.json",
  "ARCHITECTURE_INVENTORY.json",
  "ISSUE_MATRIX.json",
  "OPERATION_PROFILE_MATRIX.json",
  "OPERATION_QUALIFICATION.json",
  "RESULT_POLICY_MATRIX.json",
  "MUTATION_JOURNAL_TESTS.json",
  "TASK_DEADLINE_TESTS.json",
  "RECOVERY_TESTS.json",
  "OBSERVATION_AUTHORITY_TESTS.json",
  "POSITION_AUTHORITY_TESTS.json",
  "STATIONARY_CONFIRMATION_TESTS.json",
  "CONTROL_CONFIRMATION_TESTS.json",
  "EMERGENCY_STOP_TESTS.json",
  "PREEMPTION_OCCUPANCY_TESTS.json",
  "DTO_SCHEMA_CONFORMANCE.json",
  "MANIFEST_CAPABILITY_CONSISTENCY.json",
  "OPERATION_HEALTH_TESTS.json",
  "STARTUP_READINESS_TESTS.json",
  "PMS_RUNTIME_DB_PM2_NON_IMPACT.json",
  "DEVELOPMENT_COMPOSE_EVIDENCE.json",
  "LIVE_POINT_NAVIGATION_EVIDENCE.json",
  "REGRESSION.json",
  "COMMIT_LIST.json",
  "KNOWN_LIMITATIONS.md",
  "FINAL_REPORT.md",
];

try {
  await validateReports();
  assertGitObject(baseline);
  const changedFiles = gitText([
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACMR",
    baseline,
    "--",
    ".",
    ":(exclude)reports/ugv-provider-template-stabilization/delivery",
    ":(exclude)reports/ugv-simulation/READ_ONLY_SMOKE.json",
  ])
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
  if (changedFiles.length === 0) throw new Error("UGV_TEMPLATE_DELIVERY_EMPTY");
  for (const path of changedFiles) assertSafePath(path);

  const patchBytes = gitBytes([
    "diff",
    "--cached",
    "--binary",
    "--full-index",
    baseline,
    "--",
    ".",
    ":(exclude)reports/ugv-provider-template-stabilization/delivery",
    ":(exclude)reports/ugv-simulation/READ_ONLY_SMOKE.json",
  ]);
  if (patchBytes.length === 0) throw new Error("UGV_TEMPLATE_PATCH_EMPTY");

  const entries = [];
  for (const path of changedFiles) {
    const bytes = gitBytes(["show", `:${path}`]);
    const destination = join(bundleRoot, "workspace", path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    entries.push({ path: `workspace/${path}`, sizeBytes: bytes.length, sha256: sha256(bytes) });
  }

  const bundledPatch = join(bundleRoot, "delivery", patchName);
  await mkdir(dirname(bundledPatch), { recursive: true });
  await writeFile(bundledPatch, patchBytes);
  entries.push({
    path: `delivery/${patchName}`,
    sizeBytes: patchBytes.length,
    sha256: sha256(patchBytes),
  });

  const manifest = {
    schemaVersion: "1.0",
    product: "UGV Provider Template Stabilization",
    classification: "UGV_PROVIDER_TEMPLATE_READY_LIVE_VALIDATION_PENDING",
    sourceBranch: "codex/ugv-provider-pre-simulator-hardening",
    sourceRevision: baseline,
    targetBranch: gitText(["branch", "--show-current"]).trim(),
    headBeforeFinalization: gitText(["rev-parse", "HEAD"]).trim(),
    stagedTree: gitText(["write-tree"]).trim(),
    liveValidation: "NOT_AUTHORIZED",
    mutatingCallCount: 0,
    remotePushPerformed: false,
    files: entries,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(bundleRoot, "DELIVERY_MANIFEST.json"), manifestBytes);

  await mkdir(deliveryRoot, { recursive: true });
  await rm(archivePath, { force: true });
  await rm(patchPath, { force: true });
  await rm(`${archivePath}.sha256`, { force: true });
  await writeFile(patchPath, patchBytes);
  const zipped = spawnSync("zip", ["-X", "-q", "-r", archivePath, bundleName], {
    cwd: stage,
    encoding: "utf8",
  });
  if (zipped.status !== 0)
    throw new Error(`UGV_TEMPLATE_ZIP_FAILED ${zipped.stderr || zipped.stdout}`);
  const archiveBytes = await readFile(archivePath);
  if ((await stat(archivePath)).size === 0) throw new Error("UGV_TEMPLATE_ZIP_EMPTY");
  const archiveSha256 = sha256(archiveBytes);
  await writeFile(`${archivePath}.sha256`, `${archiveSha256}  ${archiveName}\n`);

  const listing = execFileSync("unzip", ["-Z1", archivePath], { encoding: "utf8" });
  for (const path of listing.trim().split("\n").filter(Boolean)) assertSafePath(path);
  process.stdout.write(
    `${JSON.stringify({ archivePath, archiveSha256, patchPath, files: entries.length })}\n`,
  );
} finally {
  await rm(stage, { recursive: true, force: true });
}

async function validateReports() {
  for (const name of requiredReports) {
    const bytes = await readFile(join(reportRoot, name));
    if (bytes.length === 0) throw new Error(`UGV_TEMPLATE_REPORT_EMPTY ${name}`);
    if (name.endsWith(".json")) JSON.parse(bytes.toString("utf8"));
  }
}

function assertGitObject(revision) {
  execFileSync("git", ["cat-file", "-e", `${revision}^{commit}`], { cwd: root, stdio: "pipe" });
}

function assertSafePath(path) {
  const segments = path.split("/");
  if (
    path.startsWith("/") ||
    segments.includes("..") ||
    segments.includes(".git") ||
    segments.includes("node_modules") ||
    segments.includes("dist") ||
    segments.includes("coverage") ||
    segments.includes(".env") ||
    /(?:^|\/)(?:tokens?|passwords?|private[-_]?keys?)(?:\/|$)/i.test(path)
  ) {
    throw new Error(`UGV_TEMPLATE_DELIVERY_FORBIDDEN_PATH ${path}`);
  }
}

function gitText(argumentsValue) {
  return execFileSync("git", argumentsValue, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function gitBytes(argumentsValue) {
  return execFileSync("git", argumentsValue, {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const reportRoot = join(repositoryRoot, "reports/ugv-provider-pre-simulator");
const deliveryRoot = join(reportRoot, "delivery");
const zipPath = join(deliveryRoot, "ugv-provider-pre-simulator-delivery.zip");
const patchPath = join(deliveryRoot, "ugv-provider-pre-simulator.patch");
const stage = await mkdtemp(join(tmpdir(), "ugv-pre-simulator-delivery-"));
const indexDirectory = await mkdtemp(join(tmpdir(), "ugv-pre-simulator-index-"));
const temporaryIndex = join(indexDirectory, "index");
const gitEnvironment = { ...process.env, GIT_INDEX_FILE: temporaryIndex };
const requiredReports = [
  "AVAILABILITY_FAILURE_BUDGET.json",
  "BASELINE.json",
  "BASELINE_DRIFT.json",
  "BASELINE_DRIFT.md",
  "COMPATIBILITY_PROFILE.json",
  "COMPLETION_AUDIT.json",
  "CONFIGURATION_EVIDENCE.json",
  "CONTROL_CONFIRMATION_TESTS.json",
  "EMERGENCY_STOP_TESTS.json",
  "FINAL_REPORT.md",
  "IDENTITY_EVIDENCE.json",
  "KNOWN_LIMITATIONS.md",
  "NAVIGATION_EVIDENCE_TESTS.json",
  "OPERATION_QUALIFICATION_MATRIX.json",
  "PRD_GAP_MATRIX.json",
  "PRD_GAP_MATRIX.md",
  "PREFLIGHT_LOCAL.json",
  "RECON_EVIDENCE_TESTS.json",
  "RECOVERY_TESTS.json",
  "REGRESSION.json",
  "RETRY_TOOL_HEALTH.json",
  "SIMULATOR_DEPENDENCY_MATRIX.json",
  "SIMULATOR_DEPENDENCY_MATRIX.md",
];

try {
  await mkdir(deliveryRoot, { recursive: true });
  for (const reportName of requiredReports) {
    const reportPath = join(reportRoot, reportName);
    const reportBytes = await readFile(reportPath);
    if (reportBytes.length === 0) throw new Error(`UGV_PRE_SIMULATOR_REPORT_EMPTY ${reportName}`);
    if (reportName.endsWith(".json")) JSON.parse(reportBytes.toString("utf8"));
  }
  git(["read-tree", "HEAD"]);
  git(["add", "-A", "--", ".", ":(exclude)reports/ugv-provider-pre-simulator/delivery"]);
  const changedFiles = gitText(["diff", "--cached", "--name-only", "--diff-filter=ACMR"])
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
  if (changedFiles.length === 0) throw new Error("UGV_PRE_SIMULATOR_DELIVERY_EMPTY");
  const patchBytes = execFileSync("git", ["diff", "--cached", "--binary", "--full-index"], {
    cwd: repositoryRoot,
    env: gitEnvironment,
    maxBuffer: 64 * 1024 * 1024,
  });
  await writeFile(patchPath, patchBytes);

  const bundleDirectory = join(stage, "ugv-provider-pre-simulator-delivery");
  const entries = [];
  for (const relativePath of changedFiles) {
    const source = join(repositoryRoot, relativePath);
    const destination = join(bundleDirectory, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    const bytes = await readFile(source);
    entries.push({ path: relativePath, sizeBytes: bytes.length, sha256: sha256(bytes) });
  }
  const bundledPatch = join(bundleDirectory, "delivery/ugv-provider-pre-simulator.patch");
  await mkdir(dirname(bundledPatch), { recursive: true });
  await copyFile(patchPath, bundledPatch);
  entries.push({
    path: "delivery/ugv-provider-pre-simulator.patch",
    sizeBytes: patchBytes.length,
    sha256: sha256(patchBytes),
  });
  const manifest = {
    schemaVersion: "1.0",
    product: "UGV Provider pre-simulator hardening",
    finalStatus: "UGV_PROVIDER_PRE_SIM_READY",
    sourceRevision: gitText(["rev-parse", "HEAD"]).trim(),
    branch: gitText(["branch", "--show-current"]).trim(),
    qualification: {
      simulatorAvailable: false,
      deviceMcp: "PENDING_SIMULATOR_CONTRACT",
      mqtt: "PENDING_SIMULATOR_OBSERVATION",
      physical: "PENDING_SIMULATOR_PHYSICAL_QUALIFICATION",
    },
    files: entries,
  };
  const manifestPath = join(bundleDirectory, "DELIVERY_MANIFEST.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await rm(zipPath, { force: true });
  const zipped = spawnSync(
    "zip",
    ["-X", "-q", "-r", zipPath, "ugv-provider-pre-simulator-delivery"],
    { cwd: stage, encoding: "utf8" },
  );
  if (zipped.status !== 0)
    throw new Error(`UGV_PRE_SIMULATOR_ZIP_FAILED ${zipped.stderr || zipped.stdout}`);
  const zipBytes = await readFile(zipPath);
  const zipHash = sha256(zipBytes);
  await writeFile(`${zipPath}.sha256`, `${zipHash}  ${zipPath.split("/").at(-1)}\n`);
  if ((await stat(zipPath)).size === 0) throw new Error("UGV_PRE_SIMULATOR_ZIP_EMPTY");
  process.stdout.write(
    `${JSON.stringify({ zipPath, zipSha256: zipHash, patchPath, files: entries.length })}\n`,
  );
} finally {
  await rm(stage, { recursive: true, force: true });
  await rm(indexDirectory, { recursive: true, force: true });
}

function git(argumentsValue) {
  execFileSync("git", argumentsValue, {
    cwd: repositoryRoot,
    env: gitEnvironment,
    stdio: "pipe",
  });
}

function gitText(argumentsValue) {
  return execFileSync("git", argumentsValue, {
    cwd: repositoryRoot,
    env: gitEnvironment,
    encoding: "utf8",
  });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

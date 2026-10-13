import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  cpSync,
  readdirSync,
  lstatSync,
  openSync,
  closeSync,
  unlinkSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(root);
const sourceCommit = process.argv[2];
assert.match(sourceCommit ?? "", /^[0-9a-f]{40}$/, "Exact frozen source commit required");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const excluded = (file) => /^(reports|artifacts|node_modules|dist|\.codex)\//.test(file);
const files = git("ls-tree", "-rz", "--name-only", sourceCommit)
  .toString()
  .split("\0")
  .filter((file) => file && !excluded(file))
  .sort();
const sourceInputs = files.map((file) => ({
  file,
  sha256: digest(git("show", sourceCommit + ":" + file)),
}));
const currentFiles = [
  ...new Set(
    git("ls-files", "-z", "--cached", "--others", "--exclude-standard")
      .toString()
      .split("\0")
      .filter((file) => file && !excluded(file)),
  ),
].sort();
assert.deepEqual(currentFiles, files, "Uncommitted source inputs found");
for (const input of sourceInputs)
  assert.equal(digest(readFileSync(input.file)), input.sha256, "Source drift: " + input.file);
const sourceInputsSha256 = digest(JSON.stringify(sourceInputs));
const reportRoot = "reports/trajectory-time-history-v1";
const runs = [];
for (const file of readdirSync(reportRoot + "/raw")
  .filter((file) => file.endsWith(".json"))
  .sort()) {
  const receiptPath = reportRoot + "/raw/" + file;
  const receipt = json(receiptPath);
  assert.equal(receipt.rawLog, reportRoot + "/raw/" + file.replace(/\.json$/, ".log"));
  assert.equal(digest(readFileSync(receipt.rawLog)), receipt.rawLogSha256, receipt.rawLog);
  runs.push({
    run: file.slice(0, -5),
    command: receipt.command,
    startedAt: receipt.startedAt,
    completedAt: receipt.completedAt,
    exitCode: receipt.exitCode,
    sourceCommit: receipt.sourceCommit,
    sourceInputsSha256: receipt.sourceInputsSha256,
    sourceChangedDuringRun: receipt.sourceChangedDuringRun ?? null,
    matchesFrozenSource:
      receipt.sourceCommit === sourceCommit &&
      receipt.sourceInputsSha256 === sourceInputsSha256 &&
      receipt.sourceChangedDuringRun === false,
    receipt: receiptPath,
    receiptSha256: digest(readFileSync(receiptPath)),
    rawLog: receipt.rawLog,
    rawLogSha256: receipt.rawLogSha256,
  });
}
const requiredRuns = [
  "m3-verify-v2-",
  "m3-history-path-",
  "m3-ugv-task-business-",
  "m3-public-intake-",
].map((prefix) => {
  const passed = runs
    .filter((run) => run.run.startsWith(prefix) && run.exitCode === 0 && run.matchesFrozenSource)
    .sort((a, b) => (a.completedAt < b.completedAt ? -1 : a.completedAt > b.completedAt ? 1 : 0))
    .at(-1);
  assert.ok(passed, "Missing passed same-source final gate: " + prefix);
  return passed.run;
});
for (const name of requiredRuns) {
  const run = runs.find((item) => item.run === name);
  assert.ok(run, "Missing final gate: " + name);
  assert.equal(run.exitCode, 0, "Failed final gate: " + name);
  assert.equal(run.matchesFrozenSource, true, "Gate did not test frozen source: " + name);
}
const baseline = json(reportRoot + "/BASELINE_FROZEN_ASSETS.json");
for (const item of baseline.baselineFrozenAssets) {
  assert.equal(digest(git("show", baseline.baselineCommit + ":" + item.path)), item.sha256);
  assert.equal(digest(readFileSync(item.path)), item.sha256, item.path);
}
const [completeGate, history, taskBusinessGate, intakeGate] = requiredRuns;
const test = (name) => "tests/" + name + ".test.ts";
const claims = [
  {
    id: "actual-provider-reception-time",
    status: "PASS",
    evidence: [history],
    tests: [
      test("unit/trajectory-history-capture"),
      test("integration/trajectory-history-public-mqtt"),
    ],
    guarantee:
      "Actual MQTT entrance UTC millisecond clock before decode/filter; synchronization unverified, absolute accuracy unknown; not device acquisition time.",
  },
  {
    id: "reception-recording-commit-clock-distinction",
    status: "PASS",
    evidence: [history],
    tests: [
      test("integration/trajectory-history-postgres"),
      test("unit/trajectory-history-authority"),
    ],
    guarantee:
      "PostgreSQL recording clock separate; exact transaction commit and unattested device acquisition clocks null; legacy points remain unknown.",
  },
  {
    id: "signed-finite-retained-range",
    status: "PASS",
    evidence: [history],
    tests: [
      test("unit/trajectory-history-proof"),
      test("integration/trajectory-history-reader-postgres"),
    ],
    guarantee:
      "Externally pinned Ed25519 key, scope/count/ordinal/hash anchors and full end-of-range verification; gaps and pruning invalidate completeness.",
  },
  {
    id: "bounded-caller-bound-stable-pagination",
    status: "PASS",
    evidence: [history],
    tests: [
      test("integration/trajectory-history-reader-postgres"),
      test("integration/trajectory-history-public-mqtt"),
    ],
    guarantee:
      "Persisted finite watermark; appends do not change snapshot; caller/query/scope/cursor substitution rejected; 300 entries verify numeric order and output budgets.",
  },
  {
    id: "atomic-artifact-reception-sidecars",
    status: "PASS",
    evidence: [history],
    tests: [
      test("integration/trajectory-history-public-mqtt"),
      test("unit/trajectory-history-authority"),
      test("contract/ugv-navigation-trajectory"),
    ],
    guarantee:
      "Exact Artifact revision/coordinate/identity and real scoped receipt linked in original TaskBusiness transaction; fabricated receipt fails; existing sampled geometry remains.",
  },
  {
    id: "crash-and-transport-recovery",
    status: "PASS",
    evidence: [history],
    tests: [
      test("integration/trajectory-history-crash-mqtt"),
      test("integration/trajectory-history-postgres"),
    ],
    guarantee:
      "Actual local writer SIGKILL and task-owned broker stop/start; persistent-key public MCP snapshot continuation; unclean/outage/queue failure diagnostics retained.",
  },
  {
    id: "forward-owner-installation-and-isolation",
    status: "PASS",
    evidence: [history, taskBusinessGate],
    tests: [
      test("integration/trajectory-history-gowm-postgres"),
      test("integration/trajectory-history-full-gowm"),
      test("integration/trajectory-history-postgres"),
    ],
    guarantee:
      "Native forward retry preserves bytes; hosted transactional installer rollback/checksum/grant repair, RLS and non-bypass app role; runtime verify-only.",
  },
  {
    id: "public-consumer-intake-and-frozen-compatibility",
    status: "PASS",
    evidence: [intakeGate, completeGate],
    guarantee:
      "Independent public SDK/examples, generated schemas and owner bytes, plus " +
      baseline.baselineFrozenAssets.length +
      " byte-identical frozen assets; versioned readonly synchronous extension defaults disabled.",
  },
  {
    id: "all-physical-provider-callbacks-captured",
    status: "UNKNOWN",
    evidence: [history],
    guarantee:
      "Durable ordinal continuity cannot exclude callback loss before commit or an unjournaled crash window.",
  },
  {
    id: "device-generation-history-complete",
    status: "UNKNOWN",
    evidence: [history],
    guarantee:
      "No trusted producer identity/epoch or attested start/end/count boundaries; never promoted to complete.",
  },
  {
    id: "calibrated-device-acquisition-time",
    status: "UNKNOWN",
    guarantee: "Producer time base/clock owner/synchronization/calibration contract absent.",
  },
  {
    id: "real-sdar-interop",
    status: "NOT_RUN",
    guarantee:
      "Repository interop verification reports missing consumer/fixture; no actual SDAR consumer modification or interop acceptance claimed.",
  },
  {
    id: "real-device-site-and-19100-deployment",
    status: "NOT_RUN",
    guarantee:
      "All acceptance uses task-owned local isolated PostgreSQL/MQTT and SIMULATED producer traffic; no site/device qualification or 19100 redeployment.",
  },
];
const acceptance = {
  schemaVersion: "smpp.trajectory-history-acceptance/1.0",
  generatedAt: new Date().toISOString(),
  status: "LOCAL_IMPLEMENTATION_ACCEPTED_WITH_EXPLICIT_UPSTREAM_LIMITS",
  sourceCommit,
  sourceInputsSha256,
  sourceInputs,
  baselineCommit: baseline.baselineCommit,
  frozenAssetsUnchanged: baseline.baselineFrozenAssets.length,
  evidenceClass: "SIMULATED_WITH_REAL_LOCAL_POSTGRESQL_MQTT_AND_PUBLIC_MCP",
  mandatoryFinalGates: requiredRuns,
  claims,
  runs,
  developmentFailuresPreserved: runs.filter((run) => run.exitCode !== 0).map((run) => run.run),
  changedDuringRunExcluded: runs
    .filter((run) => run.sourceChangedDuringRun === true)
    .map((run) => run.run),
  acceptanceBoundaries: {
    retainedHistory:
      "Finite committed retained range only; full signature, count and hash-chain verification required.",
    providerCaptureCoverage: "UNKNOWN",
    deviceGenerationHistory: "UNKNOWN",
    realDeviceQualification: "NOT_RUN",
    siteOperations: "NOT_RUN",
    deployment19100: "NOT_RUN",
    remotePublication: "NOT_RUN",
    completeGateDevelopmentHistory:
      "Earlier milestone attempts failed and are preserved; frozen final gate is required to pass. No retroactive PASS.",
    baselineReproduction:
      "Clean ae345aa source exports reproduced stale migration/roster expectations; dependencies were linked to installed candidate dependencies, not asserted as old-lockfile baseline.",
    dependencyAudit:
      "Configured high/critical gate passed; moderate/low advisories remain. No new advisory ignore added.",
    runtimeConformance:
      "Adapter conformance passed; Runtime profile remains partial and supplies no resource safety certification.",
  },
  producerPrerequisites: [
    "Trusted producer identity and restart epoch",
    "Attested generation start/end boundaries, expected count or continuous sequence range",
    "Defined loss/duplicate/late/replay/disconnect retransmission semantics",
    "Device acquisition clock owner, units, time base and synchronization/calibration quality",
  ],
};
writeFileSync(reportRoot + "/ACCEPTANCE.json", JSON.stringify(acceptance, null, 2) + "\n");
writeFileSync(
  reportRoot + "/ACCEPTANCE.md",
  `# 轨迹接收时间与历史证明验收\n\n源码：\`${sourceCommit}\`。本地隔离验收通过；真实设备、现场操作、SDAR 实际互通和 19100 部署为 NOT_RUN。\n\n最终四项门禁均使用相同源码输入，exit 0，运行期间源码未改变：\n\n${requiredRuns.map((name) => "- " + name).join("\n")}\n\n提供实际 MQTT 接收时间、独立数据库记录时间、只读版本化 MCP、签名有限保留范围、稳定分页及原子坐标侧车。完整保留范围不表示物理回调全捕获，也不表示设备应产生的全部历史完整。后两者保持 unknown。\n\nSDK、schema、例子和迁移说明见 contracts/ugv-trajectory-history/v1/README.md。详细逐项保证、测试路径、所有成功与失败命令、精确源码输入及原始日志 SHA-256 见 ACCEPTANCE.json。开发阶段失败未改写为通过；发生源码改变的旧门禁不作为最终证据。\n\n所有旧冻结资产 ${baseline.baselineFrozenAssets.length} 个字节不变。设备全量证明仍需可信生产者身份/epoch、认证开始结束边界、计数或连续序号与补传语义；设备采集时间还需时基与校准合同。\n`,
);
const artifactRoot = path.join(root, "artifacts/trajectory-history");
const name = "smpp-trajectory-history-" + sourceCommit.slice(0, 12);
const delivery = path.join(artifactRoot, name);
mkdirSync(delivery, { recursive: true });
cpSync(
  "contracts/ugv-trajectory-history/v1",
  path.join(delivery, "contracts/ugv-trajectory-history/v1"),
  { recursive: true },
);
cpSync("deploy/gowm-trajectory-history", path.join(delivery, "deploy/gowm-trajectory-history"), {
  recursive: true,
});
mkdirSync(path.join(delivery, "migrations/providers/ugv"), { recursive: true });
cpSync(
  "migrations/providers/ugv/033_trajectory_reception_history.sql",
  path.join(delivery, "migrations/providers/ugv/033_trajectory_reception_history.sql"),
);
cpSync(reportRoot, path.join(delivery, reportRoot), { recursive: true });
writeFileSync(
  path.join(delivery, "README.md"),
  `# SMPP 轨迹接收时间与历史证明 1.0\n\n源码提交：\`${sourceCommit}\`。只读工具：\`vehicle_get_trajectory_history\`、\`vehicle_get_trajectory_evidence\`。\n\n- SDAR 接入、字段来源、验签、启用和回退：contracts/ugv-trajectory-history/v1/README.md\n- 最终验收与原始命令/日志：reports/trajectory-time-history-v1/ACCEPTANCE.json\n- 完整运行源码（不含历史 reports）：source.tar.gz；Node 22 / pnpm 11.13.1 / frozen lockfile\n- native owner migration：migrations/providers/ugv/033_trajectory_reception_history.sql\n- hosted owner installer：deploy/gowm-trajectory-history/，实际 CLI 也包含在 source.tar.gz\n- 每个包内文件的 SHA-256：SHA256SUMS\n\n示例是公开测试向量，不能作为部署信任公钥。部署方须持久管理 Ed25519 私钥并独立分发公钥。包中没有部署私钥、数据库 URL 或现场配置。\n\n已验证有限已提交保留集合；物理回调捕获覆盖与设备全量历史保持 unknown。真实设备、现场、SDAR 实际互通、远程发布与 19100 部署均 NOT_RUN。\n`,
);
function gzip(file) {
  const fd = openSync(file + ".gz", "w");
  try {
    const result = spawnSync("gzip", ["-n", "-9", "-c", file], { stdio: ["ignore", fd, "pipe"] });
    assert.equal(result.status, 0, "gzip failed: " + String(result.stderr));
  } finally {
    closeSync(fd);
  }
  unlinkSync(file);
}
const sourceTar = path.join(delivery, "source.tar");
git("archive", "--format=tar", "--output=" + sourceTar, sourceCommit, "--", ...files);
gzip(sourceTar);
function inventory(folder, relative = "") {
  return readdirSync(path.join(folder, relative))
    .sort()
    .flatMap((file) => {
      const name = path.join(relative, file),
        target = path.join(folder, name);
      assert.equal(lstatSync(target).isSymbolicLink(), false, "Symlink in delivery: " + name);
      return lstatSync(target).isDirectory()
        ? inventory(folder, name)
        : [{ file: name, sha256: digest(readFileSync(target)) }];
    })
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}
const content = inventory(delivery).filter((item) => item.file !== "SHA256SUMS");
writeFileSync(
  path.join(delivery, "SHA256SUMS"),
  content.map((item) => item.sha256 + "  " + item.file).join("\n") + "\n",
);
const archiveTar = path.join(artifactRoot, name + ".tar");
execFileSync("tar", [
  "--sort=name",
  "--mtime=@0",
  "--owner=0",
  "--group=0",
  "--numeric-owner",
  "--format=gnu",
  "-C",
  artifactRoot,
  "-cf",
  archiveTar,
  name,
]);
gzip(archiveTar);
const archive = archiveTar + ".gz";
const auditRoot = mkdtempSync(path.join(os.tmpdir(), "smpp-trajectory-delivery-audit-"));
try {
  execFileSync("tar", ["-xzf", archive, "-C", auditRoot]);
  const extracted = path.join(auditRoot, name);
  assert.deepEqual(inventory(extracted), inventory(delivery), "Archive changed delivered bytes");
  for (const item of content)
    assert.equal(digest(readFileSync(path.join(extracted, item.file))), item.sha256);
  const extractedSource = path.join(auditRoot, "source");
  mkdirSync(extractedSource);
  execFileSync("tar", ["-xzf", path.join(extracted, "source.tar.gz"), "-C", extractedSource]);
  assert.deepEqual(
    inventory(extractedSource),
    sourceInputs,
    "Frozen source archive differs from recorded source inputs",
  );
} finally {
  rmSync(auditRoot, { recursive: true, force: true });
}
const result = {
  schemaVersion: "smpp.trajectory-history-delivery/1.0",
  status: "PASS",
  sourceCommit,
  sourceInputsSha256,
  archive,
  archiveSha256: digest(readFileSync(archive)),
  deliveredFiles: content.length + 1,
  archiveExtractedBytesVerified: true,
  sourceArchiveMatchesFrozenInputs: true,
  mandatoryGates: requiredRuns,
  realDeviceQualification: "NOT_RUN",
  siteOperations: "NOT_RUN",
  deployment19100: "NOT_RUN",
};
writeFileSync(archive + ".sha256", result.archiveSha256 + "  " + path.basename(archive) + "\n");
writeFileSync(reportRoot + "/DELIVERY.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));

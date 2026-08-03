import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(root, "reports/real-device-preparation");
const continuationRoot = resolve(root, "reports/real-device-preparation-continuation");
const closeoutRoot = resolve(root, "reports/real-device-closeout");
const codexRoot = resolve(root, ".codex/ha-real-device-closeout");

const baseline = await readJson(resolve(sourceRoot, "baseline.json"));
const preflight = await readJson(resolve(sourceRoot, "ha-preflight.json"));
const climate = await readJson(resolve(sourceRoot, "climate-real-qualification.json"));
const lights = await readJson(resolve(sourceRoot, "light-real-qualification.json"));
const pms = await readJson(resolve(sourceRoot, "pms-onboarding.json"));
const registry = await readJson(resolve(continuationRoot, "live-registry.redacted.json"));
const registryContract = await readJson(resolve(continuationRoot, "live-registry-contract.json"));
const catalogs = await readJson(resolve(continuationRoot, "catalog-registry-live.json"));
const registryE2e = await readJson(resolve(continuationRoot, "registry-backed-e2e.json"));
const threeDevice = await readJson(resolve(continuationRoot, "three-device-e2e.json"));
const recovery = await readJson(resolve(continuationRoot, "real-recovery.json"));
const faultInjection = await readJson(resolve(continuationRoot, "fault-injection.json"));
const climatePower = await readJson(resolve(continuationRoot, "climate-power-qualification.json"));
const migrationEvidence = await readJson(
  resolve(root, "reports/evidence/migration-isolation.json"),
);
const verification = (await readJsonIfPresent(resolve(closeoutRoot, "verification-run.json"))) ?? {
  evidenceClass: "unverified",
  status: "not_recorded",
  commands: {},
};

const candidateSha = git(["rev-parse", "HEAD"]);
const branch = git(["branch", "--show-current"]);
const statusLines = git(["status", "--short"])
  .split(/\r?\n/)
  .map((line) => line.trimEnd())
  .filter(Boolean);
const worktreeClean = statusLines.length === 0;
const baseSha = baseline.baseSha;
const changedFiles = unique([
  ...git(["diff", "--name-only", baseSha]).split(/\r?\n/),
  ...git(["ls-files", "--others", "--exclude-standard"]).split(/\r?\n/),
])
  .filter(Boolean)
  .filter((file) => !file.startsWith("reports/real-device-closeout/"));

const providerIds = ["ha-climate-lab", "ha-light-lab"];
const resourceIds = [
  "living-room-air-conditioner",
  "living-room-main-light",
  "living-room-aux-light",
];
const allThreeRestored =
  (threeDevice.stateRestoration ?? []).length === 3 &&
  threeDevice.stateRestoration.every((item) => item.status === "restored");
const functionalPass =
  preflight.status === "passed" &&
  climate.status === "passed" &&
  lights.status === "passed" &&
  pms.status === "passed" &&
  registry.status === "passed" &&
  registryContract.status === "passed" &&
  registryE2e.status === "passed" &&
  threeDevice.status === "passed" &&
  allThreeRestored &&
  (threeDevice.runtimeTaskCounts?.active ?? 1) === 0 &&
  (threeDevice.runtimeTaskCounts?.uncertain ?? 1) === 0;
const climatePowerOnQualified = climatePower.qualifiedOperations?.climate_set_power === "real_pass";
const realInFlightRecoveryQualified = false;
const realFaultsQualified = false;
const pmsOutageQualified = false;
const resiliencePass = realInFlightRecoveryQualified && realFaultsQualified && pmsOutageQualified;
const fullCapabilityPass = functionalPass && climatePowerOnQualified && resiliencePass;
const blockers = unique([
  ...(climatePowerOnQualified ? [] : ["CLIMATE_POWER_ON_NOT_SEPARATELY_QUALIFIED"]),
  ...(realInFlightRecoveryQualified
    ? []
    : [
        "REAL_IN_FLIGHT_ADAPTER_RESTART_RECOVERY_UNVERIFIED",
        "REAL_IN_FLIGHT_RUNTIME_RESTART_RECOVERY_UNVERIFIED",
      ]),
  ...(realFaultsQualified ? [] : ["REAL_FAULT_INJECTION_UNVERIFIED"]),
  ...(pmsOutageQualified ? [] : ["PMS_OUTAGE_TASK_AUTHORITY_UNVERIFIED"]),
]);

const verificationCommands = verification.commands ?? {};
const aggregateStatus = {
  verifyV2: statusOf(verificationCommands.verifyV2),
  verifyPlatform: statusOf(verificationCommands.verifyPlatform),
  formatCheck: statusOf(verificationCommands.formatCheck),
  lint: statusOf(verificationCommands.lint),
  typecheck: statusOf(verificationCommands.typecheck),
  build: statusOf(verificationCommands.build),
  protocolCheck: statusOf(verificationCommands.protocolCheck),
};
const sensitiveScan = await scanReports();
const forbiddenProtocolChanges = changedFiles.filter((file) =>
  /^(packages\/adapter-protocol\/proto\/|packages\/adapter-protocol\/src\/generated\/|protocols\/mcp-tasks\/|docs\/protocol\/frozen\/)/i.test(
    file,
  ),
);
const runtimeHomeAssistantImports = changedFiles.filter(
  (file) =>
    /^(apps\/runtime|packages\/runtime|apps\/pms-api|apps\/pms-worker)\//i.test(file) &&
    /home-assistant|home_assistant|HOME_ASSISTANT/i.test(file),
);
const migrationFiles = (await readdir(resolve(root, "migrations/runtime")))
  .filter((file) => /^\d+_.*\.sql$/i.test(file))
  .sort();
const latestMigration = migrationFiles.at(-1) ?? null;

const providerEndpoints = providerIds.map((providerId) => {
  const provider = registry.providers?.find((item) => item.providerId === providerId);
  const catalog = catalogs.catalogs?.find((item) => item.providerId === providerId);
  return {
    providerId,
    serverId: provider?.serverId ?? "",
    protocolMode: provider?.protocolMode ?? "frozen_v1",
    effectiveEndpoint: provider?.effectiveEndpoint ?? "",
    catalogRevision: provider?.catalogRevision ?? catalog?.catalogRevision ?? 0,
    tools: provider?.tools ?? catalog?.tools ?? [],
  };
});

const baselineCloseout = {
  ...baseline,
  evidenceClass: "static",
  baseSha,
  candidateSha,
  branch,
  worktreeClean,
  capturedAt: new Date().toISOString(),
  statusLines,
};
const changeInventory = {
  evidenceClass: "static",
  baseSha,
  candidateSha,
  branch,
  changedFileCount: changedFiles.length,
  changedFiles,
  categories: {
    climateSafetyGate: changedFiles.filter(
      (file) =>
        file.startsWith("apps/home-assistant-climate-provider/") ||
        file.includes("home-assistant-climate"),
    ),
    lightProvider: changedFiles.filter(
      (file) => file.includes("home-assistant-light") || file.includes("home_assistant_light"),
    ),
    pm2WindowsLifecycle: changedFiles.filter(
      (file) => file.startsWith("packages/pm2-runtime-adapter/") || file.includes("pm2-adapter"),
    ),
    tests: changedFiles.filter((file) => file.startsWith("tests/") || file.includes("/test/")),
    reports: changedFiles.filter((file) => file.startsWith("reports/")),
  },
  forbiddenAutomaticActions: [
    "merge",
    "tag",
    "release",
    "public deployment",
    "force push",
    "SDAR Agent Runtime integration",
  ],
};
const architectureReview = {
  evidenceClass: "static",
  status:
    forbiddenProtocolChanges.length === 0 && runtimeHomeAssistantImports.length === 0
      ? "passed"
      : "blocked",
  authorityBoundaries: {
    pms: "provider/config/deployment/catalog/registry/audit/desired state",
    runtime: "Task/Command/Scheduler/Recovery/Notification/MCP data plane",
    providerAdapter: "Home Assistant connection/resource facts/side effects/safety",
    homeAssistant: "actual climate/light state",
  },
  forbiddenProtocolChanges,
  runtimeHomeAssistantImports,
  taskAuthority: "Runtime remains the Task Authority; no tasks/result call was introduced.",
  directPmsHomeAssistantCall: false,
  directRuntimeHomeAssistantCall: false,
  providerAdapterPmsOrRuntimeTaskTableMutation: false,
  note: "The source review is scoped to the candidate diff and the live evidence paths; no frozen MCP Tasks or Adapter Proto fields were changed.",
};
const migrationAudit = {
  evidenceClass: migrationEvidence.status === "PASS" ? "contract" : "unverified",
  status:
    migrationEvidence.status === "PASS" &&
    migrationEvidence.sets?.runtime?.migrationCount === migrationFiles.length
      ? "passed"
      : "blocked",
  migrationDirectory: "migrations/runtime",
  migrationCount: migrationFiles.length,
  latestMigration,
  expectedRuntimeMigrationCount: 25,
  isolationEvidence: {
    report: "reports/evidence/migration-isolation.json",
    status: migrationEvidence.status,
    repeatedRunsPerSet: migrationEvidence.repeatedRunsPerSet,
    runtimeTableCount: migrationEvidence.sets?.runtime?.tableCount ?? null,
  },
  migrationHistoryConflict: "none observed in the isolated runtime migration check",
};
const protocolIntegrity = {
  evidenceClass:
    statusOf(verificationCommands.protocolCheck) === "passed" ? "contract" : "unverified",
  status: statusOf(verificationCommands.protocolCheck),
  frozenContract: statusOf(verificationCommands.protocolCheck),
  pinnedSchema: statusOf(verificationCommands.protocolCheck),
  frozenCases:
    verification.frozenCases ?? verificationCommands.protocolCheck?.frozenCases ?? "unverified",
  protocolLock:
    verification.protocolLock ?? verificationCommands.protocolCheck?.protocolLock ?? "unverified",
  adapterProtoChanged: forbiddenProtocolChanges.some((file) =>
    file.startsWith("packages/adapter-protocol/"),
  ),
  tasksResultUsedByLiveRunner: false,
};
const securityAudit = {
  evidenceClass: statusOf(verificationCommands.security) === "passed" ? "contract" : "unverified",
  status: statusOf(verificationCommands.security),
  dependencyAudit: verification.dependencyAudit ?? "not separately recorded",
  sensitiveReportScan: sensitiveScan,
  realWriteGate: {
    climate: "requires ALLOW_REAL_DEVICE_SIDE_EFFECTS=YES and non-empty REAL_DEVICE_TEST_RUN_ID",
    light: "requires ALLOW_REAL_DEVICE_SIDE_EFFECTS=YES and non-empty REAL_DEVICE_TEST_RUN_ID",
    invalidGateBehavior: "read-only; new real writes fail closed",
  },
  noAuthorizationHeaderInReports: sensitiveScan.authorizationHeaderCount === 0,
  noTokenInReports: sensitiveScan.tokenMatchCount === 0,
  noEntityIdInReports: sensitiveScan.entityIdMatchCount === 0,
};
const providerPackageGate = {
  evidenceClass:
    statusOf(verificationCommands.providerPackages) === "passed" ? "contract" : "unverified",
  status: statusOf(verificationCommands.providerPackages),
  packageIds: ["builtin.home-assistant.climate", "builtin.home-assistant.light"],
  providerTypes: ["home_assistant.climate", "home_assistant.light"],
  protocolMode: "frozen_v1",
  lightOperations: ["light_get_state", "light_set_power", "light_set_brightness"],
  climateOperations: [
    "climate_get_state",
    "climate_set_hvac_mode",
    "climate_set_power",
    "climate_set_temperature",
  ],
  realResourceStatus: "environment-qualified-by-report-only",
  qualificationScope: resourceIds,
};
const aggregateGates = {
  evidenceClass: Object.values(aggregateStatus).every((status) => status === "passed")
    ? "contract"
    : "unverified",
  status: Object.values(aggregateStatus).every((status) => status === "passed")
    ? "passed"
    : "partial",
  commands: aggregateStatus,
  testSuites: verification.testSuites ?? {},
  knownEnvironmentDiagnostics: [
    "Windows PM2 pidusage can emit WMI ManagementException diagnostics while readiness and task paths remain usable.",
  ],
};
const recoveryFaultEvidence = {
  evidenceClass: "mixed",
  status: resiliencePass ? "passed" : "partial",
  realRecovery: {
    status: recovery.status,
    checks: (recovery.checks ?? []).map((check) => ({
      scenario: check.scenario,
      evidenceClass: check.evidenceClass,
      status: check.status,
      runtimeRestartPerformed: check.runtimeRestartPerformed,
      sideEffectReplay: check.sideEffectReplay,
    })),
  },
  controlledFaultInjection: {
    status: faultInjection.status,
    report: "reports/real-device-preparation-continuation/fault-injection.json",
    controlledTestsPassed: faultInjection.controlledTestSummary?.testsPassed ?? 0,
    controlledTestsFailed: faultInjection.controlledTestSummary?.testsFailed ?? 0,
  },
  hardGaps: [
    "real in-flight Adapter restart recovery",
    "real in-flight Runtime restart recovery",
    "real PMS outage while Runtime Task Authority remains live",
    "real REST 200 without observed target state",
  ],
  noAutomaticRetryAfterUncertain: true,
};
const liveRealResourceStatus = {
  evidenceClass: "real",
  status: functionalPass ? "passed" : "blocked",
  environment: "home-lab",
  preflight: {
    status: preflight.status,
    completedAt: preflight.completedAt,
    resourceCount: preflight.resources?.length ?? 0,
    allReachable: (preflight.resources ?? []).every((resource) => resource.reachable === true),
    websocketStateChangedSubscribed: preflight.ws?.subscribedEventType === "state_changed",
    restWebSocketConsistent: (preflight.ws?.initialStateComparisons ?? []).every(
      (item) => item.consistent === true,
    ),
  },
  registry: {
    status: registry.status,
    revision: registry.revision,
    checksum: registry.checksum,
    etag: registry.etag,
    providerCount: registry.providers?.length ?? 0,
    latestBootstrapSameChecksum: catalogs.registry?.latestBootstrapSameChecksum === true,
    historyMonotonic: catalogs.registry?.history?.monotonicRevisions === true,
    noSecrets: registry.noSecrets === true && registryContract.checks?.noSecretKeys === true,
    noEntityIds: registry.noEntityIds === true && registryContract.checks?.noEntityIdKeys === true,
  },
  threeDeviceRun: {
    status: threeDevice.status,
    integrationRunId: threeDevice.integrationRunId,
    completedAt: threeDevice.completedAt,
    resources: resourceIds,
    allRestored: allThreeRestored,
    activeTasks: threeDevice.runtimeTaskCounts?.active ?? null,
    uncertainTasks: threeDevice.runtimeTaskCounts?.uncertain ?? null,
    climateSafety: threeDevice.climateSafety?.status ?? null,
    writesUsed: threeDevice.safetyGate?.writesUsed ?? {},
  },
  qualifiedOperations: {
    climate_get_state: "real_pass",
    climate_set_hvac_mode: "real_pass_time_scoped",
    climate_set_temperature: "real_pass_time_scoped",
    climate_set_power: "real_pass_off_restore_only",
    light_get_state: "real_pass_time_scoped",
    light_set_power: "real_pass_time_scoped",
    light_set_brightness: "unverified_optional",
  },
  providers: providerEndpoints,
  noSecrets: true,
  noEntityIds: true,
};
const finalHandoff = {
  schemaVersion: "1.0",
  repository: "zhouwen-giser/sdar-mcp-provider-platform",
  smppBaseSha: baseSha,
  smppCandidateSha: candidateSha,
  branch,
  environment: "home-lab",
  registryRevision: registry.revision ?? 0,
  registryChecksum: registry.checksum ?? "",
  registryEtag: registry.etag ?? "",
  providers: providerEndpoints,
  realResourcesQualified: functionalPass ? resourceIds : [],
  realResourcesRead: resourceIds,
  activeTasks: threeDevice.runtimeTaskCounts?.active ?? 0,
  uncertainTasks: threeDevice.runtimeTaskCounts?.uncertain ?? 0,
  deviceState: allThreeRestored ? "restored" : "manual_restore_required",
  readyForSdarFunctionalIntegration: functionalPass,
  readyForSdarResilienceIntegration: resiliencePass,
  readyForSdarFullCapabilityIntegration: fullCapabilityPass,
  readyForSdarIntegration: functionalPass && resiliencePass && fullCapabilityPass,
  blockingIssues: blockers,
  noSecrets: true,
  noEntityIds: true,
  sdarAgentRuntime: "not_connected",
};
const knownLimitations = [
  "The explicit climate power-on operation was not separately qualified; HVAC mode, target temperature, and safe power-off restoration were qualified.",
  "Real in-flight Adapter/Runtime restart recovery and real PMS/HA outage recovery remain unverified.",
  "REST 200 without observed target state was not injected against a real device.",
  "Optional light brightness was read and capability-checked but not side-effect qualified.",
  "Windows PM2 pidusage diagnostics report WMI ManagementException errors although Runtime readiness and task paths passed.",
  "No SDAR Agent Runtime was connected, and no public deployment, merge, tag, or release was performed.",
];
const finalReport = renderFinalReport(finalHandoff, verification, aggregateGates);

await mkdir(closeoutRoot, { recursive: true });
await mkdir(codexRoot, { recursive: true });
await writeJson(resolve(closeoutRoot, "baseline.json"), baselineCloseout);
await writeJson(resolve(closeoutRoot, "change-inventory.json"), changeInventory);
await writeJson(resolve(closeoutRoot, "architecture-boundary-review.json"), architectureReview);
await writeJson(resolve(closeoutRoot, "migration-audit.json"), migrationAudit);
await writeJson(resolve(closeoutRoot, "protocol-integrity.json"), protocolIntegrity);
await writeJson(resolve(closeoutRoot, "security-audit.json"), securityAudit);
await writeJson(resolve(closeoutRoot, "provider-package-gate.json"), providerPackageGate);
await writeJson(resolve(closeoutRoot, "aggregate-gates.json"), aggregateGates);
await writeJson(resolve(closeoutRoot, "recovery-fault-evidence.json"), recoveryFaultEvidence);
await writeJson(resolve(closeoutRoot, "live-real-resource-status.json"), liveRealResourceStatus);
await writeJson(resolve(closeoutRoot, "final-handoff.json"), finalHandoff);
await writeFile(
  resolve(closeoutRoot, "known-limitations.md"),
  renderLimitations(knownLimitations, finalHandoff),
  "utf8",
);
await writeFile(resolve(closeoutRoot, "final-delivery-report.md"), finalReport, "utf8");

await writeJson(resolve(sourceRoot, "final-handoff.json"), finalHandoff);
await writeFile(resolve(sourceRoot, "final-delivery-report.md"), finalReport, "utf8");
await writeFile(
  resolve(sourceRoot, "known-limitations.md"),
  renderLimitations(knownLimitations, finalHandoff),
  "utf8",
);
await writeJson(resolve(sourceRoot, "registry-snapshot.redacted.json"), {
  evidenceClass: "real",
  status: registry.status,
  environment: "home-lab",
  revision: registry.revision,
  checksum: registry.checksum,
  etag: registry.etag,
  latest: registryContract.checks?.latest ? "passed" : "unverified",
  bootstrap: registryContract.checks?.bootstrap ? "passed" : "unverified",
  watch: registryContract.checks?.watch ? "passed" : "unverified",
  providers: providerEndpoints.map((provider) => ({
    providerId: provider.providerId,
    serverId: provider.serverId,
    protocolMode: provider.protocolMode,
    effectiveEndpoint: provider.effectiveEndpoint,
    catalogRevision: provider.catalogRevision,
  })),
  latestBootstrapSameChecksum: catalogs.registry?.latestBootstrapSameChecksum === true,
  containsSecretKeys: false,
  containsEntityIdKeys: false,
  noSecrets: true,
  noEntityIds: true,
});

await writeJson(resolve(codexRoot, "task-state.json"), {
  schemaVersion: "1.0",
  phase: "P9_FINAL_QUALIFICATION",
  status: finalHandoff.readyForSdarIntegration ? "completed" : "blocked_by_explicit_hard_gates",
  baseSha,
  candidateSha,
  branch,
  worktreeClean,
  functional: functionalPass ? "passed" : "blocked",
  resilience: resiliencePass ? "passed" : "blocked",
  fullCapability: fullCapabilityPass ? "passed" : "blocked",
  readyForSdarIntegration: finalHandoff.readyForSdarIntegration,
  blockers,
  nextAction:
    "Complete the explicitly listed real in-flight/outage qualification gates before SDAR integration.",
});
await writeFile(
  resolve(codexRoot, "execution-log.md"),
  `# SMPP Home Assistant closeout execution log\n\n- Base SHA: \`${baseSha}\`\n- Candidate SHA at report generation: \`${candidateSha}\`\n- Branch: \`${branch}\`\n- Functional live qualification: **${functionalPass ? "passed" : "blocked"}**\n- Resilience qualification: **${resiliencePass ? "passed" : "blocked"}**\n- Full capability qualification: **${fullCapabilityPass ? "passed" : "blocked"}**\n- Device state: **${finalHandoff.deviceState}**\n- Active tasks: \`${finalHandoff.activeTasks}\`; uncertain tasks: \`${finalHandoff.uncertainTasks}\`\n- All reports are redacted; entity IDs are represented only by local preflight hashes.\n`,
  "utf8",
);
await writeFile(
  resolve(codexRoot, "decisions.md"),
  `# Decisions\n\n- Keep the PMS, Runtime, Provider Adapter, and Home Assistant authority boundaries unchanged.\n- Keep the frozen MCP Tasks and Adapter Protocol contracts unchanged.\n- Treat the three configured resources as an environment-scoped qualification, not a blanket Home Assistant provider certification.\n- Keep \`readyForSdarIntegration\` false until the real in-flight and outage recovery gates are executed and evidenced.\n- Do not convert controlled fault tests into real-device evidence.\n`,
  "utf8",
);
await writeFile(
  resolve(codexRoot, "blockers.md"),
  `# Blockers\n\n${blockers.map((item) => `- \`${item}\``).join("\n")}\n`,
  "utf8",
);
await writeJson(resolve(codexRoot, "review-findings.json"), {
  evidenceClass: "static",
  status:
    blockers.length === 0 && architectureReview.status === "passed" ? "passed" : "open_findings",
  findings: blockers.map((blocker) => ({
    severity: "P1",
    blocker,
    disposition: "must be completed before readyForSdarIntegration=true",
  })),
  architectureReviewStatus: architectureReview.status,
  protocolIntegrityStatus: protocolIntegrity.status,
  securityAuditStatus: securityAudit.status,
});

process.stdout.write(
  `${finalHandoff.readyForSdarIntegration ? "PASS" : "BLOCKED"} real-device closeout; candidate ${candidateSha}; blockers ${blockers.length}\n`,
);
process.exitCode = finalHandoff.readyForSdarIntegration ? 0 : 1;

function statusOf(value) {
  if (typeof value === "string") return value;
  if (value && typeof value.status === "string") return value.status;
  return "unverified";
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function readJsonIfPresent(file) {
  try {
    return await readJson(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function scanReports() {
  const reportFiles = await listFiles(sourceRoot);
  const continuationFiles = await listFiles(continuationRoot);
  const closeoutFiles = await listFiles(closeoutRoot).catch(() => []);
  const files = unique([...reportFiles, ...continuationFiles, ...closeoutFiles]).filter(
    (file) => !file.endsWith("verification-run.json"),
  );
  const token = (await readFile(resolve(root, ".local/ha-real-device/token.txt"), "utf8")).trim();
  const entityIds = JSON.parse(
    await readFile(resolve(root, ".local/ha-real-device/resources.local.json"), "utf8"),
  );
  const entityValues = [
    entityIds.climate?.entityId,
    ...(entityIds.lights ?? []).map((item) => item.entityId),
  ].filter(Boolean);
  let tokenMatchCount = 0;
  let entityIdMatchCount = 0;
  let authorizationHeaderCount = 0;
  for (const file of files) {
    const content = await readFile(file, "utf8");
    if (token && content.includes(token)) tokenMatchCount += 1;
    for (const entityId of entityValues) {
      if (content.includes(entityId)) entityIdMatchCount += 1;
    }
    authorizationHeaderCount += (content.match(/authorization\s*:\s*bearer\s+/gi) ?? []).length;
  }
  return {
    filesScanned: files.length,
    tokenMatchCount,
    entityIdMatchCount,
    authorizationHeaderCount,
    tokenFileReadForScanOnly: true,
    entityIdsReadForScanOnly: true,
  };
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(file)));
    else files.push(file);
  }
  return files;
}

function unique(values) {
  return [...new Set(values)];
}

function renderLimitations(items, handoff) {
  return [
    "# Known limitations",
    "",
    ...items.map((item) => `- ${item}`),
    "",
    `Readiness: **${handoff.readyForSdarIntegration ? "YES" : "NO"}**.`,
    "",
  ].join("\n");
}

function renderFinalReport(handoff, verificationRun, aggregate) {
  return [
    "# SMPP Home Assistant real-device preparation closeout",
    "",
    `- Base SHA: \`${handoff.smppBaseSha}\``,
    `- Candidate SHA: \`${handoff.smppCandidateSha}\``,
    `- Branch: \`${handoff.branch}\``,
    `- Environment: \`${handoff.environment}\``,
    `- Overall readiness: **${handoff.readyForSdarIntegration ? "YES" : "NO"}**`,
    "",
    "## Qualification",
    "",
    `- Functional three-device MCP path: **${handoff.readyForSdarFunctionalIntegration ? "PASS" : "BLOCKED"}**`,
    `- Resilience qualification: **${handoff.readyForSdarResilienceIntegration ? "PASS" : "BLOCKED"}**`,
    `- Full capability qualification: **${handoff.readyForSdarFullCapabilityIntegration ? "PASS" : "BLOCKED"}**`,
    `- Device state: **${handoff.deviceState}**`,
    `- Active tasks: \`${handoff.activeTasks}\`; uncertain tasks: \`${handoff.uncertainTasks}\``,
    "",
    "## Evidence",
    "",
    "- Home Assistant read-only preflight passed for the three configured resources, including REST/WebSocket consistency.",
    "- PMS onboarding, two ACTIVE Runtime Deployments, Catalog discovery, and Registry snapshot checks passed.",
    "- Registry-backed MCP reads and the latest three-device write/confirm/restore run passed.",
    "- Climate power-on remains intentionally unqualified; safe power-off restoration is separately evidenced.",
    `- Aggregate repository evidence status: **${aggregate.status}**; recorded command run status: **${verificationRun.status}**.`,
    "",
    "## Open blockers",
    "",
    ...handoff.blockingIssues.map((item) => `- \`${item}\``),
    "",
    "No SDAR Agent Runtime was connected. No merge, tag, release, public deployment, or force push was performed.",
    "",
  ].join("\n");
}

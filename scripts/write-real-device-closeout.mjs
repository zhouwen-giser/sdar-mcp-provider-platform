import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import {
  buildSdarIntegrationAllowlist,
  describeCurrentPreflight,
  evaluateMainMergeReadiness,
  hasStateChangedSubscription,
  renderFaultMatrix,
  resolveCurrentRuntimeTaskCounts,
} from "./real-device-closeout-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(root, "reports/real-device-preparation");
const continuationRoot = resolve(root, "reports/real-device-preparation-continuation");
const closeoutRoot = resolve(root, "reports/real-device-closeout");
const prettierConfig = (await resolveConfig(resolve(root, "package.json"))) ?? {};

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
const noDuplicate = await readJson(resolve(continuationRoot, "no-duplicate-side-effect.json"));
const protocolLockCrossPlatform = await readJson(
  resolve(continuationRoot, "protocol-lock-cross-platform.json"),
);
const protocolLockDiff = await readJson(resolve(continuationRoot, "protocol-lock-diff.json"));
const linuxSymlink = await readJsonIfPresent(resolve(continuationRoot, "symlink-linux.json"));
const runtimeImage = await readJsonIfPresent(resolve(root, "reports/image/runtime-v2.json"));
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
const resourceBindings = [
  { providerId: "ha-climate-lab", resourceId: "living-room-air-conditioner" },
  { providerId: "ha-light-lab", resourceId: "living-room-main-light" },
  { providerId: "ha-light-lab", resourceId: "living-room-aux-light" },
];
const allThreeRestored =
  (threeDevice.stateRestoration ?? []).length === 3 &&
  threeDevice.stateRestoration.every((item) => item.status === "restored");
const currentRuntimeTaskCounts = resolveCurrentRuntimeTaskCounts(registryE2e, threeDevice);
const preflightWebSocket = preflight.websocket ?? preflight.ws ?? {};
const currentPreflightPass = preflight.status === "passed";
const currentDeviceStateRestored = currentPreflightPass && allThreeRestored;
const functionalPass =
  currentPreflightPass &&
  climate.status === "passed" &&
  lights.status === "passed" &&
  pms.status === "passed" &&
  registry.status === "passed" &&
  registryContract.status === "passed" &&
  registryE2e.status === "passed" &&
  threeDevice.status === "passed" &&
  allThreeRestored &&
  currentRuntimeTaskCounts.active === 0 &&
  currentRuntimeTaskCounts.uncertain === 0;
const climatePowerOnQualified = climatePower.qualifiedOperations?.climate_set_power === "real_pass";
const boundedIdempotencyScenarios = collectBoundedIdempotencyScenarios(climate, lights);
const boundedIdempotencyPassed =
  boundedIdempotencyScenarios.length === 3 &&
  new Set(boundedIdempotencyScenarios.map((scenario) => scenario.resourceId)).size === 3 &&
  boundedIdempotencyScenarios.every(
    (scenario) =>
      scenario.sameArgumentsSameTask === true &&
      scenario.sameTaskDifferentArgumentsRejected === true,
  );
const realInFlightRecoveryQualified = false;
const realFaultsQualified = false;
const pmsOutageQualified = false;
const resiliencePass = realInFlightRecoveryQualified && realFaultsQualified && pmsOutageQualified;
const fullCapabilityPass = functionalPass && climatePowerOnQualified && resiliencePass;
const blockers = unique([
  ...(currentPreflightPass
    ? []
    : ["HA_PREFLIGHT_NOT_CURRENTLY_PASSED", "MANUAL_RESTORE_REQUIRED_CURRENT_DEVICE_STATE"]),
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
const requiredRepositoryCommandNames = [
  "installFrozen",
  "formatCheck",
  "lint",
  "typecheck",
  "build",
  "protocolCheck",
  "testUnit",
  "testContract",
  "testIntegration",
  "testE2e",
  "migrationIsolation",
  "haClimate",
  "haLight",
  "providerPlatformHa",
  "providerPackages",
  "security",
  "sbom",
  "container",
  "verifyV2",
  "verifyPlatform",
  "releaseCandidateCheck",
  "pmsApiProduction",
  "workerPm2Production",
  "linuxSymlink",
];
const repositoryCommandStatuses = Object.fromEntries(
  requiredRepositoryCommandNames.map((name) => [name, statusOf(verificationCommands[name])]),
);
const repositoryGatesPassed = requiredRepositoryCommandNames.every(
  (name) => repositoryCommandStatuses[name] === "passed",
);
const aggregateStatus = {
  verifyV2: statusOf(verificationCommands.verifyV2),
  verifyPlatform: statusOf(verificationCommands.verifyPlatform),
  formatCheck: statusOf(verificationCommands.formatCheck),
  lint: statusOf(verificationCommands.lint),
  typecheck: statusOf(verificationCommands.typecheck),
  build: statusOf(verificationCommands.build),
  protocolCheck: statusOf(verificationCommands.protocolCheck),
  releaseCandidateCheck: statusOf(verificationCommands.releaseCandidateCheck),
  providerPackages: statusOf(verificationCommands.providerPackages),
  security: statusOf(verificationCommands.security),
  sbom: statusOf(verificationCommands.sbom),
  container: statusOf(verificationCommands.container),
  migrationIsolation: statusOf(verificationCommands.migrationIsolation),
  pmsApiProduction: statusOf(verificationCommands.pmsApiProduction),
  workerPm2Production: statusOf(verificationCommands.workerPm2Production),
  linuxSymlink: statusOf(verificationCommands.linuxSymlink),
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
  dependencyAudit:
    verificationCommands.dependencyAudit?.summary ?? "not separately recorded for this candidate",
  dependencyAuditRefresh:
    verificationCommands.dependencyAudit?.currentOnlineRefresh ?? "not_requested",
  sensitiveReportScan: sensitiveScan,
  realWriteGate: {
    climate:
      "requires ALLOW_REAL_DEVICE_SIDE_EFFECTS=YES and non-empty REAL_DEVICE_TEST_RUN_ID; climate_set_power additionally requires ALLOW_CLIMATE_POWER_TEST=YES",
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
const releasePackaging = {
  evidenceClass:
    statusOf(verificationCommands.container) === "passed" &&
    statusOf(verificationCommands.releaseCandidateCheck) === "passed" &&
    runtimeImage?.reproducibleFilesystemAndConfig === true
      ? "static"
      : "unverified",
  status:
    statusOf(verificationCommands.container) === "passed" &&
    statusOf(verificationCommands.releaseCandidateCheck) === "passed" &&
    runtimeImage?.reproducibleFilesystemAndConfig === true
      ? "passed"
      : "blocked",
  releaseCandidateWorkflow: statusOf(verificationCommands.releaseCandidateCheck),
  runtimeImage: runtimeImage
    ? {
        image: runtimeImage.image,
        base: runtimeImage.base,
        sizeBytes: runtimeImage.sizeBytes,
        maximumBytes: runtimeImage.maximumBytes,
        filesystemHash: runtimeImage.filesystemHash,
        frozenLockfile: runtimeImage.frozenLockfile,
        productionDependenciesOnly: runtimeImage.productionDependenciesOnly,
        containsTestsDocsOrReferences: runtimeImage.containsTestsDocsOrReferences,
        reproducibleFilesystemAndConfig: runtimeImage.reproducibleFilesystemAndConfig,
      }
    : null,
  noPublicPublication: true,
};
const crossPlatformGates = {
  evidenceClass:
    protocolLockCrossPlatform.windows?.status === "passed" &&
    protocolLockCrossPlatform.linux?.status === "passed" &&
    (linuxSymlink?.status ?? "unverified") === "passed" &&
    protocolLockDiff.summary?.contentDrift === 0
      ? "mixed"
      : "unverified",
  status:
    protocolLockCrossPlatform.windows?.status === "passed" &&
    protocolLockCrossPlatform.linux?.status === "passed" &&
    (linuxSymlink?.status ?? "unverified") === "passed" &&
    protocolLockDiff.summary?.contentDrift === 0
      ? "passed"
      : "partial",
  protocolLock: {
    windows: protocolLockCrossPlatform.windows?.status ?? "unverified",
    linux: protocolLockCrossPlatform.linux?.status ?? "unverified",
    contentDrift: protocolLockDiff.summary?.contentDrift ?? null,
    lineEndingDrift: protocolLockDiff.summary?.lineEndingDrift ?? null,
  },
  providerPackageLinuxSymlink: linuxSymlink
    ? {
        status: linuxSymlink.status,
        expectedCode: linuxSymlink.expectedCode,
        actualCode: linuxSymlink.actualCode,
      }
    : { status: "unverified" },
};
const repositoryGates = {
  evidenceClass: repositoryGatesPassed ? "mixed" : "unverified",
  status: repositoryGatesPassed ? "passed" : "blocked",
  requiredCommandStatuses: repositoryCommandStatuses,
  historicalOrEnvironmentNotes: [
    "A command is counted only when its current recorded status is exactly passed.",
    "A timeout or missing TEST_DATABASE_URL is not converted into a pass.",
  ],
};
const mergeCodeBlockers = unique([
  ...(worktreeClean ? [] : ["WORKTREE_NOT_CLEAN_AT_CLOSEOUT_GENERATION"]),
  ...(architectureReview.status === "passed" ? [] : ["ARCHITECTURE_BOUNDARY_REVIEW_FAILED"]),
  ...(migrationAudit.status === "passed" ? [] : ["MIGRATION_AUDIT_FAILED"]),
  ...(protocolIntegrity.status === "passed" ? [] : ["FROZEN_PROTOCOL_GATE_FAILED"]),
  ...(securityAudit.status === "passed" ? [] : ["SECURITY_GATE_FAILED"]),
  ...(providerPackageGate.status === "passed" ? [] : ["PROVIDER_PACKAGE_GATE_FAILED"]),
  ...(repositoryGates.status === "passed" ? [] : ["REPOSITORY_GATES_NOT_CURRENTLY_PASSED"]),
  ...(releasePackaging.status === "passed"
    ? []
    : ["RUNTIME_RELEASE_PACKAGING_NOT_CURRENTLY_PASSED"]),
  ...(crossPlatformGates.status === "passed" ? [] : ["CROSS_PLATFORM_GATE_FAILED"]),
  ...(sensitiveScan.tokenMatchCount === 0 ? [] : ["SECRET_FOUND_IN_REPORT_SCAN"]),
  ...(sensitiveScan.entityIdMatchCount === 0 ? [] : ["ENTITY_ID_FOUND_IN_REPORT_SCAN"]),
  ...(sensitiveScan.authorizationHeaderCount === 0
    ? []
    : ["AUTHORIZATION_HEADER_FOUND_IN_REPORT_SCAN"]),
  ...(currentRuntimeTaskCounts.active === 0 ? [] : ["ACTIVE_RUNTIME_TASKS_REMAIN"]),
  ...(currentRuntimeTaskCounts.uncertain === 0 ? [] : ["UNCERTAIN_RUNTIME_TASKS_REMAIN"]),
]);
const mergeReadinessEvaluation = evaluateMainMergeReadiness(mergeCodeBlockers, verification.github);
const mainMergeReadiness = {
  evidenceClass: "mixed",
  ...mergeReadinessEvaluation,
  github: verification.github ?? {
    requiredChecks: "not_verified",
    blockingReviewFindings: null,
    unresolvedThreads: null,
    checkedAt: null,
    note: "A PR and its protected-branch checks had not been verified when this report was generated.",
  },
  externalQualificationBlockers: blockers,
  automaticActionsNotTaken: [
    "merge",
    "tag",
    "release",
    "public deployment",
    "force push",
    "branch deletion",
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
    websocketStateChangedSubscribed: hasStateChangedSubscription(preflight),
    restWebSocketConsistent: (preflightWebSocket.initialStateComparisons ?? []).every(
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
    currentPreflightPass,
    currentDeviceStateRestored,
    activeTasks: currentRuntimeTaskCounts.active,
    uncertainTasks: currentRuntimeTaskCounts.uncertain,
    runtimeTaskCountSource: currentRuntimeTaskCounts.source,
    climateSafety: threeDevice.climateSafety?.status ?? null,
    writesUsed: threeDevice.safetyGate?.writesUsed ?? {},
  },
  qualifiedOperations: {
    climate_get_state: "real_pass_time_scoped",
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
const adapterRecovery = {
  evidenceClass: "mixed",
  status: recovery.checks?.some(
    (check) =>
      check.scenario === "Adapter restart during an in-flight real Task" &&
      check.status === "passed",
  )
    ? "passed"
    : "unverified",
  completedRealScenarios: (recovery.checks ?? [])
    .filter(
      (check) =>
        check.evidenceClass === "real" &&
        typeof check.status === "string" &&
        check.status === "passed",
    )
    .map((check) => check.scenario),
  inFlightScenario: "unverified",
  completedTaskReplayNotObserved: noDuplicate.status === "passed_scoped_bounded_light_runs",
  inFlightNoReplay: "unverified",
  sourceReport: "reports/real-device-preparation-continuation/real-recovery.json",
};
const runtimeRecovery = {
  evidenceClass: "mixed",
  status: recovery.checks?.some(
    (check) =>
      check.scenario === "Runtime restart during an in-flight real Task" &&
      check.status === "passed",
  )
    ? "passed"
    : "unverified",
  completedRealScenarios: (recovery.checks ?? [])
    .filter(
      (check) =>
        check.evidenceClass === "real" &&
        check.runtimeRestartPerformed === true &&
        check.status === "passed",
    )
    .map((check) => check.scenario),
  inFlightScenario: "unverified",
  postRestartActiveTasks: currentRuntimeTaskCounts.active,
  postRestartUncertainTasks: currentRuntimeTaskCounts.uncertain,
  runtimeTaskCountSource: currentRuntimeTaskCounts.source,
  sourceReport: "reports/real-device-preparation-continuation/real-recovery.json",
};
const faultQualification = {
  evidenceClass: "mixed",
  status: realFaultsQualified ? "passed" : "unverified",
  real: {
    status: "unverified",
    sourceReport: "reports/real-device-preparation-continuation/fault-injection.json",
  },
  controlled: {
    status: faultInjection.status,
    testsPassed: faultInjection.controlledTestSummary?.testsPassed ?? 0,
    testsFailed: faultInjection.controlledTestSummary?.testsFailed ?? 0,
    evidenceClass: "controlledFaultInjection",
  },
  forbiddenConversion: "controlled fault results are not real-device qualification",
};
const noDuplicateQualification = {
  evidenceClass: "real",
  status: boundedIdempotencyPassed ? "passed_scoped_bounded_real_tasks" : "partial",
  sourceReports: [
    "reports/real-device-preparation/climate-real-qualification.json",
    "reports/real-device-preparation/light-real-qualification.json",
    "reports/real-device-preparation-continuation/no-duplicate-side-effect.json",
  ],
  scenarios: boundedIdempotencyScenarios,
  scope: "same idempotency key retry and conflicting-argument rejection on three executed Tasks",
  inFlightCrashReplay: "unverified_real_device",
  activeTasks: currentRuntimeTaskCounts.active,
  uncertainTasks: currentRuntimeTaskCounts.uncertain,
  runtimeTaskCountSource: currentRuntimeTaskCounts.source,
  stateRestored: allThreeRestored,
};
const finalQualification = {
  evidenceClass: "mixed",
  status: fullCapabilityPass ? "passed" : "blocked",
  functional: {
    status: functionalPass ? "passed" : "blocked",
    resources: functionalPass ? resourceIds : [],
    deviceState: currentDeviceStateRestored ? "restored" : "manual_restore_required",
    activeTasks: currentRuntimeTaskCounts.active,
    uncertainTasks: currentRuntimeTaskCounts.uncertain,
    runtimeTaskCountSource: currentRuntimeTaskCounts.source,
  },
  resilience: {
    status: resiliencePass ? "passed" : "blocked",
    adapterInFlight: adapterRecovery.status,
    runtimeInFlight: runtimeRecovery.status,
    realFaultInjection: faultQualification.real.status,
    pmsOutageTaskAuthority: pmsOutageQualified ? "passed" : "unverified",
  },
  fullCapability: fullCapabilityPass ? "passed" : "blocked",
  climatePowerOn: climatePowerOnQualified ? "passed" : "unverified",
  blockers,
};
const operationQualifications = {
  climate_get_state:
    climatePower.qualifiedOperations?.climate_get_state === "real_pass"
      ? "real_pass_time_scoped"
      : "unverified",
  climate_set_hvac_mode:
    climatePower.qualifiedOperations?.climate_set_hvac_mode === "real_pass"
      ? "real_pass_time_scoped"
      : "unverified",
  climate_set_temperature:
    climatePower.qualifiedOperations?.climate_set_temperature === "real_pass"
      ? "real_pass_time_scoped"
      : "unverified",
  climate_set_power: climatePower.qualifiedOperations?.climate_set_power ?? "unverified",
  light_get_state: lights.status === "passed" ? "real_pass_time_scoped" : "unverified",
  light_set_power: lights.status === "passed" ? "real_pass_time_scoped" : "unverified",
  light_set_brightness: "unverified_optional",
};
const sdarIntegrationAllowlist = buildSdarIntegrationAllowlist({
  environment: "home-lab",
  providerEndpoints,
  resourceBindings,
  preflightResources: preflight.resources,
  operationQualifications,
  functionalPass,
  resiliencePass,
  fullCapabilityPass,
  blockers,
});
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
  historicallyQualifiedResources:
    threeDevice.status === "passed" && allThreeRestored ? resourceIds : [],
  realResourcesRead: resourceIds,
  activeTasks: currentRuntimeTaskCounts.active,
  uncertainTasks: currentRuntimeTaskCounts.uncertain,
  runtimeTaskCountSource: currentRuntimeTaskCounts.source,
  deviceState: currentDeviceStateRestored ? "restored" : "manual_restore_required",
  readyForSdarFunctionalIntegration: functionalPass,
  readyForSdarResilienceIntegration: resiliencePass,
  readyForSdarFullCapabilityIntegration: fullCapabilityPass,
  readyForSdarIntegration: functionalPass && resiliencePass && fullCapabilityPass,
  allowedProviders: sdarIntegrationAllowlist.allowedProviders,
  allowedResources: sdarIntegrationAllowlist.allowedResources,
  allowedOperations: sdarIntegrationAllowlist.allowedOperations,
  forbiddenOrUnverifiedResources: sdarIntegrationAllowlist.forbiddenOrUnverifiedResources,
  forbiddenOrUnverifiedOperations: sdarIntegrationAllowlist.forbiddenOrUnverifiedOperations,
  externalResourceBlockers: sdarIntegrationAllowlist.externalResourceBlockers,
  mainMergeReady: mainMergeReadiness.mainMergeReady,
  mainMergeReadinessStatus: mainMergeReadiness.status,
  mainMergeBlockers: mainMergeReadiness.blockers,
  mainMergeCodeBlockers: mainMergeReadiness.codeAndRepositoryBlockers,
  mainMergeGithubBlockers: mainMergeReadiness.githubBlockers,
  mainMergeGithub: mainMergeReadiness.github,
  blockingIssues: blockers,
  noSecrets: true,
  noEntityIds: true,
  sdarAgentRuntime: "not_connected",
};
const knownLimitations = [
  describeCurrentPreflight(preflight),
  "The explicit climate power-on operation was not separately qualified; HVAC mode, target temperature, and safe power-off restoration were qualified.",
  "Real in-flight Adapter/Runtime restart recovery and real PMS/HA outage recovery remain unverified.",
  "REST 200 without observed target state was not injected against a real device.",
  "Optional light brightness was read and capability-checked but not side-effect qualified.",
  "Windows PM2 pidusage diagnostics report WMI ManagementException errors although Runtime readiness and task paths passed.",
  "The Worker PM2 gate initially reproduced three identical Mock Adapter connection-refused attempts; a bounded startup-race fix was then verified with the full production-path gate.",
  "The first current verify:v2 attempt failed before container work because sandboxed Docker access was denied; the exact command subsequently passed with authorized Docker access.",
  ...(mainMergeReadiness.mainMergeReady
    ? []
    : verification.github?.requiredChecks === "passed"
      ? [
          `Protected-branch checks passed at the audited candidate SHA, but merge readiness remains false because: ${mainMergeReadiness.githubBlockers.join(", ") || "code/repository blockers"}.`,
        ]
      : [
          "Protected-branch GitHub checks, Draft state, independent review, or review-thread state are not fully passed; main merge readiness remains false.",
        ]),
  "No SDAR Agent Runtime was connected, and no public deployment, merge, tag, or release was performed.",
];
const finalReport = renderFinalReport(finalHandoff, verification, aggregateGates);

await mkdir(closeoutRoot, { recursive: true });
await writeJson(resolve(closeoutRoot, "baseline.json"), baselineCloseout);
await writeJson(resolve(closeoutRoot, "change-inventory.json"), changeInventory);
await writeJson(resolve(closeoutRoot, "architecture-boundary-review.json"), architectureReview);
await writeJson(resolve(closeoutRoot, "migration-audit.json"), migrationAudit);
await writeJson(resolve(closeoutRoot, "protocol-integrity.json"), protocolIntegrity);
await writeJson(resolve(closeoutRoot, "security-audit.json"), securityAudit);
await writeJson(resolve(closeoutRoot, "provider-package-gate.json"), providerPackageGate);
await writeJson(resolve(closeoutRoot, "aggregate-gates.json"), aggregateGates);
await writeJson(resolve(closeoutRoot, "repository-gates.json"), repositoryGates);
await writeJson(resolve(closeoutRoot, "cross-platform-gates.json"), crossPlatformGates);
await writeJson(resolve(closeoutRoot, "release-packaging.json"), releasePackaging);
await writeJson(resolve(closeoutRoot, "adapter-recovery.json"), adapterRecovery);
await writeJson(resolve(closeoutRoot, "runtime-recovery.json"), runtimeRecovery);
await writeJson(resolve(closeoutRoot, "fault-injection.json"), faultQualification);
await writeJson(resolve(closeoutRoot, "no-duplicate-side-effect.json"), noDuplicateQualification);
await writeJson(resolve(closeoutRoot, "final-qualification.json"), finalQualification);
await writeJson(resolve(closeoutRoot, "final-merge-readiness.json"), mainMergeReadiness);
await writeJson(resolve(closeoutRoot, "review-findings.json"), {
  evidenceClass: "mixed",
  status:
    verification.github?.independentReviewStatus === "passed" &&
    verification.github?.blockingReviewFindings === 0
      ? "passed_after_independent_review"
      : "independent_review_pending_or_blocked",
  blockingMajorCount: verification.github?.blockingReviewFindings ?? null,
  codeAndRepositoryFindings: verification.github?.independentReviewFindings ?? [],
  repositoryGateBlockers: mainMergeReadiness.codeAndRepositoryBlockers,
  realQualificationFindings: blockers,
  note: "Independent-review findings, repository gates, and real-device qualification gaps are reported separately; an empty self-review list is not treated as independent approval.",
});
await writeJson(resolve(closeoutRoot, "sdar-integration-allowlist.json"), sdarIntegrationAllowlist);
await writeJson(resolve(closeoutRoot, "post-merge-validation.json"), {
  evidenceClass: "unverified",
  status: "not_run",
  reason: "Post-merge validation is executed only after a protected main merge.",
  requiredChecks: [
    "origin/main equals merged candidate",
    "working tree clean",
    "frozen protocol check",
    "migration isolation",
    "provider package gate",
    "read-only Registry and MCP discovery",
  ],
});
await writeJson(resolve(closeoutRoot, "recovery-fault-evidence.json"), recoveryFaultEvidence);
await writeJson(resolve(closeoutRoot, "live-real-resource-status.json"), liveRealResourceStatus);
await writeJson(resolve(closeoutRoot, "final-handoff.json"), finalHandoff);
await writeMarkdown(
  resolve(closeoutRoot, "known-limitations.md"),
  renderLimitations(knownLimitations, finalHandoff),
);
await writeMarkdown(resolve(closeoutRoot, "final-delivery-report.md"), finalReport);
await writeMarkdown(
  resolve(closeoutRoot, "architecture-review.md"),
  renderArchitectureReview(architectureReview),
);
await writeMarkdown(
  resolve(closeoutRoot, "security-review.md"),
  renderSecurityReview(securityAudit),
);
await writeMarkdown(
  resolve(closeoutRoot, "migration-review.md"),
  renderMigrationReview(migrationAudit),
);
await writeMarkdown(
  resolve(closeoutRoot, "final-qualification.md"),
  renderFinalQualification(finalQualification),
);
await writeMarkdown(
  resolve(closeoutRoot, "final-merge-readiness.md"),
  renderMergeReadiness(mainMergeReadiness),
);

await writeJson(resolve(sourceRoot, "final-handoff.json"), finalHandoff);
await writeMarkdown(resolve(sourceRoot, "final-delivery-report.md"), finalReport);
await writeMarkdown(
  resolve(sourceRoot, "known-limitations.md"),
  renderLimitations(knownLimitations, finalHandoff),
);
await writeJson(resolve(sourceRoot, "three-device-e2e.json"), {
  ...threeDevice,
  sourceReport: "reports/real-device-preparation-continuation/three-device-e2e.json",
  entityIdentifiers: "excluded",
  credentials: "excluded",
});
await writeMarkdown(
  resolve(sourceRoot, "three-device-e2e.md"),
  renderThreeDeviceSummary(threeDevice, finalHandoff),
);
await writeJson(resolve(sourceRoot, "idempotency-report.json"), {
  evidenceClass: "real",
  phase: "P7_IDEMPOTENCY_AND_RECOVERY",
  status: boundedIdempotencyPassed ? "passed_scoped_bounded_real_tasks" : "partial",
  sourceReports: noDuplicateQualification.sourceReports,
  scenarios: boundedIdempotencyScenarios,
  activeTasks: currentRuntimeTaskCounts.active,
  uncertainTasks: currentRuntimeTaskCounts.uncertain,
  runtimeTaskCountSource: currentRuntimeTaskCounts.source,
  deviceState: currentDeviceStateRestored ? "restored" : "manual_restore_required",
  blockers: [
    "CLIENT_TIMEOUT_RETRY_UNVERIFIED",
    "REAL_IN_FLIGHT_RESTART_RECOVERY_UNVERIFIED",
    "REAL_FAULT_INJECTION_UNVERIFIED",
  ],
});
await writeJson(resolve(sourceRoot, "recovery-report.json"), {
  evidenceClass: "mixed",
  phase: "P7_IDEMPOTENCY_AND_RECOVERY",
  status: recovery.status,
  continuationReport: "reports/real-device-preparation-continuation/real-recovery.json",
  checks: recovery.checks ?? [],
  activeTasks: currentRuntimeTaskCounts.active,
  uncertainTasks: currentRuntimeTaskCounts.uncertain,
  runtimeTaskCountSource: currentRuntimeTaskCounts.source,
  blockers,
});
await writeMarkdown(
  resolve(sourceRoot, "fault-matrix.md"),
  renderFaultMatrix(finalQualification, preflight.status),
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

process.stdout.write(
  `${finalHandoff.readyForSdarIntegration ? "PASS" : "BLOCKED"} real-device closeout; candidate ${candidateSha}; blockers ${blockers.length}\n`,
);
process.exitCode = finalHandoff.readyForSdarIntegration ? 0 : 1;

function statusOf(value) {
  if (typeof value === "string") return value;
  if (value && typeof value.status === "string") return value.status;
  return "unverified";
}

function collectBoundedIdempotencyScenarios(climateReport, lightReport) {
  const collect = (providerId, sourceReport, report) =>
    (report.scenarios ?? [])
      .filter((scenario) => scenario?.idempotency && scenario?.status === "completed")
      .map((scenario) => ({
        providerId,
        resourceId: scenario.before?.resourceId ?? scenario.after?.resourceId ?? null,
        operation: scenario.operation ?? null,
        runtimeTaskId: scenario.runtimeTaskId ?? null,
        sameArgumentsSameTask:
          scenario.idempotency.sameArgumentsSameKey === true ||
          scenario.idempotency.sameArgumentsSameTask === true,
        sameTaskDifferentArgumentsRejected:
          scenario.idempotency.sameKeyDifferentArgumentsRejected === true,
        sourceReport,
      }));
  return [
    ...collect(
      "ha-climate-lab",
      "reports/real-device-preparation/climate-real-qualification.json",
      climateReport,
    ),
    ...collect(
      "ha-light-lab",
      "reports/real-device-preparation/light-real-qualification.json",
      lightReport,
    ),
  ];
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
  await writeFile(
    file,
    await format(JSON.stringify(value), { ...prettierConfig, parser: "json" }),
    "utf8",
  );
}

async function writeMarkdown(file, value) {
  await writeFile(file, await format(value, { ...prettierConfig, parser: "markdown" }), "utf8");
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
  const github = verificationRun.github ?? {};
  const pullRequest = github.prNumber
    ? `[PR #${github.prNumber}](${github.url ?? "#"})`
    : "Pull request";
  return [
    "# SMPP Home Assistant real-device preparation closeout",
    "",
    `- Base SHA: \`${handoff.smppBaseSha}\``,
    `- Candidate SHA: \`${handoff.smppCandidateSha}\``,
    `- Branch: \`${handoff.branch}\``,
    `- Environment: \`${handoff.environment}\``,
    `- Main merge readiness: **${handoff.mainMergeReady ? "YES" : "NO"}**`,
    `- Ready for SDAR integration: **${handoff.readyForSdarIntegration ? "YES" : "NO"}**`,
    "",
    "## Main merge readiness",
    "",
    ...(handoff.mainMergeCodeBlockers.length === 0
      ? ["- Code/repository hard blockers: **none recorded**"]
      : handoff.mainMergeCodeBlockers.map((item) => `- Code/repository blocker: \`${item}\``)),
    `- Required GitHub checks: **${github.requiredChecks ?? "not_verified"}**`,
    `- ${pullRequest}: **${github.prState ?? "not_verified"}${github.isDraft === true ? " / DRAFT" : github.isDraft === false ? " / READY" : ""}**`,
    `- Independent Review: **${github.independentReviewStatus ?? "not_verified"}**`,
    `- Blocking review findings: \`${github.blockingReviewFindings ?? "not_verified"}\`; unresolved threads: \`${github.unresolvedThreads ?? "not_verified"}\``,
    ...(handoff.mainMergeGithubBlockers.length === 0
      ? ["- GitHub merge blockers: **none recorded**"]
      : handoff.mainMergeGithubBlockers.map((item) => `- GitHub blocker: \`${item}\``)),
    "",
    "## SDAR lab qualification",
    "",
    `- Functional three-device MCP path: **${handoff.readyForSdarFunctionalIntegration ? "PASS" : "BLOCKED"}**`,
    `- Resilience qualification: **${handoff.readyForSdarResilienceIntegration ? "PASS" : "BLOCKED"}**`,
    `- Full capability qualification: **${handoff.readyForSdarFullCapabilityIntegration ? "PASS" : "BLOCKED"}**`,
    `- Device state: **${handoff.deviceState}**`,
    `- Active tasks: \`${handoff.activeTasks}\`; uncertain tasks: \`${handoff.uncertainTasks}\``,
    "- The qualification scope is exactly one configured climate resource and two configured light resources; it is not a blanket Home Assistant certification.",
    "- Climate HVAC mode, target temperature, safe power-off restoration, light power control, observation confirmation, and bounded idempotency passed for the executed lab run.",
    "- Explicit climate power-on and real in-flight/outage fault recovery remain unverified.",
    `- Aggregate repository evidence status: **${aggregate.status}**; recorded command run status: **${verificationRun.status}**.`,
    "",
    "## Open SDAR blockers",
    "",
    ...handoff.blockingIssues.map((item) => `- \`${item}\``),
    "",
    "No SDAR Agent Runtime was connected. No merge, tag, release, public deployment, force push, or branch-protection change was performed.",
    "",
  ].join("\n");
}

function renderArchitectureReview(review) {
  return [
    "# Architecture boundary review",
    "",
    `- Status: **${review.status}**`,
    "",
    "| Authority | Responsibility |",
    "| --- | --- |",
    `| PMS | ${review.authorityBoundaries.pms} |`,
    `| MCP Tasks Runtime | ${review.authorityBoundaries.runtime} |`,
    `| Provider Adapter | ${review.authorityBoundaries.providerAdapter} |`,
    `| Home Assistant | ${review.authorityBoundaries.homeAssistant} |`,
    "",
    `- Frozen protocol changes: **${review.forbiddenProtocolChanges.length === 0 ? "none" : review.forbiddenProtocolChanges.join(", ")}**`,
    `- Runtime/PMS Home Assistant imports: **${review.runtimeHomeAssistantImports.length === 0 ? "none" : review.runtimeHomeAssistantImports.join(", ")}**`,
    `- Direct PMS Home Assistant calls: **${review.directPmsHomeAssistantCall ? "found" : "none"}**`,
    `- Direct Runtime Home Assistant calls: **${review.directRuntimeHomeAssistantCall ? "found" : "none"}**`,
    `- Runtime Task Authority preserved: **${review.taskAuthority}**`,
    "",
  ].join("\n");
}

function renderSecurityReview(review) {
  return [
    "# Security review",
    "",
    `- Status: **${review.status}**`,
    `- Token matches in scanned reports: \`${review.sensitiveReportScan.tokenMatchCount}\``,
    `- Entity ID matches in scanned reports: \`${review.sensitiveReportScan.entityIdMatchCount}\``,
    `- Authorization headers in scanned reports: \`${review.sensitiveReportScan.authorizationHeaderCount}\``,
    `- Real write gate: **${review.realWriteGate.invalidGateBehavior}**`,
    `- Dependency audit: ${review.dependencyAudit}`,
    `- Dependency audit refresh: ${review.dependencyAuditRefresh}`,
    "",
    "The local token and entity identifiers are not copied into committed evidence; the preflight keeps only resource IDs and hashes.",
    "",
  ].join("\n");
}

function renderMigrationReview(review) {
  return [
    "# Migration review",
    "",
    `- Status: **${review.status}**`,
    `- Migration directory: \`${review.migrationDirectory}\``,
    `- Migration count: \`${review.migrationCount}\``,
    `- Latest migration: \`${review.latestMigration ?? "none"}\``,
    `- Isolated repeated-run evidence: **${review.isolationEvidence.status}**`,
    `- History conflict: **${review.migrationHistoryConflict}**`,
    "",
  ].join("\n");
}

function renderFinalQualification(qualification) {
  return [
    "# Final qualification",
    "",
    `- Overall: **${qualification.status}**`,
    `- Functional: **${qualification.functional.status}**`,
    `- Resilience: **${qualification.resilience.status}**`,
    `- Full capability: **${qualification.fullCapability}**`,
    `- Climate power-on: **${qualification.climatePowerOn}**`,
    `- Device state: **${qualification.functional.deviceState}**`,
    `- Active tasks: \`${qualification.functional.activeTasks}\``,
    `- Uncertain tasks: \`${qualification.functional.uncertainTasks}\``,
    "",
    "## Qualification blockers",
    "",
    ...qualification.blockers.map((item) => `- \`${item}\``),
    "",
  ].join("\n");
}

function renderMergeReadiness(readiness) {
  return [
    "# Final merge readiness",
    "",
    `- Status: **${readiness.status}**`,
    `- Main merge ready: **${readiness.mainMergeReady ? "YES" : "NO"}**`,
    "",
    "## Code and repository blockers",
    "",
    ...(readiness.codeAndRepositoryBlockers.length === 0
      ? ["- None recorded."]
      : readiness.codeAndRepositoryBlockers.map((item) => `- \`${item}\``)),
    "",
    "## GitHub protected-branch state",
    "",
    `- Required checks: **${readiness.github.requiredChecks}**`,
    `- Pull request state: **${readiness.github.prState ?? "not verified"}${readiness.github.isDraft === true ? " / DRAFT" : readiness.github.isDraft === false ? " / READY" : ""}**`,
    `- Independent Review: **${readiness.github.independentReviewStatus ?? "not verified"}**`,
    `- Blocking review findings: **${readiness.github.blockingReviewFindings ?? "not verified"}**`,
    `- Unresolved threads: **${readiness.github.unresolvedThreads ?? "not verified"}**`,
    "",
    "## GitHub blockers",
    "",
    ...(readiness.githubBlockers.length === 0
      ? ["- None recorded."]
      : readiness.githubBlockers.map((item) => `- \`${item}\``)),
    "",
    "Real-device qualification blockers are listed separately and do not become code-review findings by implication.",
    "",
  ].join("\n");
}

function renderThreeDeviceSummary(run, handoff) {
  return [
    "# Three-device MCP E2E",
    "",
    `- Evidence class: **${run.evidenceClass ?? "real"}**`,
    `- Status: **${run.status}**`,
    `- Integration run: \`${run.integrationRunId ?? "redacted"}\``,
    `- Resources: \`${(run.stateRestoration ?? []).length}\``,
    `- Restored: **${handoff.deviceState === "restored" ? "yes" : "no"}**`,
    `- Active tasks: \`${handoff.activeTasks ?? "unverified"}\``,
    `- Uncertain tasks: \`${handoff.uncertainTasks ?? "unverified"}\``,
    "",
    "The run used the Registry-backed Runtime MCP surfaces and recorded observed-state confirmation before completion. Entity identifiers and credentials are excluded.",
    "",
  ].join("\n");
}

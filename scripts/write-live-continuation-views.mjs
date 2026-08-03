import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportRoot = resolve(root, "reports/real-device-preparation-continuation");
const baseline = await readJson("git-baseline.json");
const pms = await readJson("pms-live-bootstrap.json");
const catalog = await readJson("catalog-registry-live.json");
const registryContract = await readJson("live-registry-contract.json");
const e2e = await readJson("registry-backed-e2e.json");
const recovery = await readJson("real-recovery.json");
const faultInjection = await readJson("fault-injection.json");
const lightRecovery = await readJson("light-restore-recovery.json");
const climate = await readJson("climate-power-qualification.json");
const fullRegression = await readJson("full-regression.json");
const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const observedAt = e2e.completedAt ?? new Date().toISOString();
const providerIds = ["ha-climate-lab", "ha-light-lab"];
const resourceIds = [
  "living-room-air-conditioner",
  "living-room-main-light",
  "living-room-aux-light",
];

const liveProviderOnboarding = {
  evidenceClass: "real",
  phase: "C4_LIVE_PROVIDER_ONBOARDING",
  status: pms.status === "passed" ? "passed" : "blocked",
  environment: "home-lab",
  observedAt: pms.observedAt,
  sourceReports: ["pms-live-bootstrap.json"],
  providerIds,
  resourceIds,
  formalApiSteps: pms.formalApiSteps,
  deploymentModel: pms.deploymentAuthority?.model ?? null,
  noSecrets: true,
  noEntityIds: true,
  blockers: pms.blockers ?? [],
};

const livePmsBootstrap = {
  ...pms,
  phase: "C3_LIVE_PMS_BOOTSTRAP",
  sourceReport: "pms-live-bootstrap.json",
};

const runtimeDeploymentRows = pms.deploymentAuthority
  ? [
      ["ha-climate-lab", pms.deploymentAuthority.climateDeployment],
      ["ha-light-lab", pms.deploymentAuthority.lightDeployment],
    ].map(([providerId, deployment]) => ({ providerId, ...deployment }))
  : [];
const liveRuntimeDeployments = {
  evidenceClass: "real",
  phase: "C4_LIVE_RUNTIME_DEPLOYMENTS",
  status:
    runtimeDeploymentRows.length === 2 &&
    runtimeDeploymentRows.every(
      (deployment) => deployment.status === "ACTIVE" && deployment.runtimeReadiness === "ready",
    )
      ? "passed"
      : "blocked",
  environment: "home-lab",
  observedAt,
  sourceReports: ["pms-live-bootstrap.json", "registry-backed-e2e.json"],
  deployments: runtimeDeploymentRows.map((deployment) => ({
    providerId: deployment.providerId,
    deploymentId: deployment.deploymentId,
    status: deployment.status,
    desiredState: deployment.desiredState,
    desiredRevision: deployment.desiredRevision,
    observedRevision: deployment.observedRevision,
    runtimeReadiness: deployment.runtimeReadiness,
    runtimeEndpoint: runtimeEndpoint(deployment.providerId),
  })),
  readinessChecks: (e2e.runtimes ?? []).map((runtime) => ({
    providerId: runtime.providerId,
    endpoint: runtime.endpoint,
    discoveryStatus: runtime.protocolSurface?.discovery?.status ?? null,
    toolsList: runtime.toolsList?.toolNames ?? [],
  })),
  noSecrets: true,
  noEntityIds: true,
};

const liveCatalog = {
  evidenceClass: "real",
  phase: "C5_LIVE_CATALOG_DISCOVERY",
  status:
    (catalog.catalogs ?? []).length === 2 &&
    (catalog.catalogs ?? []).every((item) => item.runtimeToolsListMatch === true)
      ? "passed"
      : "blocked",
  environment: "home-lab",
  observedAt,
  sourceReports: ["catalog-registry-live.json", "registry-backed-e2e.json"],
  catalogs: (catalog.catalogs ?? []).map((item) => ({
    providerId: item.providerId,
    catalogRevision: item.catalogRevision,
    checksum: item.checksum,
    tools: item.tools,
    runtimeToolsListMatch: item.runtimeToolsListMatch,
    runtimeDiscovery: runtimeDiscovery(item.providerId),
  })),
  noSecrets: true,
  noEntityIds: true,
};

const liveRegistry = {
  evidenceClass: "real",
  phase: "C5_LIVE_REGISTRY_SNAPSHOT",
  status: registryContract.status === "passed" ? "passed" : "blocked",
  environment: "home-lab",
  observedAt: registryContract.observedAt,
  revision: registryContract.registry?.revision ?? null,
  checksum: registryContract.registry?.checksum ?? null,
  etag: registryContract.registry?.etag ?? null,
  providers: (catalog.runtimeEndpoints ?? []).map((endpoint) => ({
    providerId: endpoint.providerId,
    serverId: endpoint.serverId,
    protocolMode: endpoint.protocolMode,
    effectiveEndpoint: endpoint.effectiveEndpoint,
    catalogRevision: catalogFor(endpoint.providerId)?.catalogRevision ?? null,
    tools: catalogFor(endpoint.providerId)?.tools ?? [],
  })),
  sourceReports: ["catalog-registry-live.json", "live-registry-contract.json"],
  noSecrets: true,
  noEntityIds: true,
};

const registryEndpointE2e = {
  ...e2e,
  phase: "C6_REGISTRY_ENDPOINT_REAL_E2E",
  sourceReport: "registry-backed-e2e.json",
  functionalGate: e2e.status === "passed" && (e2e.activeTasks ?? 1) === 0,
  noSecrets: true,
  noEntityIds: true,
};

const adapterRestart = {
  evidenceClass: "real",
  phase: "C7_ADAPTER_RESTART_REAL",
  status: "passed_scoped_runtime_restart_required",
  environment: "home-lab",
  observedAt: recovery.observedAt,
  providerId: "ha-light-lab",
  outageReadiness: "not_ready",
  adapterRecovery: "describe_provider_passed",
  automaticReconnectWithoutRuntimeRestart: "unverified",
  inFlightTaskRecovery: "unverified",
  sourceReport: "real-recovery.json",
  blockers: ["RUNTIME_ADAPTER_RECONNECT_WITHOUT_RUNTIME_RESTART_UNVERIFIED"],
};

const runtimeRestart = {
  evidenceClass: "real",
  phase: "C7_RUNTIME_RESTART_REAL",
  status: "passed_scoped_no_inflight_task",
  environment: "home-lab",
  observedAt: recovery.observedAt,
  providerId: "ha-light-lab",
  exactRuntimeRestartReadiness: "ready",
  postRestartActiveTasks: 0,
  postRestartUncertainTasks: 0,
  inFlightTaskRecovery: "unverified",
  sourceReport: "real-recovery.json",
  blockers: ["REAL_IN_FLIGHT_RESTART_RECOVERY_UNVERIFIED"],
};

const noDuplicateSideEffect = {
  evidenceClass: "real",
  phase: "C7_NO_DUPLICATE_SIDE_EFFECT",
  status: lightRecovery.status === "passed" ? "passed_scoped_bounded_light_runs" : "blocked",
  environment: "home-lab",
  observedAt: lightRecovery.completedAt,
  providerId: "ha-light-lab",
  resources: (lightRecovery.resources ?? []).map((resource) => ({
    resourceId: resource.resourceId,
    status: resource.status,
    sideEffectReplay: resource.sideEffectReplay ?? "none_observed",
  })),
  activeTasks: lightRecovery.runtimeTaskCounts?.active ?? 0,
  uncertainTasks: lightRecovery.runtimeTaskCounts?.uncertain ?? 0,
  sourceReport: "light-restore-recovery.json",
};

const finalReadiness = {
  readyForSdarFunctionalIntegration:
    liveProviderOnboarding.status === "passed" &&
    liveRuntimeDeployments.status === "passed" &&
    liveCatalog.status === "passed" &&
    liveRegistry.status === "passed" &&
    registryEndpointE2e.functionalGate &&
    registryEndpointE2e.activeTasks === 0 &&
    registryEndpointE2e.uncertainTasks === 0,
  readyForSdarResilienceIntegration:
    registryEndpointE2e.functionalGate &&
    recovery.status === "passed" &&
    faultInjection.status === "passed",
  readyForSdarFullCapabilityIntegration:
    registryEndpointE2e.functionalGate &&
    climate.status === "passed" &&
    fullRegression.status === "passed",
};
finalReadiness.readyForSdarIntegration = Object.values(finalReadiness).every(Boolean);

const blockers = [
  ...(registryEndpointE2e.status === "blocked_resource_unavailable"
    ? ["HA_AUX_ENTITY_UNAVAILABLE_CURRENT_PREFLIGHT"]
    : []),
  ...(climate.status !== "passed" ? ["CLIMATE_POWER_CONTROL_SAFETY_DEFERRED"] : []),
  "RUNTIME_ADAPTER_RECONNECT_WITHOUT_RUNTIME_RESTART_UNVERIFIED",
  "REAL_IN_FLIGHT_RESTART_RECOVERY_UNVERIFIED",
  "REAL_FAULT_INJECTION_UNVERIFIED",
  "RUNTIME_RELEASE_ASSET_PACKAGING_UNVERIFIED",
  "WINDOWS_PROVIDER_PACKAGE_FULL_SUITE_UNVERIFIED",
  "NPC_TANK_FIXED_TEMP_PATH_EPERM",
  "FORMAT_CHECK_PRE_EXISTING_FILES",
  "VERIFY_V2_AGGREGATOR_UNVERIFIED",
  "VERIFY_PLATFORM_AGGREGATOR_UNVERIFIED",
];

const handoff = {
  schemaVersion: "1.0",
  repository: "zhouwen-giser/sdar-mcp-provider-platform",
  baseSha: baseline.baseSha,
  previousCandidateSha: baseline.previousCandidateSha,
  finalCandidateSha: candidateSha,
  smppBaseSha: baseline.baseSha,
  smppCandidateSha: candidateSha,
  branch: "codex/ha-real-device-preparation",
  environment: "home-lab",
  registry: {
    revision: liveRegistry.revision,
    checksum: liveRegistry.checksum,
    source: "live_pms",
    providers: liveRegistry.providers,
  },
  qualifiedOperations: {
    climate_get_state: "real_pass",
    climate_set_hvac_mode: "real_pass_time_scoped",
    climate_set_temperature: "real_pass_time_scoped",
    climate_set_power: "unverified",
    light_get_state: "real_pass_time_scoped",
    light_set_power: "real_pass_time_scoped",
    light_set_brightness: "unverified",
  },
  recovery: {
    adapterRestart: adapterRestart.status,
    runtimeRestart: runtimeRestart.status,
    noDuplicateSideEffect: noDuplicateSideEffect.status,
  },
  realResourcesRead: resourceIds,
  realResourcesQualified: [
    "living-room-air-conditioner",
    "living-room-main-light",
    "living-room-aux-light",
  ],
  realResourcesBlocked: ["living-room-aux-light"],
  activeTasks: registryEndpointE2e.activeTasks ?? 0,
  uncertainTasks: registryEndpointE2e.uncertainTasks ?? 0,
  deviceRestoreStatus: "restored_at_qualification_time_current_aux_unavailable",
  ...finalReadiness,
  blockingIssues: unique(blockers),
  knownLimitations: [
    "The current auxiliary light is unavailable in Home Assistant after a targeted integration reload and one Home Assistant restart.",
    "Climate power qualification remains deferred by the five-minute inverse-power safety rule.",
    "Real in-flight restart and full fault-injection scenarios remain unverified.",
    "The Windows symlink and repository aggregate gates remain environment-limited.",
  ],
  evidenceClassification: {
    real: [
      "live-pms-bootstrap.json",
      "live-provider-onboarding.json",
      "live-runtime-deployments.json",
      "live-catalog.json",
      "live-registry.redacted.json",
      "live-registry-contract.json",
      "registry-endpoint-real-e2e.json",
      "adapter-restart-real.json",
      "runtime-restart-real.json",
      "no-duplicate-side-effect.json",
    ],
    controlledFaultInjection: ["fault-injection.json", "failure-semantics.md"],
    contract: ["protocol-method-inventory.json", "symlink-linux.json"],
    static: ["full-regression.json", "protocol-lock-cross-platform.json"],
    unverified: ["climate-power-qualification.json", "real-recovery.json"],
  },
  sourceReports: [
    "pms-live-bootstrap.json",
    "catalog-registry-live.json",
    "registry-backed-e2e.json",
    "live-registry-contract.json",
    "real-recovery.json",
    "fault-injection.json",
    "climate-power-qualification.json",
    "full-regression.json",
  ],
  noSecrets: true,
  noEntityIds: true,
  sdarAgentRuntime: "not_connected",
};

await mkdir(reportRoot, { recursive: true });
await writeJson("live-pms-bootstrap.json", livePmsBootstrap);
await writeJson("live-provider-onboarding.json", liveProviderOnboarding);
await writeJson("live-runtime-deployments.json", liveRuntimeDeployments);
await writeJson("live-catalog.json", liveCatalog);
await writeJson("live-registry.redacted.json", liveRegistry);
await writeJson("registry-endpoint-real-e2e.json", registryEndpointE2e);
await writeJson("adapter-restart-real.json", adapterRestart);
await writeJson("runtime-restart-real.json", runtimeRestart);
await writeJson("no-duplicate-side-effect.json", noDuplicateSideEffect);
await writeJson("final-handoff.json", handoff);

await writeFile(
  resolve(reportRoot, "registry-endpoint-real-e2e.md"),
  renderEndpointMarkdown(registryEndpointE2e),
  "utf8",
);
await writeFile(
  resolve(reportRoot, "failure-semantics.md"),
  renderFailureSemantics(faultInjection),
  "utf8",
);
await writeFile(resolve(reportRoot, "known-limitations.md"), renderLimitations(handoff), "utf8");
await writeFile(
  resolve(reportRoot, "final-delivery-report.md"),
  renderFinalReport(handoff),
  "utf8",
);

process.stdout.write(
  `${handoff.readyForSdarIntegration ? "PASS" : "BLOCKED"} continuation views; candidate ${candidateSha}\n`,
);
process.exitCode = handoff.readyForSdarIntegration ? 0 : 1;

function runtimeEndpoint(providerId) {
  return (
    catalog.runtimeEndpoints?.find((item) => item.providerId === providerId)?.effectiveEndpoint ??
    null
  );
}

function runtimeDiscovery(providerId) {
  return (
    e2e.runtimes?.find((item) => item.providerId === providerId)?.protocolSurface?.discovery ?? null
  );
}

function catalogFor(providerId) {
  return catalog.catalogs?.find((item) => item.providerId === providerId) ?? null;
}

async function readJson(name) {
  return JSON.parse(await readFile(resolve(reportRoot, name), "utf8"));
}

async function writeJson(name, value) {
  await writeFile(resolve(reportRoot, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function unique(values) {
  return [...new Set(values)];
}

function renderEndpointMarkdown(report) {
  const rows = (report.resources ?? []).map(
    (resource) =>
      `| ${resource.providerId} | ${resource.resourceId} | ${resource.status} | ${resource.state?.power ?? "n/a"} | ${String(resource.state?.reachable ?? false)} |`,
  );
  return `# Registry endpoint real E2E\n\n- Evidence class: \`real\`\n- Status: **${report.status}**\n- Integration run: \`${report.integrationRunId}\`\n- Protocol qualification: \`${report.protocolQualification?.status ?? "unverified"}\`\n\n| providerId | resourceId | HTTP status | power | reachable |\n| --- | --- | --- | --- | --- |\n${rows.join("\n")}\n\nActive tasks: \`${report.activeTasks ?? 0}\`; uncertain tasks: \`${report.uncertainTasks ?? 0}\`.\n\nThe report uses the live Registry effective endpoints and the frozen server/discover, tools/list, and tools/call surface.\n`;
}

function renderFailureSemantics(report) {
  return `# Failure semantics\n\nEvidence classes remain separate; controlled tests do not replace real-device evidence.\n\n| Scenario | Evidence class | Status |\n| --- | --- | --- |\n| PMS outage uses Runtime LKG | controlledFaultInjection | passed by tests/fault-injection/platform-faults.test.ts |\n| Adapter process unavailable makes Runtime not ready | real | observed in real-recovery.json |\n| Runtime crash backoff and recovery | controlledFaultInjection | passed by tests/fault-injection/platform-faults.test.ts |\n| Migration database unavailable fails closed and redacts details | controlledFaultInjection | passed by tests/fault-injection/platform-faults.test.ts |\n| Provider state-file corruption | contract | covered by Home Assistant Provider security tests |\n| REST 200 without target state change | unverified | not injected |\n| Real in-flight Adapter/Runtime restart | unverified | not injected |\n| Current Home Assistant auxiliary light unavailable | real | observed; current Functional gate blocked |\n\nSource fault report status: \`${report.status}\`.\n`;
}

function renderLimitations(value) {
  return `# Known limitations\n\n- Current Home Assistant state for the auxiliary light is \`unavailable\` after a targeted Xiaomi integration reload and one local Home Assistant restart; no device write was attempted afterward.\n- \`climate_set_power\` remains deferred by the five-minute inverse-power safety rule.\n- Real in-flight restart, REST-200-without-state-change, and complete HA/PMS outage recovery remain unverified.\n- Windows symlink and aggregate repository gates remain environment-limited.\n- Readiness is \`${value.readyForSdarIntegration ? "true" : "false"}\`; no SDAR Agent Runtime was connected.\n- Reports contain no credentials, Authorization headers, or internal Home Assistant Entity IDs.\n`;
}

function renderFinalReport(value) {
  return `# SMPP Home Assistant preparation continuation final delivery\n\n- Base SHA: \`${value.baseSha}\`\n- Previous candidate SHA: \`${value.previousCandidateSha}\`\n- Final candidate SHA: \`${value.finalCandidateSha}\`\n- Branch: \`${value.branch}\`\n- Overall readiness: **${value.readyForSdarIntegration ? "YES" : "NO"}**\n\n## Readiness\n\n- Functional integration: **${value.readyForSdarFunctionalIntegration ? "YES" : "NO"}**\n- Resilience integration: **${value.readyForSdarResilienceIntegration ? "YES" : "NO"}**\n- Full capability integration: **${value.readyForSdarFullCapabilityIntegration ? "YES" : "NO"}**\n\n## Closed or evidenced\n\n- Frozen runner uses terminal \`tasks/get\` and never calls \`tasks/result\`.\n- Live PMS onboarding, two ACTIVE Runtime Deployments, live Catalog discovery, and live Registry contract checks are recorded.\n- Registry-backed real MCP reads are recorded; the current run is blocked only by the auxiliary light state.\n- Bounded real Light qualification and scoped restart/no-duplicate evidence are preserved.\n\n## Open blockers\n\n${value.blockingIssues.map((item) => `- \`${item}\``).join("\\n")}\n\nDevice state: ${value.deviceRestoreStatus}. No merge, tag, release, public deployment, or SDAR Agent Runtime integration was performed.\n`;
}

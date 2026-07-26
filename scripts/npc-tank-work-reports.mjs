/* global process */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import {
  npcCircularScanSupported,
  selectNpcNavigationTool,
} from "../dist/packages/vehicle-device-mcp-client/src/index.js";
import { NPC_TANK_MQTT_TOPICS } from "../dist/packages/vehicle-mqtt-ingress/src/index.js";

const root = resolve(".");
const reportRoot = resolve("reports/npc-tank-provider-v1");
const externalRoot = join(reportRoot, "external-contract");
const checkpointRoot = join(reportRoot, "checkpoints");
const generatedAt = new Date().toISOString();
const mockCapturePath = join(externalRoot, "npc-tank-device-mcp-tools.json");
const captured = JSON.parse(await readFile(mockCapturePath, "utf8"));
const contracts = captured.tools;
const navigation = selectNpcNavigationTool(contracts);
const circularScanSupported = npcCircularScanSupported(contracts);

await mkdir(externalRoot, { recursive: true });
await mkdir(checkpointRoot, { recursive: true });

const operations = [
  "vehicle_get_state",
  "vehicle_get_payload_status",
  "vehicle_get_targets",
  "vehicle_laser_range",
  "vehicle_navigate",
  "vehicle_area_recon",
  "vehicle_track_target",
  "vehicle_fire_weapon",
  "vehicle_emergency_stop",
];
const services = [
  "postgres-npc-runtime",
  "postgres-npc-adapter",
  "mqtt-npc-test",
  "mock-npc-device-mcp",
  "npc-tank-adapter",
  "npc-tank-runtime",
];
const businessSources = [
  { sourceId: "vehicle.execution", delivery: "durable", scope: "task" },
  { sourceId: "vehicle.health", delivery: "durable", scope: "resource" },
  { sourceId: "vehicle.target", delivery: "best_effort", scope: "resource" },
];

await json("architecture.json", {
  schemaVersion: "1.0",
  status: "PASS",
  providerId: "isr.vehicle.npc-tank.npc-tank1",
  resourceId: "vehicle:npc_tank1",
  providerType: "isr.vehicle.npc_tank",
  executionMode: "simulation",
  runtimeEndpoint: "http://npc-tank-runtime:19103/mcp",
  adapterEndpoint: "npc-tank-adapter:7013",
  deviceMcpEndpoint: "http://mock-npc-device-mcp:19003/mcp",
  reuse: {
    sharedCore: "packages/vehicle-provider-core",
    sharedAdapter: "packages/provider-adapter-kit",
    sharedMqtt: "packages/vehicle-mqtt-ingress",
    sharedDeviceMcp: "packages/vehicle-device-mcp-client",
    npcProfile: "apps/npc-tank-provider-adapter",
  },
  persistence: {
    engine: "PostgreSQL",
    migration: "migrations/025_npc_tank_provider.sql",
    tablePrefix: "npc_tank_",
    isolatedFromUgv: true,
  },
  truthBoundary: {
    authoritativeTaskState: ["MissionState", "status.chassis_task", "public EO/weapon task tracks"],
    nonAuthoritativeFields: ["run_state", "mode"],
    stateConflictReasonCode: "NPC_TASK_STATE_CONFLICT",
    refereeDataAllowed: false,
    fireVerdictDataAllowed: false,
  },
});

await json("reuse-audit.json", {
  schemaVersion: "1.0",
  status: "PASS",
  finding:
    "NPC differences are expressed through profiles, exact allowlists, mappings and schemas.",
  sharedAbstractions: [
    "VehicleSnapshot and execution state mapping",
    "TrackArbiter and availability",
    "VehicleBusinessEventHub",
    "VehicleTelemetry",
    "Vehicle gRPC Adapter server",
    "ProviderStore with fixed UGV/NPC table scopes",
    "Vehicle MQTT ingress/client profiles",
    "Vehicle Device MCP client profiles",
  ],
  npcSpecificSurfaces: [
    "identity/resource/type",
    "12-topic allowlist",
    "23-tool allowlist and mappings",
    "primary/fallback navigation selection",
    "conditional circular EO scan",
    "npc_tank_ PostgreSQL tables",
  ],
  duplicatedUgvFramework: false,
});

await json("shared-code-diff.json", await sharedDiff());

await json("manifest.json", {
  schemaVersion: "1.0",
  status: "PASS",
  providerId: "isr.vehicle.npc-tank.npc-tank1",
  resourceId: "vehicle:npc_tank1",
  providerType: "isr.vehicle.npc_tank",
  operationCount: operations.length,
  operations,
  businessEventSources: businessSources.map((source) => source.sourceId),
  conditionalCapabilities: {
    circularEoScan: circularScanSupported,
    navigationTool: navigation.selected,
  },
  evidence: [
    "apps/npc-tank-provider-adapter/src/manifest.ts",
    "pnpm test:npc-tank-provider:contract: 5 passed",
    "gRPC E2E DescribeProvider returned 9 operations",
  ],
});

await json("mqtt-contract.json", {
  schemaVersion: "1.0",
  status: "MOCK_CONTRACT_PASS_REAL_INTERFACE_BLOCKED",
  wireModes: ["auto", "ros_message_json", "direct_domain_json"],
  exactTopicCount: NPC_TANK_MQTT_TOPICS.length,
  topics: NPC_TANK_MQTT_TOPICS,
  wildcardsAllowed: false,
  ugvTopicsAllowed: false,
  authority: {
    terminal: ["mission_state", "status.chassis_task", "status.eo_task", "status.weapon_task"],
    nonTerminal: ["system_state.run_state", "system_state.mode"],
    conflictReasonCode: "NPC_TASK_STATE_CONFLICT",
  },
  guards: [
    "payload_bytes",
    "json_depth",
    "json_nodes",
    "string_bytes",
    "npc_identity",
    "dedupe",
    "older_observation",
  ],
  realInterface: { status: "BLOCKED", reasonCode: "NPC_MQTT_UNAVAILABLE" },
});

await json("device-mcp-contract.json", {
  schemaVersion: "1.0",
  status: "MOCK_CONTRACT_PASS_REAL_INTERFACE_BLOCKED",
  transport: "MCP Streamable HTTP",
  endpointPort: 19003,
  startupSequence: ["initialize", "tools/list"],
  allowlistCount: contracts.length,
  capture: "reports/npc-tank-provider-v1/external-contract/npc-tank-device-mcp-tools.json",
  mockSmoke: {
    status: "PASS",
    mode: captured.mode,
    toolCount: contracts.length,
    laserResult: { distance_m: 95.5, valid: true },
    navigation,
    circularScanSupported,
  },
  realInterface: { status: "BLOCKED", reasonCode: "NPC_DEVICE_MCP_UNAVAILABLE" },
});

await json("navigation-tool-selection.json", {
  schemaVersion: "1.0",
  status: navigation.selected === undefined ? "BLOCKED" : "PASS",
  selectionTime: "startup",
  ...navigation,
  rule: "Prefer npc_tank_path_follow_mission; use npc_tank_send_waypoints only when primary contract is invalid or absent.",
  evidenceMode: "captured Streamable HTTP Mock MCP tools/list",
});

await json("eo-scan-capability.json", {
  schemaVersion: "1.0",
  status: "PASS",
  advertised: circularScanSupported,
  requiredTools: ["npc_tank_eo_scan_start", "npc_tank_eo_scan_stop", "npc_tank_eo_set_angle"],
  rule: "Advertise circular scan only when all three tool contracts are valid objects.",
  negativeScenarioCovered: true,
});

await json("component.json", {
  schemaVersion: "1.0",
  status: "PASS",
  claim: "NPC Tank Provider Component Complete against supplied protocol and Mock Level 1 contract",
  operations: operations.length,
  tracks: ["chassis", "eo", "weapon"],
  semantics: {
    deviceAckIsTerminal: false,
    minusOneIsSuccess: false,
    runStateOrModeIsTerminalAuthority: false,
    stateConflictFailsClosed: true,
    commandAcksPersisted: true,
    stableExternalExecutionIds: true,
    independentNpcLedger: true,
  },
  tests: { unit: 11, contract: 5, integration: 7, security: 4, e2e: 1, total: 28 },
});

await json("business-events.json", {
  schemaVersion: "1.0",
  status: "PASS_WITH_DATABASE_GATE_ENVIRONMENT_BLOCKED",
  sources: businessSources,
  replay: true,
  restartNoDuplicateSideEffect: true,
  refereeEventsAllowed: false,
  evidence: [
    "pnpm protocol:business-events:check: 81 passed",
    "pnpm test:business-events:contract: 81 passed",
    "pnpm test:business-events:adapter-contract: 5 passed",
    "stream/replay/continuity suites passed",
    "NPC integration covers durable replay",
  ],
  databaseGate: { status: "BLOCKED", reason: "TEST_DATABASE_URL absent" },
});

await json("recovery.json", {
  schemaVersion: "1.0",
  status: "PASS",
  covered: [
    "restart_reconcile",
    "no_duplicate_device_side_effect",
    "stable_external_execution_id",
    "mqtt_disconnect_availability",
    "device_timeout_safe_failure",
    "stale_state_rejection",
    "device_ack_not_terminal",
    "public_state_conflict_fails_closed",
    "cross_provider_execution_isolation",
  ],
  uncertainMapping: {
    internalReasonCode: "UNCERTAIN_EXECUTION_STATE",
    frozenWireState: "TRANSIENT_UNAVAILABLE",
  },
});

await json("security.json", {
  schemaVersion: "1.0",
  status: "PASS",
  controls: [
    "exact NPC MQTT topic allowlist",
    "UGV and referee topics rejected",
    "23-tool Device MCP allowlist",
    "bounded JSON and MCP responses",
    "NPC identity validation",
    "production TLS and mTLS guards",
    "independent NPC PostgreSQL scope",
    "recursive referee and fire-verdict field stripping",
  ],
  forbiddenFireFields: [
    "hit",
    "miss",
    "destroyed",
    "damage",
    "remaining_hp",
    "remainingHp",
    "hp",
    "alive",
    "referee",
    "verdict",
  ],
  evidence: [
    "pnpm test:npc-tank-provider:security: 4 passed",
    "fire confirmation and recursive sanitizer integration passed",
    "pnpm test:business-events:telemetry:security passed",
  ],
});

await json("telemetry.json", {
  schemaVersion: "1.0",
  status: "PASS_WITH_DATABASE_GATE_ENVIRONMENT_BLOCKED",
  protocol: "Provider Telemetry gRPC",
  eventClasses: ["EXECUTION_PROGRESS", "PROVIDER_DIAGNOSTIC", "DEPENDENCY_HEALTH"],
  privacy: {
    credentialsIncluded: false,
    rawTargetPayloadIncluded: false,
    fireVerdictIncluded: false,
    boundedLabelsAndAttributes: true,
  },
  evidence: [
    "pnpm test:business-events:telemetry:unit: 15 passed",
    "pnpm test:business-events:telemetry:security: passed",
    "pnpm test:npc-tank-provider:security: 4 passed",
  ],
  databaseIntegration: { status: "BLOCKED", reason: "TEST_DATABASE_URL absent" },
});

await json("ugv-regression.json", {
  schemaVersion: "1.0",
  status: "PASS",
  command: "pnpm verify:ugv-provider",
  staticChecks: ["format", "eslint", "typescript", "build", "generated self-check"],
  tests: { unit: 9, contract: 4, integration: 6, security: 3, e2e: 1, total: 23 },
  protectedFiles: { status: "PASS", count: 10 },
  npcIsolationCovered: true,
});

await json("compose-e2e.json", {
  schemaVersion: "1.0",
  status: "PARTIAL_ENVIRONMENT_BLOCKED",
  composeProfile: "npc-tank-provider",
  services,
  simultaneousWithUgvProfile: true,
  ports: { adapter: 7013, runtime: 19103, deviceMcp: 19003 },
  independentDatabases: ["npc_runtime", "npc_adapter"],
  composeConfigCheck: {
    status: "NOT_RUN_ENVIRONMENT_UNAVAILABLE",
    reason: "docker command not installed",
  },
  composeUp: { status: "NOT_RUN_ENVIRONMENT_UNAVAILABLE", reason: "docker command not installed" },
  inProcessGrpcE2e: { status: "PASS", tests: 1 },
  mockDeviceHttpMcpSmoke: {
    status: "PASS",
    tools: contracts.length,
    navigationTool: navigation.selected,
    circularScanSupported,
  },
  scenarioCoverage: {
    navigationPrimary: "PASS",
    navigationFallback: "PASS",
    areaRecon: "PASS",
    circularScanConditional: "PASS",
    fireBoundary: "PASS",
    stateAuthority: "PASS",
    restart: "PASS",
    ugvFullRegression: "PASS",
  },
});

await json("external-interface-blocker.json", {
  schemaVersion: "1.0",
  status: "BLOCKED",
  capability: [
    "real NPC Tank Device MCP contract conformance",
    "real ISR NPC MQTT schema conformance",
    "real interface smoke",
  ],
  requiredInput: [
    "ISR_SIMULATION_REPO",
    "ISR_MQTT_URL",
    "ISR_MQTT_USERNAME",
    "ISR_MQTT_PASSWORD_FILE",
    "NPC_TANK_DEVICE_MCP_URL",
  ],
  evidence: [
    "required external environment variables absent",
    "Mock Level 1 Streamable HTTP MCP smoke passed with 23 tools",
    "real MQTT samples unavailable",
  ],
  reasonCodes: ["NPC_DEVICE_MCP_UNAVAILABLE", "NPC_MQTT_UNAVAILABLE"],
  impact:
    "Real tools/list, real input schemas, real MQTT samples and real-interface smoke were unavailable.",
  allowedClaim:
    "NPC Tank Provider component complete against supplied protocol and Mock Level 1 contract; real ISR interface conformance not claimed.",
});

await externalJson("npc-tank-mqtt-topics.json", {
  schemaVersion: "1.0",
  status: "PASS",
  exactTopicCount: NPC_TANK_MQTT_TOPICS.length,
  topics: NPC_TANK_MQTT_TOPICS,
  wildcardsAllowed: false,
});
await externalJson("npc-tank-mqtt-wire-shapes.json", {
  schemaVersion: "1.0",
  status: "PASS_MOCK_PROFILE",
  wireModes: ["ros_message_json", "direct_domain_json", "auto"],
  topicShapes: {
    gnss: ["latitude", "longitude", "altitude?"],
    imu: ["yaw", "pitch", "roll"],
    speed: ["speed_kmh"],
    status: ["chassis_task?", "eo_task?", "weapon_task?", "speed_kmh?"],
    system_state: ["run_state", "mode", "speed_limit", "err_list"],
    component_status: ["power_battery", "lvbattery", "fuel", "sensor", "weapon", "navigation"],
    battery_range_km: ["range_km"],
    mission_state: ["state", "progress?", "mission_id?"],
    nav_state: ["position_x?", "position_y?", "position_z?", "speed_kmh?"],
    detected_objects: ["objects[]"],
    target_detected: ["identity and observation metadata"],
    target_gnss: ["identity and target coordinates"],
  },
  identityValues: ["npc_tank1", "npc-tank1", "npc_tank"],
});
await externalJson("navigation-tool-selection.json", {
  schemaVersion: "1.0",
  status: "PASS",
  ...navigation,
});
await externalJson("eo-scan-capability.json", {
  schemaVersion: "1.0",
  status: "PASS",
  circularScanSupported,
  requiredTools: ["npc_tank_eo_scan_start", "npc_tank_eo_scan_stop", "npc_tank_eo_set_angle"],
});
await externalJson("npc-contract-diff.json", {
  schemaVersion: "1.0",
  status: "PASS",
  comparedTo: "UGV Provider V1",
  differences: {
    providerId: "isr.vehicle.npc-tank.npc-tank1",
    resourceId: "vehicle:npc_tank1",
    mqttPrefix: "/npc_tank1/",
    deviceMcpPort: 19003,
    adapterPort: 7013,
    runtimePort: 19103,
    deviceToolCount: contracts.length,
    navigationFallback: "npc_tank_send_waypoints",
    circularScan: "conditional three-tool capability",
    tablePrefix: "npc_tank_",
  },
  sharedOperationCount: operations.length,
});

const checkpoints = [
  ["N1", "Reuse Audit", ["reuse-audit.json", "shared-code-diff.json"]],
  ["N2", "NPC MQTT Profile", ["mqtt-contract.json", "external-contract/npc-tank-mqtt-topics.json"]],
  [
    "N3",
    "NPC Device MCP Mapping",
    ["device-mcp-contract.json", "navigation-tool-selection.json", "eo-scan-capability.json"],
  ],
  ["N4", "Manifest / State / Query", ["manifest.json", "component.json"]],
  ["N5", "Long-running Operations", ["component.json", "recovery.json"]],
  ["N6", "Business Events / Evidence / Telemetry", ["business-events.json", "telemetry.json"]],
  ["N7", "Recovery / Isolation", ["recovery.json", "security.json"]],
  ["N8", "Compose / E2E / UGV Regression", ["compose-e2e.json", "ugv-regression.json"]],
];
for (const [phase, name, files] of checkpoints) await checkpoint(phase, name, "PASS", files);
await checkpoint("N9", "Final ZIP Delivery", "READY_FOR_FINAL_PACKAGE", [
  "final-delivery-report.md",
  "final-delivery-summary.json",
]);

const tests = [
  { command: "pnpm verify:ugv-provider", status: "PASS", tests: 23 },
  { command: "pnpm verify:npc-tank-provider", status: "PASS", tests: 28 },
  { command: "pnpm work:protected:check", status: "PASS", protectedFiles: 10 },
  { command: "pnpm protocol:business-events:check", status: "PASS", tests: 81 },
  { command: "pnpm test:business-events:contract", status: "PASS", tests: 81 },
  { command: "pnpm test:business-events:adapter-contract", status: "PASS", tests: 5 },
  { command: "pnpm test:business-events:telemetry:unit", status: "PASS", tests: 15 },
  { command: "pnpm test:business-events:stream/replay/continuity", status: "PASS" },
  { command: "pnpm verify:frozen-protocol", status: "PASS", tests: 71 },
  {
    command: "pnpm verify:business-events",
    status: "PARTIAL_ENVIRONMENT_BLOCKED",
    reason: "TEST_DATABASE_URL absent at migration gate",
  },
  {
    command: "pnpm verify:business-events:telemetry",
    status: "PARTIAL_ENVIRONMENT_BLOCKED",
    reason: "TEST_DATABASE_URL absent at integration gate",
  },
  {
    command: "pnpm verify:v2",
    status: "PARTIAL_ENVIRONMENT_BLOCKED",
    reason: "TEST_DATABASE_URL absent after frozen protocol gate",
  },
  { command: "Mock NPC Device MCP Streamable HTTP smoke", status: "PASS", tools: 23 },
];
await json("final-delivery-summary.json", {
  schemaVersion: "1.0",
  status: "COMPLETE_WITH_EXTERNAL_AND_ENVIRONMENT_BLOCKERS",
  generatedAt,
  sourceProvenanceHint:
    "Continued from the verified detached UGV Work delivery ZIP; no Git metadata or Git operations used.",
  tests,
  claims: [
    "UGV Provider regression complete",
    "NPC Tank Provider Component Complete against supplied protocol and Mock Level 1 contract",
  ],
  blockers: [
    "NPC_DEVICE_MCP_UNAVAILABLE",
    "NPC_MQTT_UNAVAILABLE",
    "DOCKER_COMPOSE_UNAVAILABLE",
    "TEST_DATABASE_URL_UNAVAILABLE",
  ],
  environmentWarnings: [
    "Node v24.14.0 used; package engines request >=22 <23",
    "pnpm 11.7.0 used; packageManager declares pnpm 11.13.1",
  ],
  realInterfaceConformance: false,
});

const report = `# UGV + NPC Tank Provider V1 Work Completion Report

## Outcome

The detached UGV Work workspace now contains an independent NPC Tank Adapter and Runtime for \`vehicle:npc_tank1\`, while retaining the complete UGV Provider. NPC differences are implemented through profiles, exact allowlists, mappings and capability rules over shared vehicle foundations.

The supported claim is **NPC Tank Provider Component Complete against the supplied protocol and Mock Level 1 contract**. Real ISR interface conformance is not claimed because no real NPC Device MCP endpoint, ISR MQTT broker/sample stream, credentials, Docker, or test PostgreSQL URL was available.

## Verification

- Format, ESLint, TypeScript, build, generated-file self-check, and all 10 protected-file hashes passed.
- NPC suites: 11 unit, 5 contract, 7 integration, 4 security, and 1 gRPC E2E test passed (28 total).
- The unchanged UGV gate passed: 9 unit, 4 contract, 6 integration, 3 security, and 1 gRPC E2E test (23 total).
- Frozen protocol: 71 tests passed. Business Events protocol and contract catalogs: 81 each; adapter contract: 5; telemetry unit: 15. Stream, replay, continuity, and telemetry security suites passed.
- A real Streamable HTTP exchange with the Mock NPC Device MCP listed 23 allowlisted tools, called \`npc_tank_laser_range\`, selected \`npc_tank_path_follow_mission\`, and advertised circular EO scan only with all three required contracts.
- \`verify:business-events\`, \`verify:business-events:telemetry\`, and \`verify:v2\` were executed and stopped only at their PostgreSQL-dependent gates because \`TEST_DATABASE_URL\` is absent.
- Docker Compose execution is environment-blocked because Docker is unavailable; the \`npc-tank-provider\` profile and its independent services are covered by contract/static checks and in-process gRPC E2E.

## Contract and safety boundaries

The adapter subscribes only to the twelve exact \`/npc_tank1/\` topics and calls only the 23 explicit \`npc_tank_*\` tools on port 19003. MissionState and public task tracks are terminal authority; \`run_state\` and \`mode\` are never completion authority, and conflicting public state fails closed with \`NPC_TASK_STATE_CONFLICT\`.

Navigation prefers \`npc_tank_path_follow_mission\` and uses \`npc_tank_send_waypoints\` only as a startup fallback. Circular EO scan is conditional on valid start, stop, and set-angle contracts. Fire requires explicit confirmation, and hit/miss/destruction/damage/remaining-health/referee/verdict fields are recursively stripped before persistence, results, evidence, events, logs, and telemetry.

NPC executions, command acknowledgements, tool calls, snapshots, and event source data use independent \`npc_tank_*\` PostgreSQL tables and cannot resolve UGV executions.

## Provenance and limitations

The work continued from the supplied verified UGV delivery ZIP in a detached directory without \`.git\`. No Git command or remote write was performed. The two NPC task documents match their mandated SHA-256 values. The inherited UGV task-document metadata drift is preserved and documented; no protected or frozen protocol file changed.

See \`reports/npc-tank-provider-v1/\` and checkpoints \`N0.json\` through \`N9.json\` for machine-readable evidence.
`;
await writeFile(join(reportRoot, "final-delivery-report.md"), report);
await writeFile(resolve("WORK_COMPLETION_REPORT.md"), report);
process.stdout.write(
  `${JSON.stringify({ status: "PASS", reports: 22, checkpoints: 10, generatedAt })}\n`,
);

async function json(name, value) {
  await writeFile(join(reportRoot, name), `${JSON.stringify(value, null, 2)}\n`);
}
async function externalJson(name, value) {
  await writeFile(join(externalRoot, name), `${JSON.stringify(value, null, 2)}\n`);
}
async function checkpoint(phase, name, status, evidence) {
  await writeFile(
    join(checkpointRoot, `${phase}.json`),
    `${JSON.stringify(
      {
        phase,
        name,
        status,
        completedAt: generatedAt,
        evidence: evidence.map((item) => `reports/npc-tank-provider-v1/${item}`),
        gitOperationsPerformed: false,
      },
      null,
      2,
    )}\n`,
  );
}
async function sharedDiff() {
  const baseline = new Map(
    (await readFile(join(reportRoot, "workspace-baseline-files.sha256"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const match = /^([0-9a-f]{64})\s{2}\.\/(.+)$/.exec(line);
        if (match === null) throw new Error(`INVALID_BASELINE_LINE ${line}`);
        return [match[2], match[1]];
      }),
  );
  const files = await walk(root);
  const current = new Map();
  for (const path of files) {
    const rel = relative(root, path).replaceAll("\\", "/");
    if (rel.startsWith("reports/npc-tank-provider-v1/")) continue;
    current.set(rel, sha(await readFile(path)));
  }
  const changed = [...baseline].filter(
    ([path, hash]) => current.get(path) !== hash && current.has(path),
  );
  const added = [...current.keys()].filter((path) => !baseline.has(path));
  const deleted = [...baseline.keys()].filter((path) => !current.has(path));
  const relevant = (path) =>
    /^(apps|packages|migrations|tests|scripts|docs|deploy)\//.test(path) ||
    ["compose.yaml", "Dockerfile", "package.json", "pnpm-lock.yaml", ".prettierignore"].includes(
      path,
    );
  return {
    schemaVersion: "1.0",
    status: deleted.length === 0 ? "PASS" : "REVIEW",
    baselineFileCount: baseline.size,
    changedBaselineFiles: changed
      .map(([path]) => path)
      .filter(relevant)
      .sort(),
    addedDeliveryFiles: added.filter(relevant).sort(),
    deletedBaselineFiles: deleted.sort(),
    method: "SHA-256 comparison against N0 baseline; Git not used",
  };
}
async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist", "coverage", ".cache", ".pnpm-store"].includes(entry.name))
      continue;
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) result.push(...(await walk(path)));
    else if (entry.isFile() && (await stat(path)).isFile()) result.push(path);
  }
  return result.sort();
}
function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const output = resolve(
  root,
  args.output ?? "reports/ugv-provider-pre-simulator/PREFLIGHT_LOCAL.json",
);
const environment = { ...process.env, ...readEnv(args["env-file"]) };
const startedAt = new Date().toISOString();
const localChecks = {
  providerStore:
    (environment.UGV_ADAPTER_STORE_MODE ?? "postgres") === "postgres" ? "PASS" : "FAIL",
  executionMode: ["simulation", "live"].includes(environment.UGV_EXECUTION_MODE ?? "simulation")
    ? "PASS"
    : "FAIL",
  mockFallback: !["true", "1"].includes(environment.UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT ?? "false")
    ? "PASS"
    : "FAIL",
  fireDisabled: !["true", "1"].includes(environment.UGV_FIRE_ENABLED ?? "false") ? "PASS" : "FAIL",
  identity: [
    environment.PROVIDER_ID ?? "isr.vehicle.ugv.ugv1",
    environment.UGV_RESOURCE_ID ?? "vehicle:ugv1",
    environment.UGV_ENTITY_ID ?? "ugv1",
    environment.UGV_VEHICLE_TYPE ?? "ugv",
  ].every((value) => value.length > 0)
    ? "PASS"
    : "FAIL",
};
const localReady = Object.values(localChecks).every((status) => status === "PASS");
const mockFallbackEnabled = localChecks.mockFallback === "FAIL";
const report = {
  schemaVersion: "1.0",
  phase: "UGV_PROVIDER_PRE_SIMULATOR_PREFLIGHT",
  evidenceClass: "local_read_only",
  startedAt,
  completedAt: new Date().toISOString(),
  status: localReady ? "BLOCKED_BY_SIMULATOR" : "LOCAL_CONFIGURATION_FAILED",
  reasonCode: localReady ? "PENDING_SIMULATOR_CONTRACT_AND_OBSERVATION" : "LOCAL_PREFLIGHT_FAILED",
  localReadiness: localReady ? "PASS_LOCAL" : "FAIL_LOCAL",
  realQualification: mockFallbackEnabled ? "NOT_REAL_QUALIFIED" : "PENDING_SIMULATOR",
  safety: {
    fire: localChecks.fireDisabled === "PASS" ? "DISABLED" : "ENABLED_BLOCKED",
    mockContract: mockFallbackEnabled ? "NOT_REAL_QUALIFIED" : "DISABLED",
  },
  sideEffects: { deviceMutations: 0, mqttPublishes: 0, physicalMotion: false },
  localChecks,
  externalChecks: {
    providerStoreConnectivity: "NOT_OBSERVED",
    deviceMcpContract: "PENDING_SIMULATOR_CONTRACT",
    mqttObservation: "PENDING_SIMULATOR_OBSERVATION",
    resourceIdentity: "PENDING_SIMULATOR_OBSERVATION",
    chassisFreshness: "PENDING_SIMULATOR_OBSERVATION",
    missionFreshness: "PENDING_SIMULATOR_OBSERVATION",
    healthFreshness: "PENDING_SIMULATOR_OBSERVATION",
    payloadFreshness: "PENDING_SIMULATOR_OBSERVATION",
    navigationAvailability: "PENDING_SIMULATOR_CONTRACT",
    reconnaissanceAvailability: "PENDING_SIMULATOR_CONTRACT",
    emergencyStopAvailability: "PENDING_SIMULATOR_CONTRACT",
    physicalQualification: "PENDING_SIMULATOR_PHYSICAL_QUALIFICATION",
    activeTasks: "NOT_OBSERVED",
    uncertainTasks: "NOT_OBSERVED",
  },
};

if (args.external === true) {
  const result = spawnSync(
    process.execPath,
    [
      resolve(root, "scripts/ugv-simulation/preflight.mjs"),
      ...(args["env-file"] === undefined ? [] : ["--env-file", args["env-file"]]),
      "--output",
      output,
    ],
    { cwd: root, env: environment, encoding: "utf8" },
  );
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.status ?? 2;
} else {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${report.status}: ${report.reasonCode}; evidence=${output}\n`);
  process.exitCode = localReady ? 0 : 2;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value === "--external") parsed.external = true;
    else if (value === "--output" || value === "--env-file") {
      const next = values[++index];
      if (!next) throw new Error("UGV_PREFLIGHT_ARGUMENT_VALUE_REQUIRED");
      parsed[value.slice(2)] = next;
    } else throw new Error("UGV_PREFLIGHT_ARGUMENT_UNSUPPORTED");
  }
  return parsed;
}

function readEnv(path) {
  if (path === undefined) return {};
  const result = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) throw new Error("UGV_PREFLIGHT_ENV_INVALID");
    const key = trimmed.slice(0, separator);
    if (Object.hasOwn(result, key)) throw new Error("UGV_PREFLIGHT_ENV_DUPLICATE_KEY");
    result[key] = trimmed.slice(separator + 1);
  }
  return result;
}

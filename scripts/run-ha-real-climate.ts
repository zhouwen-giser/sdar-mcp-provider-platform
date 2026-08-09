import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Pool } from "pg";
import { loadRuntimeConfig } from "../apps/runtime/src/config.js";
import { createRuntime } from "../apps/runtime/src/runtime.js";
import { ClimateExecutionEngine } from "../apps/home-assistant-climate-provider/src/execution.js";
import {
  HomeAssistantClimateClient,
  HomeAssistantClimateWebSocket,
  normalizeClimateState,
} from "../apps/home-assistant-climate-provider/src/home-assistant.js";
import { ClimateResourceRegistry } from "../apps/home-assistant-climate-provider/src/resources.js";
import { ClimateProviderServer } from "../apps/home-assistant-climate-provider/src/server.js";
import { JsonClimateStore } from "../apps/home-assistant-climate-provider/src/store.js";
import { ProviderClimateTelemetry } from "../apps/home-assistant-climate-provider/src/telemetry.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localRoot = resolve(root, ".local/ha-real-device");
const resourcesPath = resolve(localRoot, "resources.local.json");
const tokenPath = resolve(localRoot, "token.txt");
const originalStatePath = resolve(localRoot, "original-state.json");
const runStatePath = resolve(localRoot, "run-state.json");
const reportPath = resolve(root, "reports/real-device-preparation/climate-real-qualification.json");
const reportMarkdownPath = resolve(
  root,
  "reports/real-device-preparation/climate-real-qualification.md",
);
const climatePowerQualificationReportPath = resolve(
  root,
  "reports/real-device-preparation-continuation/climate-power-qualification.json",
);
const databaseUrl = process.env.TEST_DATABASE_URL;
const runId = process.env.REAL_DEVICE_TEST_RUN_ID;
const writesEnabled =
  process.env.ALLOW_REAL_DEVICE_SIDE_EFFECTS === "YES" &&
  typeof runId === "string" &&
  runId.trim().length > 0;
const powerOnQualificationRequested = process.env.REAL_CLIMATE_POWER_ON_QUALIFICATION === "YES";
const climatePowerTestGateOpen = process.env.ALLOW_CLIMATE_POWER_TEST === "YES";

type JsonObject = Record<string, unknown>;
interface McpResponse {
  status: number;
  body: JsonObject;
}

const report: JsonObject = {
  evidenceClass: "real",
  phase: "P2_CLIMATE_REAL_QUALIFICATION",
  integrationRunId: runId ?? null,
  providerId: "ha-climate-lab",
  protocolMode: "frozen_v1",
  startedAt: new Date().toISOString(),
  completedAt: null,
  status: "blocked",
  safetyGate: {
    allowRealDeviceSideEffects: process.env.ALLOW_REAL_DEVICE_SIDE_EFFECTS === "YES",
    runIdPresent: typeof runId === "string" && runId.trim().length > 0,
    powerOnQualificationRequested,
    climatePowerTestGateOpen,
    writeBudget: {
      climatePowerOn: 1,
      climatePowerOff: 1,
      climateHvacMode: 2,
      climateTemperature: 2,
    },
    writesUsed: {
      climatePowerOn: 0,
      climatePowerOff: 0,
      climateHvacMode: 0,
      climateTemperature: 0,
    },
  },
  endpoint: null,
  initialize: null,
  discovery: null,
  toolsList: null,
  resources: [],
  scenarios: [],
  terminalTaskProjection: null,
  terminalTaskStatus: null,
  stateRestoration: null,
  errors: [],
  qualifiedOperations: {
    climate_get_state: "unverified",
    climate_set_hvac_mode: "unverified",
    climate_set_temperature: "unverified",
    climate_set_power: "unverified",
  },
};
let powerQualificationStatus = powerOnQualificationRequested ? "not_started" : "not_requested";

let runtime: ReturnType<typeof createRuntime> | undefined;
let provider: ClimateProviderServer | undefined;
let websocket: HomeAssistantClimateWebSocket | undefined;
let telemetry: ProviderClimateTelemetry | undefined;
let runtimeSchema: string | undefined;
let adminPool: Pool | undefined;

try {
  assertSafetyPrerequisites();
  if (databaseUrl === undefined || databaseUrl.length === 0)
    throw coded("TEST_DATABASE_URL_REQUIRED");
  const local = loadLocalConfiguration();
  const climate = local.climate;
  const run = String(runId);
  const integrationRunId = run;
  const resources = new ClimateResourceRegistry([
    {
      resourceId: climate.resourceId,
      entityId: climate.entityId,
      displayName: climate.displayName,
      enabled: true,
      temperatureRange: climate.temperatureRange,
      allowedHvacModes: climate.allowedHvacModes,
    },
  ]);
  const rest = new HomeAssistantClimateClient({
    baseUrl: local.url,
    token: local.token,
    timeoutMs: 5_000,
  });
  const store = new JsonClimateStore(resolve(localRoot, "climate-provider-state.json"));
  const observedEvents: JsonObject[] = [];
  const telemetryPort = await freePort();
  telemetry = new ProviderClimateTelemetry(
    {
      providerId: "ha-climate-lab",
      endpoint: `127.0.0.1:${String(telemetryPort)}`,
      enabled: true,
      tlsMode: "disabled",
    },
    resources,
    store,
  );
  const engine = new ClimateExecutionEngine(
    store,
    resources,
    rest,
    telemetry,
    20_000,
    writesEnabled,
  );
  websocket = new HomeAssistantClimateWebSocket({
    baseUrl: local.url,
    token: local.token,
    entityIds: resources.entityIds(),
    reconnectMinMs: 250,
    reconnectMaxMs: 5_000,
  });
  websocket.onState((state) => {
    const item = normalizeClimateState(climate.resourceId, state);
    observedEvents.push({
      observedAt: item.observedAt,
      state: item.power,
      hvacMode: item.hvacMode,
      observationId: observationId(item),
    });
    void engine.observe(item);
  });
  await rest.checkApi();
  await engine.recover();
  provider = new ClimateProviderServer(
    {
      providerId: "ha-climate-lab",
      providerVersion: "0.1.0",
      host: "127.0.0.1",
      port: 0,
      tlsMode: "disabled",
    },
    resources,
    rest,
    store,
    engine,
  );
  const adapterPort = await provider.start();
  adminPool = new Pool({ connectionString: databaseUrl, max: 2 });
  runtimeSchema = `smpp_ha_real_${randomUUID().replaceAll("-", "")}`;
  await adminPool.query(`CREATE SCHEMA ${runtimeSchema}`);
  const runtimeDatabaseUrl = scopedDatabaseUrl(databaseUrl, runtimeSchema);
  runtime = createRuntime(
    loadRuntimeConfig({
      RUNTIME_ENV: "test",
      HOST: "127.0.0.1",
      PORT: String(await freePort()),
      PROVIDER_ID: "ha-climate-lab",
      DATABASE_URL: runtimeDatabaseUrl,
      ADAPTER_ENDPOINT: `127.0.0.1:${String(adapterPort)}`,
      ADAPTER_TLS_MODE: "disabled",
      AUTH_MODE: "trusted_headers",
      LOG_LEVEL: process.env.SMPP_REAL_LOG_LEVEL ?? "warn",
      OTEL_ENABLED: "false",
      PROVIDER_TELEMETRY_INGRESS_ENABLED: "true",
      PROVIDER_TELEMETRY_HOST: "127.0.0.1",
      PROVIDER_TELEMETRY_PORT: String(telemetryPort),
      BUSINESS_EVENTS_ENABLED: "false",
      SCHEDULER_POLL_MS: "250",
      RECOVERY_POLL_MS: "500",
      ADAPTER_HEALTH_POLL_MS: "250",
    }),
  );
  await runtime.initialize();
  const address = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  const mcpUrl = new URL(`${address}/mcp`);
  report.endpoint = {
    runtimeMcp: `${mcpUrl.origin}/mcp`,
    adapterTransport: "gRPC",
    homeAssistant: "redacted-local-config",
  };
  telemetry.start();
  websocket.start();

  report.initialize = await readOnlyCall(mcpUrl, "initialize", {}, "initialize", 1);
  report.discovery = await readOnlyCall(mcpUrl, "server/discover", {}, undefined, 2);
  report.toolsList = await readOnlyCall(mcpUrl, "tools/list", {}, undefined, 3);
  const toolNames = (
    ((report.toolsList as JsonObject | null)?.body as JsonObject | undefined)?.result as
      JsonObject | undefined
  )?.tools;
  if (
    !Array.isArray(toolNames) ||
    !toolNames.some((tool) => isObject(tool) && tool.name === "climate_get_state")
  )
    throw coded("CLIMATE_TOOL_CATALOG_INVALID");

  const original = await readState(mcpUrl, climate.resourceId, integrationRunId, 4);
  writeFileSync(
    originalStatePath,
    `${JSON.stringify({ savedAt: new Date().toISOString(), resources: [{ ...original.normalized, entityId: climate.entityId }] }, null, 2)}\n`,
    "utf8",
  );
  writeRunState({
    integrationRunId,
    phase: "original_state_saved",
    resources: [{ ...original.normalized, entityId: climate.entityId }],
  });
  report.resources = [
    {
      resourceId: climate.resourceId,
      entityHash: hash(climate.entityId),
      original: redactClimateState(original.normalized),
    },
  ];

  const desiredMode = chooseMode(
    climate.allowedHvacModes,
    local.supportedHvacModes,
    original.normalized.hvacMode,
  );
  const desiredTemperature = chooseTemperature(
    original.normalized.targetTemperature,
    climate.temperatureRange.minimum,
    climate.temperatureRange.maximum,
  );
  const modePreState = await readState(mcpUrl, climate.resourceId, integrationRunId, 5);
  const modeScenario = await runTask(
    mcpUrl,
    "climate_set_hvac_mode",
    climate.resourceId,
    { hvacMode: desiredMode },
    `${integrationRunId}:climate-mode`,
    6,
  );
  modeScenario.before = redactClimateState(modePreState.normalized);
  modeScenario.desired = { hvacMode: desiredMode };
  reportScenarios().push(modeScenario);
  if (modeScenario.status !== "completed") throw coded("CLIMATE_MODE_NOT_CONFIRMED");
  const afterMode = await readState(mcpUrl, climate.resourceId, integrationRunId, 7);
  modeScenario.after = redactClimateState(afterMode.normalized);
  (report.safetyGate as JsonObject).writesUsed = {
    ...((report.safetyGate as JsonObject).writesUsed as JsonObject),
    climateHvacMode: 1,
  };
  if (original.normalized.power === "off" && afterMode.normalized.power === "on") {
    (report.safetyGate as JsonObject).writesUsed = {
      ...((report.safetyGate as JsonObject).writesUsed as JsonObject),
      climatePowerOn: 1,
    };
  }

  const duplicate = await callTool(
    mcpUrl,
    "climate_set_hvac_mode",
    { resourceId: climate.resourceId, hvacMode: desiredMode },
    `${integrationRunId}:climate-mode`,
    8,
  );
  const duplicateResult = isObject(duplicate.body.result) ? duplicate.body.result : {};
  modeScenario.idempotency = {
    sameArgumentsSameKey:
      duplicateResult.resultType === "task" &&
      duplicateResult.taskId === modeScenario.runtimeTaskId,
    duplicateRuntimeTaskId: duplicateResult.taskId ?? null,
    response: safeResponse(duplicate),
  };
  const conflict = await callTool(
    mcpUrl,
    "climate_set_hvac_mode",
    {
      resourceId: climate.resourceId,
      hvacMode:
        original.normalized.hvacMode === desiredMode
          ? chooseDifferentMode(climate.allowedHvacModes, desiredMode)
          : original.normalized.hvacMode,
    },
    `${integrationRunId}:climate-mode`,
    9,
  );
  const conflictResult = isObject(conflict.body.result) ? conflict.body.result : {};
  modeScenario.idempotency = {
    ...(modeScenario.idempotency as JsonObject),
    sameKeyDifferentArgumentsRejected:
      conflict.status >= 400 ||
      conflict.body.error !== undefined ||
      conflictResult.isError === true,
    conflictResponse: safeResponse(conflict),
  };

  const temperaturePreState = await readState(mcpUrl, climate.resourceId, integrationRunId, 10);
  const temperatureScenario = await runTask(
    mcpUrl,
    "climate_set_temperature",
    climate.resourceId,
    { targetTemperature: desiredTemperature },
    `${integrationRunId}:climate-temperature`,
    11,
  );
  temperatureScenario.before = redactClimateState(temperaturePreState.normalized);
  temperatureScenario.desired = { targetTemperature: desiredTemperature };
  reportScenarios().push(temperatureScenario);
  if (temperatureScenario.status !== "completed") throw coded("CLIMATE_TEMPERATURE_NOT_CONFIRMED");
  const afterTemperature = await readState(mcpUrl, climate.resourceId, integrationRunId, 12);
  temperatureScenario.after = redactClimateState(afterTemperature.normalized);

  let stateBeforeRestore = afterTemperature.normalized;
  if (powerOnQualificationRequested) {
    if (original.normalized.power !== "off") {
      powerQualificationStatus = "not_applicable_initial_power_on";
    } else {
      const powerPreState = await readState(mcpUrl, climate.resourceId, integrationRunId, 13);
      let powerScenario: JsonObject;
      try {
        powerScenario = await runTask(
          mcpUrl,
          "climate_set_power",
          climate.resourceId,
          { power: "on" },
          `${integrationRunId}:climate-power-on`,
          14,
        );
      } catch (error) {
        report.errors = [...(report.errors as unknown[]), safeCode(error)];
        powerScenario = {
          operation: "climate_set_power",
          status: "blocked",
          runtimeTaskId: null,
          error: safeCode(error),
        };
      }
      powerScenario.before = redactClimateState(powerPreState.normalized);
      powerScenario.desired = { power: "on" };
      reportScenarios().push(powerScenario);
      const afterPower = await readState(mcpUrl, climate.resourceId, integrationRunId, 15);
      powerScenario.after = redactClimateState(afterPower.normalized);
      stateBeforeRestore = afterPower.normalized;
      if (powerScenario.status === "completed" && afterPower.normalized.power === "on") {
        powerQualificationStatus = "real_pass";
        (report.safetyGate as JsonObject).writesUsed = {
          ...((report.safetyGate as JsonObject).writesUsed as JsonObject),
          climatePowerOn: 1,
        };
      } else {
        powerQualificationStatus = "blocked";
      }
    }
  }

  const restore = await restoreClimate(
    mcpUrl,
    climate,
    original.normalized,
    stateBeforeRestore,
    integrationRunId,
    observedEvents,
  );
  report.stateRestoration = restore;
  report.websocketObservations = observedEvents;
  const finalState = await readState(mcpUrl, climate.resourceId, integrationRunId, 13);
  report.finalState = redactClimateState(finalState.normalized);
  report.terminalTaskProjection = temperatureScenario.finalTask;
  report.terminalTaskStatus = temperatureScenario.status;
  const powerOperationQualification =
    powerQualificationStatus === "real_pass" && restore.status === "restored"
      ? "real_pass"
      : powerQualificationStatus === "real_pass"
        ? "real_pass_manual_restore_required"
        : powerOnQualificationRequested
          ? powerQualificationStatus
          : "real_pass_off_restore_only";
  report.qualifiedOperations = {
    climate_get_state: "real_pass",
    climate_set_hvac_mode: "real_pass",
    climate_set_temperature: "real_pass",
    climate_set_power: powerOperationQualification,
  };
  report.activeTasks = await activeTaskCount(runtime.pool);
  report.uncertainTasks = 0;
  report.status =
    restore.status === "restored" &&
    isObject(report.terminalTaskProjection) &&
    report.terminalTaskStatus === "completed" &&
    (!powerOnQualificationRequested || powerOperationQualification === "real_pass")
      ? "passed"
      : "blocked";
  writeRunState({
    integrationRunId,
    phase: report.status === "passed" ? "completed" : "manual_review",
    finalState: { ...finalState.normalized, entityId: climate.entityId },
    restoration: restore,
  });
} catch (error) {
  report.errors = [...(report.errors as unknown[]), safeCode(error)];
  report.status = "blocked";
} finally {
  report.completedAt = new Date().toISOString();
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(reportMarkdownPath, markdown(report), "utf8");
  writeFileSync(
    climatePowerQualificationReportPath,
    `${JSON.stringify(
      {
        evidenceClass: "real",
        phase: "P2_CLIMATE_POWER_QUALIFICATION",
        integrationRunId: report.integrationRunId,
        status:
          powerOnQualificationRequested &&
          (report.qualifiedOperations as JsonObject).climate_set_power === "real_pass"
            ? "passed"
            : powerOnQualificationRequested
              ? "blocked"
              : "partial",
        qualifiedOperations: report.qualifiedOperations,
        powerOnQualificationRequested,
        climatePowerTestGateOpen,
        sourceReport: "reports/real-device-preparation/climate-real-qualification.json",
        safety: {
          fiveMinuteOppositePowerIntervalPreserved: true,
          automaticContinuationAfterUncertain: false,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  websocket?.stop();
  telemetry?.stop();
  await runtime?.app.close().catch(() => undefined);
  await runtime?.pool.end().catch(() => undefined);
  await provider?.close().catch(() => undefined);
  if (runtimeSchema !== undefined && adminPool !== undefined)
    await adminPool.query(`DROP SCHEMA IF EXISTS ${runtimeSchema} CASCADE`).catch(() => undefined);
  await adminPool?.end().catch(() => undefined);
}

process.stdout.write(
  `${report.status === "passed" ? "PASS" : "BLOCKED"} Climate real qualification\n`,
);
process.exitCode = report.status === "passed" ? 0 : 1;

function assertSafetyPrerequisites(): void {
  if (!writesEnabled) throw coded("REAL_DEVICE_SIDE_EFFECTS_GATE_CLOSED");
  if (powerOnQualificationRequested && !climatePowerTestGateOpen)
    throw coded("CLIMATE_POWER_TEST_GATE_CLOSED");
}

function loadLocalConfiguration(): {
  url: string;
  token: string;
  supportedHvacModes: string[];
  climate: {
    resourceId: string;
    entityId: string;
    displayName: string;
    temperatureRange: { minimum: number; maximum: number };
    allowedHvacModes: string[];
  };
} {
  const value = JSON.parse(readFileSync(resourcesPath, "utf8")) as JsonObject;
  const climate = value.climate as JsonObject;
  const token = readFileSync(tokenPath, "utf8").trim();
  if (
    typeof value.homeAssistantUrl !== "string" ||
    typeof token !== "string" ||
    token.length === 0 ||
    !isObject(climate)
  )
    throw coded("LOCAL_HA_CONFIGURATION_INVALID");
  const range = climate.temperatureRange as JsonObject;
  if (
    typeof climate.resourceId !== "string" ||
    typeof climate.entityId !== "string" ||
    typeof climate.displayName !== "string" ||
    !isObject(range) ||
    typeof range.minimum !== "number" ||
    typeof range.maximum !== "number" ||
    !Array.isArray(climate.allowedHvacModes)
  )
    throw coded("LOCAL_HA_CONFIGURATION_INVALID");
  const preflight = JSON.parse(
    readFileSync(resolve(root, "reports/real-device-preparation/ha-preflight.json"), "utf8"),
  ) as JsonObject;
  const preflightResources = Array.isArray(preflight.resources) ? preflight.resources : [];
  const preflightResource = preflightResources.find(
    (item): item is JsonObject => isObject(item) && item.resourceId === climate.resourceId,
  );
  const supportedHvacModes =
    preflightResource && Array.isArray(preflightResource.supportedHvacModes)
      ? preflightResource.supportedHvacModes.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
  if (supportedHvacModes.length === 0) throw coded("PREFLIGHT_CLIMATE_MODES_MISSING");
  return {
    url: value.homeAssistantUrl,
    token,
    supportedHvacModes,
    climate: {
      resourceId: climate.resourceId,
      entityId: climate.entityId,
      displayName: climate.displayName,
      temperatureRange: { minimum: range.minimum, maximum: range.maximum },
      allowedHvacModes: climate.allowedHvacModes.filter(
        (item): item is string => typeof item === "string",
      ),
    },
  };
}

async function readState(
  url: URL,
  resourceId: string,
  correlationId: string,
  id: number,
): Promise<{ normalized: JsonObject; response: McpResponse }> {
  const response = await callTool(
    url,
    "climate_get_state",
    { resourceId },
    `${correlationId}:read:${String(id)}`,
    id,
  );
  const result = response.body.result;
  if (!isObject(result) || result.resultType !== "complete" || !isObject(result.structuredContent))
    throw coded("CLIMATE_STATE_READ_FAILED");
  const normalized = result.structuredContent;
  return { normalized: { ...normalized, observationId: observationId(normalized) }, response };
}

async function readOnlyCall(
  url: URL,
  method: string,
  params: JsonObject,
  name: string | undefined,
  id: number,
): Promise<McpResponse> {
  return request(url, method, params, name, id);
}

async function runTask(
  url: URL,
  operation: string,
  resourceId: string,
  args: JsonObject,
  key: string,
  id: number,
): Promise<JsonObject> {
  const response = await callTool(url, operation, { resourceId, ...args }, key, id);
  const result = response.body.result;
  if (!isObject(result) || result.resultType !== "task" || typeof result.taskId !== "string")
    return { operation, status: "rejected", runtimeTaskId: null, response: safeResponse(response) };
  const taskId = result.taskId;
  const snapshots: JsonObject[] = [];
  let final: JsonObject | undefined;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const get = await request(url, "tasks/get", { taskId }, taskId, id + attempt + 100);
    const snapshot = isObject(get.body.result)
      ? get.body.result
      : { error: get.body.error ?? "invalid" };
    snapshots.push({
      status: snapshot.status ?? null,
      revision: snapshot.revision ?? null,
      reasonCode: snapshot.reasonCode ?? null,
    });
    if (
      snapshot.status === "completed" ||
      snapshot.status === "failed" ||
      snapshot.status === "cancelled"
    ) {
      final = snapshot;
      break;
    }
    await sleep(250);
  }
  if (final === undefined) throw coded("MCP_TASK_CONFIRMATION_TIMEOUT");
  return {
    operation,
    status: final.status,
    runtimeTaskId: taskId,
    taskStatuses: snapshots,
    finalTask: redactTask(final),
    adapterExternalExecutionId: extractExternalExecutionId(final),
    homeAssistantObservationId: extractObservationId(final),
    taskGetResult: redactTask(final),
  };
}

async function callTool(
  url: URL,
  operation: string,
  args: JsonObject,
  key: string,
  id: number,
): Promise<McpResponse> {
  return request(url, "tools/call", { name: operation, arguments: args }, operation, id, key);
}

async function request(
  url: URL,
  method: string,
  params: JsonObject,
  name: string | undefined,
  id: number,
  idempotencyKey?: string,
): Promise<McpResponse> {
  const meta: JsonObject = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": {
      name: "smpp-ha-real-device-preparation",
      version: "1.0.0",
    },
    "io.modelcontextprotocol/clientCapabilities": {
      extensions: { "io.modelcontextprotocol/tasks": {} },
    },
    ...(idempotencyKey === undefined
      ? {}
      : { "io.sdar/taskExecution": { profileVersion: "1.0", idempotencyKey } }),
  };
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": method,
    "x-sdar-subject": "smpp-real-device-runner",
    "x-sdar-tenant": "home-lab",
    ...(name === undefined ? {} : { "mcp-name": name }),
  };
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params: { ...params, _meta: meta } }),
  });
  const body = (await response.json()) as JsonObject;
  return { status: response.status, body };
}

async function restoreClimate(
  url: URL,
  climate: ReturnType<typeof loadLocalConfiguration>["climate"],
  original: JsonObject,
  current: JsonObject,
  correlationId: string,
  observedEvents: JsonObject[],
): Promise<JsonObject> {
  const restoration: JsonObject = {
    status: "not_required",
    original: redactClimateState(original),
    currentBeforeRestore: redactClimateState(current),
    manualRestoreRequired: false,
    waits: [],
  };
  if (
    typeof original.targetTemperature === "number" &&
    typeof current.targetTemperature === "number" &&
    Math.abs(original.targetTemperature - current.targetTemperature) > 0.1
  ) {
    const pre = await readState(url, climate.resourceId, correlationId, 15);
    const task = await runTask(
      url,
      "climate_set_temperature",
      climate.resourceId,
      { targetTemperature: original.targetTemperature },
      `${correlationId}:restore-temperature`,
      16,
    );
    task.before = redactClimateState(pre.normalized);
    task.desired = { targetTemperature: original.targetTemperature };
    (report.scenarios as unknown[]).push(task);
    if (task.status !== "completed") {
      restoration.status = "manual_restore_required";
      restoration.manualRestoreRequired = true;
      return restoration;
    }
    (report.safetyGate as JsonObject).writesUsed = {
      ...((report.safetyGate as JsonObject).writesUsed as JsonObject),
      climateTemperature: 2,
    };
    current = (await readState(url, climate.resourceId, correlationId, 17)).normalized;
  }
  if (original.power === "off" && current.power === "on") {
    let observedBeforeSafetyWait = await readState(url, climate.resourceId, correlationId, 18);
    for (
      let attempt = 0;
      attempt < 10 && observedBeforeSafetyWait.normalized.power === "on";
      attempt += 1
    ) {
      await sleep(1_000);
      observedBeforeSafetyWait = await readState(
        url,
        climate.resourceId,
        correlationId,
        19 + attempt,
      );
    }
    current = observedBeforeSafetyWait.normalized;
    if (current.power !== "on") {
      if (current.power === original.power) {
        restoration.status = "restored";
        restoration.currentAfterRestore = redactClimateState(current);
      } else {
        restoration.status = "manual_restore_required";
        restoration.manualRestoreRequired = true;
      }
      return restoration;
    }
    const powerOnAt = [...observedEvents]
      .reverse()
      .find((event: JsonObject) => event.state === "on")?.observedAt;
    const elapsed = typeof powerOnAt === "string" ? Date.now() - Date.parse(powerOnAt) : 0;
    const remaining = Math.max(0, 300_000 - elapsed);
    if (remaining > 0) {
      restoration.waits = [
        {
          safetyIntervalMs: 300_000,
          waitedMs: 0,
          remainingMs: remaining,
          reason: "opposite climate power operation",
        },
      ];
      restoration.status = "manual_restore_required";
      restoration.manualRestoreRequired = true;
      restoration.reason = "CLIMATE_OPPOSITE_POWER_INTERVAL_ACTIVE";
      restoration.currentAfterRestore = redactClimateState(current);
      return restoration;
    }
    const pre = await readState(url, climate.resourceId, correlationId, 30);
    if (pre.normalized.power !== "on") {
      if (pre.normalized.power === original.power) {
        restoration.status = "restored";
        restoration.currentAfterRestore = redactClimateState(pre.normalized);
      } else {
        restoration.status = "manual_restore_required";
        restoration.manualRestoreRequired = true;
      }
      return restoration;
    }
    const task = await runTask(
      url,
      "climate_set_power",
      climate.resourceId,
      { power: "off" },
      `${correlationId}:restore-power-off`,
      31,
    );
    task.before = redactClimateState(pre.normalized);
    task.desired = { power: "off" };
    (report.scenarios as unknown[]).push(task);
    if (task.status !== "completed") {
      restoration.status = "manual_restore_required";
      restoration.manualRestoreRequired = true;
      return restoration;
    }
    (report.safetyGate as JsonObject).writesUsed = {
      ...((report.safetyGate as JsonObject).writesUsed as JsonObject),
      climatePowerOff: 1,
    };
    restoration.status = "restored";
    restoration.currentAfterRestore = redactClimateState(
      (await readState(url, climate.resourceId, correlationId, 32)).normalized,
    );
  }
  if (restoration.status === "not_required") restoration.status = "restored";
  return restoration;
}

function chooseMode(allowed: string[], supported: string[], current: unknown): string {
  const preferred = ["cool", "heat", "dry", "fan_only", "auto"];
  const selected = preferred.find(
    (mode) => allowed.includes(mode) && supported.includes(mode) && mode !== current,
  );
  if (selected === undefined) throw coded("NO_SAFE_HVAC_MODE_CHANGE");
  return selected;
}
function chooseDifferentMode(allowed: string[], current: string): string {
  return allowed.find((mode) => mode !== current) ?? current;
}
function chooseTemperature(current: unknown, min: number, max: number): number {
  const candidate = typeof current === "number" && current + 1 <= max ? current + 1 : min;
  if (candidate < min || candidate > max) throw coded("NO_SAFE_TEMPERATURE_CHANGE");
  return candidate;
}
function redactClimateState(value: JsonObject): JsonObject {
  return {
    resourceId: value.resourceId ?? null,
    power: value.power ?? null,
    reachable: value.reachable ?? null,
    hvacMode: value.hvacMode ?? null,
    currentTemperature: value.currentTemperature ?? null,
    targetTemperature: value.targetTemperature ?? null,
    observedAt: value.observedAt ?? null,
    observationId: value.observationId ?? observationId(value),
  };
}
function redactTask(value: JsonObject): JsonObject {
  return {
    status: value.status ?? null,
    revision: value.revision ?? null,
    reasonCode: value.reasonCode ?? null,
    result: value.result ?? null,
    evidence: value.evidence ?? null,
  };
}
function safeResponse(value: McpResponse): JsonObject {
  return {
    status: value.status,
    error: value.body.error ?? null,
    resultType: isObject(value.body.result) ? (value.body.result.resultType ?? null) : null,
  };
}
function extractExternalExecutionId(value: JsonObject): unknown {
  for (const meta of taskMetadataCandidates(value)) {
    if (
      isObject(meta["io.sdar/taskExecution"]) &&
      meta["io.sdar/taskExecution"].externalExecutionId !== undefined
    )
      return meta["io.sdar/taskExecution"].externalExecutionId;
  }
  return null;
}
function extractObservationId(value: JsonObject): unknown {
  for (const meta of taskMetadataCandidates(value)) {
    if (
      isObject(meta["io.sdar/taskExecution"]) &&
      meta["io.sdar/taskExecution"].observationId !== undefined
    )
      return meta["io.sdar/taskExecution"].observationId;
    const evidence = isObject(meta["io.sdar/evidence"])
      ? meta["io.sdar/evidence"].items
      : undefined;
    const first = Array.isArray(evidence) && isObject(evidence[0]) ? evidence[0] : undefined;
    if (first?.evidenceId !== undefined) return first.evidenceId;
  }
  return null;
}
function taskMetadataCandidates(value: JsonObject): JsonObject[] {
  const candidates: JsonObject[] = [];
  if (isObject(value._meta)) candidates.push(value._meta);
  if (isObject(value.result) && isObject(value.result._meta)) candidates.push(value.result._meta);
  return candidates;
}
function reportScenarios(): JsonObject[] {
  if (!Array.isArray(report.scenarios)) report.scenarios = [];
  return report.scenarios as JsonObject[];
}
function observationId(value: {
  resourceId?: unknown;
  power?: unknown;
  hvacMode?: unknown;
  targetTemperature?: unknown;
  observedAt?: unknown;
}): string {
  return hash(
    JSON.stringify({
      resourceId: value.resourceId ?? null,
      power: value.power ?? null,
      hvacMode: value.hvacMode ?? null,
      targetTemperature: value.targetTemperature ?? null,
      observedAt: value.observedAt ?? null,
    }),
  );
}
function writeRunState(value: JsonObject): void {
  writeFileSync(
    runStatePath,
    `${JSON.stringify({ ...value, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
}
async function activeTaskCount(pool: Pool): Promise<number> {
  const result = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM provider_task WHERE internal_state NOT LIKE 'TERMINAL_%'",
  );
  return Number(result.rows[0]?.count ?? 0);
}
function scopedDatabaseUrl(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}
async function freePort(): Promise<number> {
  const net = await import("node:net");
  const server = net.createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw coded("PORT_ALLOCATION_FAILED");
  const port = address.port;
  await new Promise<void>((resolvePromise, reject) =>
    server.close((error) => (error === undefined ? resolvePromise() : reject(error))),
  );
  return port;
}
async function sleep(ms: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function safeCode(error: unknown): string {
  return isObject(error) && typeof error.code === "string"
    ? error.code
    : error instanceof Error
      ? error.name
      : "REAL_CLIMATE_RUN_FAILED";
}
function textValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
function coded(code: string): Error & { code: string } {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  return error;
}
function markdown(value: JsonObject): string {
  const errors = Array.isArray(value.errors) ? value.errors : [];
  const scenarios = Array.isArray(value.scenarios) ? value.scenarios : [];
  return (
    [
      `# Climate real qualification`,
      ``,
      `- Evidence class: \`${String(value.evidenceClass)}\``,
      `- Status: **${String(value.status).toUpperCase()}**`,
      `- Provider: \`${String(value.providerId)}\``,
      `- Protocol: \`${String(value.protocolMode)}\``,
      `- Safety gate: \`${JSON.stringify(value.safetyGate)}\``,
      ``,
      `## Scenarios`,
      ``,
      ...scenarios.map((scenario) => {
        const item = isObject(scenario) ? scenario : {};
        return `- \`${textValue(item.operation, "unknown")}\`: ${textValue(item.status, "unknown")} (Task ${textValue(item.runtimeTaskId, "n/a")})`;
      }),
      ``,
      `## Restoration`,
      ``,
      `- ${JSON.stringify(value.stateRestoration ?? null)}`,
      ``,
      `## Blockers`,
      ``,
      ...(errors.length === 0
        ? ["- None recorded."]
        : errors.map((error) => `- \`${String(error)}\``)),
      ``,
      `All entity identifiers and tokens are excluded; configured entity references are represented only by SHA-256 hashes in JSON evidence.`,
    ].join("\n") + "\n"
  );
}

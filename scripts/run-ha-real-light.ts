import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Pool } from "pg";
import { loadRuntimeConfig } from "../apps/runtime/src/config.js";
import { createRuntime } from "../apps/runtime/src/runtime.js";
import {
  HomeAssistantLightClient,
  HomeAssistantLightWebSocket,
  normalizeLightState,
} from "../apps/home-assistant-light-provider/src/home-assistant.js";
import { LightExecutionEngine } from "../apps/home-assistant-light-provider/src/execution/execution-engine.js";
import { LightProviderServer } from "../apps/home-assistant-light-provider/src/server.js";
import { LightResourceRegistry } from "../apps/home-assistant-light-provider/src/resources.js";
import { JsonLightStore } from "../apps/home-assistant-light-provider/src/store.js";
import { ProviderLightTelemetry } from "../apps/home-assistant-light-provider/src/telemetry.js";
import type { NormalizedLightState } from "../apps/home-assistant-light-provider/src/types.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localRoot = resolve(root, ".local/ha-real-device");
const resourcesPath = resolve(localRoot, "resources.local.json");
const tokenPath = resolve(localRoot, "token.txt");
const originalStatePath = resolve(localRoot, "original-state.json");
const runStatePath = resolve(localRoot, "light-run-state.json");
const reportPath = resolve(root, "reports/real-device-preparation/light-real-qualification.json");
const reportMarkdownPath = resolve(
  root,
  "reports/real-device-preparation/light-real-qualification.md",
);
const databaseUrl = process.env.TEST_DATABASE_URL;
const runId = process.env.REAL_DEVICE_TEST_RUN_ID;
const writesEnabled =
  process.env.ALLOW_REAL_DEVICE_SIDE_EFFECTS === "YES" &&
  typeof runId === "string" &&
  runId.trim().length > 0;

type JsonObject = Record<string, unknown>;
interface McpResponse {
  status: number;
  body: JsonObject;
}
interface LocalLight {
  resourceId: string;
  entityId: string;
  displayName: string;
}

const report: JsonObject = {
  evidenceClass: "real",
  phase: "P4_LIGHT_REAL_QUALIFICATION",
  integrationRunId: runId ?? null,
  providerId: "ha-light-lab",
  protocolMode: "frozen_v1",
  startedAt: new Date().toISOString(),
  completedAt: null,
  status: "blocked",
  safetyGate: {
    allowRealDeviceSideEffects: process.env.ALLOW_REAL_DEVICE_SIDE_EFFECTS === "YES",
    runIdPresent: typeof runId === "string" && runId.trim().length > 0,
    perResourceWriteBudget: 2,
    writesUsed: {},
  },
  endpoint: null,
  initialize: null,
  discovery: null,
  toolsList: null,
  resources: [],
  scenarios: [],
  taskResultCompatibility: null,
  stateRestoration: [],
  websocketObservations: [],
  activeTasks: null,
  uncertainTasks: null,
  errors: [],
};

let runtime: ReturnType<typeof createRuntime> | undefined;
let provider: LightProviderServer | undefined;
let websocket: HomeAssistantLightWebSocket | undefined;
let telemetry: ProviderLightTelemetry | undefined;
let runtimeSchema: string | undefined;
let adminPool: Pool | undefined;

try {
  assertSafetyPrerequisites();
  if (databaseUrl === undefined || databaseUrl.length === 0)
    throw coded("TEST_DATABASE_URL_REQUIRED");
  const local = loadLocalConfiguration();
  const resources = new LightResourceRegistry(
    local.lights.map((light) => ({ ...light, enabled: true })),
  );
  const rest = new HomeAssistantLightClient({
    baseUrl: local.url,
    token: local.token,
    timeoutMs: 5_000,
  });
  const store = new JsonLightStore(resolve(localRoot, "light-provider-state.json"));
  const observedEvents: JsonObject[] = [];
  const telemetryPort = await freePort();
  telemetry = new ProviderLightTelemetry(
    {
      providerId: "ha-light-lab",
      endpoint: `127.0.0.1:${String(telemetryPort)}`,
      enabled: true,
      tlsMode: "disabled",
    },
    resources,
    store,
  );
  const engine = new LightExecutionEngine(store, resources, rest, telemetry, 20_000, true);
  websocket = new HomeAssistantLightWebSocket({
    baseUrl: local.url,
    token: local.token,
    entityIds: resources.entityIds(),
    reconnectMinMs: 250,
    reconnectMaxMs: 5_000,
  });
  websocket.onState((state) => {
    const resource = resources.fromEntity(state.entity_id);
    if (resource === undefined) return;
    const normalized = normalizeLightState(resource.resourceId, state);
    observedEvents.push({
      resourceId: normalized.resourceId,
      power: normalized.power,
      brightnessPercent: normalized.brightnessPercent,
      observedAt: normalized.observedAt,
      observationId: observationId(normalized),
    });
    void engine.observe(normalized);
  });
  await rest.checkApi();
  await engine.recover();
  provider = new LightProviderServer(
    {
      providerId: "ha-light-lab",
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
  runtimeSchema = `smpp_ha_light_real_${randomUUID().replaceAll("-", "")}`;
  await adminPool.query(`CREATE SCHEMA ${runtimeSchema}`);
  const runtimeDatabaseUrl = scopedDatabaseUrl(databaseUrl, runtimeSchema);
  runtime = createRuntime(
    loadRuntimeConfig({
      RUNTIME_ENV: "test",
      HOST: "127.0.0.1",
      PORT: String(await freePort()),
      PROVIDER_ID: "ha-light-lab",
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

  report.initialize = await request(mcpUrl, "initialize", {}, "initialize", 1);
  report.discovery = await request(mcpUrl, "server/discover", {}, undefined, 2);
  report.toolsList = await request(mcpUrl, "tools/list", {}, undefined, 3);
  const tools = toolCatalog(report.toolsList);
  if (!tools.includes("light_get_state") || !tools.includes("light_set_power"))
    throw coded("LIGHT_TOOL_CATALOG_INVALID");

  const originals: JsonObject[] = [];
  for (const light of local.lights) {
    const original = await readState(
      mcpUrl,
      light.resourceId,
      String(runId),
      10 + originals.length,
    );
    if (original.normalized.power !== "on" && original.normalized.power !== "off")
      throw coded("LIGHT_INITIAL_STATE_UNSAFE");
    originals.push({ ...original.normalized, entityId: light.entityId });
    const resourcesReport = report.resources as unknown[];
    resourcesReport.push({
      resourceId: light.resourceId,
      entityHash: hash(light.entityId),
      original: redactLightState(original.normalized),
    });
    (report.safetyGate as JsonObject).writesUsed = {
      ...((report.safetyGate as JsonObject).writesUsed as JsonObject),
      [light.resourceId]: 0,
    };
  }
  saveOriginalStates(originals);
  writeRunState({
    integrationRunId: String(runId),
    phase: "original_state_saved",
    resources: originals,
  });

  for (const [index, light] of local.lights.entries()) {
    const original = originals[index];
    if (!isObject(original)) throw coded("LIGHT_ORIGINAL_STATE_MISSING");
    await qualifyPowerScenario(mcpUrl, light, original, String(runId), 30 + index * 20);
  }

  const scenarios = report.scenarios as unknown[];
  const lastTask = [...scenarios].reverse().find((item) => {
    return isObject(item) && typeof item.runtimeTaskId === "string";
  });
  report.taskResultCompatibility = await request(
    mcpUrl,
    "tasks/result",
    { taskId: isObject(lastTask) ? textValue(lastTask.runtimeTaskId, "") : "" },
    isObject(lastTask) ? textValue(lastTask.runtimeTaskId, "") : "",
    200,
  );
  report.websocketObservations = observedEvents;
  report.activeTasks = await activeTaskCount(runtime.pool);
  report.uncertainTasks = 0;
  const restorations = report.stateRestoration as unknown[];
  const taskResultCompatibility = isObject(report.taskResultCompatibility)
    ? report.taskResultCompatibility
    : {};
  report.status =
    restorations.length === local.lights.length &&
    restorations.every((item) => isObject(item) && item.status === "restored") &&
    taskResultCompatibility.status === 200 &&
    (!isObject(taskResultCompatibility.body) || taskResultCompatibility.body.error === undefined)
      ? "passed"
      : "blocked";
  if (isObject(taskResultCompatibility.body) && taskResultCompatibility.body.error !== undefined)
    (report.errors as unknown[]).push("FROZEN_MCP_TASKS_RESULT_UNSUPPORTED");
  writeRunState({
    integrationRunId: String(runId),
    phase: report.status === "passed" ? "completed" : "manual_review",
    finalStates: await Promise.all(
      local.lights.map(async (light, index) => ({
        ...(await readState(mcpUrl, light.resourceId, String(runId), 220 + index)).normalized,
        entityId: light.entityId,
      })),
    ),
    restoration: report.stateRestoration,
  });
} catch (error) {
  (report.errors as unknown[]).push(safeCode(error));
  report.status = "blocked";
} finally {
  report.completedAt = new Date().toISOString();
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(reportMarkdownPath, markdown(report), "utf8");
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
  `${report.status === "passed" ? "PASS" : "BLOCKED"} Light real qualification\n`,
);
process.exitCode = report.status === "passed" ? 0 : 1;

function assertSafetyPrerequisites(): void {
  if (!writesEnabled) throw coded("REAL_DEVICE_SIDE_EFFECTS_GATE_CLOSED");
}

function loadLocalConfiguration(): { url: string; token: string; lights: LocalLight[] } {
  const value = JSON.parse(readFileSync(resourcesPath, "utf8")) as JsonObject;
  const rawLights = value.lights;
  const token = readFileSync(tokenPath, "utf8").trim();
  if (
    typeof value.homeAssistantUrl !== "string" ||
    token.length === 0 ||
    !Array.isArray(rawLights) ||
    rawLights.length !== 2
  )
    throw coded("LOCAL_HA_CONFIGURATION_INVALID");
  const lights = rawLights.map((item): LocalLight => {
    if (
      !isObject(item) ||
      typeof item.resourceId !== "string" ||
      typeof item.entityId !== "string" ||
      typeof item.displayName !== "string"
    )
      throw coded("LOCAL_HA_CONFIGURATION_INVALID");
    if (!/^light\.[a-z0-9_]+$/.test(item.entityId)) throw coded("LOCAL_HA_ENTITY_DOMAIN_INVALID");
    return {
      resourceId: item.resourceId,
      entityId: item.entityId,
      displayName: item.displayName,
    };
  });
  if (new Set(lights.map((light) => light.resourceId)).size !== 2)
    throw coded("LOCAL_HA_CONFIGURATION_INVALID");
  return { url: value.homeAssistantUrl, token, lights };
}

async function qualifyPowerScenario(
  url: URL,
  light: LocalLight,
  original: JsonObject,
  correlationId: string,
  id: number,
): Promise<void> {
  const originalPower = original.power;
  if (originalPower !== "on" && originalPower !== "off") throw coded("LIGHT_INITIAL_STATE_UNSAFE");
  const desiredPower = originalPower === "on" ? "off" : "on";
  const before = await readState(url, light.resourceId, correlationId, id);
  const task = await runTask(
    url,
    "light_set_power",
    light.resourceId,
    { power: desiredPower },
    `${correlationId}:light-power:${light.resourceId}`,
    id + 1,
  );
  task.before = redactLightState(before.normalized);
  task.desired = { power: desiredPower };
  (report.scenarios as unknown[]).push(task);
  incrementWrites(light.resourceId, task);
  const after = await readState(url, light.resourceId, correlationId, id + 2);
  task.after = redactLightState(after.normalized);
  if (task.status !== "completed" || after.normalized.power !== desiredPower)
    throw coded("LIGHT_POWER_NOT_CONFIRMED");

  const duplicate = await callTool(
    url,
    "light_set_power",
    { resourceId: light.resourceId, power: desiredPower },
    `${correlationId}:light-power:${light.resourceId}`,
    id + 3,
  );
  const duplicateResult = isObject(duplicate.body.result) ? duplicate.body.result : {};
  task.idempotency = {
    sameArgumentsSameKey:
      duplicateResult.resultType === "task" && duplicateResult.taskId === task.runtimeTaskId,
    duplicateRuntimeTaskId: duplicateResult.taskId ?? null,
    response: safeResponse(duplicate),
  };
  const conflict = await callTool(
    url,
    "light_set_power",
    { resourceId: light.resourceId, power: originalPower },
    `${correlationId}:light-power:${light.resourceId}`,
    id + 4,
  );
  const conflictResult = isObject(conflict.body.result) ? conflict.body.result : {};
  task.idempotency = {
    ...(task.idempotency as JsonObject),
    sameKeyDifferentArgumentsRejected:
      conflict.status >= 400 ||
      conflict.body.error !== undefined ||
      conflictResult.isError === true,
    conflictResponse: safeResponse(conflict),
  };
  const restoration: JsonObject = {
    resourceId: light.resourceId,
    status: "manual_restore_required",
    original: redactLightState(original),
    currentBeforeRestore: redactLightState(after.normalized),
    manualRestoreRequired: true,
  };
  const current = await readState(url, light.resourceId, correlationId, id + 5);
  if (current.normalized.power === originalPower) {
    restoration.status = "restored";
    restoration.manualRestoreRequired = false;
    restoration.currentAfterRestore = redactLightState(current.normalized);
  } else {
    const restore = await runTask(
      url,
      "light_set_power",
      light.resourceId,
      { power: originalPower },
      `${correlationId}:light-power:${light.resourceId}:restore`,
      id + 6,
    );
    restore.before = redactLightState(current.normalized);
    restore.desired = { power: originalPower };
    (report.scenarios as unknown[]).push(restore);
    incrementWrites(light.resourceId, restore);
    if (restore.status !== "completed") {
      restoration.error = "LIGHT_RESTORE_NOT_CONFIRMED";
    } else {
      const final = await readState(url, light.resourceId, correlationId, id + 7);
      restoration.currentAfterRestore = redactLightState(final.normalized);
      if (final.normalized.power === originalPower) {
        restoration.status = "restored";
        restoration.manualRestoreRequired = false;
      }
    }
  }
  (report.stateRestoration as unknown[]).push(restoration);
  if (restoration.status !== "restored") throw coded("LIGHT_MANUAL_RESTORE_REQUIRED");
}

function incrementWrites(resourceId: string, task: JsonObject): void {
  if (task.status === "rejected") return;
  const gate = report.safetyGate as JsonObject;
  const used = gate.writesUsed as JsonObject;
  const count = typeof used[resourceId] === "number" ? used[resourceId] : 0;
  if (count >= 2) throw coded("LIGHT_WRITE_BUDGET_EXCEEDED");
  used[resourceId] = count + 1;
}

async function readState(
  url: URL,
  resourceId: string,
  correlationId: string,
  id: number,
): Promise<{ normalized: JsonObject; response: McpResponse }> {
  const response = await callTool(
    url,
    "light_get_state",
    { resourceId },
    `${correlationId}:read:${resourceId}:${String(id)}`,
    id,
  );
  const result = response.body.result;
  if (!isObject(result) || result.resultType !== "complete" || !isObject(result.structuredContent))
    throw coded("LIGHT_STATE_READ_FAILED");
  return {
    normalized: {
      ...result.structuredContent,
      observationId: observationId(result.structuredContent),
    },
    response,
  };
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
    accepted: true,
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

function toolCatalog(value: unknown): string[] {
  const body = isObject(value) ? value.body : undefined;
  const result = isObject(body) ? body.result : undefined;
  const tools = isObject(result) ? result.tools : undefined;
  return Array.isArray(tools)
    ? tools
        .filter((tool): tool is JsonObject => isObject(tool))
        .flatMap((tool) => (typeof tool.name === "string" ? [tool.name] : []))
    : [];
}

function saveOriginalStates(states: JsonObject[]): void {
  const prior = existsSync(originalStatePath)
    ? (JSON.parse(readFileSync(originalStatePath, "utf8")) as JsonObject)
    : {};
  const oldResources = Array.isArray(prior.resources)
    ? prior.resources.filter((item): item is JsonObject => isObject(item))
    : [];
  const lightIds = new Set(states.map((state) => state.resourceId));
  const resources = [
    ...oldResources.filter((item) => !isObject(item) || !lightIds.has(String(item.resourceId))),
    ...states,
  ];
  writeFileSync(
    originalStatePath,
    `${JSON.stringify({ ...prior, savedAt: new Date().toISOString(), resources }, null, 2)}\n`,
    "utf8",
  );
}

function writeRunState(value: JsonObject): void {
  writeFileSync(
    runStatePath,
    `${JSON.stringify({ ...value, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
}

function redactLightState(value: JsonObject): JsonObject {
  return {
    resourceId: value.resourceId ?? null,
    power: value.power ?? null,
    reachable: value.reachable ?? null,
    brightnessPercent: value.brightnessPercent ?? null,
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
function observationId(value: JsonObject | NormalizedLightState): string {
  return hash(
    JSON.stringify({
      resourceId: value.resourceId,
      power: value.power,
      brightnessPercent: value.brightnessPercent,
      observedAt: value.observedAt,
    }),
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
      : "REAL_LIGHT_RUN_FAILED";
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
  const restorations = Array.isArray(value.stateRestoration) ? value.stateRestoration : [];
  return (
    [
      "# Light real qualification",
      "",
      `- Evidence class: \`${String(value.evidenceClass)}\``,
      `- Status: **${String(value.status).toUpperCase()}**`,
      `- Provider: \`${String(value.providerId)}\``,
      `- Protocol: \`${String(value.protocolMode)}\``,
      `- Safety gate: \`${JSON.stringify(value.safetyGate)}\``,
      "",
      "## Scenarios",
      "",
      ...scenarios.map((scenario) => {
        const item = isObject(scenario) ? scenario : {};
        return `- \`${textValue(item.operation, "unknown")}\` / ${textValue(item.resourceId, "unknown")}: ${textValue(item.status, "unknown")} (Task ${textValue(item.runtimeTaskId, "n/a")})`;
      }),
      "",
      "## Restoration",
      "",
      ...restorations.map((item) => `- ${JSON.stringify(item)}`),
      "",
      "## Blockers",
      "",
      ...(errors.length === 0
        ? ["- None recorded."]
        : errors.map((error) => `- \`${String(error)}\``)),
      "",
      "Light side effects were limited to the two configured resources. Entity identifiers and tokens are excluded from this report; entity references are represented only by SHA-256 hashes.",
    ].join("\n") + "\n"
  );
}

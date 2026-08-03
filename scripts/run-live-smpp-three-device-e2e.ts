import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

const ROOT = resolve(process.cwd());
const ENVIRONMENT = "home-lab";
const API_BASE_URL = process.env.SMPP_PMS_API_URL ?? "http://127.0.0.1:8090";
const RUN_ID = process.env.REAL_DEVICE_TEST_RUN_ID?.trim() ?? "";
const WRITE_GATE = process.env.ALLOW_REAL_DEVICE_SIDE_EFFECTS === "YES" && RUN_ID.length > 0;
const MANAGEMENT_TOKEN_FILE = resolve(ROOT, ".local/pms-continuation/secrets/pms-management.token");
const REPORT_DIRECTORY = resolve(ROOT, "reports/real-device-preparation-continuation");
const REPORT_PATH = resolve(REPORT_DIRECTORY, "three-device-e2e.json");
const MARKDOWN_PATH = resolve(REPORT_DIRECTORY, "three-device-e2e.md");
const STATE_PATH = resolve(ROOT, ".local/pms-continuation/three-device-run-state.json");

const CLIMATE_RESOURCE = "living-room-air-conditioner";
const LIGHT_RESOURCES = ["living-room-main-light", "living-room-aux-light"] as const;

type JsonObject = Record<string, unknown>;

interface McpResponse {
  readonly status: number;
  readonly body: JsonObject;
}

interface RegistryProvider extends JsonObject {
  readonly providerId?: unknown;
  readonly effectiveEndpoint?: unknown;
}

interface StateRecord {
  readonly providerId: string;
  readonly resourceId: string;
  readonly power: unknown;
  readonly reachable: unknown;
  readonly hvacMode: unknown;
  readonly targetTemperature: unknown;
  readonly currentTemperature: unknown;
  readonly brightnessPercent: unknown;
  readonly observedAt: unknown;
  readonly observationId: unknown;
}

const integrationRunId = RUN_ID || `smpp-three-device-${randomUUID()}`;
const report: JsonObject = {
  evidenceClass: "real",
  phase: "P6_MCP_REAL_DEVICE_E2E",
  integrationRunId,
  environment: ENVIRONMENT,
  startedAt: new Date().toISOString(),
  completedAt: null,
  status: "blocked",
  safetyGate: {
    allowRealDeviceSideEffects: process.env.ALLOW_REAL_DEVICE_SIDE_EFFECTS === "YES",
    runIdPresent: RUN_ID.length > 0,
    writeGateOpen: WRITE_GATE,
    lightWriteBudgetPerResource: 2,
    climatePowerWriteBudget: { on: 1, off: 1 },
    writesUsed: {},
  },
  registry: null,
  initialStates: [],
  scenarios: [],
  finalStates: [],
  stateRestoration: [],
  climateSafety: null,
  runtimeTaskCounts: null,
  errors: [],
};

try {
  if (!WRITE_GATE) throw new Error("REAL_DEVICE_SIDE_EFFECTS_GATE_CLOSED");
  const token = (await readFile(MANAGEMENT_TOKEN_FILE, "utf8")).trim();
  if (token.length === 0) throw new Error("PMS_MANAGEMENT_TOKEN_EMPTY");
  const registry = await readRegistry(token);
  const providers = registry.providers;
  if (providers.length !== 2) throw new Error("REGISTRY_PROVIDER_COUNT_INVALID");
  report.registry = {
    revision: registry.revision,
    checksum: registry.checksum,
    providerIds: providers.map((provider) => provider.providerId ?? null),
    etag: registry.etag,
    containsEntityIdKeys: containsKey(registry.body, /entityid/i),
    containsSecretKeys: containsKey(registry.body, /token|secret|authorization|password/i),
  };
  if (
    containsKey(registry.body, /entityid/i) ||
    containsKey(registry.body, /token|secret|authorization|password/i)
  ) {
    throw new Error("REGISTRY_SENSITIVE_FIELDS_PRESENT");
  }

  const climateEndpoint = endpointFor(providers, "ha-climate-lab");
  const lightEndpoint = endpointFor(providers, "ha-light-lab");
  const initial = [
    await readState(climateEndpoint, "ha-climate-lab", CLIMATE_RESOURCE, 10),
    ...(await Promise.all(
      LIGHT_RESOURCES.map((resourceId, index) =>
        readState(lightEndpoint, "ha-light-lab", resourceId, 20 + index),
      ),
    )),
  ];
  report.initialStates = initial.map(redactState);
  await writeFile(
    STATE_PATH,
    `${JSON.stringify({ integrationRunId, initialStates: initial.map(redactState) }, null, 2)}\n`,
    "utf8",
  );

  const climate = initial[0];
  if (climate === undefined) throw new Error("CLIMATE_INITIAL_STATE_MISSING");
  report.climateSafety = {
    status: climate.power === "off" ? "MANUAL_SAFETY_BLOCK" : "not_executed",
    original: redactState(climate),
    current: redactState(climate),
    reason:
      climate.power === "off"
        ? "Climate write skipped: changing HVAC mode may change power state and the inverse operation is protected by the five-minute safety interval."
        : "Climate write was not attempted by this light-focused controlled run.",
  };

  const lightRestorations: JsonObject[] = [];
  for (const [index, resourceId] of LIGHT_RESOURCES.entries()) {
    const original = initial[index + 1];
    if (original === undefined) throw new Error(`LIGHT_INITIAL_STATE_MISSING:${resourceId}`);
    lightRestorations.push(
      await qualifyLight(
        lightEndpoint,
        resourceId,
        original,
        `${integrationRunId}:light:${resourceId}`,
        100 + index * 30,
      ),
    );
  }
  report.stateRestoration = lightRestorations;

  const finalStates = [
    await readState(climateEndpoint, "ha-climate-lab", CLIMATE_RESOURCE, 300),
    ...(await Promise.all(
      LIGHT_RESOURCES.map((resourceId, index) =>
        readState(lightEndpoint, "ha-light-lab", resourceId, 310 + index),
      ),
    )),
  ];
  report.finalStates = finalStates.map(redactState);
  report.runtimeTaskCounts = await runtimeTaskCounts();
  const lightsRestored = lightRestorations.every((item) => item.status === "restored");
  const noUncertain =
    report.runtimeTaskCounts !== null && (report.runtimeTaskCounts as JsonObject).uncertain === 0;
  report.status = lightsRestored && noUncertain ? "blocked_climate_safety" : "blocked";
} catch (error) {
  (report.errors as unknown[]).push(safeError(error));
  report.status = "blocked";
} finally {
  report.completedAt = new Date().toISOString();
  await mkdir(REPORT_DIRECTORY, { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(MARKDOWN_PATH, renderMarkdown(report), "utf8");
}

process.stdout.write(
  `${report.status === "blocked_climate_safety" ? "BLOCKED_CLIMATE_SAFETY" : "BLOCKED"} Three-device MCP E2E\n`,
);
process.exitCode = 1;

async function readRegistry(token: string): Promise<{
  readonly body: JsonObject;
  readonly providers: readonly RegistryProvider[];
  readonly revision: unknown;
  readonly checksum: unknown;
  readonly etag: string | null;
}> {
  const response = await fetch(`${API_BASE_URL}/api/v1/registry/${ENVIRONMENT}/latest`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "x-sdar-actor": "smpp-continuation-admin",
      "x-sdar-correlation-id": integrationRunId,
    },
  });
  const body = (await response.json()) as JsonObject;
  const document = asObject(body.document);
  const providers = Array.isArray(document?.providers) ? document.providers.filter(isObject) : [];
  if (response.status !== 200) throw new Error("REGISTRY_LATEST_NOT_AVAILABLE");
  return {
    body,
    providers,
    revision: body.revision,
    checksum: body.checksum,
    etag: response.headers.get("etag"),
  };
}

function endpointFor(providers: readonly RegistryProvider[], providerId: string): string {
  const provider = providers.find((item) => item.providerId === providerId);
  const endpoint = provider?.effectiveEndpoint;
  if (typeof endpoint !== "string" || !/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(endpoint)) {
    throw new Error(`RUNTIME_ENDPOINT_INVALID:${providerId}`);
  }
  return endpoint;
}

async function qualifyLight(
  endpoint: string,
  resourceId: string,
  original: StateRecord,
  key: string,
  requestId: number,
): Promise<JsonObject> {
  const restoration: JsonObject = {
    resourceId,
    status: "manual_restore_required",
    original: redactState(original),
    currentBeforeRestore: null,
    currentAfterRestore: null,
    writesUsed: 0,
    idempotency: null,
  };
  if (original.power !== "on" && original.power !== "off") {
    restoration.reason = "LIGHT_INITIAL_STATE_UNSAFE";
    return restoration;
  }
  const desiredPower = original.power === "on" ? "off" : "on";
  const before = await readState(endpoint, "ha-light-lab", resourceId, requestId);
  const task = await runTask(
    endpoint,
    "ha-light-lab",
    "light_set_power",
    resourceId,
    { power: desiredPower },
    key,
    requestId + 1,
  );
  (report.scenarios as unknown[]).push({
    providerId: "ha-light-lab",
    resourceId,
    operation: "light_set_power",
    before: redactState(before),
    desired: { power: desiredPower },
    ...task,
  });
  if (task.status !== "completed") {
    restoration.reason = "LIGHT_POWER_CONFIRMATION_FAILED";
    return restoration;
  }
  incrementLightWrite(resourceId, restoration);
  const after = await readState(endpoint, "ha-light-lab", resourceId, requestId + 2);
  restoration.currentBeforeRestore = redactState(after);
  if (after.power !== desiredPower) {
    restoration.reason = "LIGHT_POWER_STATE_MISMATCH";
    return restoration;
  }

  const duplicate = await callTool(
    endpoint,
    "ha-light-lab",
    "light_set_power",
    resourceId,
    { power: desiredPower },
    key,
    requestId + 3,
  );
  const duplicateResult = asObject(duplicate.body.result);
  const duplicateTaskId =
    typeof duplicateResult?.taskId === "string" ? duplicateResult.taskId : null;
  const conflict = await callTool(
    endpoint,
    "ha-light-lab",
    "light_set_power",
    resourceId,
    { power: original.power },
    key,
    requestId + 4,
  );
  const conflictRejected =
    conflict.status >= 400 ||
    conflict.body.error !== undefined ||
    asObject(conflict.body.result)?.isError === true;
  restoration.idempotency = {
    sameArgumentsSameTask: duplicateTaskId === task.runtimeTaskId,
    sameTaskId: duplicateTaskId,
    differentArgumentsRejected: conflictRejected,
    duplicateHttpStatus: duplicate.status,
    conflictHttpStatus: conflict.status,
  };

  const current = await readState(endpoint, "ha-light-lab", resourceId, requestId + 5);
  if (current.power === original.power) {
    restoration.status = "restored";
    restoration.currentAfterRestore = redactState(current);
    return restoration;
  }
  const writesUsed = typeof restoration.writesUsed === "number" ? restoration.writesUsed : 0;
  if (writesUsed >= 2) {
    restoration.reason = "LIGHT_WRITE_BUDGET_EXCEEDED";
    return restoration;
  }
  const restore = await runTask(
    endpoint,
    "ha-light-lab",
    "light_set_power",
    resourceId,
    { power: original.power },
    `${key}:restore`,
    requestId + 6,
  );
  (report.scenarios as unknown[]).push({
    providerId: "ha-light-lab",
    resourceId,
    operation: "light_set_power.restore",
    before: redactState(current),
    desired: { power: original.power },
    ...restore,
  });
  if (restore.status !== "completed") {
    restoration.reason = "LIGHT_RESTORE_CONFIRMATION_FAILED";
    return restoration;
  }
  incrementLightWrite(resourceId, restoration);
  const final = await readState(endpoint, "ha-light-lab", resourceId, requestId + 7);
  restoration.currentAfterRestore = redactState(final);
  restoration.status = final.power === original.power ? "restored" : "manual_restore_required";
  if (restoration.status !== "restored") restoration.reason = "LIGHT_RESTORE_STATE_MISMATCH";
  return restoration;
}

async function readState(
  endpoint: string,
  providerId: string,
  resourceId: string,
  id: number,
): Promise<StateRecord> {
  const operation = providerId === "ha-climate-lab" ? "climate_get_state" : "light_get_state";
  const response = await callTool(
    endpoint,
    providerId,
    operation,
    resourceId,
    {},
    `read:${integrationRunId}:${resourceId}:${String(id)}`,
    id,
  );
  const result = asObject(response.body.result);
  const content = asObject(result?.structuredContent);
  if (response.status !== 200 || result?.resultType !== "complete" || content === undefined) {
    throw new Error(`MCP_READ_FAILED:${providerId}:${resourceId}`);
  }
  return {
    providerId,
    resourceId,
    power: content.power ?? null,
    reachable: content.reachable ?? null,
    hvacMode: content.hvacMode ?? null,
    targetTemperature: content.targetTemperature ?? null,
    currentTemperature: content.currentTemperature ?? null,
    brightnessPercent: content.brightnessPercent ?? null,
    observedAt: content.observedAt ?? null,
    observationId: content.observationId ?? null,
  };
}

async function runTask(
  endpoint: string,
  providerId: string,
  operation: string,
  resourceId: string,
  args: JsonObject,
  key: string,
  id: number,
): Promise<JsonObject> {
  const response = await callTool(endpoint, providerId, operation, resourceId, args, key, id);
  const result = asObject(response.body.result);
  if (
    response.status !== 200 ||
    result?.resultType !== "task" ||
    typeof result.taskId !== "string"
  ) {
    return { status: "rejected", runtimeTaskId: null, response: safeResponse(response) };
  }
  const taskId = result.taskId;
  const snapshots: JsonObject[] = [];
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const get = await request(endpoint, "tasks/get", { taskId }, taskId, id + 100 + attempt);
    const snapshot = asObject(get.body.result) ?? {};
    snapshots.push({
      status: snapshot.status ?? null,
      revision: snapshot.revision ?? null,
      reasonCode: snapshot.reasonCode ?? null,
    });
    if (["completed", "failed", "cancelled"].includes(String(snapshot.status))) {
      return {
        status: snapshot.status,
        accepted: true,
        runtimeTaskId: taskId,
        correlationId: key,
        taskStatuses: snapshots,
        finalTask: redactTask(snapshot),
        adapterExternalExecutionId: externalExecutionId(snapshot),
        homeAssistantObservationId: observationIdFromTask(snapshot),
      };
    }
    await delay(250);
  }
  return {
    status: "confirmation_timeout",
    accepted: true,
    runtimeTaskId: taskId,
    correlationId: key,
    taskStatuses: snapshots,
    adapterExternalExecutionId: null,
    homeAssistantObservationId: null,
  };
}

async function callTool(
  endpoint: string,
  providerId: string,
  operation: string,
  resourceId: string,
  args: JsonObject,
  key: string,
  id: number,
): Promise<McpResponse> {
  return request(
    endpoint,
    "tools/call",
    { name: operation, arguments: { resourceId, ...args } },
    operation,
    id,
    `${integrationRunId}:${providerId}:${key}`,
  );
}

async function request(
  endpoint: string,
  method: string,
  params: JsonObject,
  name: string,
  id: number,
  idempotencyKey?: string,
): Promise<McpResponse> {
  const meta: JsonObject = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": {
      name: "smpp-three-device-real-device-preparation",
      version: "1.0.0",
    },
    "io.modelcontextprotocol/clientCapabilities": {
      extensions: { "io.modelcontextprotocol/tasks": {} },
    },
    ...(idempotencyKey === undefined
      ? {}
      : { "io.sdar/taskExecution": { profileVersion: "1.0", idempotencyKey } }),
  };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      "mcp-name": name,
      "x-sdar-subject": "smpp-real-device-runner",
      "x-sdar-tenant": ENVIRONMENT,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params: { ...params, _meta: meta } }),
  });
  const body = (await response.json()) as JsonObject;
  return { status: response.status, body };
}

function incrementLightWrite(resourceId: string, restoration: JsonObject): void {
  const writes = asObject(report.safetyGate)?.writesUsed;
  if (!isObject(writes)) throw new Error("SAFETY_BUDGET_STATE_INVALID");
  const writeValue = writes[resourceId];
  const used = typeof writeValue === "number" ? writeValue : 0;
  if (used >= 2) throw new Error(`LIGHT_WRITE_BUDGET_EXCEEDED:${resourceId}`);
  writes[resourceId] = used + 1;
  const previousWrites = typeof restoration.writesUsed === "number" ? restoration.writesUsed : 0;
  restoration.writesUsed = previousWrites + 1;
}

async function runtimeTaskCounts(): Promise<JsonObject> {
  const counts: JsonObject = { active: 0, uncertain: 0, runtimes: [] };
  for (const [providerId, deploymentId] of [
    ["ha-climate-lab", "ha-climate-deployment"],
    ["ha-light-lab", "ha-light-deployment"],
  ] as const) {
    const secretPath = resolve(
      ROOT,
      `.local/pms-continuation/roots/runtime-secrets/deployments/${deploymentId}/instances/database/runtime.secret`,
    );
    const url = (await readFile(secretPath, "utf8")).trim();
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      const result = await pool.query<{ internal_state: string; count: string }>(
        `SELECT internal_state, count(*)::text AS count FROM provider_task GROUP BY internal_state`,
      );
      const active = result.rows
        .filter((row) => !row.internal_state.startsWith("TERMINAL_"))
        .reduce((sum, row) => sum + Number(row.count), 0);
      const uncertain = result.rows
        .filter((row) => row.internal_state.toUpperCase().includes("UNCERTAIN"))
        .reduce((sum, row) => sum + Number(row.count), 0);
      counts.active = Number(counts.active) + active;
      counts.uncertain = Number(counts.uncertain) + uncertain;
      (counts.runtimes as unknown[]).push({ providerId, active, uncertain });
    } finally {
      await pool.end();
    }
  }
  return counts;
}

function redactState(value: StateRecord): JsonObject {
  return {
    providerId: value.providerId,
    resourceId: value.resourceId,
    power: value.power,
    reachable: value.reachable,
    hvacMode: value.hvacMode,
    targetTemperature: value.targetTemperature,
    currentTemperature: value.currentTemperature,
    brightnessPercent: value.brightnessPercent,
    observedAt: value.observedAt,
    observationId: value.observationId,
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

function externalExecutionId(value: JsonObject): unknown {
  for (const meta of taskMetadataCandidates(value)) {
    const taskExecution = asObject(meta["io.sdar/taskExecution"]);
    if (taskExecution?.externalExecutionId !== undefined) {
      return taskExecution.externalExecutionId;
    }
  }
  const result = asObject(value.result);
  return result?.externalExecutionId ?? value.externalExecutionId ?? null;
}

function observationIdFromTask(value: JsonObject): unknown {
  for (const meta of taskMetadataCandidates(value)) {
    const taskExecution = asObject(meta["io.sdar/taskExecution"]);
    if (taskExecution?.observationId !== undefined) return taskExecution.observationId;
    const evidenceContainer = asObject(meta["io.sdar/evidence"]);
    const evidence = evidenceContainer?.items;
    const first = Array.isArray(evidence) ? evidence.find(isObject) : undefined;
    if (first?.evidenceId !== undefined) return first.evidenceId;
  }
  const evidence = value.evidence;
  if (!Array.isArray(evidence)) return null;
  const first = evidence.find(isObject);
  return first?.evidenceId ?? null;
}

function taskMetadataCandidates(value: JsonObject): JsonObject[] {
  const candidates: JsonObject[] = [];
  if (isObject(value._meta)) candidates.push(value._meta);
  const result = asObject(value.result);
  if (result !== undefined && isObject(result._meta)) candidates.push(result._meta);
  const nestedResult = result === undefined ? undefined : asObject(result.result);
  if (nestedResult !== undefined && isObject(nestedResult._meta)) {
    candidates.push(nestedResult._meta);
  }
  return candidates;
}

function safeResponse(value: McpResponse): JsonObject {
  const result = asObject(value.body.result);
  const structuredContent = asObject(result?.structuredContent);
  return {
    status: value.status,
    error: value.body.error ?? null,
    resultType: result?.resultType ?? null,
    isError: result?.isError ?? null,
    resultKeys: result === undefined ? [] : Object.keys(result).sort(),
    structuredContentKeys:
      structuredContent === undefined ? [] : Object.keys(structuredContent).sort(),
    structuredContentOutcome: structuredContent?.outcome ?? null,
    structuredContentReasonCode: structuredContent?.reasonCode ?? null,
    content: Array.isArray(result?.content)
      ? result.content
          .filter(isObject)
          .map((item) => ({ type: item.type ?? null, text: item.text ?? null }))
      : [],
  };
}

function containsKey(value: unknown, pattern: RegExp): boolean {
  if (Array.isArray(value)) return value.some((item) => containsKey(item, pattern));
  if (!isObject(value)) return false;
  return Object.entries(value).some(
    ([key, child]) => pattern.test(key) || containsKey(child, pattern),
  );
}

function safeError(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)) return error.message;
  return "THREE_DEVICE_E2E_FAILED";
}

function renderMarkdown(value: JsonObject): string {
  const safety = asObject(value.climateSafety);
  const counts = asObject(value.runtimeTaskCounts);
  const restorations = Array.isArray(value.stateRestoration) ? value.stateRestoration : [];
  return [
    "# Three-device SMPP MCP E2E",
    "",
    `- Evidence class: \`${String(value.evidenceClass)}\``,
    `- Status: \`${String(value.status)}\``,
    `- Integration run: \`${String(value.integrationRunId)}\``,
    `- Light restorations: ${restorations.map((item) => String(asObject(item)?.status)).join(", ") || "none"}`,
    `- Runtime active/uncertain tasks: \`${displayValue(counts?.active)} / ${displayValue(counts?.uncertain)}\``,
    "",
    "The read path is Registry-backed and uses the two PMS-managed Runtime `/mcp` endpoints. Light writes are guarded by the real-device gate and each write is confirmed through `tasks/get` plus a subsequent state read.",
    "",
    `## Climate safety: \`${displayValue(safety?.status)}\``,
    "",
    displayValue(safety?.reason),
    "",
    "No `tasks/result` endpoint was called because it is not part of the repository's frozen MCP protocol surface.",
    "",
    "## Errors",
    "",
    ...(Array.isArray(value.errors) && value.errors.length > 0
      ? value.errors.map((error) => `- ${String(error)}`)
      : ["- none"]),
    "",
  ].join("\n");
}

function asObject(value: unknown): JsonObject | undefined {
  return isObject(value) ? value : undefined;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function displayValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "unverified";
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

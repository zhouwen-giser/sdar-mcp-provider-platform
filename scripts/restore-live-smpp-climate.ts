import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd());
const LOCAL_STATE_ROOT = resolve(process.env.SMPP_LOCAL_STATE_ROOT ?? resolve(ROOT, ".local"));
const PMS_CONTINUATION_ROOT = resolve(LOCAL_STATE_ROOT, "pms-continuation");
const ENVIRONMENT = "home-lab";
const API_BASE_URL = process.env.SMPP_PMS_API_URL ?? "http://127.0.0.1:8090";
const RUN_ID = process.env.REAL_DEVICE_TEST_RUN_ID?.trim() ?? "";
const GENERAL_WRITE_GATE =
  process.env.ALLOW_REAL_DEVICE_SIDE_EFFECTS === "YES" && RUN_ID.length > 0;
const CLIMATE_POWER_TEST_GATE = process.env.ALLOW_CLIMATE_POWER_TEST === "YES";
const SOURCE_REPORT = resolve(
  ROOT,
  "reports/real-device-preparation-continuation/three-device-e2e.json",
);
const REPORT_DIRECTORY = resolve(ROOT, "reports/real-device-preparation-continuation");
const REPORT_PATH = resolve(REPORT_DIRECTORY, "climate-restore-recovery.json");
const MARKDOWN_PATH = resolve(REPORT_DIRECTORY, "climate-restore-recovery.md");
const CLIMATE_RESOURCE = "living-room-air-conditioner";

type JsonObject = Record<string, unknown>;

interface McpResponse {
  readonly status: number;
  readonly body: JsonObject;
}

const integrationRunId = RUN_ID || `smpp-climate-restore-${randomUUID()}`;
const report: JsonObject = {
  evidenceClass: "real",
  phase: "P6_CLIMATE_RESTORE_RECOVERY",
  integrationRunId,
  environment: ENVIRONMENT,
  startedAt: new Date().toISOString(),
  completedAt: null,
  status: "blocked",
  safetyGate: {
    allowRealDeviceSideEffects: process.env.ALLOW_REAL_DEVICE_SIDE_EFFECTS === "YES",
    runIdPresent: RUN_ID.length > 0,
    climatePowerTestGateOpen: CLIMATE_POWER_TEST_GATE,
    writeGateOpen: GENERAL_WRITE_GATE && CLIMATE_POWER_TEST_GATE,
    writeBudget: { climatePowerOff: 1 },
    writesUsed: { climatePowerOff: 0 },
  },
  sourceInitialState: null,
  currentBeforeRestore: null,
  wait: null,
  task: null,
  finalState: null,
  deviceRestoreStatus: "unverified",
  manualRestoreRequired: false,
  activeTasks: null,
  uncertainTasks: null,
  runtimeTaskCountSource: "not_queried",
  errors: [],
};

try {
  const source = JSON.parse(await readFile(SOURCE_REPORT, "utf8")) as JsonObject;
  const initialStates = Array.isArray(source.initialStates) ? source.initialStates : [];
  const original = initialStates.find(
    (item): item is JsonObject => isObject(item) && item.resourceId === CLIMATE_RESOURCE,
  );
  if (original === undefined || (original.power !== "on" && original.power !== "off")) {
    throw new Error("CLIMATE_RESTORE_SOURCE_STATE_INVALID");
  }
  report.sourceInitialState = redactState(original);

  const managementToken = (
    await readFile(resolve(PMS_CONTINUATION_ROOT, "secrets/pms-management.token"), "utf8")
  ).trim();
  if (managementToken.length === 0) throw new Error("PMS_MANAGEMENT_TOKEN_EMPTY");
  const registry = await readRegistry(managementToken);
  const climateEndpoint = endpointFor(registry.providers);
  let current = await readState(climateEndpoint, CLIMATE_RESOURCE, 10);
  report.currentBeforeRestore = redactState(current);

  if (current.power !== original.power) {
    report.deviceRestoreStatus = "manual_restore_required";
    report.manualRestoreRequired = true;
    if (original.power !== "off" || current.power !== "on") {
      throw new Error("CLIMATE_RESTORE_POWER_STATE_UNSAFE");
    }
    if (!GENERAL_WRITE_GATE) throw new Error("REAL_DEVICE_SIDE_EFFECTS_GATE_CLOSED");
    if (!CLIMATE_POWER_TEST_GATE) throw new Error("CLIMATE_POWER_TEST_GATE_CLOSED");
    const waitMs = safetyWaitMs(current.observedAt);
    report.wait = {
      safetyIntervalMs: 300_000,
      remainingMs: waitMs,
      waitedMs: 0,
      reason: "opposite climate power operation",
    };
    if (waitMs > 0) throw new Error("CLIMATE_OPPOSITE_POWER_INTERVAL_ACTIVE");
    current = await readState(climateEndpoint, CLIMATE_RESOURCE, 11);
    if (current.power === "on") {
      const task = await runPowerOff(climateEndpoint, `${integrationRunId}:restore-power-off`, 20);
      report.task = task;
      if (task.status !== "completed") throw new Error("CLIMATE_POWER_RESTORE_CONFIRMATION_FAILED");
      const writes = asObject(asObject(report.safetyGate)?.writesUsed);
      if (writes === undefined) throw new Error("SAFETY_BUDGET_STATE_INVALID");
      writes.climatePowerOff = 1;
    }
  }

  const final = await readState(climateEndpoint, CLIMATE_RESOURCE, 30);
  report.finalState = redactState(final);
  report.status =
    final.power === original.power &&
    final.hvacMode === original.hvacMode &&
    final.targetTemperature === original.targetTemperature
      ? "passed"
      : "blocked";
  if (report.status !== "passed") throw new Error("CLIMATE_RESTORE_STATE_MISMATCH");
  report.deviceRestoreStatus = "restored";
  report.manualRestoreRequired = false;
} catch (error) {
  const code = safeError(error);
  (report.errors as unknown[]).push(code);
  if (
    [
      "REAL_DEVICE_SIDE_EFFECTS_GATE_CLOSED",
      "CLIMATE_POWER_TEST_GATE_CLOSED",
      "CLIMATE_OPPOSITE_POWER_INTERVAL_ACTIVE",
      "CLIMATE_RESTORE_POWER_STATE_UNSAFE",
      "CLIMATE_POWER_RESTORE_CONFIRMATION_FAILED",
      "CLIMATE_RESTORE_STATE_MISMATCH",
    ].includes(code)
  ) {
    report.deviceRestoreStatus = "manual_restore_required";
    report.manualRestoreRequired = true;
  }
} finally {
  report.completedAt = new Date().toISOString();
  await mkdir(REPORT_DIRECTORY, { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(MARKDOWN_PATH, renderMarkdown(report), "utf8");
}

process.stdout.write(
  `${report.status === "passed" ? "PASS" : "BLOCKED"} Climate restore recovery\n`,
);
process.exitCode = report.status === "passed" ? 0 : 1;

async function readRegistry(token: string): Promise<{ providers: JsonObject[] }> {
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
  if (response.status !== 200 || providers.length !== 2) throw new Error("REGISTRY_NOT_READY");
  if (containsKey(body, /entityid/i) || containsKey(body, /token|secret|authorization|password/i)) {
    throw new Error("REGISTRY_SENSITIVE_FIELDS_PRESENT");
  }
  return { providers };
}

function endpointFor(providers: readonly JsonObject[]): string {
  const provider = providers.find((item) => item.providerId === "ha-climate-lab");
  const endpoint = provider?.effectiveEndpoint;
  if (typeof endpoint !== "string" || !/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(endpoint)) {
    throw new Error("CLIMATE_RUNTIME_ENDPOINT_INVALID");
  }
  return endpoint;
}

async function readState(endpoint: string, resourceId: string, id: number): Promise<JsonObject> {
  const response = await request(
    endpoint,
    "tools/call",
    { name: "climate_get_state", arguments: { resourceId } },
    "climate_get_state",
    id,
  );
  const result = asObject(response.body.result);
  const content = asObject(result?.structuredContent);
  if (response.status !== 200 || result?.resultType !== "complete" || content === undefined) {
    throw new Error("CLIMATE_STATE_READ_FAILED");
  }
  return content;
}

async function runPowerOff(endpoint: string, key: string, id: number): Promise<JsonObject> {
  const response = await request(
    endpoint,
    "tools/call",
    { name: "climate_set_power", arguments: { resourceId: CLIMATE_RESOURCE, power: "off" } },
    "climate_set_power",
    id,
    key,
  );
  const result = asObject(response.body.result);
  if (
    response.status !== 200 ||
    result?.resultType !== "task" ||
    typeof result.taskId !== "string"
  ) {
    return { status: "rejected", runtimeTaskId: null, response: safeResponse(response) };
  }
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const get = await request(
      endpoint,
      "tasks/get",
      { taskId: result.taskId },
      result.taskId,
      id + 100 + attempt,
    );
    const snapshot = asObject(get.body.result) ?? {};
    if (["completed", "failed", "cancelled"].includes(String(snapshot.status))) {
      return {
        status: snapshot.status,
        runtimeTaskId: result.taskId,
        correlationId: key,
        finalTask: redactTask(snapshot),
        adapterExternalExecutionId: externalExecutionId(snapshot),
        homeAssistantObservationId: observationIdFromTask(snapshot),
      };
    }
    await delay(250);
  }
  return { status: "confirmation_timeout", runtimeTaskId: result.taskId, correlationId: key };
}

async function request(
  endpoint: string,
  method: string,
  params: JsonObject,
  name: string,
  id: number,
  key?: string,
): Promise<McpResponse> {
  const meta: JsonObject = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": {
      name: "smpp-climate-restore-recovery",
      version: "1.0.0",
    },
    "io.modelcontextprotocol/clientCapabilities": {
      extensions: { "io.modelcontextprotocol/tasks": {} },
    },
    ...(key === undefined
      ? {}
      : { "io.sdar/taskExecution": { profileVersion: "1.0", idempotencyKey: key } }),
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
  return { status: response.status, body: (await response.json()) as JsonObject };
}

function redactState(value: JsonObject): JsonObject {
  return {
    resourceId: value.resourceId ?? null,
    power: value.power ?? null,
    reachable: value.reachable ?? null,
    hvacMode: value.hvacMode ?? null,
    targetTemperature: value.targetTemperature ?? null,
    currentTemperature: value.currentTemperature ?? null,
    observedAt: value.observedAt ?? null,
    observationId: value.observationId ?? null,
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
  const result = asObject(value.result);
  return result?.externalExecutionId ?? value.externalExecutionId ?? null;
}

function observationIdFromTask(value: JsonObject): unknown {
  const evidence = Array.isArray(value.evidence) ? value.evidence.find(isObject) : undefined;
  return evidence?.evidenceId ?? null;
}

function safeResponse(value: McpResponse): JsonObject {
  const result = asObject(value.body.result);
  return {
    status: value.status,
    error: value.body.error ?? null,
    resultType: result?.resultType ?? null,
  };
}

function safetyWaitMs(observedAt: unknown): number {
  if (typeof observedAt !== "string") return 300_000;
  const timestamp = Date.parse(observedAt);
  if (!Number.isFinite(timestamp)) return 300_000;
  return Math.max(0, 300_000 - (Date.now() - timestamp));
}

function containsKey(value: unknown, pattern: RegExp): boolean {
  if (Array.isArray(value)) return value.some((item) => containsKey(item, pattern));
  if (!isObject(value)) return false;
  return Object.entries(value).some(
    ([key, child]) => pattern.test(key) || containsKey(child, pattern),
  );
}

function safeError(error: unknown): string {
  return error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)
    ? error.message
    : "CLIMATE_RESTORE_FAILED";
}

function renderMarkdown(value: JsonObject): string {
  return [
    "# Climate restore recovery",
    "",
    `- Evidence class: \`${String(value.evidenceClass)}\``,
    `- Status: \`${String(value.status)}\``,
    `- Integration run: \`${String(value.integrationRunId)}\``,
    `- Device restore: \`${String(value.deviceRestoreStatus)}\``,
    `- Source state: \`${JSON.stringify(value.sourceInitialState ?? null)}\``,
    `- Current before restore: \`${JSON.stringify(value.currentBeforeRestore ?? null)}\``,
    `- Wait: \`${JSON.stringify(value.wait ?? null)}\``,
    `- Final state: \`${JSON.stringify(value.finalState ?? null)}\``,
    `- Runtime task counts: \`not_queried\``,
    "",
    "Only the safety-gated `climate_set_power(off)` restore path is permitted by this recovery driver; no other device operation is attempted.",
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

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

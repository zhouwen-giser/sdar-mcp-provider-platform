import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { summarizeRuntimeTaskStates } from "./live-runtime-task-state.js";

const ROOT = resolve(process.cwd());
const API = process.env.SMPP_PMS_API_URL ?? "http://127.0.0.1:8090";
const ENVIRONMENT = "home-lab";
const RUN_ID = process.env.REAL_DEVICE_TEST_RUN_ID?.trim() ?? "";
const GATE_OPEN = process.env.ALLOW_REAL_DEVICE_SIDE_EFFECTS === "YES" && RUN_ID.length > 0;
const sourceReport = JSON.parse(
  await readFile(
    resolve(ROOT, "reports/real-device-preparation-continuation/three-device-e2e.json"),
    "utf8",
  ),
) as JsonObject;
const reportDirectory = resolve(ROOT, "reports/real-device-preparation-continuation");
const reportPath = resolve(reportDirectory, "light-restore-recovery.json");
const markdownPath = resolve(reportDirectory, "light-restore-recovery.md");

type JsonObject = Record<string, unknown>;

interface McpResponse {
  readonly status: number;
  readonly body: JsonObject;
}

const report: JsonObject = {
  evidenceClass: "real",
  phase: "P6_LIGHT_RESTORE_RECOVERY",
  integrationRunId: RUN_ID || `smpp-light-restore-${randomUUID()}`,
  startedAt: new Date().toISOString(),
  completedAt: null,
  status: "blocked",
  safetyGate: {
    allowRealDeviceSideEffects: process.env.ALLOW_REAL_DEVICE_SIDE_EFFECTS === "YES",
    runIdPresent: RUN_ID.length > 0,
    writeBudgetPerResource: 1,
  },
  resources: [],
  runtimeTaskCounts: null,
  errors: [],
};

try {
  if (!GATE_OPEN) throw new Error("REAL_DEVICE_SIDE_EFFECTS_GATE_CLOSED");
  const managementToken = (
    await readFile(resolve(ROOT, ".local/pms-continuation/secrets/pms-management.token"), "utf8")
  ).trim();
  const registryResponse = await fetch(`${API}/api/v1/registry/${ENVIRONMENT}/latest`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${managementToken}`,
      "x-sdar-actor": "smpp-continuation-admin",
      "x-sdar-correlation-id": String(report.integrationRunId),
    },
  });
  const registry = (await registryResponse.json()) as JsonObject;
  const providers = Array.isArray(asObject(registry.document)?.providers)
    ? (asObject(registry.document)?.providers as unknown[]).filter(isObject)
    : [];
  const lightEndpoint = providers.find(
    (provider) => provider.providerId === "ha-light-lab",
  )?.effectiveEndpoint;
  if (
    typeof lightEndpoint !== "string" ||
    !/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(lightEndpoint)
  ) {
    throw new Error("LIGHT_RUNTIME_ENDPOINT_INVALID");
  }

  const originalStates = Array.isArray(sourceReport.initialStates)
    ? sourceReport.initialStates
        .filter(isObject)
        .filter((state) => state.providerId === "ha-light-lab")
    : [];
  if (originalStates.length !== 2) throw new Error("LIGHT_ORIGINAL_STATES_MISSING");
  for (const [index, original] of originalStates.entries()) {
    const resourceId = typeof original.resourceId === "string" ? original.resourceId : "";
    const expectedPower = original.power;
    const current = await readState(lightEndpoint, resourceId, 10 + index);
    const item: JsonObject = {
      resourceId,
      expectedPower,
      currentBeforeRestore: redactState(current),
      status: "manual_restore_required",
      runtimeTaskId: null,
      correlationId: null,
      adapterExternalExecutionId: null,
      homeAssistantObservationId: null,
    };
    if (expectedPower !== "on" && expectedPower !== "off") {
      item.reason = "LIGHT_ORIGINAL_POWER_UNSAFE";
      (report.resources as unknown[]).push(item);
      continue;
    }
    if (current.power === expectedPower) {
      item.status = "restored";
      item.currentAfterRestore = redactState(current);
      (report.resources as unknown[]).push(item);
      continue;
    }
    const task = await runTask(
      lightEndpoint,
      resourceId,
      { power: expectedPower },
      `${String(report.integrationRunId)}:restore:${resourceId}`,
      30 + index * 20,
    );
    item.runtimeTaskId = task.runtimeTaskId;
    item.correlationId = task.correlationId;
    item.adapterExternalExecutionId = task.adapterExternalExecutionId;
    item.homeAssistantObservationId = task.homeAssistantObservationId;
    item.task = task;
    if (task.status !== "completed") {
      item.reason = "LIGHT_RESTORE_CONFIRMATION_FAILED";
      (report.resources as unknown[]).push(item);
      continue;
    }
    const final = await readState(lightEndpoint, resourceId, 40 + index);
    item.currentAfterRestore = redactState(final);
    item.status = final.power === expectedPower ? "restored" : "manual_restore_required";
    if (item.status !== "restored") item.reason = "LIGHT_RESTORE_STATE_MISMATCH";
    (report.resources as unknown[]).push(item);
  }
  report.runtimeTaskCounts = await taskCounts();
  report.status =
    (report.resources as unknown[]).every((item) => asObject(item)?.status === "restored") &&
    asObject(report.runtimeTaskCounts)?.active === 0 &&
    asObject(report.runtimeTaskCounts)?.uncertain === 0
      ? "passed"
      : "blocked";
} catch (error) {
  (report.errors as unknown[]).push(safeError(error));
} finally {
  report.completedAt = new Date().toISOString();
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(report), "utf8");
}

process.stdout.write(`${report.status === "passed" ? "PASS" : "BLOCKED"} Light restore recovery\n`);
process.exitCode = report.status === "passed" ? 0 : 1;

async function readState(endpoint: string, resourceId: string, id: number): Promise<JsonObject> {
  const response = await request(
    endpoint,
    "tools/call",
    {
      name: "light_get_state",
      arguments: { resourceId },
    },
    "light_get_state",
    id,
  );
  const result = asObject(response.body.result);
  const structured = asObject(result?.structuredContent);
  if (response.status !== 200 || result?.resultType !== "complete" || structured === undefined) {
    throw new Error(`LIGHT_STATE_READ_FAILED:${resourceId}`);
  }
  return structured;
}

async function runTask(
  endpoint: string,
  resourceId: string,
  args: JsonObject,
  key: string,
  id: number,
): Promise<JsonObject> {
  const response = await request(
    endpoint,
    "tools/call",
    { name: "light_set_power", arguments: { resourceId, ...args } },
    "light_set_power",
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
  return {
    status: "confirmation_timeout",
    runtimeTaskId: result.taskId,
    correlationId: key,
    adapterExternalExecutionId: null,
    homeAssistantObservationId: null,
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
    "io.modelcontextprotocol/clientInfo": { name: "smpp-light-restore-recovery", version: "1.0.0" },
    "io.modelcontextprotocol/clientCapabilities": {
      extensions: { "io.modelcontextprotocol/tasks": {} },
    },
    ...(key === undefined
      ? {}
      : {
          "io.sdar/taskExecution": {
            profileVersion: "1.0",
            idempotencyKey: `${String(report.integrationRunId)}:${key}`,
          },
        }),
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

async function taskCounts(): Promise<JsonObject> {
  const url = (
    await readFile(
      resolve(
        ROOT,
        ".local/pms-continuation/roots/runtime-secrets/deployments/ha-light-deployment/instances/database/runtime.secret",
      ),
      "utf8",
    )
  ).trim();
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const rows = await pool.query<{ internal_state: string; count: string }>(
      "SELECT internal_state, count(*)::text AS count FROM provider_task GROUP BY internal_state",
    );
    const admission = await readUnsettledAdmissionCounts(pool);
    const counts = summarizeRuntimeTaskStates(rows.rows, admission);
    return { active: counts.active, uncertain: counts.uncertain };
  } finally {
    await pool.end();
  }
}

async function readUnsettledAdmissionCounts(
  pool: Pool,
): Promise<{ active: string; uncertain: string }> {
  const result = await pool.query<{ active: string; uncertain: string }>(
    `SELECT
       count(*) FILTER (
         WHERE intent.state IN ('PENDING','ACCEPTED','UNCERTAIN')
           AND NOT EXISTS (SELECT 1 FROM provider_task task WHERE task.task_id=intent.task_id)
       )::text AS active,
       count(*) FILTER (WHERE intent.state='UNCERTAIN')::text AS uncertain
     FROM admission_intent intent`,
  );
  const counts = result.rows[0];
  if (counts === undefined) throw new Error("RUNTIME_ADMISSION_TASK_COUNTS_MISSING");
  return counts;
}

function redactState(value: JsonObject): JsonObject {
  return {
    resourceId: value.resourceId ?? null,
    power: value.power ?? null,
    reachable: value.reachable ?? null,
    brightnessPercent: value.brightnessPercent ?? null,
    observedAt: value.observedAt ?? null,
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
    resultType: asObject(value.body.result)?.resultType ?? null,
    isError: asObject(value.body.result)?.isError ?? null,
  };
}

function safeError(error: unknown): string {
  return error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)
    ? error.message
    : "LIGHT_RESTORE_RECOVERY_FAILED";
}

function renderMarkdown(value: JsonObject): string {
  const resources = Array.isArray(value.resources) ? value.resources : [];
  const counts = asObject(value.runtimeTaskCounts);
  return [
    "# Light restore recovery",
    "",
    `- Evidence class: \`${String(value.evidenceClass)}\``,
    `- Status: \`${String(value.status)}\``,
    `- Resources: ${resources.map((item) => `${String(asObject(item)?.resourceId)}=${String(asObject(item)?.status)}`).join(", ")}`,
    `- Active/uncertain tasks: \`${displayValue(counts?.active)} / ${displayValue(counts?.uncertain)}\``,
    "",
    "This recovery used the PMS Registry-backed Light Runtime and confirmed terminal state through `tasks/get` followed by `light_get_state`.",
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

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

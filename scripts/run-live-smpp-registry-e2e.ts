import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { format, resolveConfig } from "prettier";
import { summarizeRuntimeTaskStates } from "./live-runtime-task-state.js";

const ROOT = resolve(process.cwd());
const LOCAL_STATE_ROOT = resolve(process.env.SMPP_LOCAL_STATE_ROOT ?? resolve(ROOT, ".local"));
const PMS_CONTINUATION_ROOT = resolve(LOCAL_STATE_ROOT, "pms-continuation");
const ENVIRONMENT = "home-lab";
const API_BASE_URL = process.env.SMPP_PMS_API_URL ?? "http://127.0.0.1:8090";
const DATABASE_URL_FILE = resolve(PMS_CONTINUATION_ROOT, "secrets/pms-database-url");
const MANAGEMENT_TOKEN_FILE = resolve(PMS_CONTINUATION_ROOT, "secrets/pms-management.token");
const REPORT_DIRECTORY = resolve(ROOT, "reports/real-device-preparation-continuation");
const REPORT_PATH = resolve(REPORT_DIRECTORY, "registry-backed-e2e.json");
const MARKDOWN_PATH = resolve(REPORT_DIRECTORY, "registry-backed-e2e.md");
const prettierConfig = (await resolveConfig(resolve(ROOT, "package.json"))) ?? {};

const expectedResources = Object.freeze({
  "ha-climate-lab": ["living-room-air-conditioner"],
  "ha-light-lab": ["living-room-main-light", "living-room-aux-light"],
});
const expectedDeployments = Object.freeze({
  "ha-climate-lab": "ha-climate-deployment",
  "ha-light-lab": "ha-light-deployment",
});

type JsonObject = Record<string, unknown>;

interface McpResponse {
  readonly status: number;
  readonly body: JsonObject;
}

const integrationRunId = `smpp-registry-e2e-${randomUUID()}`;
const report: JsonObject = {
  evidenceClass: "real",
  phase: "P6_MCP_REAL_DEVICE_E2E_READ_ONLY",
  integrationRunId,
  environment: ENVIRONMENT,
  startedAt: new Date().toISOString(),
  completedAt: null,
  status: "blocked",
  pms: {
    apiBaseUrl: API_BASE_URL,
    registry: null,
    etag: null,
    bootstrapConsistency: null,
  },
  runtimes: [],
  resources: [],
  runtimeTaskCounts: null,
  activeTasks: null,
  uncertainTasks: null,
  errors: [],
};

const databaseUrl = (await readFile(DATABASE_URL_FILE, "utf8")).trim();
const managementToken = (await readFile(MANAGEMENT_TOKEN_FILE, "utf8")).trim();
if (managementToken.length === 0) throw new Error("PMS_MANAGEMENT_TOKEN_EMPTY");

try {
  const registry = await readRegistry();
  const registryDocument = asObject(registry.body.document);
  const providers = Array.isArray(registryDocument?.providers)
    ? registryDocument.providers.filter(isObject)
    : [];
  const registrySafety = inspectSecretAndEntityKeys(registry.body);
  report.pms = {
    apiBaseUrl: API_BASE_URL,
    registry: {
      environment: registry.body.environment ?? null,
      revision: registry.body.revision ?? null,
      checksum: registry.body.checksum ?? null,
      providerIds: providers.map((provider) => provider.providerId ?? null),
      providerCount: providers.length,
      containsSecretKeys: registrySafety.containsSecretKeys,
      containsEntityIdKeys: registrySafety.containsEntityIdKeys,
    },
    etag: registry.etag,
    bootstrapConsistency: await checkBootstrap(registry.body.checksum),
  };

  if (registry.response.status !== 200) throw new Error("REGISTRY_LATEST_NOT_AVAILABLE");
  if (registry.body.environment !== ENVIRONMENT) throw new Error("REGISTRY_ENVIRONMENT_MISMATCH");
  if (providers.length !== 2) throw new Error("REGISTRY_PROVIDER_COUNT_INVALID");
  if (registrySafety.containsSecretKeys || registrySafety.containsEntityIdKeys) {
    throw new Error("REGISTRY_SENSITIVE_FIELDS_PRESENT");
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const rows = await pool.query<{
      provider_id: string;
      deployment_id: string;
      status: string;
      port: number;
      process_state: string;
      liveness_state: string;
      readiness_state: string;
      registration_state: string;
    }>(
      `SELECT deployment.provider_id,
               deployment.deployment_id,
               deployment.status,
               process.port,
               process.process_state,
               process.liveness_state,
               process.readiness_state,
               process.registration_state
          FROM runtime_deployment deployment
          JOIN runtime_process process ON process.deployment_id=deployment.deployment_id
         WHERE deployment.environment=$1
         ORDER BY deployment.provider_id`,
      [ENVIRONMENT],
    );
    if (rows.rows.length !== 2) throw new Error("RUNTIME_DEPLOYMENT_COUNT_INVALID");

    const runtimeTaskCounts: JsonObject[] = [];
    for (const row of rows.rows) {
      const provider = providers.find((candidate) => candidate.providerId === row.provider_id);
      if (!isObject(provider)) throw new Error(`REGISTRY_PROVIDER_MISSING:${row.provider_id}`);
      const endpoint = provider.effectiveEndpoint;
      if (typeof endpoint !== "string" || !/^http:\/\/127\.0\.0\.1:\d+(?:\/mcp)?$/.test(endpoint)) {
        throw new Error(`RUNTIME_ENDPOINT_INVALID:${row.provider_id}`);
      }
      if (new URL(endpoint).port !== String(row.port)) {
        throw new Error(`RUNTIME_ENDPOINT_PORT_MISMATCH:${row.provider_id}`);
      }
      if (!(row.provider_id in expectedResources)) {
        throw new Error(`UNEXPECTED_PROVIDER:${row.provider_id}`);
      }
      if (
        row.deployment_id !==
        expectedDeployments[row.provider_id as keyof typeof expectedDeployments]
      ) {
        throw new Error(`RUNTIME_DEPLOYMENT_ID_MISMATCH:${row.provider_id}`);
      }
      const expected = expectedResources[row.provider_id as keyof typeof expectedResources];
      if (
        row.status !== "ACTIVE" ||
        row.process_state !== "online" ||
        row.liveness_state !== "live" ||
        row.readiness_state !== "ready" ||
        row.registration_state !== "registered"
      ) {
        throw new Error(`RUNTIME_NOT_READY:${row.provider_id}`);
      }
      const runtime = await queryRuntime(row.provider_id, endpoint, expected);
      (report.runtimes as unknown[]).push(runtime.summary);
      (report.resources as unknown[]).push(...runtime.resources);
      runtimeTaskCounts.push(await readRuntimeTaskCounts(row.provider_id, row.deployment_id));
    }

    report.activeTasks = runtimeTaskCounts.reduce((sum, item) => sum + Number(item.active ?? 0), 0);
    report.uncertainTasks = runtimeTaskCounts.reduce(
      (sum, item) => sum + Number(item.uncertain ?? 0),
      0,
    );
    report.runtimeTaskCounts = {
      active: report.activeTasks,
      uncertain: report.uncertainTasks,
      runtimes: runtimeTaskCounts,
    };
    report.protocolQualification = {
      status: "passed",
      requiredMethods: ["server/discover", "tools/list", "tools/call"],
      initialize: "not_applicable_to_frozen_runtime_surface",
    };
    const allResourcesReachable = (report.resources as unknown[]).every(
      (resource) =>
        asObject(resource)?.state !== undefined &&
        asObject(asObject(resource)?.state)?.reachable === true,
    );
    report.status = allResourcesReachable ? "passed" : "blocked_resource_unavailable";
    if (!allResourcesReachable) {
      (report.errors as unknown[]).push("HOME_ASSISTANT_RESOURCE_UNAVAILABLE");
    }
  } finally {
    await pool.end();
  }
} catch (error) {
  (report.errors as unknown[]).push(safeError(error));
  report.status = "blocked";
} finally {
  report.completedAt = new Date().toISOString();
  await mkdir(REPORT_DIRECTORY, { recursive: true });
  await writeFile(
    REPORT_PATH,
    await format(JSON.stringify(report), { ...prettierConfig, parser: "json" }),
    "utf8",
  );
  await writeFile(
    MARKDOWN_PATH,
    await format(renderMarkdown(report), { ...prettierConfig, parser: "markdown" }),
    "utf8",
  );
}

process.stdout.write(
  `${report.status === "passed" ? "PASS" : "BLOCKED"} Registry-backed SMPP MCP read-only E2E\n`,
);
process.exitCode = report.status === "passed" ? 0 : 1;

async function readRegistry(): Promise<{
  response: McpResponse;
  body: JsonObject;
  etag: string | null;
}> {
  const response = await fetch(`${API_BASE_URL}/api/v1/registry/${ENVIRONMENT}/latest`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${managementToken}`,
      "x-sdar-actor": "smpp-continuation-admin",
      "x-sdar-correlation-id": integrationRunId,
    },
  });
  const body = (await response.json()) as JsonObject;
  return { response: { status: response.status, body }, body, etag: response.headers.get("etag") };
}

async function checkBootstrap(expectedChecksum: unknown): Promise<JsonObject> {
  const response = await fetch(`${API_BASE_URL}/api/v1/registry/${ENVIRONMENT}/bootstrap`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${managementToken}`,
      "x-sdar-actor": "smpp-continuation-admin",
      "x-sdar-correlation-id": integrationRunId,
    },
  });
  const body = (await response.json()) as JsonObject;
  const snapshot = asObject(body.snapshot);
  return {
    status: response.status,
    sameChecksum: snapshot?.checksum === expectedChecksum,
    etag: response.headers.get("etag"),
  };
}

async function readRuntimeTaskCounts(
  providerId: string,
  deploymentId: string,
): Promise<JsonObject> {
  const credentialPath = resolve(
    PMS_CONTINUATION_ROOT,
    `roots/runtime-secrets/deployments/${deploymentId}/instances/database/runtime.secret`,
  );
  const connectionString = (await readFile(credentialPath, "utf8")).trim();
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const result = await pool.query<{ internal_state: string; count: string }>(
      "SELECT internal_state, count(*)::text AS count FROM provider_task GROUP BY internal_state",
    );
    const admission = await readUnsettledAdmissionCounts(pool);
    return { providerId, ...summarizeRuntimeTaskStates(result.rows, admission) };
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

async function queryRuntime(
  providerId: string,
  endpoint: string,
  resourceIds: readonly string[],
): Promise<{ summary: JsonObject; resources: JsonObject[] }> {
  const url = new URL(endpoint.endsWith("/mcp") ? endpoint : `${endpoint}/mcp`);
  const discovery = await request(url, "server/discover", {}, "server/discover", 1);
  const toolsList = await request(url, "tools/list", {}, "tools/list", 2);
  const tools = toolNames(toolsList);
  const requiredTool = providerId === "ha-climate-lab" ? "climate_get_state" : "light_get_state";
  if (!tools.includes(requiredTool)) throw new Error(`MCP_TOOL_MISSING:${providerId}`);

  const resources: JsonObject[] = [];
  for (const [index, resourceId] of resourceIds.entries()) {
    const operation = requiredTool;
    const response = await request(
      url,
      "tools/call",
      { name: operation, arguments: { resourceId } },
      operation,
      10 + index,
      `${integrationRunId}:${providerId}:read:${resourceId}`,
    );
    const result = asObject(response.body.result);
    const content = asObject(result?.structuredContent);
    if (response.status !== 200 || result?.resultType !== "complete" || content === undefined) {
      throw new Error(`MCP_READ_FAILED:${providerId}:${resourceId}`);
    }
    resources.push({
      providerId,
      resourceId,
      runtimeTaskId: null,
      adapterExternalExecutionId: null,
      homeAssistantObservationId: observationId(content),
      state: redactState(content),
      status: response.status,
    });
  }

  return {
    summary: {
      providerId,
      endpoint: endpoint,
      protocolSurface: {
        initialize: "not_applicable_to_frozen_runtime_surface",
        discovery: summarizeResponse(discovery),
        toolsCall: "used_for_real_state_read",
      },
      toolsList: { status: toolsList.status, toolNames: tools },
      mcpReadCount: resources.length,
    },
    resources,
  };
}

async function request(
  url: URL,
  method: string,
  params: JsonObject,
  name: string,
  id: number,
  idempotencyKey?: string,
): Promise<McpResponse> {
  const meta: JsonObject = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": {
      name: "smpp-registry-backed-real-device-preparation",
      version: "1.0.0",
    },
    "io.modelcontextprotocol/clientCapabilities": {
      extensions: { "io.modelcontextprotocol/tasks": {} },
    },
    ...(idempotencyKey === undefined
      ? {}
      : { "io.sdar/taskExecution": { profileVersion: "1.0", idempotencyKey } }),
  };
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      "mcp-name": name,
      "x-sdar-subject": "smpp-registry-backed-runner",
      "x-sdar-tenant": ENVIRONMENT,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params: { ...params, _meta: meta } }),
  });
  const body = (await response.json()) as JsonObject;
  return { status: response.status, body };
}

function toolNames(response: McpResponse): string[] {
  const tools = asObject(response.body.result)?.tools;
  return Array.isArray(tools)
    ? tools.filter(isObject).flatMap((tool) => (typeof tool.name === "string" ? [tool.name] : []))
    : [];
}

function summarizeResponse(response: McpResponse): JsonObject {
  const result = asObject(response.body.result);
  return {
    status: response.status,
    resultType: result?.resultType ?? null,
    hasError: response.body.error !== undefined,
  };
}

function redactState(value: JsonObject): JsonObject {
  return {
    resourceId: value.resourceId ?? null,
    power: value.power ?? null,
    reachable: value.reachable ?? null,
    hvacMode: value.hvacMode ?? null,
    targetTemperature: value.targetTemperature ?? null,
    currentTemperature: value.currentTemperature ?? null,
    brightnessPercent: value.brightnessPercent ?? null,
    observedAt: value.observedAt ?? null,
  };
}

function observationId(value: JsonObject): unknown {
  return value.observationId ?? asObject(value.evidence)?.observationId ?? null;
}

function inspectSecretAndEntityKeys(value: unknown): {
  containsSecretKeys: boolean;
  containsEntityIdKeys: boolean;
} {
  let containsSecretKeys = false;
  let containsEntityIdKeys = false;
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!isObject(candidate)) return;
    for (const [key, child] of Object.entries(candidate)) {
      if (/token|secret|authorization|password/i.test(key)) containsSecretKeys = true;
      if (/entityid/i.test(key)) containsEntityIdKeys = true;
      visit(child);
    }
  };
  visit(value);
  return { containsSecretKeys, containsEntityIdKeys };
}

function safeError(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)) return error.message;
  return "REGISTRY_BACKED_E2E_FAILED";
}

function asObject(value: unknown): JsonObject | undefined {
  return isObject(value) ? value : undefined;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function displayValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "unknown";
}

function renderMarkdown(value: JsonObject): string {
  const pms = asObject(value.pms);
  const registry = asObject(pms?.registry);
  const runtimes = Array.isArray(value.runtimes) ? value.runtimes : [];
  const resources = Array.isArray(value.resources) ? value.resources : [];
  return [
    "# Registry-backed SMPP MCP read-only E2E",
    "",
    `- Evidence class: \`${String(value.evidenceClass)}\``,
    `- Status: \`${String(value.status)}\``,
    `- Environment: \`${ENVIRONMENT}\``,
    `- Registry revision/checksum: \`${displayValue(registry?.revision)} / ${displayValue(registry?.checksum)}\``,
    `- Registry providers: ${Array.isArray(registry?.providerIds) ? registry.providerIds.map(String).join(", ") : "none"}`,
    `- Runtime MCP reads: \`${String(resources.length)}\``,
    `- Active/uncertain tasks: \`${String(value.activeTasks)} / ${String(value.uncertainTasks)}\``,
    "",
    "This report covers the PMS Registry-backed MCP read path only. No Home Assistant write operation was attempted.",
    "",
    "## Runtime checks",
    "",
    ...runtimes.map((runtime) => {
      const item = asObject(runtime);
      const rawToolNames = asObject(item?.toolsList)?.toolNames;
      const toolNames = isUnknownArray(rawToolNames)
        ? rawToolNames.map((tool) => String(tool)).join(", ")
        : "unavailable";
      return `- ${String(item?.providerId)}: ${String(item?.mcpReadCount)} MCP state read(s); tools=${toolNames}`;
    }),
    "",
    "## Errors",
    "",
    ...(Array.isArray(value.errors) && value.errors.length > 0
      ? value.errors.map((error) => `- ${String(error)}`)
      : ["- none"]),
    "",
  ].join("\n");
}

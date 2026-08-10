import { randomUUID } from "node:crypto";
import {
  boundedInteger,
  canonical,
  coded,
  explicitBoolean,
  gitSha,
  isRecord,
  loadEnvironment,
  optional,
  parseArguments,
  parseEndpoint,
  redactEndpoint,
  repositoryRoot,
  safeFailure,
  sha256,
  topLevelKeys,
  writeEvidence,
} from "./lib.mjs";

const REQUIRED_READ_TOOLS = [
  "vehicle_get_state",
  "vehicle_get_capabilities",
  "vehicle_get_payload_status",
  "vehicle_get_targets",
];
const argumentsValue = parseArguments(process.argv.slice(2));
const environment = loadEnvironment(argumentsValue["env-file"]);
const root = repositoryRoot(import.meta.url);
const output =
  argumentsValue.output ??
  optional(environment, "UGV_READ_ONLY_EVIDENCE_PATH") ??
  `${root}/reports/ugv-simulation/READ_ONLY_SMOKE.json`;
const runtimePort = boundedInteger(
  environment.UGV_RUNTIME_PORT,
  "UGV_RUNTIME_PORT",
  19_100,
  1,
  65_535,
);
const runtimeRaw =
  optional(environment, "UGV_RUNTIME_MCP_URL") ?? `http://127.0.0.1:${String(runtimePort)}/mcp`;
const runtimeUrl = parseEndpoint(runtimeRaw, "UGV_RUNTIME_MCP_URL", ["http:", "https:"]);
const requestTimeoutMs = boundedInteger(
  environment.UGV_SMOKE_REQUEST_TIMEOUT_MS,
  "UGV_SMOKE_REQUEST_TIMEOUT_MS",
  10_000,
  500,
  60_000,
);
const maximumStateAgeMs = boundedInteger(
  environment.UGV_SMOKE_MAX_STATE_AGE_MS,
  "UGV_SMOKE_MAX_STATE_AGE_MS",
  30_000,
  1_000,
  300_000,
);
const startedAt = new Date().toISOString();
const report = {
  schemaVersion: 1,
  evidenceClass: "real_runtime_read_only",
  phase: "G10_READ_ONLY_SMOKE",
  status: "BLOCKED_EXTERNAL_ENV",
  reasonCode: "READ_ONLY_SMOKE_NOT_COMPLETED",
  command: "bash deploy/ugv-simulation/smoke.sh",
  exitCode: 2,
  startedAt,
  completedAt: null,
  gitSha: optional(environment, "UGV_QUALIFICATION_GIT_SHA") ?? gitSha(root),
  sourceStatus: optional(environment, "UGV_QUALIFICATION_SOURCE_STATUS") ?? "UNVERIFIED",
  endpoints: {
    runtimeMcp: redactEndpoint(runtimeUrl),
    ...(optional(environment, "UGV_SIM_DEVICE_MCP_URL") === undefined
      ? {}
      : {
          deviceMcp: redactEndpoint(
            parseEndpoint(environment.UGV_SIM_DEVICE_MCP_URL, "UGV_SIM_DEVICE_MCP_URL", [
              "http:",
              "https:",
            ]),
          ),
        }),
    ...(optional(environment, "UGV_SIM_MQTT_URL") === undefined
      ? {}
      : {
          mqtt: redactEndpoint(
            parseEndpoint(environment.UGV_SIM_MQTT_URL, "UGV_SIM_MQTT_URL", [
              "mqtt:",
              "mqtts:",
              "ws:",
              "wss:",
            ]),
          ),
        }),
  },
  safety: safetyEvidence(environment),
  runtimeReady: null,
  discovery: null,
  toolsList: null,
  reads: [],
  failure: null,
};

try {
  report.runtimeReady = await readiness(runtimeUrl, requestTimeoutMs);
  const discovery = await request(
    runtimeUrl,
    "server/discover",
    {},
    undefined,
    1,
    requestTimeoutMs,
  );
  assertRpcSuccess(discovery, "RUNTIME_DISCOVERY_FAILED");
  report.discovery = {
    httpStatus: discovery.status,
    responseSha256: sha256(canonical(discovery.body)),
  };

  const toolsResponse = await request(runtimeUrl, "tools/list", {}, undefined, 2, requestTimeoutMs);
  assertRpcSuccess(toolsResponse, "RUNTIME_TOOLS_LIST_FAILED");
  const toolNames = extractToolNames(toolsResponse.body);
  const missing = REQUIRED_READ_TOOLS.filter((name) => !toolNames.includes(name));
  if (missing.length > 0) throw coded("RUNTIME_REQUIRED_READ_TOOLS_MISSING");
  report.toolsList = {
    httpStatus: toolsResponse.status,
    toolCount: toolNames.length,
    toolNames,
    catalogSha256: sha256(canonical(toolsResponse.body.result)),
  };

  let id = 10;
  for (const operation of REQUIRED_READ_TOOLS) {
    const response = await request(
      runtimeUrl,
      "tools/call",
      { name: operation, arguments: { resourceId: "vehicle:ugv1" } },
      operation,
      id,
      requestTimeoutMs,
      `ugv-read-only-${operation}-${randomUUID()}`,
    );
    id += 1;
    const content = completeContent(response, operation);
    if (operation === "vehicle_get_state") assertRealState(content, maximumStateAgeMs);
    if (operation === "vehicle_get_capabilities") assertCapabilities(content);
    report.reads.push({
      operation,
      httpStatus: response.status,
      resultType: "complete",
      structuredContentSha256: sha256(canonical(content)),
      summary: summarize(operation, content),
    });
  }
  report.status = "PASS";
  report.reasonCode = "REAL_RUNTIME_READ_ONLY_READY";
  report.exitCode = 0;
} catch (error) {
  report.failure = safeFailure(error, "REAL_RUNTIME_READ_ONLY_FAILED");
  report.reasonCode = report.failure.reasonCode;
} finally {
  report.completedAt = new Date().toISOString();
  try {
    writeEvidence(output, report, [runtimeRaw]);
  } catch (error) {
    const failure = safeFailure(error, "READ_ONLY_EVIDENCE_WRITE_FAILED");
    process.stderr.write(`UGV read-only evidence failure: ${failure.reasonCode}\n`);
    process.exitCode = 3;
  }
}

if (process.exitCode !== 3) {
  process.exitCode = report.exitCode;
  process.stdout.write(`${report.status}: ${report.reasonCode}; evidence=${output}\n`);
}

async function readiness(mcpUrl, timeoutMs) {
  const readyUrl = new URL("/health/ready", mcpUrl);
  const response = await boundedFetch(readyUrl, { method: "GET" }, timeoutMs);
  let body = null;
  try {
    body = await response.json();
  } catch {
    // HTTP status is the readiness authority; response bodies are not retained as evidence.
  }
  if (!response.ok || !isRecord(body) || body.status !== "ready")
    throw coded(`RUNTIME_NOT_READY_HTTP_${String(response.status)}`);
  return {
    httpStatus: response.status,
    status: "ready",
    dependencyStates: isRecord(body.dependencies)
      ? Object.fromEntries(
          Object.entries(body.dependencies)
            .filter(([, value]) => typeof value === "string")
            .sort(([left], [right]) => left.localeCompare(right)),
        )
      : {},
  };
}

async function request(url, method, params, name, id, timeoutMs, idempotencyKey = undefined) {
  const meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": {
      name: "sdar-ugv-real-read-only-smoke",
      version: "1.0.0",
    },
    "io.modelcontextprotocol/clientCapabilities": {
      extensions: { "io.modelcontextprotocol/tasks": {} },
    },
    ...(idempotencyKey === undefined
      ? {}
      : { "io.sdar/taskExecution": { profileVersion: "1.0", idempotencyKey } }),
  };
  const response = await boundedFetch(
    url,
    {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
        "x-sdar-subject": "ugv-real-read-only-smoke",
        "x-sdar-tenant": "ugv-qualification",
        "x-sdar-execution-mode": "simulation",
        "x-sdar-simulation-id": "ugv-real-interface-qualification",
        ...(name === undefined ? {} : { "mcp-name": name }),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params: { ...params, _meta: meta } }),
    },
    timeoutMs,
  );
  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw coded("RUNTIME_MCP_NON_JSON_RESPONSE", error);
  }
  if (!isRecord(body)) throw coded("RUNTIME_MCP_RESPONSE_INVALID");
  return { status: response.status, body };
}

async function boundedFetch(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw coded("RUNTIME_NETWORK_REQUEST_FAILED", error);
  } finally {
    clearTimeout(timeout);
  }
}

function assertRpcSuccess(response, code) {
  if (response.status < 200 || response.status >= 300 || !isRecord(response.body.result))
    throw coded(code);
  if (response.body.error !== undefined) throw coded(code);
}

function extractToolNames(body) {
  const result = isRecord(body.result) ? body.result : undefined;
  const tools = isRecord(result) ? result.tools : undefined;
  if (!Array.isArray(tools)) throw coded("RUNTIME_TOOLS_LIST_INVALID");
  return tools
    .flatMap((tool) => (isRecord(tool) && typeof tool.name === "string" ? [tool.name] : []))
    .sort((left, right) => left.localeCompare(right));
}

function completeContent(response, operation) {
  if (response.status < 200 || response.status >= 300 || response.body.error !== undefined)
    throw coded(`${operation.toUpperCase()}_READ_FAILED`);
  const result = response.body.result;
  if (!isRecord(result) || result.resultType !== "complete" || !isRecord(result.structuredContent))
    throw coded(`${operation.toUpperCase()}_COMPLETE_RESULT_REQUIRED`);
  return result.structuredContent;
}

function assertRealState(content, maximumAgeMs) {
  const connectivity = content.connectivity;
  if (!isRecord(connectivity)) throw coded("UGV_STATE_CONNECTIVITY_REQUIRED");
  if (connectivity.mqttConnected !== true) throw coded("UGV_STATE_MQTT_NOT_CONNECTED");
  if (connectivity.deviceMcpConnected !== true) throw coded("UGV_STATE_DEVICE_MCP_NOT_CONNECTED");
  if (connectivity.deviceAvailable === false || content.available === false)
    throw coded("UGV_STATE_DEVICE_UNAVAILABLE");
  if (connectivity.deviceAvailable !== true)
    throw coded("UGV_STATE_DEVICE_AVAILABILITY_UNCONFIRMED");
  if (!Number.isSafeInteger(content.mqttIngressSequence) || content.mqttIngressSequence < 1)
    throw coded("UGV_STATE_MQTT_INGRESS_UNCONFIRMED");
  const freshness = content.freshness;
  const observedAt = isRecord(freshness) ? freshness.chassisObservedAt : undefined;
  if (typeof observedAt !== "string") throw coded("UGV_STATE_CHASSIS_FRESHNESS_MISSING");
  const ageMs = Date.now() - Date.parse(observedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maximumAgeMs)
    throw coded("UGV_STATE_CHASSIS_STALE");
}

function assertCapabilities(content) {
  if (content.available === false) throw coded("UGV_CAPABILITIES_DEVICE_UNAVAILABLE");
  const keys = topLevelKeys(content).filter((key) => !["resourceId", "observedAt"].includes(key));
  if (keys.length === 0) throw coded("UGV_CAPABILITIES_EMPTY");
}

function summarize(operation, content) {
  if (operation === "vehicle_get_state") {
    const connectivity = isRecord(content.connectivity) ? content.connectivity : {};
    const freshness = isRecord(content.freshness) ? content.freshness : {};
    const chassis = isRecord(content.chassis) ? content.chassis : {};
    const mission = isRecord(chassis.mission) ? chassis.mission : {};
    return {
      resourceId: isRecord(content.identity) ? (content.identity.resourceId ?? null) : null,
      mqttConnected: connectivity.mqttConnected === true,
      deviceMcpConnected: connectivity.deviceMcpConnected === true,
      deviceAvailable: connectivity.deviceAvailable ?? content.available ?? null,
      mqttIngressSequence: content.mqttIngressSequence ?? null,
      chassisObservedAt: freshness.chassisObservedAt ?? null,
      missionState: mission.state ?? null,
      revision: typeof content.revision === "string" ? content.revision : null,
    };
  }
  if (operation === "vehicle_get_capabilities")
    return { resourceId: content.resourceId ?? null, capabilityKeys: topLevelKeys(content) };
  if (operation === "vehicle_get_payload_status") {
    const reconnaissance = isRecord(content.reconnaissance) ? content.reconnaissance : {};
    return {
      resourceId: content.resourceId ?? null,
      online: content.online ?? null,
      cameraFault: content.cameraFault ?? reconnaissance.cameraFault ?? null,
      reconnaissanceState: reconnaissance.status ?? reconnaissance.state ?? null,
      payloadErrorCount: Array.isArray(content.payloadErrorCodes)
        ? content.payloadErrorCodes.length
        : null,
    };
  }
  return {
    resourceId: content.resourceId ?? null,
    targetCount: Array.isArray(content.targets) ? content.targets.length : null,
    observedAt: content.observedAt ?? null,
  };
}

function safetyEvidence(env) {
  const realControlEnabled = explicitBoolean(
    env.UGV_ENABLE_REAL_CONTROL,
    "UGV_ENABLE_REAL_CONTROL",
    false,
  );
  const reconEnabled = explicitBoolean(env.UGV_ENABLE_RECON_TESTS, "UGV_ENABLE_RECON_TESTS", false);
  const effectorEnabled = explicitBoolean(
    env.UGV_ENABLE_EFFECTOR_TESTS,
    "UGV_ENABLE_EFFECTOR_TESTS",
    false,
  );
  const reconFixture = optional(env, "UGV_TEST_RECON_REGION_JSON") !== undefined;
  return {
    readOnly: true,
    controlAttempted: false,
    mutatingToolCalls: 0,
    realControlConfigured: realControlEnabled,
    controlStatus: "NOT_EXECUTED_READ_ONLY_SCRIPT",
    pointNavigationStatus:
      optional(env, "UGV_TEST_SAFE_POINT_JSON") === undefined
        ? "NOT_EXECUTED_SAFE_FIXTURE_MISSING"
        : "NOT_EXECUTED_READ_ONLY_SCRIPT",
    routeNavigationStatus:
      optional(env, "UGV_TEST_SAFE_WAYPOINTS_JSON") === undefined
        ? "NOT_EXECUTED_SAFE_FIXTURE_MISSING"
        : "NOT_EXECUTED_READ_ONLY_SCRIPT",
    reconConfigured: reconEnabled,
    reconStatus: !reconFixture
      ? "NOT_EXECUTED_SAFE_FIXTURE_MISSING"
      : "NOT_EXECUTED_READ_ONLY_SCRIPT",
    effectorConfigured: effectorEnabled,
    effectorStatus: "NOT_EXECUTED_READ_ONLY_SCRIPT",
  };
}

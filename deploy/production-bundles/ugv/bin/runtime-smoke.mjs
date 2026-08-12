const providerId = "isr.vehicle.ugv.ugv1";
const deploymentId = "production-ugv-direct";
const instanceId = "production-ugv-direct-1";
const environment = "production";
const apiBaseUrl = internalApiUrl(required("PMS_SMOKE_API_BASE_URL"));
const advertisedBaseUrl = productionBaseUrl(required("PMS_SEED_RUNTIME_ADVERTISED_ENDPOINT"));
const expectedRegistryEndpoint = new URL("/mcp", advertisedBaseUrl).toString();
const deployment = await pms(
  `/api/v1/runtime-deployments/${encodeURIComponent(deploymentId)}?providerId=${encodeURIComponent(providerId)}`,
);
assertDeployment(deployment);
const processProjection = await pms(
  `/api/v1/runtime-processes/${encodeURIComponent(instanceId)}?providerId=${encodeURIComponent(providerId)}`,
);
assertProcess(processProjection);
const registry = await pms(`/api/v1/registry/${encodeURIComponent(environment)}/latest`);
const registryProvider = Array.isArray(registry?.document?.providers)
  ? registry.document.providers.find((value) => value?.providerId === providerId)
  : undefined;
if (
  registryProvider?.serverId !== instanceId ||
  registryProvider.effectiveEndpoint !== expectedRegistryEndpoint ||
  !Array.isArray(registryProvider.tools) ||
  registryProvider.tools.length === 0 ||
  !Number.isSafeInteger(registry.revision) ||
  registry.revision < 1 ||
  typeof registry.checksum !== "string" ||
  !/^[0-9a-f]{64}$/.test(registry.checksum)
) {
  throw new Error("UGV_SMOKE_REGISTRY_AUTHORITY_INVALID");
}
const endpoint = new URL(registryProvider.effectiveEndpoint);
const maximumStateAgeMs = positiveInteger("UGV_SMOKE_MAX_STATE_AGE_MS", 30_000, 300_000);
const requiredReads = [
  "vehicle_get_state",
  "vehicle_get_capabilities",
  "vehicle_get_payload_status",
  "vehicle_get_targets",
];
let requestId = 1;

const ready = await fetch(new URL("/health/ready", endpoint), {
  signal: globalThis.AbortSignal.timeout(5_000),
});
if (!ready.ok) throw new Error("UGV_SMOKE_RUNTIME_NOT_READY");

await rpc("server/discover");
const catalog = await rpc("tools/list");
const names = Array.isArray(catalog?.tools)
  ? catalog.tools.flatMap((tool) => (typeof tool?.name === "string" ? [tool.name] : []))
  : [];
if (requiredReads.some((name) => !names.includes(name))) {
  throw new Error("UGV_SMOKE_REQUIRED_READ_TOOL_MISSING");
}
const registryToolNames = registryProvider.tools.flatMap((tool) =>
  typeof tool?.name === "string" ? [tool.name] : [],
);
if (requiredReads.some((name) => !registryToolNames.includes(name))) {
  throw new Error("UGV_SMOKE_REGISTRY_REQUIRED_READ_TOOL_MISSING");
}

for (const operation of requiredReads) {
  const result = await rpc(
    "tools/call",
    { name: operation, arguments: { resourceId: "vehicle:ugv1" } },
    operation,
  );
  if (
    result?.resultType !== "complete" ||
    typeof result.structuredContent !== "object" ||
    result.structuredContent === null ||
    Array.isArray(result.structuredContent)
  ) {
    throw new Error(`UGV_SMOKE_READ_INCOMPLETE_${safe(operation)}`);
  }
  if (operation === "vehicle_get_state") assertRealState(result.structuredContent);
  if (operation === "vehicle_get_capabilities") assertCapabilities(result.structuredContent);
}

process.stdout.write(
  `${JSON.stringify({
    status: "passed",
    authority: "pms_managed_direct_container",
    registryAuthority: "pms_worker",
    deploymentId,
    instanceId,
    runtimeEndpointSource: "pms_registry",
    registryRevision: registry.revision,
    registryChecksum: registry.checksum,
    registryEndpoint: registryProvider.effectiveEndpoint,
    registrationFreshness: processProjection.registrationFreshness,
    lastHeartbeatAt: processProjection.lastHeartbeatAt,
    runtimeToolCount: names.length,
    readOperations: requiredReads,
    mutatingOperationsCalled: 0,
  })}\n`,
);

async function pms(path) {
  const response = await fetch(new URL(path, apiBaseUrl), {
    headers: {
      accept: "application/json",
      "x-actor-id": "production-ugv-admin",
      "x-correlation-id": `ugv-production-pms-smoke-${String(Date.now())}`,
    },
    signal: globalThis.AbortSignal.timeout(10_000),
  });
  const source = await response.text();
  if (Buffer.byteLength(source, "utf8") > 1_048_576) {
    throw new Error("UGV_SMOKE_PMS_RESPONSE_TOO_LARGE");
  }
  let payload;
  try {
    payload = source.length === 0 ? null : JSON.parse(source);
  } catch {
    throw new Error("UGV_SMOKE_PMS_RESPONSE_INVALID");
  }
  if (!response.ok) throw new Error(`UGV_SMOKE_PMS_API_${String(response.status)}`);
  return payload;
}

function assertDeployment(value) {
  if (
    value?.deploymentId !== deploymentId ||
    value.providerId !== providerId ||
    value.environment !== environment ||
    value.status !== "ACTIVE" ||
    value.runtimeAuthority !== "direct_container" ||
    value.directContainer?.instanceId !== instanceId ||
    value.directContainer?.advertisedEndpoint !== advertisedBaseUrl.toString()
  ) {
    throw new Error("UGV_SMOKE_DIRECT_DEPLOYMENT_INVALID");
  }
}

function assertProcess(value) {
  const heartbeatAgeMs =
    typeof value?.lastHeartbeatAt === "string"
      ? Date.now() - Date.parse(value.lastHeartbeatAt)
      : Number.NaN;
  if (
    value?.deploymentId !== deploymentId ||
    value.instanceId !== instanceId ||
    value.observedHealth !== "READY" ||
    value.readyForActive !== true ||
    value.registrationState !== "registered" ||
    value.registrationFreshness !== "registered" ||
    value.configState !== "externally_managed" ||
    !Number.isFinite(heartbeatAgeMs) ||
    heartbeatAgeMs < 0 ||
    heartbeatAgeMs >= 45_000
  ) {
    throw new Error("UGV_SMOKE_RUNTIME_PROCESS_NOT_FRESH");
  }
}

async function rpc(method, params = {}, operation = undefined) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      "x-correlation-id": `ugv-production-smoke-${String(requestId)}`,
      "x-sdar-execution-mode": "simulation",
      "x-sdar-simulation-id": "ugv-production-read-only-smoke",
      ...(operation === undefined ? {} : { "mcp-name": operation }),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: requestId++,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": {
            name: "sdar-ugv-production-read-only-smoke",
            version: "1.0.0",
          },
          "io.modelcontextprotocol/clientCapabilities": {
            extensions: { "io.modelcontextprotocol/tasks": {} },
          },
        },
      },
    }),
    signal: globalThis.AbortSignal.timeout(15_000),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`UGV_SMOKE_RPC_NON_JSON_${safe(method)}`);
  }
  if (!response.ok || payload?.error !== undefined || payload?.result === undefined) {
    throw new Error(`UGV_SMOKE_RPC_FAILED_${safe(method)}`);
  }
  return payload.result;
}

function assertRealState(state) {
  const connectivity = state.connectivity;
  if (
    typeof connectivity !== "object" ||
    connectivity === null ||
    connectivity.mqttConnected !== true ||
    connectivity.deviceMcpConnected !== true ||
    connectivity.deviceAvailable !== true ||
    state.available === false
  ) {
    throw new Error("UGV_SMOKE_REAL_CONNECTIVITY_UNCONFIRMED");
  }
  if (!Number.isSafeInteger(state.mqttIngressSequence) || state.mqttIngressSequence < 1) {
    throw new Error("UGV_SMOKE_MQTT_INGRESS_UNCONFIRMED");
  }
  const observedAt = state.freshness?.chassisObservedAt;
  const ageMs = typeof observedAt === "string" ? Date.now() - Date.parse(observedAt) : Number.NaN;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maximumStateAgeMs) {
    throw new Error("UGV_SMOKE_CHASSIS_STATE_STALE");
  }
}

function assertCapabilities(capabilities) {
  if (capabilities.available === false) throw new Error("UGV_SMOKE_CAPABILITIES_UNAVAILABLE");
  const meaningful = Object.keys(capabilities).filter(
    (key) => !new Set(["resourceId", "observedAt", "available"]).has(key),
  );
  if (meaningful.length === 0) throw new Error("UGV_SMOKE_CAPABILITIES_EMPTY");
}

function positiveInteger(name, fallback, maximum) {
  const source = process.env[name] ?? String(fallback);
  if (!/^[1-9][0-9]*$/.test(source)) throw new Error(`${name}_INVALID`);
  const value = Number(source);
  if (!Number.isSafeInteger(value) || value > maximum) throw new Error(`${name}_INVALID`);
  return value;
}

function required(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0 || /[\0\r\n]/.test(value)) {
    throw new Error(`${name}_REQUIRED`);
  }
  return value;
}

function internalApiUrl(source) {
  const value = new URL(source);
  if (
    value.protocol !== "http:" ||
    value.hostname !== "pms-api" ||
    value.port !== "8090" ||
    value.pathname !== "/" ||
    value.username.length > 0 ||
    value.password.length > 0 ||
    value.search.length > 0 ||
    value.hash.length > 0
  ) {
    throw new Error("UGV_SMOKE_PMS_API_URL_INVALID");
  }
  return value;
}

function productionBaseUrl(source) {
  const value = new URL(source);
  if (
    value.protocol !== "http:" ||
    value.pathname !== "/" ||
    value.port.length === 0 ||
    value.username.length > 0 ||
    value.password.length > 0 ||
    value.search.length > 0 ||
    value.hash.length > 0 ||
    new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]).has(value.hostname) ||
    /REPLACE|mock|invalid/i.test(value.hostname)
  ) {
    throw new Error("UGV_SMOKE_ADVERTISED_URL_INVALID");
  }
  return value;
}

function safe(value) {
  return value.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_");
}

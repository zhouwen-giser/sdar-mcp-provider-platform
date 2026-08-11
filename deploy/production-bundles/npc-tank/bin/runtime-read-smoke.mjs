import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

const secret = (await readFile("/run/secrets/runtime-jwt-hs256", "utf8")).trim();
if (secret.length < 32 || /\s/.test(secret)) throw new Error("RUNTIME_JWT_SECRET_INVALID");
const issuer = process.env.JWT_ISSUER;
const audience = process.env.JWT_AUDIENCE;
if (!issuer || !audience) throw new Error("RUNTIME_JWT_POLICY_MISSING");
const providerId = "isr.vehicle.npc-tank.npc-tank1";
const deploymentId = "production-npc-tank-direct";
const instanceId = "production-npc-tank-direct-1";
const environment = "production";
const apiBaseUrl = internalApiUrl(required("PMS_SMOKE_API_BASE_URL"));
const adminToken = (await readFile(required("PMS_SMOKE_ADMIN_TOKEN_FILE"), "utf8")).trim();
if (adminToken.length < 16 || adminToken.length > 8_192 || /\s/.test(adminToken)) {
  throw new Error("NPC_SMOKE_PMS_ADMIN_TOKEN_INVALID");
}
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
  throw new Error("NPC_SMOKE_REGISTRY_AUTHORITY_INVALID");
}
const endpoint = new URL(registryProvider.effectiveEndpoint);
const token = jwt(secret, {
  sub: "npc-production-read-only-smoke",
  tenant: "npc-production",
  iss: issuer,
  aud: audience,
  nbf: Math.floor(Date.now() / 1000) - 5,
  exp: Math.floor(Date.now() / 1000) + 120,
});
const resourceId = "vehicle:npc_tank1";
let requestId = 1;

const health = await fetch(new URL("/health/ready", endpoint), {
  signal: globalThis.AbortSignal.timeout(5_000),
});
if (!health.ok) throw new Error("NPC_RUNTIME_NOT_READY");

await rpc("server/discover");
const listed = await rpc("tools/list");
const toolNames = Array.isArray(listed.tools) ? listed.tools.map((tool) => tool.name) : [];
const requiredReads = [
  "vehicle_get_state",
  "vehicle_get_capabilities",
  "vehicle_get_payload_status",
  "vehicle_get_targets",
];
if (requiredReads.some((name) => !toolNames.includes(name))) {
  throw new Error("NPC_RUNTIME_REQUIRED_READ_TOOL_MISSING");
}
const registryToolNames = registryProvider.tools.flatMap((tool) =>
  typeof tool?.name === "string" ? [tool.name] : [],
);
if (requiredReads.some((name) => !registryToolNames.includes(name))) {
  throw new Error("NPC_REGISTRY_REQUIRED_READ_TOOL_MISSING");
}
for (const operation of requiredReads) {
  const result = await rpc("tools/call", { name: operation, arguments: { resourceId } }, operation);
  if (result.resultType !== "complete" || result.structuredContent === undefined) {
    throw new Error(`NPC_RUNTIME_READ_INCOMPLETE_${operation.toUpperCase()}`);
  }
  if (operation === "vehicle_get_state") {
    const connectivity = result.structuredContent.connectivity;
    if (
      connectivity?.mqttConnected !== true ||
      connectivity?.deviceMcpConnected !== true ||
      connectivity?.deviceAvailable !== true
    ) {
      throw new Error("NPC_RUNTIME_REAL_CONNECTIVITY_UNCONFIRMED");
    }
  }
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
    runtimeToolCount: toolNames.length,
    readOperations: requiredReads,
    mutatingOperationsCalled: 0,
  })}\n`,
);

async function pms(path) {
  const response = await fetch(new URL(path, apiBaseUrl), {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${adminToken}`,
      "x-actor-id": "npc-production-admin",
      "x-correlation-id": `npc-production-pms-smoke-${String(Date.now())}`,
    },
    signal: globalThis.AbortSignal.timeout(10_000),
  });
  const source = await response.text();
  if (Buffer.byteLength(source, "utf8") > 1_048_576) {
    throw new Error("NPC_SMOKE_PMS_RESPONSE_TOO_LARGE");
  }
  let payload;
  try {
    payload = source.length === 0 ? null : JSON.parse(source);
  } catch {
    throw new Error("NPC_SMOKE_PMS_RESPONSE_INVALID");
  }
  if (!response.ok) throw new Error(`NPC_SMOKE_PMS_API_${String(response.status)}`);
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
    throw new Error("NPC_SMOKE_DIRECT_DEPLOYMENT_INVALID");
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
    throw new Error("NPC_SMOKE_RUNTIME_PROCESS_NOT_FRESH");
  }
}

async function rpc(method, params = {}, operation = undefined) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      "x-correlation-id": `npc-production-smoke-${String(requestId)}`,
      "x-sdar-execution-mode": "simulation",
      "x-sdar-simulation-id": "npc-production-read-only-smoke",
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
            name: "sdar-npc-production-read-only-smoke",
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
  const body = await response.json();
  if (!response.ok || body.error !== undefined || body.result === undefined) {
    throw new Error(`NPC_RUNTIME_RPC_FAILED_${method.replaceAll("/", "_")}`);
  }
  return body.result;
}

function jwt(signingSecret, payload) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", signingSecret)
    .update(`${header}.${claims}`)
    .digest("base64url");
  return `${header}.${claims}.${signature}`;
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
    !new Set(["127.0.0.1", "localhost", "::1"]).has(value.hostname) ||
    value.port !== "8090" ||
    value.pathname !== "/" ||
    value.username.length > 0 ||
    value.password.length > 0 ||
    value.search.length > 0 ||
    value.hash.length > 0
  ) {
    throw new Error("NPC_SMOKE_PMS_API_URL_INVALID");
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
    throw new Error("NPC_SMOKE_ADVERTISED_URL_INVALID");
  }
  return value;
}

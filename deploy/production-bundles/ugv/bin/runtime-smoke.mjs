import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

const endpoint = new URL("http://127.0.0.1:8080/mcp");
const secret = (await readFile("/run/secrets/runtime_jwt_hs256_secret", "utf8")).trim();
if (secret.length < 32 || /\s/.test(secret)) throw new Error("UGV_SMOKE_JWT_SECRET_INVALID");

const issuer = required("JWT_ISSUER");
const audience = required("JWT_AUDIENCE");
const maximumStateAgeMs = positiveInteger("UGV_SMOKE_MAX_STATE_AGE_MS", 30_000, 300_000);
const now = Math.floor(Date.now() / 1_000);
const token = jwt(secret, {
  sub: "ugv-production-read-only-smoke",
  tenant: "ugv-production",
  iss: issuer,
  aud: audience,
  nbf: now - 5,
  exp: now + 120,
});
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
    authority: "direct_runtime_container",
    registryAuthority: "not_configured",
    runtimeToolCount: names.length,
    readOperations: requiredReads,
    mutatingOperationsCalled: 0,
  })}\n`,
);

async function rpc(method, params = {}, operation = undefined) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
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

function jwt(signingSecret, claims) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", signingSecret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
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

function safe(value) {
  return value.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_");
}

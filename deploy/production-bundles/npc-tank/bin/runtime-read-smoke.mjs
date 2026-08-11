import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

const endpoint = new URL("http://127.0.0.1:8080/mcp");
const secret = (await readFile("/run/secrets/runtime-jwt-hs256", "utf8")).trim();
if (secret.length < 32 || /\s/.test(secret)) throw new Error("RUNTIME_JWT_SECRET_INVALID");
const issuer = process.env.JWT_ISSUER;
const audience = process.env.JWT_AUDIENCE;
if (!issuer || !audience) throw new Error("RUNTIME_JWT_POLICY_MISSING");
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
    authority: "direct_runtime_container",
    registryAuthority: "not_configured",
    runtimeToolCount: toolNames.length,
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

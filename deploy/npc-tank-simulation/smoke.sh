#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$(CDPATH= cd -- "$deploy_dir/../.." && pwd)"
pms_compose_file="$repo_root/deploy/pms-console/compose.yaml"
npc_compose_file="$deploy_dir/compose.yaml"
env_file="${NPC_TANK_SIM_ENV_FILE:-$deploy_dir/.env}"
project_name="sdar-npc-tank-simulation-real"

blocked() {
  printf 'BLOCKED_CONFIGURATION: %s\n' "$1" >&2
  exit 2
}

[[ -f "$env_file" ]] || blocked "configuration file not found: $env_file"
for executable in docker node git; do
  command -v "$executable" >/dev/null 2>&1 || blocked "$executable is required"
done
docker compose version >/dev/null 2>&1 || blocked "Docker Compose v2 is required"

NPC_TANK_QUALIFICATION_GIT_SHA="$(
  node "$deploy_dir/validate-deployment.mjs" \
    --repo-root "$repo_root" \
    --env-file "$env_file"
)" || exit $?
[[ "$NPC_TANK_QUALIFICATION_GIT_SHA" =~ ^[0-9a-f]{40,64}$ ]] || \
  blocked "qualification source SHA is invalid"
export NPC_TANK_QUALIFICATION_GIT_SHA
export NPC_TANK_QUALIFICATION_SOURCE_STATUS="TRACKED_SOURCE_CLEAN"
export PMS_CONSOLE_GIT_SHA="$NPC_TANK_QUALIFICATION_GIT_SHA"

compose=(
  docker compose
  --project-name "$project_name"
  --env-file "$env_file"
  -f "$pms_compose_file"
  -f "$npc_compose_file"
)

"${compose[@]}" config --quiet
pms_secret_root="$(
  "${compose[@]}" config --format json | node --input-type=module -e '
    import { dirname } from "node:path";
    let source = "";
    for await (const chunk of process.stdin) source += chunk;
    const document = JSON.parse(source);
    const volumes = document.services?.["pms-api"]?.volumes;
    const mount = Array.isArray(volumes)
      ? volumes.find((entry) => entry?.target === "/run/pms-secrets/api")
      : undefined;
    if (mount?.type !== "bind" || typeof mount.source !== "string") process.exit(2);
    process.stdout.write(`${dirname(mount.source)}\n`);
  '
)" || blocked "failed to resolve the PMS Console secret root"
node "$repo_root/deploy/pms-console/validate-secrets.mjs" "$pms_secret_root" "$repo_root"

verify_image_revision() {
  local image="$1"
  local revision
  revision="$(docker image inspect \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")" || \
    blocked "qualified image is missing: $image"
  [[ "$revision" == "$NPC_TANK_QUALIFICATION_GIT_SHA" ]] || \
    blocked "$image does not match the qualification SHA"
}

verify_running_service() {
  local service="$1"
  local expected_health="$2"
  local container_id running health
  container_id="$("${compose[@]}" ps --quiet "$service")"
  [[ -n "$container_id" ]] || blocked "required service is not running: $service"
  running="$(docker container inspect --format '{{ .State.Running }}' "$container_id")"
  health="$(docker container inspect \
    --format '{{ if .State.Health }}{{ .State.Health.Status }}{{ else }}none{{ end }}' \
    "$container_id")"
  [[ "$running" == "true" ]] || blocked "required service stopped: $service"
  if [[ "$expected_health" == "healthy" && "$health" != "healthy" ]]; then
    blocked "required service is unhealthy: $service"
  fi
}

for service in \
  pms-postgres pms-api pms-worker pms-web \
  npc-runtime-postgres npc-adapter-postgres npc-tank-adapter npc-tank-runtime; do
  verify_running_service "$service" healthy
done

for image in \
  "sdar/pms-api:$NPC_TANK_QUALIFICATION_GIT_SHA" \
  "sdar/pms-worker:$NPC_TANK_QUALIFICATION_GIT_SHA" \
  "sdar/pms-web:$NPC_TANK_QUALIFICATION_GIT_SHA" \
  "sdar-npc-tank-simulation-real/npc-tank-adapter:$NPC_TANK_QUALIFICATION_GIT_SHA" \
  "sdar-npc-tank-simulation-real/npc-tank-runtime:$NPC_TANK_QUALIFICATION_GIT_SHA"; do
  verify_image_revision "$image"
done

echo "Checking PMS DB, API, Worker, Web, and same-origin proxy boundary..."
"${compose[@]}" exec -T pms-postgres pg_isready -U pms_admin -d pms >/dev/null
"${compose[@]}" exec -T pms-api node -e \
  "fetch('http://127.0.0.1:8090/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
"${compose[@]}" exec -T pms-web node -e \
  "fetch('http://127.0.0.1:8080/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
published="$("${compose[@]}" port pms-web 8080)"
web_port="${published##*:}"
[[ "$web_port" =~ ^[1-9][0-9]*$ ]] || blocked "PMS Web published port is invalid"
node "$repo_root/deploy/pms-console/smoke-client.mjs" "http://127.0.0.1:$web_port"

echo "Checking NPC databases and Runtime readiness..."
"${compose[@]}" exec -T npc-runtime-postgres pg_isready -U npc_runtime -d npc_runtime >/dev/null
"${compose[@]}" exec -T npc-adapter-postgres pg_isready -U npc_adapter -d npc_adapter >/dev/null
"${compose[@]}" exec -T npc-tank-runtime node -e \
  "fetch('http://127.0.0.1:8080/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

run_preflight_without_build() {
  local exit_code=0
  "${compose[@]}" --profile preflight up \
    --no-build \
    --no-deps \
    --force-recreate \
    --pull never \
    --exit-code-from npc-preflight \
    npc-preflight || exit_code=$?
  "${compose[@]}" --profile preflight rm --force --stop npc-preflight >/dev/null 2>&1 || true
  return "$exit_code"
}

echo "Rechecking real Device MCP and passive MQTT contracts..."
run_preflight_without_build

echo "Calling Runtime read operations; Registry is authoritative when explicitly required..."
registry_required="$(
  "${compose[@]}" config --format json | node --input-type=module -e '
    let source = "";
    for await (const chunk of process.stdin) source += chunk;
    const value = JSON.parse(source).services?.["npc-tank-runtime"]?.environment
      ?.NPC_TANK_REQUIRE_PMS_REGISTRY;
    if (value !== "true" && value !== "false") process.exit(2);
    process.stdout.write(value);
  '
)" || blocked "failed to resolve NPC_TANK_REQUIRE_PMS_REGISTRY"
registry_environment="$(
  "${compose[@]}" config --format json | node --input-type=module -e '
    let source = "";
    for await (const chunk of process.stdin) source += chunk;
    const value = JSON.parse(source).services?.["npc-tank-runtime"]?.environment
      ?.NPC_TANK_PMS_ENVIRONMENT;
    if (typeof value !== "string" || !/^[a-z][a-z0-9-]{0,62}$/.test(value)) process.exit(2);
    process.stdout.write(value);
  '
)" || blocked "failed to resolve NPC_TANK_PMS_ENVIRONMENT"
runtime_probe_service="npc-tank-runtime"
if [[ "$registry_required" == "true" ]]; then
  # Platform-managed Runtime endpoints are loopback URLs in the Worker/API shared
  # network namespace. Probe from that owner while keeping Registry as authority.
  runtime_probe_service="pms-worker"
fi
"${compose[@]}" exec -T \
  -e "NPC_TANK_REQUIRE_PMS_REGISTRY=$registry_required" \
  -e "NPC_TANK_PMS_ENVIRONMENT=$registry_environment" \
  "$runtime_probe_service" node --input-type=module -e '
  const providerId = "isr.vehicle.npc-tank.npc-tank1";
  const resourceId = "vehicle:npc_tank1";
  const registryRequired = process.env.NPC_TANK_REQUIRE_PMS_REGISTRY === "true";
  let endpoint = new URL("http://127.0.0.1:8080/mcp");
  if (registryRequired) {
    const environment = process.env.NPC_TANK_PMS_ENVIRONMENT ?? "simulation";
    const response = await fetch(
      `http://pms-api:8090/api/console/v1/registry/${encodeURIComponent(environment)}/latest`,
    );
    if (!response.ok) throw new Error("NPC_PMS_REGISTRY_SNAPSHOT_REQUIRED");
    const snapshot = await response.json();
    if (
      !Number.isSafeInteger(snapshot.revision) ||
      !/^[0-9a-f]{64}$/.test(snapshot.checksum) ||
      response.headers.get("etag") !== `"${snapshot.checksum}"`
    ) throw new Error("NPC_PMS_REGISTRY_AUTHORITY_INVALID");
    const forbiddenKey = (value) => {
      if (Array.isArray(value)) return value.some(forbiddenKey);
      if (value === null || typeof value !== "object") return false;
      return Object.entries(value).some(([key, child]) =>
        /password|authorization|token|secret|credential/i.test(key) || forbiddenKey(child),
      );
    };
    if (forbiddenKey(snapshot)) throw new Error("NPC_PMS_REGISTRY_SENSITIVE_FIELD_PRESENT");
    const providers = snapshot.document?.providers;
    const provider = Array.isArray(providers)
      ? providers.find((candidate) => candidate?.providerId === providerId)
      : undefined;
    if (
      typeof provider?.effectiveEndpoint !== "string" ||
      typeof provider.serverId !== "string" ||
      !Number.isSafeInteger(provider.catalogRevision)
    ) throw new Error("NPC_PMS_REGISTRY_PROVIDER_MISSING");
    endpoint = new URL(provider.effectiveEndpoint);
    if (endpoint.username || endpoint.password) throw new Error("NPC_PMS_REGISTRY_ENDPOINT_UNSAFE");
    process.stdout.write(
      `Registry authority PASS: revision=${snapshot.revision}; checksum=${snapshot.checksum.slice(0, 12)}; server=${provider.serverId}; catalog=${provider.catalogRevision}\n`,
    );
  } else {
    process.stdout.write("Registry authority NOT_EXECUTED: NPC_TANK_REQUIRE_PMS_REGISTRY=false\n");
  }

  const health = await fetch(new URL("/health/ready", endpoint));
  if (!health.ok) throw new Error("NPC_RUNTIME_NOT_READY");
  let requestId = 1;
  const rpc = async (method, params = {}, operation = undefined) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
        "x-sdar-subject": "npc-real-read-only-smoke",
        "x-sdar-tenant": "npc-qualification",
        "x-sdar-execution-mode": "simulation",
        "x-sdar-simulation-id": "npc-real-interface-qualification",
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
              name: "sdar-npc-real-read-only-smoke",
              version: "1.0.0",
            },
            "io.modelcontextprotocol/clientCapabilities": {
              extensions: { "io.modelcontextprotocol/tasks": {} },
            },
          },
        },
      }),
    });
    const body = await response.json();
    if (!response.ok || body.error !== undefined || body.result === undefined)
      throw new Error(`NPC_RUNTIME_RPC_FAILED_${method}`);
    return body.result;
  };
  await rpc("server/discover");
  const listed = await rpc("tools/list");
  const names = Array.isArray(listed.tools) ? listed.tools.map((tool) => tool.name) : [];
  const required = [
    "vehicle_get_state",
    "vehicle_get_capabilities",
    "vehicle_get_payload_status",
    "vehicle_get_targets",
  ];
  if (required.some((name) => !names.includes(name)))
    throw new Error("NPC_RUNTIME_READ_TOOLS_MISSING");
  for (const operation of required) {
    const result = await rpc(
      "tools/call",
      { name: operation, arguments: { resourceId } },
      operation,
    );
    if (result.resultType !== "complete" || result.structuredContent === undefined)
      throw new Error(`NPC_RUNTIME_${operation.toUpperCase()}_INCOMPLETE`);
    if (operation === "vehicle_get_state") {
      const connectivity = result.structuredContent.connectivity;
      if (
        connectivity?.mqttConnected !== true ||
        connectivity?.deviceMcpConnected !== true ||
        connectivity?.deviceAvailable !== true
      ) throw new Error("NPC_RUNTIME_REAL_CONNECTIVITY_UNCONFIRMED");
    }
  }
  process.stdout.write(`Runtime read-only PASS: tools=${names.length}; endpointAuthority=${registryRequired ? "registry" : "local-compose"}\n`);
'

printf 'PASS: PMS Console and real NPC Tank read-only smoke completed at %s\n' \
  "$NPC_TANK_QUALIFICATION_GIT_SHA"

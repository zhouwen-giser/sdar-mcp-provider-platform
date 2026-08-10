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
[[ -f "$pms_compose_file" ]] || blocked "Goal 10 PMS Console Compose is missing"
for executable in docker node git tar; do
  command -v "$executable" >/dev/null 2>&1 || blocked "$executable is required"
done
docker compose version >/dev/null 2>&1 || blocked "Docker Compose v2 is required"

shopt -s nullglob dotglob
for candidate in "$deploy_dir/secrets"/*; do
  case "$(basename -- "$candidate")" in
    README.md | .gitignore) ;;
    *) blocked "deploy/npc-tank-simulation/secrets must contain documentation only" ;;
  esac
done
shopt -u nullglob dotglob

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
export VITE_PMS_DATA_MODE=api

qualification_tmp_root="${TMPDIR:-/tmp}"
[[ -d "$qualification_tmp_root" ]] || blocked "temporary directory root does not exist"
qualification_build_context="$(mktemp -d "$qualification_tmp_root/sdar-npc-build-context.XXXXXXXX")"
cleanup_build_context() {
  if [[ -n "${qualification_build_context:-}" && -d "$qualification_build_context" ]]; then
    rm -rf -- "$qualification_build_context"
  fi
}
trap cleanup_build_context EXIT
git -C "$repo_root" archive --format=tar "$NPC_TANK_QUALIFICATION_GIT_SHA" \
  | tar -xf - -C "$qualification_build_context" || \
  blocked "failed to materialize the exact-HEAD build context"
export NPC_TANK_QUALIFICATION_BUILD_CONTEXT="$qualification_build_context"
export PMS_CONSOLE_BUILD_CONTEXT="$qualification_build_context"

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

services="$("${compose[@]}" --profile preflight config --services)"
for service in \
  pms-postgres pms-api pms-worker pms-web \
  npc-runtime-postgres npc-adapter-postgres npc-preflight npc-tank-adapter npc-tank-runtime; do
  [[ $'\n'"$services"$'\n' == *$'\n'"$service"$'\n'* ]] || \
    blocked "required service missing: $service"
done
while IFS= read -r service; do
  case "$service" in
    pms-postgres | pms-api | pms-worker | pms-web | \
      npc-runtime-postgres | npc-adapter-postgres | npc-preflight | \
      npc-tank-adapter | npc-tank-runtime) ;;
    *) blocked "unexpected or non-real service present: $service" ;;
  esac
done <<<"$services"

printf 'Building PMS Console and NPC real-only images from exact HEAD %s...\n' \
  "$NPC_TANK_QUALIFICATION_GIT_SHA"
"${compose[@]}" build pms-api pms-worker pms-web npc-tank-adapter npc-tank-runtime

verify_image() {
  local image="$1"
  local require_health="$2"
  local revision user healthcheck
  revision="$(docker image inspect \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")" || \
    blocked "qualified image is missing: $image"
  [[ "$revision" == "$NPC_TANK_QUALIFICATION_GIT_SHA" ]] || \
    blocked "$image has the wrong OCI revision"
  user="$(docker image inspect --format '{{ .Config.User }}' "$image")"
  [[ "$user" == "node" ]] || blocked "$image must run as the node user"
  if [[ "$require_health" == "true" ]]; then
    healthcheck="$(docker image inspect --format '{{ json .Config.Healthcheck }}' "$image")"
    [[ "$healthcheck" != "null" ]] || blocked "$image must define a healthcheck"
  fi
}

for image in \
  "sdar/pms-api:$NPC_TANK_QUALIFICATION_GIT_SHA" \
  "sdar/pms-worker:$NPC_TANK_QUALIFICATION_GIT_SHA" \
  "sdar/pms-web:$NPC_TANK_QUALIFICATION_GIT_SHA" \
  "sdar-npc-tank-simulation-real/npc-tank-adapter:$NPC_TANK_QUALIFICATION_GIT_SHA" \
  "sdar-npc-tank-simulation-real/npc-tank-runtime:$NPC_TANK_QUALIFICATION_GIT_SHA"; do
  verify_image "$image" true
done

verify_npc_artifacts() {
  local image="$1"
  local expected_app="$2"
  docker run --rm --entrypoint sh "$image" -c \
    'test -d /app/dist/apps && test "$(find /app/dist/apps -mindepth 1 -maxdepth 1 -type d -printf "%f\n")" = "$1" && test ! -d /app/node_modules/.pnpm/node_modules/@sdar && { test "$1" != npc-tank-provider-adapter || { test -f /app/scripts/npc-tank-simulation/capture-real-contracts.mjs && test -f /app/scripts/ugv-simulation/lib.mjs; }; }' \
    sh "$expected_app" || blocked "$image contains an unexpected application artifact"
}
verify_npc_artifacts \
  "sdar-npc-tank-simulation-real/npc-tank-adapter:$NPC_TANK_QUALIFICATION_GIT_SHA" \
  npc-tank-provider-adapter
verify_npc_artifacts \
  "sdar-npc-tank-simulation-real/npc-tank-runtime:$NPC_TANK_QUALIFICATION_GIT_SHA" \
  runtime

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

wait_timeout="$(
  "${compose[@]}" config --format json | node --input-type=module -e '
    let source = "";
    for await (const chunk of process.stdin) source += chunk;
    const value = process.env.NPC_TANK_COMPOSE_WAIT_TIMEOUT_SECONDS ?? "180";
    if (!/^[1-9][0-9]*$/.test(value)) process.exit(2);
    process.stdout.write(value);
  '
)" || blocked "NPC_TANK_COMPOSE_WAIT_TIMEOUT_SECONDS must be a positive integer"

echo "Starting PMS and NPC PostgreSQL services..."
"${compose[@]}" up --detach --wait --wait-timeout "$wait_timeout" \
  pms-postgres npc-runtime-postgres npc-adapter-postgres

echo "Capturing the real Device MCP contract and passive MQTT evidence (read-only)..."
run_preflight_without_build

echo "Starting the Goal 10 PMS control plane..."
"${compose[@]}" up --detach --no-build --pull never \
  --wait --wait-timeout "$wait_timeout" pms-api pms-worker pms-web

echo "Starting the NPC Tank Adapter and Runtime..."
"${compose[@]}" up --detach --no-build --pull never \
  --wait --wait-timeout "$wait_timeout" npc-tank-adapter npc-tank-runtime

echo "Running the integrated non-destructive smoke suite..."
bash "$deploy_dir/smoke.sh"
printf 'PASS: real-only NPC Tank stack is healthy at %s\n' "$NPC_TANK_QUALIFICATION_GIT_SHA"

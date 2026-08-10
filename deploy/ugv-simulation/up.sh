#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$(CDPATH= cd -- "$deploy_dir/../.." && pwd)"
env_file="${UGV_SIM_ENV_FILE:-$deploy_dir/.env}"
project_name="sdar-ugv-simulation-real"

if [[ ! -f "$env_file" ]]; then
  echo "BLOCKED_EXTERNAL_ENV: configuration file not found: $env_file" >&2
  echo "Copy $deploy_dir/.env.example to $deploy_dir/.env and configure real endpoints." >&2
  exit 2
fi
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "BLOCKED_EXTERNAL_ENV: Docker Compose v2 is required." >&2
  exit 2
fi
if ! command -v node >/dev/null 2>&1; then
  echo "BLOCKED_EXTERNAL_ENV: Node.js 22 or newer is required." >&2
  exit 2
fi
if ! node "$repo_root/scripts/ugv-simulation/validate-node-version.mjs"; then
  exit 2
fi
if ! command -v git >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1; then
  echo "BLOCKED_EXTERNAL_ENV: git and tar are required for the immutable build context." >&2
  exit 2
fi

shopt -s nullglob dotglob
for candidate in "$deploy_dir/secrets"/*; do
  case "$(basename -- "$candidate")" in
    README.md|.gitignore) ;;
    *)
      echo "BLOCKED_CONFIGURATION: the repository secret directory must contain documentation only." >&2
      exit 2
      ;;
  esac
done
shopt -u nullglob dotglob

if ! UGV_QUALIFICATION_GIT_SHA="$(
  node "$repo_root/scripts/ugv-simulation/validate-deployment.mjs" \
    --repo-root "$repo_root" \
    --env-file "$env_file"
)"; then
  exit 2
fi
if [[ ! "$UGV_QUALIFICATION_GIT_SHA" =~ ^[0-9a-f]{40,64}$ ]]; then
  echo "BLOCKED_CONFIGURATION: qualification source SHA is invalid." >&2
  exit 2
fi
export UGV_QUALIFICATION_GIT_SHA
export UGV_QUALIFICATION_SOURCE_STATUS="TRACKED_SOURCE_CLEAN"
echo "Qualification source verified: $UGV_QUALIFICATION_GIT_SHA"

qualification_tmp_root="${TMPDIR:-/tmp}"
if [[ ! -d "$qualification_tmp_root" ]]; then
  echo "BLOCKED_CONFIGURATION: temporary directory root does not exist." >&2
  exit 2
fi
qualification_build_context="$(mktemp -d "$qualification_tmp_root/sdar-ugv-build-context.XXXXXXXX")"
cleanup_qualification_build_context() {
  if [[ -n "${qualification_build_context:-}" && -d "$qualification_build_context" ]]; then
    rm -rf -- "$qualification_build_context"
  fi
}
trap cleanup_qualification_build_context EXIT
if ! git -C "$repo_root" archive --format=tar "$UGV_QUALIFICATION_GIT_SHA" \
  | tar -xf - -C "$qualification_build_context"; then
  echo "BLOCKED_CONFIGURATION: failed to materialize the exact-HEAD build context." >&2
  exit 2
fi
export UGV_QUALIFICATION_BUILD_CONTEXT="$qualification_build_context"
echo "Immutable build context materialized from: $UGV_QUALIFICATION_GIT_SHA"

compose=(docker compose --project-name "$project_name" --env-file "$env_file" -f "$deploy_dir/compose.yaml")

"${compose[@]}" config --quiet
services="$("${compose[@]}" --profile preflight config --services)"
for required_service in ugv-adapter-postgres ugv-runtime-postgres ugv-preflight ugv-adapter ugv-runtime; do
  if [[ $'\n'"$services"$'\n' != *$'\n'"$required_service"$'\n'* ]]; then
    echo "BLOCKED_CONFIGURATION: required service missing: $required_service" >&2
    exit 2
  fi
done
while IFS= read -r service; do
  case "$service" in
    ugv-adapter-postgres|ugv-runtime-postgres|ugv-preflight|ugv-adapter|ugv-runtime) ;;
    *)
      echo "BLOCKED_CONFIGURATION: non-real service present: $service" >&2
      exit 2
      ;;
  esac
done <<<"$services"

echo "Building the real-only UGV qualification images..."
"${compose[@]}" build ugv-adapter ugv-runtime

verify_real_image() {
  local image="$1"
  local expected_app="$2"
  local revision
  if ! revision="$(
    docker image inspect \
      --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
      "$image"
  )" || [[ "$revision" != "$UGV_QUALIFICATION_GIT_SHA" ]]; then
    echo "BLOCKED_CONFIGURATION: $image is not labeled with the qualification SHA." >&2
    exit 2
  fi
  if ! docker run --rm --entrypoint sh "$image" -c \
    'test -d /app/dist/apps && test "$(find /app/dist/apps -mindepth 1 -maxdepth 1 -type d -printf "%f\n")" = "$1" && test ! -d /app/node_modules/.pnpm/node_modules/@sdar && { test "$1" != ugv-provider-adapter || { test -f /app/scripts/ugv-simulation/preflight.mjs && test -f /app/scripts/ugv-simulation/lib.mjs; }; }' \
    sh "$expected_app"; then
    echo "BLOCKED_CONFIGURATION: $image contains an unexpected application artifact." >&2
    exit 2
  fi
}
adapter_image="sdar-ugv-simulation-real/ugv-adapter:$UGV_QUALIFICATION_GIT_SHA"
runtime_image="sdar-ugv-simulation-real/runtime:$UGV_QUALIFICATION_GIT_SHA"
verify_real_image "$adapter_image" ugv-provider-adapter
verify_real_image "$runtime_image" runtime

run_preflight_without_build() {
  local exit_code=0
  "${compose[@]}" --profile preflight up \
    --no-build \
    --no-deps \
    --force-recreate \
    --pull never \
    --exit-code-from ugv-preflight \
    ugv-preflight || exit_code=$?
  "${compose[@]}" --profile preflight rm --force --stop ugv-preflight >/dev/null 2>&1 || true
  return "$exit_code"
}

echo "Checking real Device MCP and MQTT prerequisites (read-only)..."
run_preflight_without_build

wait_timeout="${UGV_COMPOSE_WAIT_TIMEOUT_SECONDS:-180}"
if [[ ! "$wait_timeout" =~ ^[1-9][0-9]*$ ]]; then
  echo "BLOCKED_CONFIGURATION: UGV_COMPOSE_WAIT_TIMEOUT_SECONDS must be a positive integer." >&2
  exit 2
fi

echo "Starting PostgreSQL, UGV Adapter, and Runtime..."
"${compose[@]}" up --detach --wait --wait-timeout "$wait_timeout" --remove-orphans
echo "PASS: real-only UGV compatibility stack is healthy. Qualification status is evidence-gated; run: bash deploy/ugv-simulation/smoke.sh"

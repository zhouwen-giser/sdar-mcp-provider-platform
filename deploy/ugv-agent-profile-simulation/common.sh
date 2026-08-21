#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(CDPATH= cd -- "$deploy_dir/../.." && pwd)"
readonly deploy_dir repo_root
readonly UAP_PROJECT_NAME="sdar-ugv-agent-profile-simulation"
readonly UAP_PROFILE="ugv-agent-profile-simulation"
readonly UAP_OVERRIDE="$repo_root/compose.ugv-agent-profile-simulation.yaml"
readonly UAP_REPORT_DIR="$repo_root/reports/ugv-agent-profile-simulation"
readonly UAP_RUNTIME_SERVICE="ugv-agent-profile-runtime"
readonly UAP_ADAPTER_SERVICE="ugv-agent-profile-adapter"
readonly UAP_RUNTIME_DB_SERVICE="ugv-agent-profile-runtime-postgres"
readonly UAP_ADAPTER_DB_SERVICE="ugv-agent-profile-adapter-postgres"

uap_require_local_tools() {
  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    echo "UAP_DOCKER_COMPOSE_REQUIRED" >&2
    exit 2
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "UAP_NODE_REQUIRED" >&2
    exit 2
  fi
}

uap_compose() {
  docker compose \
    --project-name "$UAP_PROJECT_NAME" \
    -f "$repo_root/compose.yaml" \
    -f "$UAP_OVERRIDE" \
    --profile "$UAP_PROFILE" \
    "$@"
}

uap_validate_config() {
  local rendered
  rendered="$(mktemp "${TMPDIR:-/tmp}/uap-compose.XXXXXXXX.json")"
  trap 'rm -f -- "$rendered"' RETURN
  uap_compose config --format json >"$rendered"
  node "$repo_root/scripts/ugv-agent-profile-simulation/validate-compose-profile.mjs" \
    --compose-json "$rendered"
  rm -f -- "$rendered"
  trap - RETURN
}

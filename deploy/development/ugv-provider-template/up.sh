#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$(CDPATH= cd -- "$deploy_dir/../../.." && pwd)"
profile="${1:-mock}"
env_file="${UGV_TEMPLATE_ENV_FILE:-$deploy_dir/.env}"
project_name="${UGV_TEMPLATE_PROJECT_NAME:-sdar-development-ugv-provider-template}"

if [[ "$profile" != "mock" && "$profile" != "external" ]]; then
  echo "UGV_TEMPLATE_PROFILE_INVALID: expected mock or external" >&2
  exit 2
fi
if [[ ! -f "$env_file" ]]; then
  if [[ "$profile" == "mock" ]]; then
    env_file="$deploy_dir/.env.example"
  else
    echo "UGV_TEMPLATE_EXTERNAL_ENV_REQUIRED: copy .env.example to .env and configure real endpoints" >&2
    exit 2
  fi
fi
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "UGV_TEMPLATE_DOCKER_COMPOSE_REQUIRED" >&2
  exit 2
fi
if ! command -v node >/dev/null 2>&1; then
  echo "UGV_TEMPLATE_NODE_REQUIRED" >&2
  exit 2
fi

compose=(docker compose --project-name "$project_name" --env-file "$env_file" -f "$deploy_dir/compose.yaml" --profile "$profile")
rendered="$(mktemp "${TMPDIR:-/tmp}/sdar-ugv-template-compose.XXXXXXXX.json")"
cleanup() { rm -f -- "$rendered"; }
trap cleanup EXIT
"${compose[@]}" config --format json >"$rendered"
node "$repo_root/scripts/ugv-provider-template/validate-development-config.mjs" \
  --profile "$profile" --compose-json "$rendered"

echo "Building UGV development images for profile $profile..."
if [[ "$profile" == "mock" ]]; then
  "${compose[@]}" build mock-ugv-device-mcp mock-ugv-mqtt-publisher ugv-adapter ugv-runtime
else
  "${compose[@]}" build ugv-adapter ugv-runtime
fi

wait_timeout="${UGV_TEMPLATE_WAIT_TIMEOUT_SECONDS:-180}"
if [[ ! "$wait_timeout" =~ ^[1-9][0-9]*$ ]]; then
  echo "UGV_TEMPLATE_WAIT_TIMEOUT_INVALID" >&2
  exit 2
fi

echo "Starting isolated development databases..."
"${compose[@]}" up --detach --wait --wait-timeout "$wait_timeout" \
  ugv-adapter-postgres ugv-runtime-postgres

if [[ "$profile" == "mock" ]]; then
  echo "Starting deterministic mock Device MCP and MQTT services..."
  "${compose[@]}" up --detach --wait --wait-timeout "$wait_timeout" \
    mock-mqtt mock-ugv-device-mcp mock-ugv-mqtt-publisher
else
  echo "Running external Device MCP/MQTT read-only preflight before Adapter startup..."
  UGV_TEMPLATE_ENV_FILE="$env_file" UGV_TEMPLATE_PROJECT_NAME="$project_name" \
    bash "$deploy_dir/contract-check.sh" external
fi

echo "Starting UGV Adapter and Runtime..."
"${compose[@]}" up --detach --wait --wait-timeout "$wait_timeout" ugv-adapter ugv-runtime

UGV_TEMPLATE_ENV_FILE="$env_file" UGV_TEMPLATE_PROJECT_NAME="$project_name" \
  bash "$deploy_dir/smoke.sh" "$profile"
echo "UGV_TEMPLATE_DEVELOPMENT_READY: profile=$profile"

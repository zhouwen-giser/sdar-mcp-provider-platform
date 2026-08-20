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
  if [[ "$profile" == "mock" ]]; then env_file="$deploy_dir/.env.example"; else exit 2; fi
fi
compose=(docker compose --project-name "$project_name" --env-file "$env_file" -f "$deploy_dir/compose.yaml" --profile "$profile")

runtime_address="$("${compose[@]}" port ugv-runtime 8080)"
runtime_address="${runtime_address/0.0.0.0/127.0.0.1}"
runtime_address="${runtime_address/\[::\]/127.0.0.1}"
if [[ -z "$runtime_address" ]]; then
  echo "UGV_TEMPLATE_RUNTIME_PORT_UNAVAILABLE" >&2
  exit 2
fi

mkdir -p "$repo_root/reports/ugv-provider-template-stabilization"
UGV_RUNTIME_MCP_URL="http://$runtime_address/mcp" \
UGV_SMOKE_EXECUTION_MODE="$(
  "${compose[@]}" config --format json | node --input-type=module -e '
    let raw=""; for await (const chunk of process.stdin) raw += chunk;
    const value=JSON.parse(raw).services?.["ugv-adapter"]?.environment?.UGV_EXECUTION_MODE;
    if (value !== "simulation" && value !== "live") process.exit(2);
    process.stdout.write(value);
  '
)" \
UGV_PREFLIGHT_EVIDENCE_PATH="$repo_root/reports/ugv-provider-template-stabilization/DEVELOPMENT_${profile^^}_SMOKE.json" \
  node "$repo_root/scripts/ugv-simulation/read-only-smoke.mjs" \
    --output "$repo_root/reports/ugv-provider-template-stabilization/DEVELOPMENT_${profile^^}_SMOKE.json"

echo "UGV_TEMPLATE_SMOKE_PASS: profile=$profile runtime=http://$runtime_address/mcp"

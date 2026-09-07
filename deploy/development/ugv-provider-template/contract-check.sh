#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$(CDPATH= cd -- "$deploy_dir/../../.." && pwd)"
profile="${1:-external}"
env_file="${UGV_TEMPLATE_ENV_FILE:-$deploy_dir/.env}"
project_name="${UGV_TEMPLATE_PROJECT_NAME:-sdar-development-ugv-provider-template}"

if [[ "$profile" == "mock" ]]; then
  if [[ ! -f "$env_file" ]]; then env_file="$deploy_dir/.env.example"; fi
  compose=(docker compose --project-name "$project_name" --env-file "$env_file" -f "$deploy_dir/compose.yaml" --profile mock)
  runtime_id="$("${compose[@]}" ps --quiet ugv-runtime)"
  if [[ -z "$runtime_id" ]]; then
    echo "UGV_TEMPLATE_MOCK_RUNTIME_NOT_RUNNING: run bash up.sh mock first" >&2
    exit 2
  fi
  UGV_TEMPLATE_ENV_FILE="$env_file" UGV_TEMPLATE_PROJECT_NAME="$project_name" \
    bash "$deploy_dir/smoke.sh" mock
  exit 0
fi

if [[ "$profile" != "external" ]]; then
  echo "UGV_TEMPLATE_PROFILE_INVALID: expected mock or external" >&2
  exit 2
fi
if [[ ! -f "$env_file" ]]; then
  env_file="$deploy_dir/.env.example"
fi
mkdir -p "$repo_root/reports/ugv-provider-template-stabilization"
node "$repo_root/scripts/ugv-provider-preflight.mjs" \
  --external \
  --env-file "$env_file" \
  --output "$repo_root/reports/ugv-provider-template-stabilization/DEVELOPMENT_EXTERNAL_PREFLIGHT.json"
echo "UGV_TEMPLATE_EXTERNAL_PREFLIGHT_PASS"

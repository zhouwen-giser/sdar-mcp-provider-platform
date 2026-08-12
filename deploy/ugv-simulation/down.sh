#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
env_file="${UGV_SIM_ENV_FILE:-$deploy_dir/.env}"
project_name="sdar-ugv-simulation-real"

if [[ ! -f "$env_file" ]]; then
  env_file="/dev/null"
fi
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required." >&2
  exit 2
fi

docker compose \
  --project-name "$project_name" \
  --env-file "$env_file" \
  -f "$deploy_dir/compose.yaml" \
  down --remove-orphans --timeout 30

echo "Integrated stack stopped. PMS/UGV PostgreSQL, Worker state, and contract-report volumes were preserved."

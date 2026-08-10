#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$(CDPATH= cd -- "$deploy_dir/../.." && pwd)"
pms_compose_file="$repo_root/deploy/pms-console/compose.yaml"
npc_compose_file="$deploy_dir/compose.yaml"
env_file="${NPC_TANK_SIM_ENV_FILE:-$deploy_dir/.env}"
project_name="sdar-npc-tank-simulation-real"

if [[ ! -f "$env_file" ]]; then
  env_file="/dev/null"
  export PMS_CONSOLE_SECRET_ROOT="/tmp"
  export NPC_TANK_PMS_CREDENTIAL_ROOT="/tmp"
  export NPC_TANK_ADAPTER_DB_PASSWORD_FILE="/dev/null"
  export NPC_TANK_ADAPTER_DATABASE_URL_FILE="/dev/null"
  export NPC_TANK_RUNTIME_DB_PASSWORD_FILE="/dev/null"
  export NPC_TANK_RUNTIME_DATABASE_URL_FILE="/dev/null"
fi

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required." >&2
  exit 2
fi

compose=(
  docker compose
  --project-name "$project_name"
  --env-file "$env_file"
  -f "$pms_compose_file"
  -f "$npc_compose_file"
)
"${compose[@]}" down --remove-orphans --timeout 30

echo "NPC/PMS stack stopped. PostgreSQL, PMS Worker state, and contract-report volumes were preserved."

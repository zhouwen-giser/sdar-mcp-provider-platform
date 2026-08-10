#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PMS_CONSOLE_ENV_FILE="${PMS_CONSOLE_ENV_FILE:-$deploy_dir/.env}"
project_name="sdar-pms-console"
volumes=()
argument="${1:-}"

if [[ $# -gt 1 || ( -n "$argument" && "$argument" != "--volumes" ) ]]; then
  echo "Usage: bash deploy/pms-console/down.sh [--volumes]" >&2
  exit 2
fi
if [[ $# -eq 1 ]]; then
  volumes=(--volumes)
fi
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "BLOCKED_CONFIGURATION:DOCKER_COMPOSE_V2_REQUIRED" >&2
  exit 2
fi
if [[ ! -f "$PMS_CONSOLE_ENV_FILE" ]]; then
  PMS_CONSOLE_ENV_FILE=/dev/null
  export PMS_CONSOLE_SECRET_ROOT="${PMS_CONSOLE_SECRET_ROOT:-/tmp}"
fi
export PMS_CONSOLE_GIT_SHA="${PMS_CONSOLE_GIT_SHA:-unverified}"

docker compose \
  --project-name "$project_name" \
  --env-file "$PMS_CONSOLE_ENV_FILE" \
  -f "$deploy_dir/compose.yaml" \
  down --remove-orphans --timeout 35 "${volumes[@]}"

if [[ ${#volumes[@]} -eq 1 ]]; then
  echo "PMS Console stopped and its named PostgreSQL/Worker volumes were removed."
else
  echo "PMS Console stopped; named PostgreSQL/Worker volumes were preserved."
fi

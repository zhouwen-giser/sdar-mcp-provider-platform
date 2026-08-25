#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=common.sh
source "$deploy_dir/common.sh"

uap_require_local_tools

# Repeating up against the already-running fixed project is idempotent and does not fabricate a
# second qualification attempt. A stopped/partial stack is a new external run and needs a new ID.
already_running="true"
declare -A active_services=()
while IFS= read -r service; do
  if [[ -n "$service" ]]; then active_services["$service"]="true"; fi
done < <(
  docker ps \
    --filter "label=com.docker.compose.project=$UAP_PROJECT_NAME" \
    --filter "status=running" \
    --format '{{.Label "com.docker.compose.service"}}'
)
for service in \
  "$UAP_ADAPTER_DB_SERVICE" \
  "$UAP_RUNTIME_DB_SERVICE" \
  "$UAP_ADAPTER_SERVICE" \
  "$UAP_RUNTIME_SERVICE"; do
  if [[ "${active_services[$service]:-false}" != "true" ]]; then
    already_running="false"
  fi
done
if [[ "$already_running" == "true" ]]; then
  uap_validate_config
  bash "$deploy_dir/health.sh"
  echo "UAP_EXTERNAL_SIMULATION_ALREADY_READY"
  exit 0
fi

# The passive external contract gate must pass before any long-running Goal service starts. An
# operator may run preflight explicitly first; consume that immutable report instead of fabricating
# a second attempt with the same run ID.
run_id="${UGV_SIMULATION_RUN_ID:-}"
if [[ ! "$run_id" =~ ^[a-z0-9][a-z0-9._-]{0,95}$ || "$run_id" == *".."* ]]; then
  echo "UAP_SIMULATION_RUN_ID_INVALID" >&2
  exit 2
fi
readonly run_id
preflight_path="$UAP_REPORT_DIR/attempts/deployment-preflight-${run_id}.redacted.json"
if [[ ! -f "$preflight_path" ]]; then
  bash "$deploy_dir/preflight.sh"
fi
node "$repo_root/scripts/ugv-agent-profile-simulation/consume-preflight-run.mjs" \
  --attempts-dir "$UAP_REPORT_DIR/attempts" \
  --run-id "$run_id"

wait_timeout="${UGV_AGENT_PROFILE_WAIT_TIMEOUT_SECONDS:-180}"
if [[ ! "$wait_timeout" =~ ^[1-9][0-9]*$ ]]; then
  echo "UAP_WAIT_TIMEOUT_INVALID" >&2
  exit 2
fi

uap_compose up --build --detach --wait --wait-timeout "$wait_timeout" \
  "$UAP_ADAPTER_DB_SERVICE" \
  "$UAP_RUNTIME_DB_SERVICE" \
  "$UAP_ADAPTER_SERVICE" \
  "$UAP_RUNTIME_SERVICE"

bash "$deploy_dir/health.sh"
echo "UAP_EXTERNAL_SIMULATION_READY: runtime=http://127.0.0.1:${UGV_AGENT_PROFILE_RUNTIME_PORT:-19121}/mcp"

#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=common.sh
source "$deploy_dir/common.sh"

mkdir -p "$UAP_REPORT_DIR/attempts"

run_id="${UGV_SIMULATION_RUN_ID:-}"
if [[ ! "$run_id" =~ ^[a-z0-9][a-z0-9._-]{0,95}$ || "$run_id" == *".."* ]]; then
  echo "UAP_SIMULATION_RUN_ID_INVALID: use a unique lowercase [a-z0-9._-] identifier" >&2
  exit 2
fi
readonly run_id
output_path="$UAP_REPORT_DIR/attempts/deployment-preflight-${run_id}.redacted.json"
readonly output_path

# Reserve before every later gate. The immutable marker is never removed, so a configuration,
# freezer, network, or process failure still consumes the identity.
node "$repo_root/scripts/ugv-agent-profile-simulation/reserve-preflight-run.mjs" \
  --attempts-dir "$UAP_REPORT_DIR/attempts" \
  --run-id "$run_id"

uap_require_local_tools
uap_validate_config
node --import tsx "$repo_root/scripts/ugv-agent-profile-simulation/freeze-contracts.mjs" --check

# The inherited generic probe validates strong local DB-password shape even though it never opens a
# database. Generate throwaway values in memory; neither value is persisted or printed.
adapter_probe_key="$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('base64url'))")"
runtime_probe_key="$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('base64url'))")"
readonly adapter_probe_key runtime_probe_key
source_status="CLEAN"
if [[ -n "$(git -C "$repo_root" status --porcelain=v1 --untracked-files=no)" ]]; then
  source_status="DIRTY"
fi
readonly source_status

UGV_QUALIFICATION_GIT_SHA="$(git -C "$repo_root" rev-parse HEAD)" \
UGV_QUALIFICATION_SOURCE_STATUS="$source_status" \
UGV_SIMULATION_RUN_ID="$run_id" \
UGV_SIM_DEVICE_MCP_URL="http://192.168.2.63:19000/mcp" \
UGV_SIM_DEVICE_MCP_TLS_MODE="disabled" \
UGV_SIM_DEVICE_MCP_TIMEOUT_MS="10000" \
UGV_SIM_MQTT_URL="mqtt://192.168.2.63:1883" \
UGV_SIM_MQTT_TLS_MODE="disabled" \
UGV_MQTT_WIRE_MODE="ros_bridge_json" \
UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT="false" \
UGV_ADAPTER_DB_PASSWORD="$adapter_probe_key" \
UGV_RUNTIME_DB_PASSWORD="$runtime_probe_key" \
UGV_PREFLIGHT_MQTT_CONNECT_TIMEOUT_MS="10000" \
UGV_PREFLIGHT_MQTT_SAMPLE_TIMEOUT_MS="20000" \
UGV_ENABLE_REAL_CONTROL="false" \
UGV_ENABLE_RECON_TESTS="false" \
UGV_ENABLE_EFFECTOR_TESTS="false" \
  node "$repo_root/scripts/ugv-simulation/preflight.mjs" \
    --output "$output_path"

echo "UAP_EXTERNAL_PREFLIGHT_PASS: runId=$run_id toolsCallCount=0 mqttPublishCount=0 evidence=$output_path"

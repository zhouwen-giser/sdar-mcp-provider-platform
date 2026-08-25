#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=common.sh
source "$deploy_dir/common.sh"

run_id="${UGV_SIMULATION_RUN_ID:-}"
if [[ ! "$run_id" =~ ^[a-z0-9][a-z0-9._-]{0,95}$ || "$run_id" == *".."* ]]; then
  echo "UAP_SIMULATION_RUN_ID_INVALID: use the unique ID consumed by this Profile run" >&2
  exit 2
fi
readonly run_id

mkdir -p "$UAP_REPORT_DIR/attempts"
node "$repo_root/scripts/ugv-agent-profile-simulation/reserve-provider-qualification-run.mjs" \
  --attempts-dir "$UAP_REPORT_DIR/attempts" \
  --run-id "$run_id"

output_path="$UAP_REPORT_DIR/attempts/smpp-provider-qualification-${run_id}.redacted.json"
readonly output_path
node --import tsx \
  "$repo_root/scripts/ugv-agent-profile-simulation/qualify-provider-readonly.mjs" \
  --run-id "$run_id" \
  --output "$output_path"

echo "UAP_SMPP_PROVIDER_QUALIFICATION_PASS: runId=$run_id navigationDispatchCount=0 evidence=$output_path"

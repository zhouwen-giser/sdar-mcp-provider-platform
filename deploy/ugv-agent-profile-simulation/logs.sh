#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=common.sh
source "$deploy_dir/common.sh"

uap_require_local_tools
tail_count="${UGV_AGENT_PROFILE_LOG_TAIL:-200}"
if [[ ! "$tail_count" =~ ^[1-9][0-9]*$ ]]; then
  echo "UAP_LOG_TAIL_INVALID" >&2
  exit 2
fi

uap_compose logs --no-color --tail "$tail_count" \
  "$UAP_ADAPTER_DB_SERVICE" \
  "$UAP_RUNTIME_DB_SERVICE" \
  "$UAP_ADAPTER_SERVICE" \
  "$UAP_RUNTIME_SERVICE"

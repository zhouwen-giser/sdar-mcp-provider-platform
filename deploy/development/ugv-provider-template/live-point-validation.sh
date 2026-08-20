#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$(CDPATH= cd -- "$deploy_dir/../../.." && pwd)"
env_file="${UGV_TEMPLATE_ENV_FILE:-$deploy_dir/.env}"

if [[ ! -f "$env_file" ]]; then
  echo "UGV_LIVE_ENV_REQUIRED" >&2
  exit 2
fi
if [[ "${ALLOW_REAL_UGV_SIDE_EFFECTS:-}" != "YES" ]]; then
  echo "UGV_LIVE_SIDE_EFFECT_AUTHORIZATION_REQUIRED" >&2
  exit 2
fi
for name in LIVE_TEST_RUN_ID UGV_RUNTIME_MCP_URL UGV_TEST_RESOURCE_ID \
  UGV_LIVE_RUNTIME_DATABASE_URL UGV_LIVE_ADAPTER_DATABASE_URL; do
  if [[ -z "${!name:-}" ]]; then
    echo "${name}_REQUIRED" >&2
    exit 2
  fi
done

node "$repo_root/scripts/ugv-provider-template/live-point-validation.mjs" \
  --env-file "$env_file"

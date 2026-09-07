#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
profile="${1:-external}"
env_file="${UGV_TEMPLATE_ENV_FILE:-$deploy_dir/.env}"
project_name="${UGV_TEMPLATE_PROJECT_NAME:-sdar-development-ugv-provider-template}"

if [[ "$profile" != "mock" && "$profile" != "external" ]]; then
  echo "UGV_TEMPLATE_PROFILE_INVALID: expected mock or external" >&2
  exit 2
fi
if [[ ! -f "$env_file" ]]; then
  if [[ "$profile" == "mock" ]]; then
    env_file="$deploy_dir/.env.mock.example"
  else
    env_file="$deploy_dir/.env.example"
  fi
fi
docker compose --project-name "$project_name" --env-file "$env_file" \
  -f "$deploy_dir/compose.yaml" --profile "$profile" down --remove-orphans

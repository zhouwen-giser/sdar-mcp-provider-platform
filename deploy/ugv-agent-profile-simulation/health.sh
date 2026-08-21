#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=common.sh
source "$deploy_dir/common.sh"

uap_require_local_tools
uap_validate_config

for service in \
  "$UAP_ADAPTER_DB_SERVICE" \
  "$UAP_RUNTIME_DB_SERVICE" \
  "$UAP_ADAPTER_SERVICE" \
  "$UAP_RUNTIME_SERVICE"; do
  if [[ -z "$(uap_compose ps --quiet "$service")" ]]; then
    echo "UAP_SERVICE_NOT_RUNNING: $service" >&2
    exit 2
  fi
done

uap_compose exec -T "$UAP_RUNTIME_SERVICE" node -e \
  "fetch('http://127.0.0.1:8080/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

echo "UAP_EXTERNAL_SIMULATION_HEALTHY"

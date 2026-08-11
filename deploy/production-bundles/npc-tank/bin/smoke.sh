#!/usr/bin/env bash
set -euo pipefail

bin_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=common.sh
source "$bin_dir/common.sh"

npc_require_lifecycle_files
npc_require_deployable_bundle
npc_require_docker
npc_validate_external_configuration
npc_validate_secret_inventory
npc_verify_images
npc_validate_compose

while IFS= read -r service; do
  npc_verify_running_service "$service"
done < <(npc_persistent_services)

npc_compose exec -T pms-postgres pg_isready -U pms_admin -d pms >/dev/null
npc_compose exec -T npc-adapter-postgres \
  pg_isready -U npc_adapter -d npc_adapter >/dev/null
npc_compose exec -T npc-runtime-postgres \
  pg_isready -U npc_runtime -d npc_runtime >/dev/null
npc_compose exec -T pms-api node -e \
  "fetch('http://127.0.0.1:8090/health/ready').then(r=>{if(!r.ok)process.exit(2)}).catch(()=>process.exit(2))"
npc_compose exec -T pms-api node /opt/sdar-bundle/pms-web-smoke.mjs

jwt_issuer="$(npc_env_literal NPC_TANK_RUNTIME_JWT_ISSUER "$NPC_BUNDLE_USER_ENV")"
jwt_issuer="${jwt_issuer:-sdar-npc-tank-production}"
jwt_audience="$(npc_env_literal NPC_TANK_RUNTIME_JWT_AUDIENCE "$NPC_BUNDLE_USER_ENV")"
jwt_audience="${jwt_audience:-sdar-runtime}"
npc_compose exec -T \
  --env "JWT_ISSUER=$jwt_issuer" \
  --env "JWT_AUDIENCE=$jwt_audience" \
  npc-tank-runtime node /opt/sdar-bundle/runtime-read-smoke.mjs

printf 'SMOKE_PASS: eight services, PMS Web API routing, JWT Runtime, Device MCP, MQTT read path, and zero mutating Runtime calls verified at %s.\n' \
  "$(npc_bundle_revision)"
printf '%s\n' 'Registry authority remains NOT_CONFIGURED; this smoke does not claim Registry/Catalog closure.'

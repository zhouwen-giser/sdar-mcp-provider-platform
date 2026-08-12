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

pms_web_smoke_host="$(npc_required_env_literal PMS_WEB_BIND_ADDRESS "$NPC_BUNDLE_USER_ENV")"
[[ "$pms_web_smoke_host" == "0.0.0.0" ]] && pms_web_smoke_host="127.0.0.1"
[[ "$pms_web_smoke_host" == "::" || "$pms_web_smoke_host" == "[::]" ]] && pms_web_smoke_host="::1"
if [[ "$pms_web_smoke_host" == \[*\] ]]; then
  pms_web_smoke_url_host="$pms_web_smoke_host"
elif [[ "$pms_web_smoke_host" == *:* ]]; then
  pms_web_smoke_url_host="[$pms_web_smoke_host]"
else
  pms_web_smoke_url_host="$pms_web_smoke_host"
fi
pms_web_smoke_origin="http://$pms_web_smoke_url_host:$(npc_required_env_literal PMS_WEB_PORT "$NPC_BUNDLE_USER_ENV")"
pms_web_smoke_image="sdar/production-pms-web:$(npc_bundle_revision)"
docker run --rm --network host --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --env "PMS_WEB_SMOKE_ORIGIN=$pms_web_smoke_origin" \
  --entrypoint node \
  --volume "$bin_dir/pms-web-smoke.mjs:/opt/sdar-bundle/pms-web-smoke.mjs:ro" \
  "$pms_web_smoke_image" /opt/sdar-bundle/pms-web-smoke.mjs

npc_compose --profile seed run --rm --no-deps \
  pms-seed node /app/runtime-read-smoke.mjs

printf 'SMOKE_PASS: eight services, container and host-published anonymous PMS Web raw API/SDAR projection, anonymous Runtime MCP, PMS-managed direct deployment, fresh heartbeat, Device MCP, MQTT read path, and zero mutating Runtime calls verified at %s.\n' \
  "$(npc_bundle_revision)"

#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=common.sh
source "$script_dir/common.sh"

require_command docker
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required"
require_initialized_bundle

services=(
  pms-postgres
  pms-api
  pms-worker
  pms-web
  ugv-adapter-postgres
  ugv-runtime-postgres
  ugv-adapter
  ugv-runtime
)
for service in "${services[@]}"; do
  container_id="$(compose ps --quiet "$service")"
  [[ -n "$container_id" ]] || die "service is not running: $service"
  state="$(docker container inspect --format '{{.State.Status}}' "$container_id")"
  health="$(docker container inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id")"
  [[ "$state" == "running" && "$health" == "healthy" ]] ||
    die "service is not healthy: $service ($state/$health)"
done

compose exec -T pms-postgres pg_isready -U pms_admin -d pms >/dev/null
compose exec -T ugv-adapter-postgres pg_isready -U ugv_adapter -d ugv_adapter >/dev/null
compose exec -T ugv-runtime-postgres pg_isready -U ugv_runtime -d ugv_runtime >/dev/null
compose exec -T pms-web node /opt/sdar-bundle/pms-web-smoke.mjs

pms_web_smoke_host="$(required_env_value PMS_WEB_BIND_ADDRESS)"
[[ "$pms_web_smoke_host" == "0.0.0.0" ]] && pms_web_smoke_host="127.0.0.1"
[[ "$pms_web_smoke_host" == "::" || "$pms_web_smoke_host" == "[::]" ]] && pms_web_smoke_host="::1"
if [[ "$pms_web_smoke_host" == \[*\] ]]; then
  pms_web_smoke_url_host="$pms_web_smoke_host"
elif [[ "$pms_web_smoke_host" == *:* ]]; then
  pms_web_smoke_url_host="[$pms_web_smoke_host]"
else
  pms_web_smoke_url_host="$pms_web_smoke_host"
fi
pms_web_smoke_origin="http://$pms_web_smoke_url_host:$(required_env_value PMS_WEB_PORT)"
pms_web_smoke_image="sdar/production-pms-web:$(bundle_revision)"
docker image inspect "$pms_web_smoke_image" >/dev/null 2>&1 ||
  die "verified local PMS Web image is missing: $pms_web_smoke_image"
[[ "$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$pms_web_smoke_image")" == "$(bundle_revision)" ]] ||
  die "local PMS Web image revision does not match this bundle"
docker run --rm --network host --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --env "PMS_WEB_SMOKE_ORIGIN=$pms_web_smoke_origin" \
  --entrypoint node \
  --volume "$script_dir/pms-web-smoke.mjs:/opt/sdar-bundle/pms-web-smoke.mjs:ro" \
  "$pms_web_smoke_image" /opt/sdar-bundle/pms-web-smoke.mjs

compose --profile seed run --rm --no-deps pms-seed node /app/runtime-smoke.mjs

printf 'SMOKE_PASS: eight services, container and host-published anonymous PMS Web raw API/SDAR projection, anonymous Runtime MCP, PMS-managed direct deployment, fresh heartbeat, Device MCP, and MQTT read path are ready at %s.\n' \
  "$(bundle_revision)"

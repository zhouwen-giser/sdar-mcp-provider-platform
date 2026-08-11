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
compose exec -T ugv-runtime node /opt/sdar-bundle/runtime-smoke.mjs

printf 'SMOKE_PASS: eight services, PMS Web proxy, JWT Runtime, Device MCP, and MQTT read path are ready at %s.\n' \
  "$(bundle_revision)"

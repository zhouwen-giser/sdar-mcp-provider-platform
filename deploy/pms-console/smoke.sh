#!/usr/bin/env bash
set -euo pipefail

source "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

pms_require_environment
expected_sha="$(pms_expected_head)"
export PMS_CONSOLE_GIT_SHA="$expected_sha"
pms_compose config --quiet
pms_assert_service_inventory
pms_validate_secrets

for service in pms-postgres pms-api pms-worker pms-web; do
  container_id="$(pms_compose ps --quiet "$service")"
  [[ -n "$container_id" ]] || pms_fail "SERVICE_NOT_RUNNING_${service^^}"
  running="$(docker container inspect --format '{{ .State.Running }}' "$container_id")"
  [[ "$running" == "true" ]] || pms_fail "SERVICE_EXITED_${service^^}"
  health="$(docker container inspect --format '{{ if .State.Health }}{{ .State.Health.Status }}{{ else }}none{{ end }}' "$container_id")"
  [[ "$health" == "healthy" ]] || pms_fail "SERVICE_UNHEALTHY_${service^^}"
done

pms_compose exec -T pms-postgres pg_isready -U pms_admin -d pms >/dev/null
pms_compose exec -T pms-api node -e \
  "fetch('http://127.0.0.1:8090/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
pms_compose exec -T pms-web node -e \
  "fetch('http://127.0.0.1:8080/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

published="$(pms_compose port pms-web 8080)"
web_port="${published##*:}"
[[ "$web_port" =~ ^[1-9][0-9]*$ ]] || pms_fail "WEB_PUBLISHED_PORT_INVALID"
node "$PMS_CONSOLE_DEPLOY_DIR/smoke-client.mjs" "http://127.0.0.1:$web_port"

bash "$PMS_CONSOLE_DEPLOY_DIR/verify-images.sh" "$expected_sha"
echo "PASS: PMS DB, API, Worker, Web, Console proxy, and proxy boundary are healthy"

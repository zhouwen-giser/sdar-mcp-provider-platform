#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=common.sh
source "$script_dir/common.sh"

require_initialized_bundle
require_command docker
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required"

image_loader="$bundle_dir/bin/load-images.sh"
[[ -x "$image_loader" && ! -L "$image_loader" ]] ||
  die "verified bundle image loader is missing or not executable"
"$image_loader"

revision="$(bundle_revision)"
images=(
  "sdar/production-ugv-pms-api:$revision"
  "sdar/production-ugv-pms-worker:$revision"
  "sdar/production-pms-web:$revision"
  "sdar/production-ugv-runtime:$revision"
  "sdar/production-ugv-adapter:$revision"
  "$(postgres_image)"
)
for image in "${images[@]}"; do
  docker image inspect "$image" >/dev/null 2>&1 || die "bundle image is not loaded: $image"
done

validate_compose_policy
wait_timeout="$(required_env_value UGV_COMPOSE_WAIT_TIMEOUT_SECONDS)"
[[ "$wait_timeout" =~ ^[1-9][0-9]*$ ]] || die "UGV_COMPOSE_WAIT_TIMEOUT_SECONDS must be positive"

printf 'Starting eight persistent UGV production services at revision %s...\n' "$revision"
compose up --detach --no-build --pull never --wait --wait-timeout "$wait_timeout" \
  pms-postgres pms-api pms-worker pms-web \
  ugv-adapter-postgres ugv-runtime-postgres ugv-adapter ugv-runtime

printf 'Applying idempotent PMS vendor-managed UGV seed...\n'
compose --profile seed run --rm --no-deps pms-seed

bash "$script_dir/smoke.sh"
printf 'PASS: UGV production bundle is ready; PMS Web is bound to %s:%s.\n' \
  "$(required_env_value PMS_WEB_BIND_ADDRESS)" "$(required_env_value PMS_WEB_PORT)"

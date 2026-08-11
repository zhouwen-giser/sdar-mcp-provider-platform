#!/usr/bin/env bash
set -euo pipefail

bin_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=common.sh
source "$bin_dir/common.sh"

# Refuse stage-only deliveries before any docker load or compose up operation.
npc_require_lifecycle_files
npc_require_deployable_bundle
npc_require_docker
npc_validate_external_configuration
npc_validate_secret_inventory

bash "$bin_dir/load-images.sh"
npc_verify_images
npc_validate_compose

wait_timeout="$(npc_env_literal COMPOSE_WAIT_TIMEOUT_SECONDS "$NPC_BUNDLE_USER_ENV")"
wait_timeout="${wait_timeout:-240}"
[[ "$wait_timeout" =~ ^[1-9][0-9]*$ && "$wait_timeout" -le 3600 ]] || \
  npc_die "COMPOSE_WAIT_TIMEOUT_SECONDS must be between 1 and 3600"

mapfile -t services < <(npc_persistent_services)
printf 'Starting eight NPC production services at revision %s...\n' "$(npc_bundle_revision)"
npc_compose up --detach --no-build --pull never --wait --wait-timeout "$wait_timeout" \
  "${services[@]}"

printf '%s\n' 'Applying the idempotent vendor-managed NPC package/provider/resource seed...'
npc_compose --profile seed run --rm --no-deps pms-seed

bash "$bin_dir/smoke.sh"
printf 'PASS: NPC internal-network production bundle is ready; PMS Web is available at http://%s:%s.\n' \
  "$(npc_required_env_literal PMS_WEB_BIND_ADDRESS "$NPC_BUNDLE_USER_ENV")" \
  "$(npc_required_env_literal PMS_WEB_PORT "$NPC_BUNDLE_USER_ENV")"

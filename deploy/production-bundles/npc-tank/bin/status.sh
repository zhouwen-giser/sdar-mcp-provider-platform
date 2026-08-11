#!/usr/bin/env bash
set -euo pipefail

bin_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=common.sh
source "$bin_dir/common.sh"

npc_require_lifecycle_files
npc_require_deployable_bundle
npc_require_docker
npc_compose ps

while IFS= read -r service; do
  npc_verify_running_service "$service"
done < <(npc_persistent_services)

printf 'PMS Web: http://%s:%s (plain internal-network access; no end-user authentication)\n' \
  "$(npc_required_env_literal PMS_WEB_BIND_ADDRESS "$NPC_BUNDLE_USER_ENV")" \
  "$(npc_required_env_literal PMS_WEB_PORT "$NPC_BUNDLE_USER_ENV")"
printf 'NPC Runtime: http://%s:%s (JWT protected)\n' \
  "$(npc_required_env_literal NPC_TANK_RUNTIME_BIND_ADDRESS "$NPC_BUNDLE_USER_ENV")" \
  "$(npc_required_env_literal NPC_TANK_RUNTIME_PORT "$NPC_BUNDLE_USER_ENV")"
printf '%s\n' 'Runtime authority: direct container; Registry authority: NOT_CONFIGURED.'

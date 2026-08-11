#!/usr/bin/env bash
set -euo pipefail

bin_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=common.sh
source "$bin_dir/common.sh"

npc_require_lifecycle_files
npc_require_docker
npc_compose down --remove-orphans --timeout 45
printf '%s\n' \
  'NPC production services stopped. PostgreSQL volumes, Worker state, reports, configuration, and secrets were preserved.'

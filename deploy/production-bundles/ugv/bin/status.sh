#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=common.sh
source "$script_dir/common.sh"

require_command docker
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required"
require_environment_file
require_image_lock
compose ps
printf 'PMS Web: http://%s:%s\n' \
  "$(required_env_value PMS_WEB_BIND_ADDRESS)" "$(required_env_value PMS_WEB_PORT)"
printf 'UGV Runtime: http://%s:%s (anonymous isolated-intranet access)\n' \
  "$(required_env_value UGV_RUNTIME_BIND_ADDRESS)" "$(required_env_value UGV_RUNTIME_PORT)"
printf 'Registry advertised Runtime base: %s\n' \
  "$(required_env_value UGV_RUNTIME_ADVERTISED_URL)"
printf '%s\n' 'Runtime authority: direct_container; Registry authority: pms_worker.'

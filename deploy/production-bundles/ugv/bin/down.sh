#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=common.sh
source "$script_dir/common.sh"

require_command docker
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required"
require_environment_file
require_image_lock
compose down --remove-orphans --timeout 30
printf '%s\n' 'UGV production services stopped. PostgreSQL volumes, Worker state, evidence, and secrets were preserved.'

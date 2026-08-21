#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=common.sh
source "$deploy_dir/common.sh"

uap_require_local_tools
uap_compose down --remove-orphans
echo "UAP_EXTERNAL_SIMULATION_STOPPED: volumes=preserved"

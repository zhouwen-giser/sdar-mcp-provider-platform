#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=common.sh
source "$deploy_dir/common.sh"

uap_require_local_tools
if [[ "$UAP_PROJECT_NAME" != "sdar-ugv-agent-profile-simulation" ]]; then
  echo "UAP_CLEAN_PROJECT_SCOPE_INVALID" >&2
  exit 2
fi

# Compose project labels scope deletion to this Goal. No global volume/image prune is allowed.
uap_compose down --volumes --remove-orphans
echo "UAP_EXTERNAL_SIMULATION_CLEANED: project=$UAP_PROJECT_NAME"

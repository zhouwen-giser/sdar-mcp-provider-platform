#!/usr/bin/env bash
set -euo pipefail
command -v node >/dev/null || { echo '需要 Node.js 22 和 Docker Compose v2+' >&2; exit 1; }
deploy_dir="$(dirname "$(readlink -f "$0")")"
if [[ $# -lt 2 && -f "$deploy_dir/../../../DEPLOYMENT_PROFILE" && ! -e "$deploy_dir/.env" ]]; then
  [[ "$(cat "$deploy_dir/../../../DEPLOYMENT_PROFILE")" == sz-gowm ]] || exit 1
  (umask 077; cp "$deploy_dir/.env.gowm.example" "$deploy_dir/.env")
fi
exec node "$(dirname "$(readlink -f "$0")")/package.mjs" "$@"

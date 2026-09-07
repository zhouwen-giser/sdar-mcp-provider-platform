#!/usr/bin/env bash
set -euo pipefail
command -v node >/dev/null || { echo '需要 Node.js 22 和 Docker Compose v2+' >&2; exit 1; }
exec node "$(dirname "$(readlink -f "$0")")/package.mjs" "$@"

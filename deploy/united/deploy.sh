#!/usr/bin/env bash
set -euo pipefail
if ! command -v node >/dev/null; then
  if [[ -x "$HOME/.nvm/versions/node/v22.23.2/bin/node" ]]; then
    export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
  else
    echo 'Node.js 22 is required; add its bin directory to PATH.' >&2
    exit 1
  fi
fi
exec node "$(cd "$(dirname "$0")" && pwd)/deploy.mjs" "$@"

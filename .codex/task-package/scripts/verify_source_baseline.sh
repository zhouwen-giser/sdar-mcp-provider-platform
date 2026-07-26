#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ZIP="$ROOT/inputs/source/sdar-mcp-tasks-provider-runtime-ugv-npc-provider-v1-work-delivery.zip"
EXPECTED="000a46f7452eadac986de3f142dde6358a590c5c372bee2e09793fe9396ad6e3"
ACTUAL="$(sha256sum "$ZIP" | awk '{print $1}')"
[[ "$ACTUAL" == "$EXPECTED" ]] || { echo "SHA mismatch: $ACTUAL"; exit 1; }
echo "Source baseline OK: $ACTUAL"

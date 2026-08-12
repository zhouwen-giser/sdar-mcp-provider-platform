#!/usr/bin/env bash
set -euo pipefail

source "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

pms_require_environment
pms_require_command tar TAR

PMS_CONSOLE_GIT_SHA="$(pms_expected_head)"
export PMS_CONSOLE_GIT_SHA
export VITE_PMS_DATA_MODE=api

pms_compose config --quiet
pms_assert_service_inventory
pms_validate_secrets

wait_timeout="${PMS_COMPOSE_WAIT_TIMEOUT_SECONDS:-180}"
[[ "$wait_timeout" =~ ^[1-9][0-9]*$ ]] || pms_fail "WAIT_TIMEOUT_INVALID"

temporary_root="${TMPDIR:-/tmp}"
[[ -d "$temporary_root" ]] || pms_fail "TEMPORARY_ROOT_INVALID"
PMS_CONSOLE_BUILD_CONTEXT="$(mktemp -d "$temporary_root/sdar-pms-console-build.XXXXXXXX")"
export PMS_CONSOLE_BUILD_CONTEXT
cleanup_build_context() {
  if [[ -n "${PMS_CONSOLE_BUILD_CONTEXT:-}" && -d "$PMS_CONSOLE_BUILD_CONTEXT" ]]; then
    rm -rf -- "$PMS_CONSOLE_BUILD_CONTEXT"
  fi
}
trap cleanup_build_context EXIT

git -C "$PMS_CONSOLE_REPO_ROOT" archive --format=tar "$PMS_CONSOLE_GIT_SHA" | \
  tar -xf - -C "$PMS_CONSOLE_BUILD_CONTEXT" || pms_fail "EXACT_HEAD_ARCHIVE_FAILED"

echo "Building PMS Console images from exact HEAD: $PMS_CONSOLE_GIT_SHA"
pms_compose build pms-api pms-worker pms-web
bash "$PMS_CONSOLE_DEPLOY_DIR/verify-images.sh" "$PMS_CONSOLE_GIT_SHA" --images-only

echo "Starting dedicated PMS PostgreSQL 17..."
pms_compose up --detach --wait --wait-timeout "$wait_timeout" pms-postgres
echo "Starting PMS API..."
pms_compose up --detach --no-build --no-deps --wait --wait-timeout "$wait_timeout" pms-api
echo "Starting PMS Worker..."
pms_compose up --detach --no-build --no-deps --wait --wait-timeout "$wait_timeout" pms-worker
echo "Starting PMS Web in API mode..."
pms_compose up --detach --no-build --no-deps --wait --wait-timeout "$wait_timeout" \
  --remove-orphans pms-web

bash "$PMS_CONSOLE_DEPLOY_DIR/smoke.sh"
echo "PASS: standalone PMS Console package is healthy at exact HEAD $PMS_CONSOLE_GIT_SHA"

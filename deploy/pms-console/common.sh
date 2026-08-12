#!/usr/bin/env bash

PMS_CONSOLE_DEPLOY_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PMS_CONSOLE_REPO_ROOT="$(CDPATH= cd -- "$PMS_CONSOLE_DEPLOY_DIR/../.." && pwd)"
PMS_CONSOLE_ENV_FILE="${PMS_CONSOLE_ENV_FILE:-$PMS_CONSOLE_DEPLOY_DIR/.env}"
PMS_CONSOLE_PROJECT_NAME="sdar-pms-console"

pms_fail() {
  echo "BLOCKED_CONFIGURATION:$1" >&2
  exit 2
}

pms_require_command() {
  command -v "$1" >/dev/null 2>&1 || pms_fail "REQUIRED_COMMAND_MISSING_$2"
}

pms_require_environment() {
  [[ -f "$PMS_CONSOLE_ENV_FILE" ]] || pms_fail "ENV_FILE_MISSING"
  pms_require_command docker DOCKER
  pms_require_command git GIT
  pms_require_command node NODE
  docker compose version >/dev/null 2>&1 || pms_fail "DOCKER_COMPOSE_V2_REQUIRED"
}

pms_compose() {
  docker compose \
    --project-name "$PMS_CONSOLE_PROJECT_NAME" \
    --env-file "$PMS_CONSOLE_ENV_FILE" \
    -f "$PMS_CONSOLE_DEPLOY_DIR/compose.yaml" \
    "$@"
}

pms_expected_head() {
  local branch sha
  branch="$(git -C "$PMS_CONSOLE_REPO_ROOT" branch --show-current)"
  [[ "$branch" == "codex/goal-10-ugv-simulation-real-interface" ]] || pms_fail "BRANCH_MISMATCH"
  git -C "$PMS_CONSOLE_REPO_ROOT" diff --quiet -- || pms_fail "TRACKED_SOURCE_DIRTY"
  git -C "$PMS_CONSOLE_REPO_ROOT" diff --cached --quiet -- || pms_fail "STAGED_SOURCE_DIRTY"
  git -C "$PMS_CONSOLE_REPO_ROOT" cat-file -e HEAD:deploy/pms-console/compose.yaml 2>/dev/null || \
    pms_fail "DEPLOYMENT_NOT_COMMITTED_AT_HEAD"
  sha="$(git -C "$PMS_CONSOLE_REPO_ROOT" rev-parse --verify 'HEAD^{commit}')"
  [[ "$sha" =~ ^[0-9a-f]{40,64}$ ]] || pms_fail "GIT_SHA_INVALID"
  printf '%s\n' "$sha"
}

pms_assert_service_inventory() {
  local services expected
  services="$(pms_compose config --services | LC_ALL=C sort)"
  expected=$'pms-api\npms-postgres\npms-web\npms-worker'
  [[ "$services" == "$expected" ]] || pms_fail "SERVICE_INVENTORY_INVALID"
}

pms_resolved_secret_root() {
  pms_compose config --format json | node --input-type=module -e '
    import { dirname } from "node:path";
    let source = "";
    for await (const chunk of process.stdin) source += chunk;
    const document = JSON.parse(source);
    const volumes = document.services?.["pms-api"]?.volumes;
    const api = Array.isArray(volumes)
      ? volumes.find((entry) => entry?.target === "/run/pms-secrets/api")
      : undefined;
    if (api?.type !== "bind" || typeof api.source !== "string") process.exit(2);
    process.stdout.write(`${dirname(api.source)}\n`);
  ' || pms_fail "SECRET_ROOT_RESOLUTION_FAILED"
}

pms_validate_secrets() {
  local secret_root
  secret_root="$(pms_resolved_secret_root)"
  node "$PMS_CONSOLE_DEPLOY_DIR/validate-secrets.mjs" \
    "$secret_root" \
    "$PMS_CONSOLE_REPO_ROOT"
}

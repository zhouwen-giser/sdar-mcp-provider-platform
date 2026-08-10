#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$(CDPATH= cd -- "$deploy_dir/../.." && pwd)"
env_file="${UGV_SIM_ENV_FILE:-$deploy_dir/.env}"
project_name="sdar-ugv-simulation-real"
evidence_path="${UGV_READ_ONLY_EVIDENCE_PATH:-$repo_root/reports/ugv-simulation/READ_ONLY_SMOKE.json}"

if [[ ! -f "$env_file" ]]; then
  echo "BLOCKED_EXTERNAL_ENV: configuration file not found: $env_file" >&2
  exit 2
fi
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "BLOCKED_EXTERNAL_ENV: Docker Compose v2 is required." >&2
  exit 2
fi
if ! command -v node >/dev/null 2>&1; then
  echo "BLOCKED_EXTERNAL_ENV: Node.js 22 or newer is required for the smoke client." >&2
  exit 2
fi
if ! node "$repo_root/scripts/ugv-simulation/validate-node-version.mjs"; then
  exit 2
fi

shopt -s nullglob dotglob
for candidate in "$deploy_dir/secrets"/*; do
  case "$(basename -- "$candidate")" in
    README.md|.gitignore) ;;
    *)
      echo "BLOCKED_CONFIGURATION: the repository secret directory must contain documentation only." >&2
      exit 2
      ;;
  esac
done
shopt -u nullglob dotglob

if ! UGV_QUALIFICATION_GIT_SHA="$(
  node "$repo_root/scripts/ugv-simulation/validate-deployment.mjs" \
    --repo-root "$repo_root" \
    --env-file "$env_file"
)"; then
  exit 2
fi
if [[ ! "$UGV_QUALIFICATION_GIT_SHA" =~ ^[0-9a-f]{40,64}$ ]]; then
  echo "BLOCKED_CONFIGURATION: qualification source SHA is invalid." >&2
  exit 2
fi
export UGV_QUALIFICATION_GIT_SHA
export UGV_QUALIFICATION_SOURCE_STATUS="TRACKED_SOURCE_CLEAN"
export PMS_CONSOLE_GIT_SHA="$UGV_QUALIFICATION_GIT_SHA"
echo "Qualification source verified: $UGV_QUALIFICATION_GIT_SHA"
compose=(docker compose --project-name "$project_name" --env-file "$env_file" -f "$deploy_dir/compose.yaml")

"${compose[@]}" config --quiet
pms_secret_root="$(
  "${compose[@]}" config --format json | node --input-type=module -e '
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
  '
)" || {
  echo "BLOCKED_CONFIGURATION: failed to resolve the PMS Console secret root." >&2
  exit 2
}
node "$repo_root/deploy/pms-console/validate-secrets.mjs" \
  "$pms_secret_root" \
  "$repo_root"
adapter_image="sdar-ugv-simulation-real/ugv-adapter:$UGV_QUALIFICATION_GIT_SHA"
runtime_image="sdar-ugv-simulation-real/runtime:$UGV_QUALIFICATION_GIT_SHA"
pms_api_image="sdar/pms-api:$UGV_QUALIFICATION_GIT_SHA"
pms_worker_image="sdar/pms-worker:$UGV_QUALIFICATION_GIT_SHA"
pms_web_image="sdar/pms-web:$UGV_QUALIFICATION_GIT_SHA"

verify_image_revision() {
  local image="$1"
  local revision
  if ! revision="$(
    docker image inspect \
      --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
      "$image"
  )" || [[ "$revision" != "$UGV_QUALIFICATION_GIT_SHA" ]]; then
    echo "BLOCKED_CONFIGURATION: qualified image is missing or has the wrong source SHA: $image" >&2
    echo "Run bash deploy/ugv-simulation/up.sh from this exact Git SHA before smoke." >&2
    exit 2
  fi
}

verify_running_service_image() {
  local service="$1"
  local image="$2"
  local container_id
  local expected_image_id
  local running_image_id
  container_id="$("${compose[@]}" ps --quiet "$service")"
  if [[ -z "$container_id" ]]; then
    echo "BLOCKED_EXTERNAL_ENV: required service is not running: $service" >&2
    exit 2
  fi
  expected_image_id="$(docker image inspect --format '{{ .Id }}' "$image")"
  running_image_id="$(docker container inspect --format '{{ .Image }}' "$container_id")"
  if [[ "$running_image_id" != "$expected_image_id" ]]; then
    echo "BLOCKED_CONFIGURATION: $service is not running the image for the qualification SHA." >&2
    exit 2
  fi
}

for service in pms-postgres pms-api pms-worker pms-web; do
  container_id="$("${compose[@]}" ps --quiet "$service")"
  if [[ -z "$container_id" ]]; then
    echo "BLOCKED_EXTERNAL_ENV: required PMS service is not running: $service" >&2
    exit 2
  fi
  running="$(docker container inspect --format '{{ .State.Running }}' "$container_id")"
  health="$(
    docker container inspect \
      --format '{{ if .State.Health }}{{ .State.Health.Status }}{{ else }}none{{ end }}' \
      "$container_id"
  )"
  if [[ "$running" != "true" || "$health" != "healthy" ]]; then
    echo "BLOCKED_EXTERNAL_ENV: required PMS service is unhealthy: $service" >&2
    exit 2
  fi
done

verify_image_revision "$pms_api_image"
verify_image_revision "$pms_worker_image"
verify_image_revision "$pms_web_image"
verify_running_service_image pms-api "$pms_api_image"
verify_running_service_image pms-worker "$pms_worker_image"
verify_running_service_image pms-web "$pms_web_image"

echo "Checking PMS DB, API, Worker, Web, and same-origin proxy boundary..."
"${compose[@]}" exec -T pms-postgres pg_isready -U pms_admin -d pms >/dev/null
"${compose[@]}" exec -T pms-api node -e \
  "fetch('http://127.0.0.1:8090/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
"${compose[@]}" exec -T pms-web node -e \
  "fetch('http://127.0.0.1:8080/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
published="$("${compose[@]}" port pms-web 8080)"
web_port="${published##*:}"
if [[ ! "$web_port" =~ ^[1-9][0-9]*$ ]]; then
  echo "BLOCKED_CONFIGURATION: PMS Web published port is invalid." >&2
  exit 2
fi
node "$repo_root/deploy/pms-console/smoke-client.mjs" \
  "http://127.0.0.1:$web_port"

verify_image_revision "$adapter_image"
verify_image_revision "$runtime_image"
verify_running_service_image ugv-adapter "$adapter_image"
verify_running_service_image ugv-runtime "$runtime_image"

run_preflight_without_build() {
  local exit_code=0
  "${compose[@]}" --profile preflight up \
    --no-build \
    --no-deps \
    --force-recreate \
    --pull never \
    --exit-code-from ugv-preflight \
    ugv-preflight || exit_code=$?
  "${compose[@]}" --profile preflight rm --force --stop ugv-preflight >/dev/null 2>&1 || true
  return "$exit_code"
}

echo "Rechecking external endpoints without publishing or invoking controls..."
run_preflight_without_build

echo "Calling only Runtime read operations..."
node "$repo_root/scripts/ugv-simulation/read-only-smoke.mjs" \
  --env-file "$env_file" \
  --output "$evidence_path"

echo "PASS: PMS Console checks and read-only Runtime smoke completed; evidence=$evidence_path"

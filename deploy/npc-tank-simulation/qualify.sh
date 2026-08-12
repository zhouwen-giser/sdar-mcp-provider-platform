#!/usr/bin/env bash
set -euo pipefail

deploy_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$(CDPATH= cd -- "$deploy_dir/../.." && pwd)"
pms_compose_file="$repo_root/deploy/pms-console/compose.yaml"
npc_compose_file="$deploy_dir/compose.yaml"
env_file="${NPC_TANK_SIM_ENV_FILE:-$deploy_dir/.env}"
project_name="sdar-npc-tank-simulation-real"
validation_flags=()
control_requested=false
recon_requested=false
effector_requested=false

for argument in "$@"; do
  case "$argument" in
    --control)
      control_requested=true
      validation_flags+=(--control)
      ;;
    --recon)
      recon_requested=true
      validation_flags+=(--recon)
      ;;
    --effector)
      effector_requested=true
      validation_flags+=(--effector)
      ;;
    *)
      printf 'BLOCKED_CONFIGURATION: unsupported qualification argument: %s\n' "$argument" >&2
      exit 2
      ;;
  esac
done

[[ -f "$env_file" ]] || {
  printf 'BLOCKED_CONFIGURATION: configuration file not found: %s\n' "$env_file" >&2
  exit 2
}

qualification_sha="$(
  node "$deploy_dir/validate-deployment.mjs" \
    --repo-root "$repo_root" \
    --env-file "$env_file" \
    "${validation_flags[@]}"
)" || exit $?
export NPC_TANK_QUALIFICATION_GIT_SHA="$qualification_sha"
export PMS_CONSOLE_GIT_SHA="$qualification_sha"

compose=(
  docker compose
  --project-name "$project_name"
  --env-file "$env_file"
  -f "$pms_compose_file"
  -f "$npc_compose_file"
)
"${compose[@]}" config --quiet

echo "Running the mandatory read-only qualification first..."
bash "$deploy_dir/smoke.sh"

if [[ "$control_requested" == "true" ]]; then
  echo "CONTROL NOT_EXECUTED: safety fixtures and double opt-in validated; no deployment-local actuator runner is permitted."
fi
if [[ "$recon_requested" == "true" ]]; then
  echo "RECON NOT_EXECUTED: region fixture and double opt-in validated; use the audited Goal 11 observation-confirming runner."
fi
if [[ "$effector_requested" == "true" ]]; then
  echo "EFFECTOR NOT_EXECUTED: effector/fire remains outside the core deployment qualification."
fi

if [[ "$control_requested" == "true" || "$recon_requested" == "true" || "$effector_requested" == "true" ]]; then
  echo "BLOCKED_IMPLEMENTATION: mutating qualification cannot be claimed by the deployment wrapper alone." >&2
  exit 2
fi

echo "PASS: read-only NPC Tank deployment qualification completed; control/recon/effector NOT_EXECUTED."

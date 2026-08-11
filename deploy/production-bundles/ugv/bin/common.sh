#!/usr/bin/env bash

set -euo pipefail

bundle_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$bundle_dir/compose.yaml"
env_file="${UGV_PRODUCTION_ENV_FILE:-$bundle_dir/.env}"
image_env_file="$bundle_dir/.bundle-images.env"
project_name="sdar-production-ugv"

die() {
  printf 'BLOCKED_CONFIGURATION: %s\n' "$1" >&2
  exit 2
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required"
}

env_value_from() {
  local file="$1"
  local requested="$2"
  local found=""
  local count=0
  local line name value
  [[ -f "$file" ]] || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == *=* ]] || die "invalid env-file line in $(basename -- "$file")"
    name="${line%%=*}"
    value="${line#*=}"
    [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] || die "invalid env key in $(basename -- "$file")"
    if [[ "$name" == "$requested" ]]; then
      found="$value"
      count=$((count + 1))
    fi
  done <"$file"
  [[ "$count" -le 1 ]] || die "duplicate $requested in $(basename -- "$file")"
  [[ "$count" -eq 1 ]] || return 1
  printf '%s\n' "$found"
}

env_value() {
  env_value_from "$env_file" "$1"
}

required_env_value() {
  local value
  value="$(env_value "$1")" || die "$1 is required in $(basename -- "$env_file")"
  [[ -n "$value" ]] || die "$1 must not be empty"
  [[ "$value" != *'$('* && "$value" != *'`'* && "$value" != *$'\n'* ]] ||
    die "$1 contains forbidden shell syntax"
  printf '%s\n' "$value"
}

file_mode() {
  stat -c '%a' -- "$1" 2>/dev/null || die "cannot inspect permissions: $1"
}

file_owner() {
  stat -c '%u' -- "$1" 2>/dev/null || die "cannot inspect owner: $1"
}

require_private_file() {
  local path="$1"
  local maximum_bytes="${2:-1048576}"
  [[ -f "$path" && ! -L "$path" ]] || die "regular non-symlink file required: $path"
  [[ -s "$path" ]] || die "non-empty file required: $path"
  [[ "$(stat -c '%h' -- "$path")" == "1" ]] || die "file must have exactly one hard link: $path"
  local mode size
  mode="$(file_mode "$path")"
  [[ "$mode" == "400" || "$mode" == "600" ]] || die "file mode must be 0400 or 0600: $path"
  [[ "$(file_owner "$path")" == "1000" ]] || die "file must be owned by UID 1000: $path"
  size="$(stat -c '%s' -- "$path")"
  [[ "$size" =~ ^[0-9]+$ && "$size" -le "$maximum_bytes" ]] || die "file is too large: $path"
}

require_private_directory() {
  local path="$1"
  [[ -d "$path" && ! -L "$path" ]] || die "regular non-symlink directory required: $path"
  [[ "$(file_mode "$path")" == "700" ]] || die "directory mode must be 0700: $path"
  [[ "$(file_owner "$path")" == "1000" ]] || die "directory must be owned by UID 1000: $path"
}

require_environment_file() {
  require_private_file "$env_file" 65536
  local key
  for key in \
    BUNDLE_REVISION \
    POSTGRES_IMAGE \
    POSTGRES_DIGEST \
    POSTGRES_DIGEST12 \
    BUNDLE_DEPLOYABLE; do
    if env_value_from "$env_file" "$key" >/dev/null 2>&1; then
      die "image identity keys are forbidden in the user-editable .env"
    fi
  done
  for key in \
    UGV_SIM_DEVICE_MCP_HEADERS_FILE \
    UGV_SIM_DEVICE_MCP_CA_FILE \
    UGV_SIM_MQTT_USERNAME \
    UGV_SIM_MQTT_PASSWORD_FILE \
    UGV_SIM_MQTT_TLS_CA_FILE \
    UGV_SIM_MQTT_TLS_CERT_FILE \
    UGV_SIM_MQTT_TLS_KEY_FILE; do
    if env_value_from "$env_file" "$key" >/dev/null 2>&1; then
      die "$key is not used by the certificate-free intranet bundle"
    fi
  done
}

require_image_lock() {
  [[ -f "$image_env_file" && ! -L "$image_env_file" ]] ||
    die ".bundle-images.env is missing; use an intact production bundle"
  local numeric_mode
  numeric_mode=$((8#$(file_mode "$image_env_file")))
  (( (numeric_mode & 8#222) == 0 )) || die ".bundle-images.env must be read-only"
  local revision postgres postgres_digest postgres_digest12 deployable line name
  revision="$(env_value_from "$image_env_file" BUNDLE_REVISION)" ||
    die "BUNDLE_REVISION is missing from .bundle-images.env"
  postgres="$(env_value_from "$image_env_file" POSTGRES_IMAGE)" ||
    die "POSTGRES_IMAGE is missing from .bundle-images.env"
  postgres_digest="$(env_value_from "$image_env_file" POSTGRES_DIGEST)" ||
    die "POSTGRES_DIGEST is missing from .bundle-images.env"
  postgres_digest12="$(env_value_from "$image_env_file" POSTGRES_DIGEST12)" ||
    die "POSTGRES_DIGEST12 is missing from .bundle-images.env"
  deployable="$(env_value_from "$image_env_file" BUNDLE_DEPLOYABLE)" ||
    die "BUNDLE_DEPLOYABLE is missing from .bundle-images.env"
  [[ "$deployable" == "true" ]] || die "this is a stage-only bundle (BUNDLE_DEPLOYABLE is not true)"
  [[ "$revision" =~ ^[0-9a-f]{40,64}$ ]] ||
    die "BUNDLE_REVISION is invalid"
  [[ "$postgres_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || die "POSTGRES_DIGEST is invalid"
  [[ "$postgres_digest12" =~ ^[0-9a-f]{12}$ ]] || die "POSTGRES_DIGEST12 is invalid"
  [[ "${postgres_digest#sha256:}" == "$postgres_digest12"* ]] ||
    die "POSTGRES_DIGEST12 does not match POSTGRES_DIGEST"
  [[ "$postgres" == "sdar/production-postgres:17-alpine-$postgres_digest12" ]] ||
    die "POSTGRES_IMAGE is not the bundle-controlled immutable local reference"
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    name="${line%%=*}"
    case "$name" in
      BUNDLE_REVISION|POSTGRES_IMAGE|POSTGRES_DIGEST|POSTGRES_DIGEST12|BUNDLE_DEPLOYABLE) ;;
      *) die "unexpected key in .bundle-images.env: $name" ;;
    esac
  done <"$image_env_file"
}

require_generated_layout() {
  local directory
  for directory in \
    "$bundle_dir/secrets" \
    "$bundle_dir/secrets/pms" \
    "$bundle_dir/secrets/pms/api" \
    "$bundle_dir/secrets/pms/worker" \
    "$bundle_dir/secrets/pms/runtime-control-plane" \
    "$bundle_dir/secrets/pms/runtime-control-plane/providers/isr.vehicle.ugv.ugv1/deployments/production-ugv-direct/instances/production-ugv-direct-1" \
    "$bundle_dir/secrets/ugv" \
    "$bundle_dir/secrets/ugv/database" \
    "$bundle_dir/secrets/ugv/runtime" \
    "$bundle_dir/runtime" \
    "$bundle_dir/runtime/pms-worker-state" \
    "$bundle_dir/runtime/pms-worker-state/runtime-secrets" \
    "$bundle_dir/runtime/pms-worker-state/runtime-cache" \
    "$bundle_dir/runtime/pms-worker-state/pm2" \
    "$bundle_dir/runtime/ugv-contract-reports"; do
    require_private_directory "$directory"
  done

  local file
  for file in \
    "$bundle_dir/runtime/.initialized" \
    "$bundle_dir/secrets/pms/postgres-password" \
    "$bundle_dir/secrets/pms/pms-database-url" \
    "$bundle_dir/secrets/pms/api/management.json" \
    "$bundle_dir/secrets/pms/api/runtime.json" \
    "$bundle_dir/secrets/pms/api/management-reader.token" \
    "$bundle_dir/secrets/pms/api/management-admin.token" \
    "$bundle_dir/secrets/pms/worker/external-runtime-catalog.json" \
    "$bundle_dir/secrets/pms/worker/postgres-provisioning.json" \
    "$bundle_dir/secrets/pms/worker/runtime-database-password" \
    "$bundle_dir/secrets/pms/runtime-control-plane/providers/isr.vehicle.ugv.ugv1/deployments/production-ugv-direct/instances/production-ugv-direct-1/control-plane.token" \
    "$bundle_dir/secrets/ugv/database/adapter-password" \
    "$bundle_dir/secrets/ugv/database/runtime-password" \
    "$bundle_dir/secrets/ugv/database/adapter-database-url" \
    "$bundle_dir/secrets/ugv/database/runtime-database-url" \
    "$bundle_dir/secrets/ugv/runtime/jwt-hs256-secret"; do
    require_private_file "$file" 1048576
  done
}

require_external_configuration() {
  local insecure_opt_in device_url mqtt_url wire_mode runtime_advertised_url
  insecure_opt_in="$(required_env_value ALLOW_INSECURE_INTERNAL_TRANSPORT)"
  device_url="$(required_env_value UGV_SIM_DEVICE_MCP_URL)"
  mqtt_url="$(required_env_value UGV_SIM_MQTT_URL)"
  wire_mode="$(required_env_value UGV_MQTT_WIRE_MODE)"
  runtime_advertised_url="$(required_env_value UGV_RUNTIME_ADVERTISED_URL)"
  [[ "$insecure_opt_in" == "true" ]] ||
    die "ALLOW_INSECURE_INTERNAL_TRANSPORT must be exactly true for this intranet bundle"
  [[ "$device_url" == http://* && "$device_url" == */mcp && "$device_url" != *".invalid"* ]] ||
    die "UGV_SIM_DEVICE_MCP_URL must be a configured plaintext http:// intranet URL ending in /mcp"
  [[ "$device_url" != *"@"* && "$device_url" != *"#"* ]] ||
    die "UGV_SIM_DEVICE_MCP_URL must not contain credentials or a fragment"
  [[ "$mqtt_url" == mqtt://* || "$mqtt_url" == ws://* ]] ||
    die "UGV_SIM_MQTT_URL must use plaintext mqtt:// or ws:// in this intranet bundle"
  [[ "$mqtt_url" != *".invalid"* && "$mqtt_url" != *"@"* && "$mqtt_url" != *"#"* ]] ||
    die "UGV_SIM_MQTT_URL is a placeholder or contains credentials/fragment"
  [[ "$wire_mode" == "ros_message_json" || "$wire_mode" == "direct_domain_json" ||
    "$wire_mode" == "ros_bridge_json" ]] || die "UGV_MQTT_WIRE_MODE must be explicit"
  [[ "$runtime_advertised_url" == http://* && "$runtime_advertised_url" != */mcp &&
    "$runtime_advertised_url" != */mcp/ ]] ||
    die "UGV_RUNTIME_ADVERTISED_URL must be a plaintext HTTP Runtime base URL without /mcp"
  [[ ! "$runtime_advertised_url" =~ REPLACE|mock|\.invalid|localhost|127\.0\.0\.1|0\.0\.0\.0 ]] ||
    die "UGV_RUNTIME_ADVERTISED_URL must identify the real intranet deployment host"
  [[ "$runtime_advertised_url" != *"@"* && "$runtime_advertised_url" != *"?"* &&
    "$runtime_advertised_url" != *"#"* ]] ||
    die "UGV_RUNTIME_ADVERTISED_URL must not contain credentials, query, or fragment"

}

require_initialized_bundle() {
  require_command stat
  require_environment_file
  require_image_lock
  require_generated_layout
  require_external_configuration
}

compose() {
  local -a clean_environment=(env)
  local source line name
  for source in "$env_file" "$image_env_file"; do
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line%$'\r'}"
      [[ -z "$line" || "$line" == \#* || "$line" != *=* ]] && continue
      name="${line%%=*}"
      [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] || continue
      clean_environment+=(-u "$name")
    done <"$source"
  done
  "${clean_environment[@]}" \
    docker compose \
    --project-name "$project_name" \
    --env-file "$env_file" \
    --env-file "$image_env_file" \
    -f "$compose_file" \
    "$@"
}

bundle_revision() {
  env_value_from "$image_env_file" BUNDLE_REVISION
}

postgres_image() {
  env_value_from "$image_env_file" POSTGRES_IMAGE
}

validate_compose_policy() {
  local configuration_file pms_api_image
  configuration_file="$(mktemp "${TMPDIR:-/tmp}/sdar-ugv-production-compose.XXXXXXXX.json")"
  pms_api_image="sdar/production-ugv-pms-api:$(bundle_revision)"
  if ! compose --profile seed config --format json >"$configuration_file"; then
    rm -f -- "$configuration_file"
    die "Docker Compose configuration is invalid"
  fi
  chmod 0444 "$configuration_file"
  if ! docker run --rm --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --env "BUNDLE_REVISION=$(bundle_revision)" \
    --env "POSTGRES_IMAGE=$(postgres_image)" \
    --entrypoint node \
    --volume "$bundle_dir/bin/validate-config.mjs:/opt/validate-config.mjs:ro" \
    --volume "$configuration_file:/opt/compose-config.json:ro" \
    "$pms_api_image" /opt/validate-config.mjs /opt/compose-config.json; then
    rm -f -- "$configuration_file"
    die "production Compose policy validation failed"
  fi
  rm -f -- "$configuration_file"
}

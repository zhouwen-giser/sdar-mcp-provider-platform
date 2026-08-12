#!/usr/bin/env bash

NPC_BUNDLE_BIN_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
NPC_BUNDLE_DIR="$(CDPATH= cd -- "$NPC_BUNDLE_BIN_DIR/.." && pwd)"
NPC_BUNDLE_USER_ENV="${NPC_TANK_PRODUCTION_ENV_FILE:-$NPC_BUNDLE_DIR/.env}"
NPC_BUNDLE_IMAGE_ENV="$NPC_BUNDLE_DIR/.bundle-images.env"
NPC_BUNDLE_COMPOSE_FILE="$NPC_BUNDLE_DIR/compose.yaml"
NPC_BUNDLE_PROJECT_NAME="sdar-production-npc-tank"

npc_die() {
  printf 'BLOCKED_CONFIGURATION: %s\n' "$1" >&2
  exit 2
}

npc_require_command() {
  command -v "$1" >/dev/null 2>&1 || npc_die "$1 is required"
}

npc_require_docker() {
  npc_require_command docker
  docker compose version >/dev/null 2>&1 || npc_die "Docker Compose v2 is required"
}

npc_require_lifecycle_files() {
  [[ -f "$NPC_BUNDLE_USER_ENV" ]] || npc_die "missing .env; run bin/init.sh first"
  [[ ! -L "$NPC_BUNDLE_USER_ENV" ]] || npc_die ".env must not be a symlink"
  local user_env_mode
  user_env_mode="$(stat -c '%a' "$NPC_BUNDLE_USER_ENV")" || npc_die "cannot inspect .env"
  (( (8#$user_env_mode & ~0600) == 0 && (8#$user_env_mode & 0400) != 0 )) || \
    npc_die ".env permissions must not exceed 0600"
  [[ -f "$NPC_BUNDLE_IMAGE_ENV" ]] || \
    npc_die "missing immutable .bundle-images.env from the delivery builder"
  [[ ! -L "$NPC_BUNDLE_IMAGE_ENV" ]] || npc_die ".bundle-images.env must not be a symlink"
  local image_env_mode
  image_env_mode="$(stat -c '%a' "$NPC_BUNDLE_IMAGE_ENV")" || \
    npc_die "cannot inspect .bundle-images.env"
  (( (8#$image_env_mode & 0222) == 0 )) || \
    npc_die ".bundle-images.env must be read-only"
}

npc_env_literal() {
  local key="$1"
  local file="$2"
  local value
  local -a values=()
  while IFS= read -r value; do
    values+=("$value")
  done < <(
    awk -v wanted="$key" '
      $0 ~ "^[[:space:]]*" wanted "[[:space:]]*=" {
        sub("^[[:space:]]*" wanted "[[:space:]]*=", "")
        sub("\\r$", "")
        print
      }
    ' "$file"
  )
  [[ "${#values[@]}" -le 1 ]] || npc_die "duplicate $key in $(basename -- "$file")"
  value="${values[0]:-}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || \
    npc_die "$key contains a forbidden newline"
  printf '%s\n' "$value"
}

npc_required_env_literal() {
  local value
  value="$(npc_env_literal "$1" "$2")"
  [[ -n "$value" ]] || npc_die "$1 is required in $(basename -- "$2")"
  printf '%s\n' "$value"
}

npc_optional_env_literal() {
  local key="$1"
  local file="$2"
  local fallback="$3"
  local value
  value="$(npc_env_literal "$key" "$file")" || return $?
  [[ -n "$value" ]] || value="$fallback"
  printf '%s\n' "$value"
}

npc_bundle_revision() {
  local revision
  revision="$(npc_required_env_literal BUNDLE_REVISION "$NPC_BUNDLE_IMAGE_ENV")"
  [[ "$revision" =~ ^[0-9a-f]{40,64}$ ]] || npc_die "BUNDLE_REVISION must be 40-64 lowercase hex"
  printf '%s\n' "$revision"
}

npc_require_deployable_bundle() {
  local deployable digest digest12 image expected12
  deployable="$(npc_required_env_literal BUNDLE_DEPLOYABLE "$NPC_BUNDLE_IMAGE_ENV")"
  [[ "$deployable" == "true" ]] || \
    npc_die "this is a stage-only bundle (BUNDLE_DEPLOYABLE must be true)"
  digest="$(npc_required_env_literal POSTGRES_DIGEST "$NPC_BUNDLE_IMAGE_ENV")"
  digest12="$(npc_required_env_literal POSTGRES_DIGEST12 "$NPC_BUNDLE_IMAGE_ENV")"
  image="$(npc_required_env_literal POSTGRES_IMAGE "$NPC_BUNDLE_IMAGE_ENV")"
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || npc_die "POSTGRES_DIGEST is invalid"
  [[ "$digest12" =~ ^[0-9a-f]{12}$ ]] || npc_die "POSTGRES_DIGEST12 is invalid"
  expected12="${digest#sha256:}"
  expected12="${expected12:0:12}"
  [[ "$digest12" == "$expected12" ]] || npc_die "POSTGRES_DIGEST12 does not match POSTGRES_DIGEST"
  [[ "$image" == "sdar/production-postgres:17-alpine-$digest12" ]] || \
    npc_die "POSTGRES_IMAGE does not match the immutable digest-derived tag"
}

npc_postgres_image() {
  local image
  image="$(npc_required_env_literal POSTGRES_IMAGE "$NPC_BUNDLE_IMAGE_ENV")"
  [[ "$image" =~ ^sdar/production-postgres:17-alpine-[0-9a-f]{12}$ ]] || \
    npc_die "POSTGRES_IMAGE is not the builder-owned immutable local reference"
  printf '%s\n' "$image"
}

npc_state_root_unresolved() {
  local configured
  configured="$(npc_env_literal BUNDLE_STATE_ROOT "$NPC_BUNDLE_USER_ENV")"
  configured="${configured:-./state}"
  if [[ "$configured" == /* ]]; then
    printf '%s\n' "$configured"
  else
    printf '%s/%s\n' "$NPC_BUNDLE_DIR" "${configured#./}"
  fi
}

npc_state_root() {
  local unresolved
  unresolved="$(npc_state_root_unresolved)"
  [[ ! -L "$unresolved" ]] || npc_die "state root must not be a symlink"
  [[ -d "$unresolved" ]] || npc_die "state root is missing; run bin/init.sh"
  (CDPATH= cd -- "$unresolved" && pwd -P) || npc_die "cannot resolve state root"
}

npc_compose() {
  local -a unset_arguments=()
  local key
  while IFS= read -r key; do
    [[ -n "$key" ]] && unset_arguments+=( -u "$key" )
  done < <(
    awk -F= '
      /^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=/ {
        key = $1
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
        print key
      }
    ' "$NPC_BUNDLE_USER_ENV" "$NPC_BUNDLE_IMAGE_ENV" | sort -u
  )
  env "${unset_arguments[@]}" -u COMPOSE_PROJECT_NAME docker compose \
    --project-name "$NPC_BUNDLE_PROJECT_NAME" \
    --project-directory "$NPC_BUNDLE_DIR" \
    --env-file "$NPC_BUNDLE_USER_ENV" \
    --env-file "$NPC_BUNDLE_IMAGE_ENV" \
    -f "$NPC_BUNDLE_COMPOSE_FILE" \
    "$@"
}

npc_expected_images() {
  local revision
  revision="$(npc_bundle_revision)"
  printf '%s\n' \
    "sdar/production-npc-tank-pms-api:$revision" \
    "sdar/production-npc-tank-pms-worker:$revision" \
    "sdar/production-pms-web:$revision" \
    "sdar/production-npc-tank-runtime:$revision" \
    "sdar/production-npc-tank-adapter:$revision" \
    "$(npc_postgres_image)"
}

npc_verify_images() {
  local revision image actual_revision user
  revision="$(npc_bundle_revision)"
  while IFS= read -r image; do
    docker image inspect "$image" >/dev/null 2>&1 || npc_die "required image is missing: $image"
    if [[ "$image" == sdar/production-postgres:* ]]; then
      continue
    fi
    actual_revision="$(docker image inspect \
      --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")"
    [[ "$actual_revision" == "$revision" ]] || npc_die "$image has the wrong OCI revision"
    user="$(docker image inspect --format '{{ .Config.User }}' "$image")"
    [[ "$user" == "node" || "$user" == "1000" || "$user" == "1000:1000" ]] || \
      npc_die "$image must use the non-root node identity"
  done < <(npc_expected_images)
}

npc_validate_secret_file() {
  local path="$1"
  local label="$2"
  [[ -e "$path" ]] || npc_die "$label is missing: $path"
  [[ ! -L "$path" && -f "$path" ]] || npc_die "$label must be a regular non-symlink file"
  [[ "$(stat -c '%h' "$path")" == "1" ]] || npc_die "$label must have one hard link"
  [[ -s "$path" ]] || npc_die "$label must not be empty"
  local mode
  mode="$(stat -c '%a' "$path")"
  (( (8#$mode & ~0600) == 0 && (8#$mode & 0400) != 0 )) || \
    npc_die "$label permissions must not exceed 0600"
  [[ "$(stat -c '%s' "$path")" -le 1048576 ]] || npc_die "$label exceeds 1 MiB"
}

npc_validate_secret_directory() {
  local path="$1"
  local label="$2"
  [[ -d "$path" && ! -L "$path" ]] || npc_die "$label must be a non-symlink directory"
  local mode
  mode="$(stat -c '%a' "$path")"
  (( (8#$mode & ~0700) == 0 && (8#$mode & 0500) == 0500 )) || \
    npc_die "$label permissions must not exceed 0700"
}

npc_validate_secret_inventory() {
  local state_root
  state_root="$(npc_state_root)"
  [[ "$(stat -c '%u' "$state_root")" == "1000" ]] || \
    npc_die "state root must be owned by UID 1000"
  npc_validate_secret_directory "$state_root" "state root"
  npc_validate_secret_directory "$state_root/secrets" "internal secret root"
  npc_validate_secret_directory "$state_root/secrets/pms-api" "PMS API secret root"
  npc_validate_secret_directory "$state_root/secrets/pms-worker" "PMS Worker secret root"
  npc_validate_secret_directory "$state_root/secrets/runtime-control-plane" \
    "Runtime control-plane credential root"
  npc_validate_secret_directory \
    "$state_root/secrets/runtime-control-plane/providers/isr.vehicle.npc-tank.npc-tank1/deployments/production-npc-tank-direct/instances/production-npc-tank-direct-1" \
    "direct Runtime instance credential root"

  local relative
  for relative in \
    secrets/pms-postgres-password \
    secrets/pms-database-url \
    secrets/pms-api/runtime.json \
    secrets/pms-worker/postgres-provisioning.json \
    secrets/runtime-control-plane/providers/isr.vehicle.npc-tank.npc-tank1/deployments/production-npc-tank-direct/instances/production-npc-tank-direct-1/control-plane.token \
    secrets/npc-adapter-db-password \
    secrets/npc-adapter-database-url \
    secrets/npc-runtime-db-password \
    secrets/npc-runtime-database-url; do
    npc_validate_secret_file "$state_root/$relative" "$relative"
    [[ "$(stat -c '%u' "$state_root/$relative")" == "1000" ]] || \
      npc_die "$relative must be owned by UID 1000"
  done

}

npc_validate_external_configuration() {
  local device_url mqtt_url insecure_opt_in runtime_advertised_url
  local otel_enabled otel_endpoint otel_timeout otel_authority
  device_url="$(npc_required_env_literal NPC_TANK_DEVICE_MCP_URL "$NPC_BUNDLE_USER_ENV")"
  mqtt_url="$(npc_required_env_literal NPC_TANK_MQTT_URL "$NPC_BUNDLE_USER_ENV")"
  runtime_advertised_url="$(
    npc_required_env_literal NPC_TANK_RUNTIME_ADVERTISED_URL "$NPC_BUNDLE_USER_ENV"
  )"
  insecure_opt_in="$(
    npc_required_env_literal ALLOW_INSECURE_INTERNAL_TRANSPORT "$NPC_BUNDLE_USER_ENV"
  )"
  otel_enabled="$(
    npc_optional_env_literal NPC_TANK_OTEL_ENABLED "$NPC_BUNDLE_USER_ENV" false
  )" || return $?
  otel_timeout="$(
    npc_optional_env_literal \
      NPC_TANK_OTEL_EXPORTER_OTLP_TIMEOUT_MS "$NPC_BUNDLE_USER_ENV" 10000
  )" || return $?
  [[ "$insecure_opt_in" == "true" ]] || \
    npc_die "ALLOW_INSECURE_INTERNAL_TRANSPORT must be the literal true"
  [[ "$device_url" == http://* && "$device_url" == */mcp ]] || \
    npc_die "NPC_TANK_DEVICE_MCP_URL must be an internal http:// URL ending in /mcp"
  [[ "$mqtt_url" == mqtt://* ]] || \
    npc_die "NPC_TANK_MQTT_URL must use mqtt:// for this internal-network bundle"
  [[ ! "$device_url" =~ REPLACE|mock|\.invalid ]] || \
    npc_die "NPC_TANK_DEVICE_MCP_URL is still a placeholder"
  [[ ! "$mqtt_url" =~ REPLACE|mock|\.invalid ]] || \
    npc_die "NPC_TANK_MQTT_URL is still a placeholder"
  [[ "$runtime_advertised_url" == http://* && "$runtime_advertised_url" != */mcp &&
    "$runtime_advertised_url" != */mcp/ ]] || \
    npc_die "NPC_TANK_RUNTIME_ADVERTISED_URL must be an HTTP base URL without /mcp"
  [[ ! "$runtime_advertised_url" =~ REPLACE|mock|\.invalid|localhost|127\.0\.0\.1|0\.0\.0\.0 ]] || \
    npc_die "NPC_TANK_RUNTIME_ADVERTISED_URL must identify the real intranet deployment host"
  [[ "$runtime_advertised_url" != *"@"* && "$runtime_advertised_url" != *"?"* &&
    "$runtime_advertised_url" != *"#"* ]] || \
    npc_die "NPC_TANK_RUNTIME_ADVERTISED_URL must not contain credentials, query, or fragment"
  [[ "$otel_enabled" == "true" || "$otel_enabled" == "false" ]] || \
    npc_die "NPC_TANK_OTEL_ENABLED must be exactly true or false"
  [[ "$otel_timeout" =~ ^[0-9]+$ && "${#otel_timeout}" -le 5 ]] || \
    npc_die "NPC_TANK_OTEL_EXPORTER_OTLP_TIMEOUT_MS must be an integer from 100 through 60000"
  (( 10#$otel_timeout >= 100 && 10#$otel_timeout <= 60000 )) || \
    npc_die "NPC_TANK_OTEL_EXPORTER_OTLP_TIMEOUT_MS must be an integer from 100 through 60000"
  if [[ "$otel_enabled" == "true" ]]; then
    otel_endpoint="$(
      npc_required_env_literal NPC_TANK_OTEL_EXPORTER_OTLP_ENDPOINT "$NPC_BUNDLE_USER_ENV"
    )"
    [[ "$otel_endpoint" == http://* ]] || \
      npc_die "NPC_TANK_OTEL_EXPORTER_OTLP_ENDPOINT must be a plaintext OTLP/HTTP base URL"
    otel_authority="${otel_endpoint#http://}"
    otel_authority="${otel_authority%%/*}"
    [[ -n "$otel_authority" && "$otel_authority" != *[[:space:]]* ]] || \
      npc_die "NPC_TANK_OTEL_EXPORTER_OTLP_ENDPOINT must include a valid intranet host"
    [[ ! "$otel_endpoint" =~ REPLACE|mock|\.invalid|localhost|127\.0\.0\.1|0\.0\.0\.0 ]] || \
      npc_die "NPC_TANK_OTEL_EXPORTER_OTLP_ENDPOINT must identify the real intranet Collector"
    [[ "$otel_endpoint" != *"@"* && "$otel_endpoint" != *"?"* &&
      "$otel_endpoint" != *"#"* ]] || \
      npc_die "NPC_TANK_OTEL_EXPORTER_OTLP_ENDPOINT must not contain credentials, query, or fragment"
    [[ ! "$otel_endpoint" =~ /v1/(traces|logs|metrics)/?$ ]] || \
      npc_die "NPC_TANK_OTEL_EXPORTER_OTLP_ENDPOINT must be a base URL without an OTLP signal path"
  fi
}

npc_validate_compose() {
  local pms_api_image configuration_file
  pms_api_image="sdar/production-npc-tank-pms-api:$(npc_bundle_revision)"
  configuration_file="$(mktemp "${TMPDIR:-/tmp}/sdar-npc-production-compose.XXXXXXXX.json")"
  npc_compose --profile seed config --format json >"$configuration_file" || {
    rm -f -- "$configuration_file"
    npc_die "Docker Compose configuration is invalid"
  }
  docker run --rm --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --env "BUNDLE_REVISION=$(npc_bundle_revision)" \
    --env "POSTGRES_IMAGE=$(npc_postgres_image)" \
    --entrypoint node \
    --volume "$NPC_BUNDLE_BIN_DIR/validate-config.mjs:/opt/validate-config.mjs:ro" \
    --volume "$configuration_file:/opt/compose-config.json:ro" \
    "$pms_api_image" /opt/validate-config.mjs /opt/compose-config.json || {
    rm -f -- "$configuration_file"
    npc_die "production Compose policy validation failed"
  }
  rm -f -- "$configuration_file"
}

npc_verify_running_service() {
  local service="$1"
  local container_id running health
  container_id="$(npc_compose ps --quiet "$service")"
  [[ -n "$container_id" ]] || npc_die "service is not running: $service"
  running="$(docker container inspect --format '{{ .State.Running }}' "$container_id")"
  health="$(docker container inspect \
    --format '{{ if .State.Health }}{{ .State.Health.Status }}{{ else }}none{{ end }}' \
    "$container_id")"
  [[ "$running" == "true" ]] || npc_die "service stopped: $service"
  [[ "$health" == "healthy" ]] || npc_die "service is not healthy: $service ($health)"
}

npc_persistent_services() {
  printf '%s\n' \
    pms-postgres pms-api pms-worker pms-web \
    npc-adapter-postgres npc-runtime-postgres npc-tank-adapter npc-tank-runtime
}

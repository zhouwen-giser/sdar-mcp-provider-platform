#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=common.sh
source "$script_dir/common.sh"

require_command openssl
require_command stat
require_command find

current_uid="$(id -u)"
if [[ "$current_uid" != "0" && "$current_uid" != "1000" ]]; then
  die "init.sh must run as UID 1000, or as root so it can assign runtime ownership to UID 1000"
fi

umask 077

if [[ ! -e "$env_file" ]]; then
  cp -- "$bundle_dir/.env.example" "$env_file"
elif [[ -L "$env_file" || ! -f "$env_file" ]]; then
  die "the configured .env path must be a regular non-symlink file"
fi

directories=(
  "$bundle_dir/secrets/pms/api"
  "$bundle_dir/secrets/pms/worker"
  "$bundle_dir/secrets/pms/runtime-control-plane"
  "$bundle_dir/secrets/pms/runtime-control-plane/providers/isr.vehicle.ugv.ugv1/deployments/production-ugv-direct/instances/production-ugv-direct-1"
  "$bundle_dir/secrets/ugv/database"
  "$bundle_dir/secrets/ugv/runtime"
  "$bundle_dir/runtime/pms-worker-state/runtime-secrets"
  "$bundle_dir/runtime/pms-worker-state/runtime-cache"
  "$bundle_dir/runtime/pms-worker-state/pm2"
  "$bundle_dir/runtime/ugv-contract-reports"
)
for directory in "${directories[@]}"; do
  [[ ! -L "$directory" ]] || die "refusing symlink directory: $directory"
  mkdir -p -- "$directory"
done

random_secret() {
  local path="$1"
  local bytes="$2"
  local value temporary
  [[ ! -L "$path" ]] || die "refusing secret symlink: $path"
  if [[ ! -e "$path" ]]; then
    value="$(openssl rand -hex "$bytes")"
  elif [[ ! -f "$path" || ! -s "$path" ]]; then
    die "refusing invalid existing secret: $path"
  else
    value="$(<"$path")"
  fi
  [[ "$value" =~ ^[0-9a-f]+$ && "${#value}" -eq $((bytes * 2)) ]] ||
    die "refusing malformed existing secret: $path"
  temporary="$path.tmp.$$"
  printf '%s' "$value" >"$temporary"
  chmod 0600 "$temporary"
  mv -f -- "$temporary" "$path"
}

random_secret "$bundle_dir/secrets/pms/postgres-password" 32
random_secret "$bundle_dir/secrets/pms/api/management-reader.token" 32
random_secret "$bundle_dir/secrets/pms/api/management-admin.token" 32
random_secret "$bundle_dir/secrets/ugv/database/adapter-password" 32
random_secret "$bundle_dir/secrets/ugv/database/runtime-password" 32
random_secret "$bundle_dir/secrets/ugv/runtime/jwt-hs256-secret" 48
random_secret "$bundle_dir/secrets/pms/worker/runtime-database-password" 32
random_secret \
  "$bundle_dir/secrets/pms/runtime-control-plane/providers/isr.vehicle.ugv.ugv1/deployments/production-ugv-direct/instances/production-ugv-direct-1/control-plane.token" \
  48

pms_password="$(<"$bundle_dir/secrets/pms/postgres-password")"
adapter_password="$(<"$bundle_dir/secrets/ugv/database/adapter-password")"
runtime_password="$(<"$bundle_dir/secrets/ugv/database/runtime-password")"
provisioned_runtime_password="$(<"$bundle_dir/secrets/pms/worker/runtime-database-password")"

write_private() {
  local target="$1"
  local temporary="$target.tmp.$$"
  [[ ! -L "$target" ]] || die "refusing symlink target: $target"
  printf '%s\n' "$2" >"$temporary"
  chmod 0600 "$temporary"
  mv -f -- "$temporary" "$target"
}

write_private \
  "$bundle_dir/secrets/pms/pms-database-url" \
  "postgresql://pms_admin:${pms_password}@pms-postgres:5432/pms"
write_private \
  "$bundle_dir/secrets/ugv/database/adapter-database-url" \
  "postgresql://ugv_adapter:${adapter_password}@ugv-adapter-postgres:5432/ugv_adapter"
write_private \
  "$bundle_dir/secrets/ugv/database/runtime-database-url" \
  "postgresql://ugv_runtime:${runtime_password}@ugv-runtime-postgres:5432/ugv_runtime"

management_descriptor="$(printf '%s' '{
  "management": {
    "reader": [
      {
        "subjectId": "production-ugv-reader",
        "tokenFile": "/run/pms-secrets/api/management-reader.token"
      }
    ],
    "administrator": [
      {
        "subjectId": "production-ugv-admin",
        "tokenFile": "/run/pms-secrets/api/management-admin.token"
      }
    ]
  }
}')"
runtime_descriptor="$(printf '%s' '{
  "runtimeConfig": [],
  "runtimeRegistration": [
    {
      "subjectId": "production-ugv-direct-registration",
      "providerId": "isr.vehicle.ugv.ugv1",
      "deploymentId": "production-ugv-direct",
      "instanceId": "production-ugv-direct-1",
      "runtimeVersion": "2.0.0-rc.1",
      "protocolVersion": "2026-07-28",
      "scopes": ["runtime:register", "runtime:heartbeat"],
      "tokenFile": "/run/pms-secrets/runtime-control-plane/providers/isr.vehicle.ugv.ugv1/deployments/production-ugv-direct/instances/production-ugv-direct-1/control-plane.token"
    }
  ]
}')"
catalog_credential_descriptor="$(printf '%s' '{
  "credentials": [
    {
      "providerId": "isr.vehicle.ugv.ugv1",
      "deploymentId": "production-ugv-direct",
      "instanceId": "production-ugv-direct-1",
      "secretFile": "/run/pms-secrets/external-runtime/jwt-hs256-secret",
      "issuer": "sdar-production-ugv",
      "audience": "sdar-ugv-runtime",
      "subjectId": "pms-worker",
      "tenantId": "pms-control"
    }
  ]
}')"
provisioning_descriptor="$(printf '{\n  "clusterRef": "bundle-pms-postgres",\n  "adminSecretRef": "file/production-ugv/pms-postgres-admin",\n  "adminDatabaseUrl": "postgresql://pms_admin:%s@pms-postgres:5432/pms",\n  "runtimePassword": "%s"\n}' "$pms_password" "$provisioned_runtime_password")"
write_private "$bundle_dir/secrets/pms/api/management.json" "$management_descriptor"
write_private "$bundle_dir/secrets/pms/api/runtime.json" "$runtime_descriptor"
write_private \
  "$bundle_dir/secrets/pms/worker/external-runtime-catalog.json" \
  "$catalog_credential_descriptor"
write_private "$bundle_dir/secrets/pms/worker/postgres-provisioning.json" "$provisioning_descriptor"

write_private "$bundle_dir/runtime/.initialized" "schemaVersion=2"

find "$bundle_dir/secrets" "$bundle_dir/runtime" -type d -exec chmod 0700 {} +
find "$bundle_dir/secrets" "$bundle_dir/runtime" -type f -exec chmod 0600 {} +
chmod 0600 "$env_file"

if [[ "$current_uid" == "0" ]]; then
  chown -R 1000:1000 "$bundle_dir/secrets" "$bundle_dir/runtime" "$env_file"
fi

require_environment_file
require_generated_layout

printf '%s\n' \
  'INITIALIZED: local database, Runtime JWT, and instance-scoped PMS credentials were created.' \
  'The direct-container Runtime identity is production-ugv-direct/production-ugv-direct-1.' \
  'REQUIRED: edit .env with the real intranet Device MCP and MQTT addresses.' \
  'No TLS certificate or external simulator credential is generated, mounted, or required.'

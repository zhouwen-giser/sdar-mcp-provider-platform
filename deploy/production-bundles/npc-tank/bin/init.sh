#!/usr/bin/env bash
set -euo pipefail

bin_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=common.sh
source "$bin_dir/common.sh"

npc_require_command openssl
npc_require_command stat
npc_require_command awk

if [[ -L "$NPC_BUNDLE_USER_ENV" || (-e "$NPC_BUNDLE_USER_ENV" && ! -f "$NPC_BUNDLE_USER_ENV") ]]; then
  npc_die ".env must be a regular non-symlink file"
fi
if [[ ! -e "$NPC_BUNDLE_USER_ENV" ]]; then
  cp -- "$NPC_BUNDLE_DIR/.env.example" "$NPC_BUNDLE_USER_ENV"
  chmod 0600 "$NPC_BUNDLE_USER_ENV"
  printf 'Created %s from the non-secret template.\n' "$NPC_BUNDLE_USER_ENV"
fi

current_uid="$(id -u)"
if [[ "$current_uid" != "0" && "$current_uid" != "1000" ]]; then
  npc_die "bin/init.sh must run as UID 1000, or as root so it can assign ownership to UID 1000"
fi

umask 077
state_root="$(npc_state_root_unresolved)"
mkdir -p -- \
  "$state_root/secrets/pms-api" \
  "$state_root/secrets/pms-worker" \
  "$state_root/secrets/runtime-control-plane" \
  "$state_root/secrets/runtime-control-plane/providers/isr.vehicle.npc-tank.npc-tank1/deployments/production-npc-tank-direct/instances/production-npc-tank-direct-1"
chmod 0700 -- \
  "$state_root" \
  "$state_root/secrets" \
  "$state_root/secrets/pms-api" \
  "$state_root/secrets/pms-worker" \
  "$state_root/secrets/runtime-control-plane" \
  "$state_root/secrets/runtime-control-plane/providers/isr.vehicle.npc-tank.npc-tank1/deployments/production-npc-tank-direct/instances/production-npc-tank-direct-1"

random_hex() {
  openssl rand -hex 32
}

write_new_secret() {
  local path="$1"
  local value="$2"
  local existing temporary
  [[ ! -L "$path" ]] || npc_die "refusing generated-secret symlink: $path"
  if [[ -e "$path" ]]; then
    npc_validate_secret_file "$path" "existing generated secret"
    existing="$(<"$path")"
    [[ -n "$existing" && "$existing" != *$'\r'* && "$existing" != *$'\n'* ]] ||
      npc_die "existing generated secret contains invalid whitespace"
    value="$existing"
  fi
  temporary="$path.tmp.$$"
  printf '%s' "$value" >"$temporary"
  chmod 0600 "$temporary"
  mv -f -- "$temporary" "$path"
}

require_pair_or_absent() {
  local left="$1"
  local right="$2"
  if [[ -e "$left" && ! -e "$right" ]] || [[ ! -e "$left" && -e "$right" ]]; then
    npc_die "partial generated pair detected: $(basename -- "$left") / $(basename -- "$right")"
  fi
}

pms_password_file="$state_root/secrets/pms-postgres-password"
pms_url_file="$state_root/secrets/pms-database-url"
adapter_password_file="$state_root/secrets/npc-adapter-db-password"
adapter_url_file="$state_root/secrets/npc-adapter-database-url"
runtime_password_file="$state_root/secrets/npc-runtime-db-password"
runtime_url_file="$state_root/secrets/npc-runtime-database-url"

require_pair_or_absent "$pms_password_file" "$pms_url_file"
require_pair_or_absent "$adapter_password_file" "$adapter_url_file"
require_pair_or_absent "$runtime_password_file" "$runtime_url_file"

if [[ ! -e "$pms_password_file" ]]; then
  pms_password="$(random_hex)"
  write_new_secret "$pms_password_file" "$pms_password"
  write_new_secret "$pms_url_file" \
    "postgresql://pms_admin:$pms_password@pms-postgres:5432/pms"
fi
if [[ ! -e "$adapter_password_file" ]]; then
  adapter_password="$(random_hex)"
  write_new_secret "$adapter_password_file" "$adapter_password"
  write_new_secret "$adapter_url_file" \
    "postgresql://npc_adapter:$adapter_password@npc-adapter-postgres:5432/npc_adapter"
fi
if [[ ! -e "$runtime_password_file" ]]; then
  runtime_password="$(random_hex)"
  write_new_secret "$runtime_password_file" "$runtime_password"
  write_new_secret "$runtime_url_file" \
    "postgresql://npc_runtime:$runtime_password@npc-runtime-postgres:5432/npc_runtime"
fi

write_new_secret "$state_root/secrets/runtime-jwt-hs256" "$(random_hex)"
write_new_secret "$state_root/secrets/pms-api/management-admin.token" "$(random_hex)"
write_new_secret \
  "$state_root/secrets/runtime-control-plane/providers/isr.vehicle.npc-tank.npc-tank1/deployments/production-npc-tank-direct/instances/production-npc-tank-direct-1/control-plane.token" \
  "$(random_hex)"

management_descriptor="$state_root/secrets/pms-api/management.json"
if [[ ! -e "$management_descriptor" ]]; then
  printf '%s\n' \
    '{' \
    '  "management": {' \
    '    "reader": [],' \
    '    "administrator": [' \
    '      {' \
    '        "subjectId": "npc-production-admin",' \
    '        "tokenFile": "/run/pms-secrets/management-admin.token"' \
    '      }' \
    '    ]' \
    '  }' \
    '}' >"$management_descriptor"
  chmod 0600 "$management_descriptor"
fi

runtime_descriptor="$state_root/secrets/pms-api/runtime.json"
[[ ! -L "$runtime_descriptor" ]] || npc_die "refusing Runtime descriptor symlink"
if [[ -e "$runtime_descriptor" ]]; then
  npc_validate_secret_file "$runtime_descriptor" "existing Runtime descriptor"
fi
printf '%s\n' \
  '{' \
  '  "runtimeConfig": [],' \
  '  "runtimeRegistration": [' \
  '    {' \
  '      "subjectId": "production-npc-tank-direct-registration",' \
  '      "providerId": "isr.vehicle.npc-tank.npc-tank1",' \
  '      "deploymentId": "production-npc-tank-direct",' \
  '      "instanceId": "production-npc-tank-direct-1",' \
  '      "runtimeVersion": "2.0.0-rc.1",' \
  '      "protocolVersion": "2026-07-28",' \
  '      "scopes": ["runtime:register", "runtime:heartbeat"],' \
  '      "tokenFile": "/run/pms-secrets/runtime-control-plane/providers/isr.vehicle.npc-tank.npc-tank1/deployments/production-npc-tank-direct/instances/production-npc-tank-direct-1/control-plane.token"' \
  '    }' \
  '  ]' \
  '}' >"$runtime_descriptor"
chmod 0600 "$runtime_descriptor"

catalog_credential_descriptor="$state_root/secrets/pms-worker/external-runtime-catalog.json"
[[ ! -L "$catalog_credential_descriptor" ]] || \
  npc_die "refusing external catalog credential descriptor symlink"
if [[ -e "$catalog_credential_descriptor" ]]; then
  npc_validate_secret_file \
    "$catalog_credential_descriptor" \
    "existing external catalog credential descriptor"
fi
printf '%s\n' \
  '{' \
  '  "credentials": [' \
  '    {' \
  '      "providerId": "isr.vehicle.npc-tank.npc-tank1",' \
  '      "deploymentId": "production-npc-tank-direct",' \
  '      "instanceId": "production-npc-tank-direct-1",' \
  '      "secretFile": "/run/pms-secrets/runtime-jwt-hs256",' \
  '      "issuer": "sdar-npc-tank-production",' \
  '      "audience": "sdar-runtime",' \
  '      "subjectId": "pms-worker",' \
  '      "tenantId": "pms-control"' \
  '    }' \
  '  ]' \
  '}' >"$catalog_credential_descriptor"
chmod 0600 "$catalog_credential_descriptor"

provisioning_descriptor="$state_root/secrets/pms-worker/postgres-provisioning.json"
if [[ ! -e "$provisioning_descriptor" ]]; then
  pms_password="$(tr -d '\r\n' <"$pms_password_file")"
  provisioning_runtime_password="$(random_hex)"
  printf '%s\n' \
    '{' \
    '  "clusterRef": "npc-production-pms-postgres",' \
    '  "adminSecretRef": "file/npc-production/pms-postgres-admin",' \
    "  \"adminDatabaseUrl\": \"postgresql://pms_admin:$pms_password@pms-postgres:5432/pms\"," \
    "  \"runtimePassword\": \"$provisioning_runtime_password\"" \
    '}' >"$provisioning_descriptor"
  chmod 0600 "$provisioning_descriptor"
fi

find "$state_root" -type d -exec chmod 0700 {} +
find "$state_root" -type f -exec chmod 0600 {} +
chmod 0600 "$NPC_BUNDLE_USER_ENV"

if [[ "$current_uid" == "0" ]]; then
  chown -R 1000:1000 "$state_root" "$NPC_BUNDLE_USER_ENV"
fi

npc_validate_secret_inventory

printf '%s\n' \
  'Internal database credentials, the instance-scoped PMS credential, and Runtime JWT are ready.' \
  'The direct-container Runtime identity is production-npc-tank-direct/production-npc-tank-direct-1.' \
  'No TLS CA, certificate, key, MQTT password, or transport trust material is required.' \
  'Edit .env with the real internal HTTP Device MCP and MQTT endpoints, then run bin/up.sh.'

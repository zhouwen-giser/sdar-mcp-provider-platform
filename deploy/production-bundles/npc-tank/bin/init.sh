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
  "$state_root/secrets/runtime-control-plane"
chmod 0700 -- \
  "$state_root" \
  "$state_root/secrets" \
  "$state_root/secrets/pms-api" \
  "$state_root/secrets/pms-worker" \
  "$state_root/secrets/runtime-control-plane"

random_hex() {
  openssl rand -hex 32
}

write_new_secret() {
  local path="$1"
  local value="$2"
  if [[ -e "$path" ]]; then
    npc_validate_secret_file "$path" "existing generated secret"
    return
  fi
  printf '%s\n' "$value" >"$path"
  chmod 0600 "$path"
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
if [[ ! -e "$runtime_descriptor" ]]; then
  printf '%s\n' '{"runtimeConfig":[],"runtimeRegistration":[]}' >"$runtime_descriptor"
  chmod 0600 "$runtime_descriptor"
fi

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
  'Internal database credentials, PMS credentials, and the Runtime JWT secret are ready.' \
  'No TLS CA, certificate, key, MQTT password, or transport trust material is required.' \
  'Edit .env with the real internal HTTP Device MCP and MQTT endpoints, then run bin/up.sh.'

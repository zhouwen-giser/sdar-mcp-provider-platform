const restoreShellInterpolation = (source) => source.replaceAll("\\${", "${");

/**
 * Return the on-site image builder embedded in source-based ARM64 bundles.
 *
 * The script intentionally parses, rather than sources, every bundle-owned env
 * file. This keeps bundle metadata declarative and prevents credentials or
 * arbitrary shell from becoming part of the image-build path.
 */
export function arm64BuildImagesScript() {
  return restoreShellInterpolation(String.raw`#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "\${BASH_SOURCE[0]}")" && pwd -P)"
deploy_dir="$(CDPATH= cd -- "$script_dir/.." && pwd -P)"
bundle_root="$(CDPATH= cd -- "$deploy_dir/../.." && pwd -P)"
checksum_file="$bundle_root/SHA256SUMS"
manifest_file="$bundle_root/build/manifest.tsv"
base_images_file="$bundle_root/build/base-images.env"
image_env_file="$deploy_dir/.bundle-images.env"

fail() {
  printf 'BLOCKED_ARM64_IMAGE_BUILD: %s\n' "$1" >&2
  exit 2
}

# Integrity is checked before any bundle metadata is parsed or any Docker
# operation is attempted.
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"
[[ -f "$checksum_file" && ! -L "$checksum_file" ]] || fail "SHA256SUMS is missing"
cd "$bundle_root"
sha256sum --check --strict SHA256SUMS >/dev/null || fail "SHA256SUMS verification failed"

for command in docker uname; do
  command -v "$command" >/dev/null 2>&1 || fail "$command is required"
done
(( BASH_VERSINFO[0] >= 4 )) || fail "Bash 4 or newer is required"

[[ -f "$manifest_file" && ! -L "$manifest_file" ]] ||
  fail "build/manifest.tsv must be a regular non-symlink file"
[[ -f "$base_images_file" && ! -L "$base_images_file" ]] ||
  fail "build/base-images.env must be a regular non-symlink file"
[[ -f "$image_env_file" && ! -L "$image_env_file" ]] ||
  fail "deploy/.bundle-images.env must be a regular non-symlink file"

BUNDLE_PLATFORM=""
NODE_BASE_IMAGE=""
POSTGRES_UPSTREAM_IMAGE=""
SOURCE_ARCHIVE=""

read_base_images_environment() {
  local line name value
  local -A seen=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == *=* ]] || fail "invalid line in build/base-images.env"
    name="\${line%%=*}"
    value="\${line#*=}"
    [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] ||
      fail "invalid key in build/base-images.env"
    [[ -z "\${seen[$name]+x}" ]] || fail "duplicate $name in build/base-images.env"
    case "$name" in
      BUNDLE_PLATFORM|NODE_BASE_IMAGE|POSTGRES_UPSTREAM_IMAGE|SOURCE_ARCHIVE)
        printf -v "$name" '%s' "$value"
        ;;
      *) fail "unexpected key in build/base-images.env: $name" ;;
    esac
    seen["$name"]=1
  done < "$base_images_file"
  [[ "\${#seen[@]}" -eq 4 ]] || fail "build/base-images.env must contain exactly four keys"
}

BUNDLE_REVISION=""
POSTGRES_IMAGE=""
POSTGRES_DIGEST=""
POSTGRES_DIGEST12=""
BUNDLE_DEPLOYABLE=""

read_bundle_images_environment() {
  local line name value
  local -A seen=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == *=* ]] || fail "invalid line in deploy/.bundle-images.env"
    name="\${line%%=*}"
    value="\${line#*=}"
    [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] ||
      fail "invalid key in deploy/.bundle-images.env"
    [[ -z "\${seen[$name]+x}" ]] || fail "duplicate $name in deploy/.bundle-images.env"
    case "$name" in
      BUNDLE_REVISION|POSTGRES_IMAGE|POSTGRES_DIGEST|POSTGRES_DIGEST12|BUNDLE_DEPLOYABLE)
        printf -v "$name" '%s' "$value"
        ;;
      *) fail "unexpected key in deploy/.bundle-images.env: $name" ;;
    esac
    seen["$name"]=1
  done < "$image_env_file"
  [[ "\${#seen[@]}" -eq 5 ]] ||
    fail "deploy/.bundle-images.env must contain exactly five keys"
}

read_base_images_environment
read_bundle_images_environment

[[ "$BUNDLE_PLATFORM" == "linux/arm64" ]] || fail "BUNDLE_PLATFORM must be linux/arm64"
[[ "$NODE_BASE_IMAGE" =~ ^docker\.io/library/node:22-bookworm-slim@sha256:[0-9a-f]{64}$ ]] ||
  fail "NODE_BASE_IMAGE must pin node:22-bookworm-slim by digest"
[[ "$POSTGRES_UPSTREAM_IMAGE" =~ ^docker\.io/library/postgres:17-alpine@sha256:[0-9a-f]{64}$ ]] ||
  fail "POSTGRES_UPSTREAM_IMAGE must pin postgres:17-alpine by digest"
[[ "$SOURCE_ARCHIVE" =~ ^source/[A-Za-z0-9][A-Za-z0-9._-]*\.tar\.gz$ ]] ||
  fail "SOURCE_ARCHIVE is unsafe or invalid"
[[ "$BUNDLE_REVISION" =~ ^[0-9a-f]{40,64}$ ]] || fail "BUNDLE_REVISION is invalid"
[[ "$POSTGRES_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "POSTGRES_DIGEST is invalid"
[[ "$POSTGRES_DIGEST12" =~ ^[0-9a-f]{12}$ ]] || fail "POSTGRES_DIGEST12 is invalid"
[[ "\${POSTGRES_DIGEST#sha256:}" == "$POSTGRES_DIGEST12"* ]] ||
  fail "POSTGRES_DIGEST12 does not match POSTGRES_DIGEST"
[[ "\${POSTGRES_UPSTREAM_IMAGE##*@}" == "$POSTGRES_DIGEST" ]] ||
  fail "PostgreSQL base-image digest does not match deploy image lock"
[[ "$POSTGRES_IMAGE" == "sdar/production-postgres:17-alpine-$POSTGRES_DIGEST12" ]] ||
  fail "POSTGRES_IMAGE is not the bundle-controlled local alias"
[[ "$BUNDLE_DEPLOYABLE" == "true" ]] || fail "bundle is not deployable"

source_archive="$bundle_root/$SOURCE_ARCHIVE"
[[ -f "$source_archive" && ! -L "$source_archive" ]] ||
  fail "the declared source archive must be a regular non-symlink file"
shopt -s nullglob
source_archives=("$bundle_root"/source/*.tar.gz)
shopt -u nullglob
[[ "\${#source_archives[@]}" -eq 1 ]] || fail "exactly one source/*.tar.gz archive is required"
[[ "\${source_archives[0]}" == "$source_archive" ]] ||
  fail "SOURCE_ARCHIVE does not identify the only source archive"

host_os="$(uname -s)"
host_arch="$(uname -m)"
[[ "$host_os" == "Linux" ]] || fail "the build host must be Linux"
case "$host_arch" in
  arm64|aarch64) ;;
  *) fail "native ARM64 host required; emulation and cross-build hosts are forbidden" ;;
esac

docker_server_os="$(docker version --format '{{.Server.Os}}' 2>/dev/null)" ||
  fail "cannot query the Docker server OS"
docker_server_arch="$(docker version --format '{{.Server.Arch}}' 2>/dev/null)" ||
  fail "cannot query the Docker server architecture"
[[ "$docker_server_os" == "linux" ]] || fail "Docker server must be Linux"
case "$docker_server_arch" in
  arm64|aarch64) ;;
  *) fail "native linux/arm64 Docker server required; emulation is forbidden" ;;
esac

declare -a APP_ROLES=()
declare -a APP_TARGETS=()
declare -a APP_REFERENCES=()
declare -a APP_REVISIONS=()
declare -a APP_PROVIDERS=()
declare -a APP_PROFILES=()
declare -A seen_roles=()
declare -A seen_targets=()
declare -A seen_references=()
manifest_line_number=0
manifest_row_count=0
application_count=0
infrastructure_count=0
product_provider=""

while IFS= read -r line || [[ -n "$line" ]]; do
  manifest_line_number=$((manifest_line_number + 1))
  if [[ "$manifest_line_number" -eq 1 ]]; then
    [[ "$line" == $'kind\trole\ttarget\treference\trevision\tprovider_label\tprofile_label' ]] ||
      fail "build/manifest.tsv header is invalid"
    continue
  fi
  [[ -n "$line" ]] || fail "blank manifest rows are forbidden"
  without_tabs="\${line//$'\t'/}"
  [[ $((\${#line} - \${#without_tabs})) -eq 6 ]] ||
    fail "manifest row must contain exactly seven tab-separated fields"
  IFS=$'\t' read -r kind role target reference row_revision provider profile <<< "$line"
  [[ -n "$kind" && -n "$role" && -n "$target" && -n "$reference" &&
    -n "$row_revision" && -n "$provider" && -n "$profile" ]] ||
    fail "manifest row contains an empty field"
  [[ -z "\${seen_references[$reference]+x}" ]] || fail "duplicate manifest reference: $reference"
  seen_references["$reference"]=1
  manifest_row_count=$((manifest_row_count + 1))

  if [[ "$kind" == "application" ]]; then
    case "$role" in
      pms-api|pms-worker|pms-web|runtime|adapter) ;;
      *) fail "unknown application role: $role" ;;
    esac
    [[ -z "\${seen_roles[$role]+x}" ]] || fail "duplicate application role: $role"
    [[ "$target" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || fail "unsafe Docker target: $target"
    [[ -z "\${seen_targets[$target]+x}" ]] || fail "duplicate Docker target: $target"
    [[ "$reference" =~ ^sdar/production-[a-z0-9][a-z0-9._/-]*:[0-9a-f]{40,64}$ ]] ||
      fail "unsafe application image reference: $reference"
    [[ "$row_revision" == "$BUNDLE_REVISION" ]] ||
      fail "application revision does not match BUNDLE_REVISION: $role"
    [[ "$profile" == "production" ]] || fail "application profile label must be production"
    if [[ "$role" == "pms-web" ]]; then
      [[ "$provider" == "shared" ]] || fail "pms-web provider label must be shared"
    else
      [[ "$provider" == "ugv" || "$provider" == "npc-tank" ]] ||
        fail "application provider label is invalid: $provider"
      if [[ -z "$product_provider" ]]; then
        product_provider="$provider"
      else
        [[ "$provider" == "$product_provider" ]] ||
          fail "application provider labels must identify one product"
      fi
    fi
    seen_roles["$role"]=1
    seen_targets["$target"]=1
    APP_ROLES+=("$role")
    APP_TARGETS+=("$target")
    APP_REFERENCES+=("$reference")
    APP_REVISIONS+=("$row_revision")
    APP_PROVIDERS+=("$provider")
    APP_PROFILES+=("$profile")
    application_count=$((application_count + 1))
  elif [[ "$kind" == "infrastructure" ]]; then
    [[ "$role" == "postgres" && "$target" == "-" && "$reference" == "$POSTGRES_IMAGE" &&
      "$row_revision" == "-" && "$provider" == "-" && "$profile" == "-" ]] ||
      fail "the infrastructure row must be the locked PostgreSQL local alias"
    infrastructure_count=$((infrastructure_count + 1))
    [[ "$infrastructure_count" -eq 1 ]] || fail "duplicate PostgreSQL infrastructure row"
  else
    fail "unknown manifest kind: $kind"
  fi
done < "$manifest_file"

[[ "$manifest_line_number" -eq 7 && "$manifest_row_count" -eq 6 ]] ||
  fail "manifest must contain one header and exactly six image rows"
[[ "$application_count" -eq 5 && "$infrastructure_count" -eq 1 ]] ||
  fail "manifest must contain exactly five applications and one PostgreSQL image"
[[ "$product_provider" == "ugv" || "$product_provider" == "npc-tank" ]] ||
  fail "manifest product provider is missing"
for required_role in pms-api pms-worker pms-web runtime adapter; do
  [[ -n "\${seen_roles[$required_role]+x}" ]] || fail "missing application role: $required_role"
done

for ((index = 0; index < application_count; index += 1)); do
  role="\${APP_ROLES[$index]}"
  target="\${APP_TARGETS[$index]}"
  reference="\${APP_REFERENCES[$index]}"
  provider="\${APP_PROVIDERS[$index]}"
  case "$role" in
    pms-api)
      expected_target="pms-api-$product_provider-production"
      expected_reference="sdar/production-$product_provider-pms-api:$BUNDLE_REVISION"
      expected_provider="$product_provider"
      ;;
    pms-worker)
      expected_target="pms-worker-$product_provider-production"
      expected_reference="sdar/production-$product_provider-pms-worker:$BUNDLE_REVISION"
      expected_provider="$product_provider"
      ;;
    pms-web)
      expected_target="pms-web-production"
      expected_reference="sdar/production-pms-web:$BUNDLE_REVISION"
      expected_provider="shared"
      ;;
    runtime)
      expected_target="$product_provider-production-runtime"
      expected_reference="sdar/production-$product_provider-runtime:$BUNDLE_REVISION"
      expected_provider="$product_provider"
      ;;
    adapter)
      expected_target="$product_provider-production-adapter"
      expected_reference="sdar/production-$product_provider-adapter:$BUNDLE_REVISION"
      expected_provider="$product_provider"
      ;;
  esac
  [[ "$target" == "$expected_target" ]] || fail "unexpected Docker target for $role"
  [[ "$reference" == "$expected_reference" ]] || fail "unexpected local image reference for $role"
  [[ "$provider" == "$expected_provider" ]] || fail "unexpected provider label for $role"
done

image_platform_matches() {
  local reference="$1"
  local actual_os actual_arch
  actual_os="$(docker image inspect --format '{{.Os}}' "$reference" 2>/dev/null)" || return 1
  actual_arch="$(docker image inspect --format '{{.Architecture}}' "$reference" 2>/dev/null)" ||
    return 1
  [[ "$actual_os" == "linux" && "$actual_arch" == "arm64" ]]
}

pull_exact_image() {
  local description="$1"
  local reference="$2"
  local expected_digest="\${reference##*@}"
  local repo_digests candidate digest_found=false
  printf 'Pulling pinned %s image for linux/arm64...\n' "$description"
  docker image pull --platform linux/arm64 "$reference" ||
    fail "failed to pull pinned $description image"
  image_platform_matches "$reference" || fail "$description image is not linux/arm64"
  repo_digests="$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$reference")" ||
    fail "cannot inspect $description repository digests"
  while IFS= read -r candidate; do
    [[ "$candidate" == *"@$expected_digest" ]] && digest_found=true
  done <<< "$repo_digests"
  [[ "$digest_found" == "true" ]] || fail "$description digest identity is not locally verifiable"
}

application_metadata_matches() {
  local reference="$1"
  local revision="$2"
  local provider="$3"
  local profile="$4"
  local actual_revision actual_user actual_health actual_provider actual_profile
  image_platform_matches "$reference" || return 1
  actual_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$reference" 2>/dev/null)" ||
    return 1
  actual_user="$(docker image inspect --format '{{.Config.User}}' "$reference" 2>/dev/null)" || return 1
  actual_health="$(docker image inspect --format '{{json .Config.Healthcheck}}' "$reference" 2>/dev/null)" ||
    return 1
  actual_provider="$(docker image inspect --format '{{index .Config.Labels "io.sdar.production-bundle.provider"}}' "$reference" 2>/dev/null)" ||
    return 1
  actual_profile="$(docker image inspect --format '{{index .Config.Labels "io.sdar.production-bundle.profile"}}' "$reference" 2>/dev/null)" ||
    return 1
  [[ "$actual_revision" == "$revision" && "$actual_user" == "node" &&
    -n "$actual_health" && "$actual_health" != "null" && "$actual_health" != "<nil>" &&
    "$actual_provider" == "$provider" && "$actual_profile" == "$profile" ]]
}

pull_exact_image "Node.js" "$NODE_BASE_IMAGE"
pull_exact_image "PostgreSQL" "$POSTGRES_UPSTREAM_IMAGE"
docker image tag "$POSTGRES_UPSTREAM_IMAGE" "$POSTGRES_IMAGE" ||
  fail "failed to create the locked PostgreSQL local alias"
upstream_postgres_id="$(docker image inspect --format '{{.Id}}' "$POSTGRES_UPSTREAM_IMAGE")" ||
  fail "cannot inspect pinned PostgreSQL image ID"
local_postgres_id="$(docker image inspect --format '{{.Id}}' "$POSTGRES_IMAGE")" ||
  fail "cannot inspect local PostgreSQL alias ID"
[[ "$upstream_postgres_id" == "$local_postgres_id" ]] ||
  fail "PostgreSQL local alias does not identify the pinned upstream image"
image_platform_matches "$POSTGRES_IMAGE" || fail "PostgreSQL local alias is not linux/arm64"

for ((index = 0; index < application_count; index += 1)); do
  role="\${APP_ROLES[$index]}"
  target="\${APP_TARGETS[$index]}"
  reference="\${APP_REFERENCES[$index]}"
  revision="\${APP_REVISIONS[$index]}"
  provider="\${APP_PROVIDERS[$index]}"
  profile="\${APP_PROFILES[$index]}"
  printf 'Building %s (%s) natively for linux/arm64...\n' "$role" "$target"
  DOCKER_BUILDKIT=1 docker build \
    --platform linux/arm64 \
    --pull \
    --file Dockerfile \
    --target "$target" \
    --build-arg "NODE_BASE_IMAGE=$NODE_BASE_IMAGE" \
    --build-arg "VCS_REF=$revision" \
    --build-arg "VITE_PMS_DATA_MODE=api" \
    --tag "$reference" \
    - < "$source_archive" || fail "Docker build failed for $role"
  application_metadata_matches "$reference" "$revision" "$provider" "$profile" ||
    fail "newly built image metadata is invalid for $role"
done

verified_count=0
for ((index = 0; index < application_count; index += 1)); do
  application_metadata_matches \
    "\${APP_REFERENCES[$index]}" \
    "\${APP_REVISIONS[$index]}" \
    "\${APP_PROVIDERS[$index]}" \
    "\${APP_PROFILES[$index]}" ||
    fail "final application image verification failed: \${APP_REFERENCES[$index]}"
  verified_count=$((verified_count + 1))
done
image_platform_matches "$POSTGRES_IMAGE" || fail "final PostgreSQL platform verification failed"
final_postgres_id="$(docker image inspect --format '{{.Id}}' "$POSTGRES_IMAGE")" ||
  fail "final PostgreSQL identity verification failed"
[[ "$final_postgres_id" == "$upstream_postgres_id" ]] ||
  fail "final PostgreSQL digest-locked alias verification failed"
verified_count=$((verified_count + 1))
[[ "$verified_count" -eq 6 ]] || fail "exactly six verified images are required"

printf 'PASS: five application images and one digest-pinned PostgreSQL image are verified for native linux/arm64.\n'
`);
}

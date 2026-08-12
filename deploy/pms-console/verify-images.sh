#!/usr/bin/env bash
set -euo pipefail

source "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/common.sh"

pms_require_environment

expected_sha="${1:-$(git -C "$PMS_CONSOLE_REPO_ROOT" rev-parse --verify 'HEAD^{commit}')}"
mode="${2:-}"
[[ "$expected_sha" =~ ^[0-9a-f]{40,64}$ ]] || pms_fail "EXPECTED_IMAGE_SHA_INVALID"
[[ -z "$mode" || "$mode" == "--images-only" ]] || pms_fail "VERIFY_IMAGES_ARGUMENT_INVALID"
export PMS_CONSOLE_GIT_SHA="$expected_sha"

for service in pms-api pms-worker pms-web; do
  image="sdar/$service:$expected_sha"
  revision="$(
    docker image inspect \
      --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
      "$image" 2>/dev/null
  )" || pms_fail "IMAGE_MISSING_${service^^}"
  [[ "$revision" == "$expected_sha" ]] || pms_fail "IMAGE_REVISION_MISMATCH_${service^^}"
  user="$(docker image inspect --format '{{ .Config.User }}' "$image")"
  [[ "$user" == "node" ]] || pms_fail "IMAGE_USER_INVALID_${service^^}"
  health="$(docker image inspect --format '{{ json .Config.Healthcheck }}' "$image")"
  [[ "$health" != "null" ]] || pms_fail "IMAGE_HEALTHCHECK_MISSING_${service^^}"

  if [[ "$mode" != "--images-only" ]]; then
    container_id="$(pms_compose ps --quiet "$service")"
    [[ -n "$container_id" ]] || pms_fail "SERVICE_NOT_RUNNING_${service^^}"
    expected_image_id="$(docker image inspect --format '{{ .Id }}' "$image")"
    running_image_id="$(docker container inspect --format '{{ .Image }}' "$container_id")"
    [[ "$running_image_id" == "$expected_image_id" ]] || \
      pms_fail "RUNNING_IMAGE_MISMATCH_${service^^}"
  fi
done

echo "PASS: PMS image revisions equal $expected_sha"

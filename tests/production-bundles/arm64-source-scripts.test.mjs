import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { arm64BuildImagesScript } from "../../scripts/production-bundles/arm64-source-scripts.mjs";

test("ARM64 source image builder is valid Bash", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sdar-arm64-source-script-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "build-images.sh");
  await writeFile(path, arm64BuildImagesScript(), { encoding: "utf8", mode: 0o555 });

  const checked = spawnSync("bash", ["-n", path], { encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr);
});

test("ARM64 source image builder verifies integrity before Docker and pins its inputs", () => {
  const script = arm64BuildImagesScript();
  const checksum = script.indexOf("sha256sum --check --strict SHA256SUMS");
  const firstDockerOperation = script.indexOf("docker version --format");

  assert.ok(checksum > 0);
  assert.ok(firstDockerOperation > checksum);
  assert.match(script, /bundle_root=.*\$deploy_dir\/\.\.\/\.\./);
  assert.match(script, /build\/manifest\.tsv/);
  assert.match(script, /build\/base-images\.env/);
  assert.match(script, /deploy\/\.bundle-images\.env/);
  assert.match(script, /source\/\*\.tar\.gz/);
  assert.match(
    script,
    /kind\\trole\\ttarget\\treference\\trevision\\tprovider_label\\tprofile_label/,
  );
  assert.match(script, /manifest must contain one header and exactly six image rows/);
  assert.match(script, /exactly five applications and one PostgreSQL image/);
  assert.match(script, /BUNDLE_PLATFORM must be linux\/arm64/);
  assert.match(script, /native ARM64 host required/);
  assert.match(script, /native linux\/arm64 Docker server required/);
  assert.match(script, /docker image pull --platform linux\/arm64 "\$reference"/);
  assert.match(script, /docker image tag "\$POSTGRES_UPSTREAM_IMAGE" "\$POSTGRES_IMAGE"/);
  assert.match(script, /PostgreSQL base-image digest does not match deploy image lock/);
});

test("ARM64 source image builder builds each application from the checked source archive", () => {
  const script = arm64BuildImagesScript();

  assert.match(script, /DOCKER_BUILDKIT=1 docker build \\\n+ {4}--platform linux\/arm64/);
  assert.match(script, /--pull/);
  assert.match(script, /--target "\$target"/);
  assert.match(script, /--build-arg "NODE_BASE_IMAGE=\$NODE_BASE_IMAGE"/);
  assert.match(script, /--build-arg "VCS_REF=\$revision"/);
  assert.match(script, /--build-arg "VITE_PMS_DATA_MODE=api"/);
  assert.match(script, /- < "\$source_archive"/);
  assert.doesNotMatch(script, /SKIP: %s already matches|if application_metadata_matches/);
  assert.match(script, /'\{\{\.Os\}\}'/);
  assert.match(script, /'\{\{\.Architecture\}\}'/);
  assert.match(script, /org\.opencontainers\.image\.revision/);
  assert.match(script, /'\{\{\.Config\.User\}\}'/);
  assert.match(script, /'\{\{json \.Config\.Healthcheck\}\}'/);
  assert.match(script, /io\.sdar\.production-bundle\.provider/);
  assert.match(script, /io\.sdar\.production-bundle\.profile/);
});

test("ARM64 source image builder contains no registry authentication path", () => {
  const script = arm64BuildImagesScript();

  assert.doesNotMatch(script, /docker\s+login|--password|password-stdin/i);
  assert.doesNotMatch(script, /gh[oprsu]_[A-Za-z0-9]/);
  assert.doesNotMatch(script, /REGISTRY_(?:TOKEN|USERNAME|PASSWORD)/);
});

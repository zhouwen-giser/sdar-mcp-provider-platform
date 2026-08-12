import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { PRODUCT_IDS, productCatalog } from "../../scripts/production-bundles/catalog.mjs";
import {
  arm64RootReadme,
  injectArm64Platform,
  parseArm64SourceArguments,
  readAndValidateBaseImageLock,
} from "../../scripts/production-bundles/arm64-source-lib.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const revision = "a".repeat(40);

test("ARM64 source builder arguments select products without a registry destination", () => {
  const all = parseArm64SourceArguments([]);
  assert.deepEqual(all.products, ["ugv", "npc-tank"]);
  assert.equal("registry" in all, false);
  assert.deepEqual(parseArm64SourceArguments(["--product", "ugv"]).products, ["ugv"]);
  assert.throws(
    () => parseArm64SourceArguments(["--registry", "ghcr.io/example"]),
    /ARM64_SOURCE_ARGUMENT_UNKNOWN/,
  );
});

test("ARM64 base lock pins official Node and PostgreSQL child manifests", async () => {
  const lock = await readAndValidateBaseImageLock(
    join(repositoryRoot, "scripts/production-bundles/arm64-base-images.lock.json"),
  );
  assert.equal(lock.platform, "linux/arm64");
  assert.deepEqual(Object.keys(lock.images).sort(), ["node", "postgres"]);
  for (const [role, image] of Object.entries(lock.images)) {
    assert.match(
      image.reference,
      /^docker\.io\/library\/(?:node|postgres):[^@]+@sha256:[0-9a-f]{64}$/,
    );
    assert.equal(image.reference.endsWith(image.platformManifestDigest), true, role);
    assert.equal(image.platform, "linux/arm64");
  }
});

for (const productId of PRODUCT_IDS) {
  test(`${productId} source-build Compose is ARM64-only and has no build or public app image`, async () => {
    const product = productCatalog(productId);
    const source = await readFile(
      join(repositoryRoot, "deploy/production-bundles", product.deployDirectory, "compose.yaml"),
      "utf8",
    );
    const transformed = injectArm64Platform(source);
    const document = parseYaml(transformed, { merge: true });
    assert.equal(Object.keys(document.services).length, 9);
    for (const service of Object.values(document.services)) {
      assert.equal(service.platform, "linux/arm64");
      assert.equal(service.pull_policy, "never");
      assert.equal(service.build, undefined);
      assert.doesNotMatch(String(service.image), /ghcr\.io|docker\.io\/.*sdar/i);
    }
  });

  test(`${productId} has a dedicated ARM64 source-build deployment guide`, async () => {
    const product = productCatalog(productId);
    const source = await readFile(
      join(
        repositoryRoot,
        "deploy/production-bundles",
        product.deployDirectory,
        "README.arm64-source-build.md",
      ),
      "utf8",
    );
    assert.match(source, /ARM64/);
    assert.match(source, /现场构建/);
    assert.match(source, /不包含.*镜像|零镜像/);
    assert.match(source, /Docker Hub/);
    assert.match(source, /npm/);
    assert.doesNotMatch(source, /镜像已包含在交付包中|离线加载并核对/);
  });
}

test("Dockerfile allows the ARM64 package to pin every Node base stage", async () => {
  const dockerfile = await readFile(join(repositoryRoot, "Dockerfile"), "utf8");
  assert.match(dockerfile, /^ARG NODE_BASE_IMAGE=node:22-bookworm-slim$/m);
  assert.equal((dockerfile.match(/^FROM \$\{NODE_BASE_IMAGE\} AS /gm) ?? []).length, 6);
  assert.equal((dockerfile.match(/^FROM node:22-bookworm-slim AS /gm) ?? []).length, 0);
  assert.match(dockerfile, /install --frozen-lockfile --ignore-scripts --prefer-offline/);
  assert.match(dockerfile, /rebuild esbuild grpc-tools/);
  assert.match(dockerfile, /type=cache,id=sdar-pnpm-store/);
  assert.match(dockerfile, /--network-concurrency=8/);
  assert.equal((dockerfile.match(/id=sdar-corepack/g) ?? []).length, 3);
  assert.doesNotMatch(dockerfile, /rebuild[^\n]*openapi-changes/);
});

test("root ARM64 README states zero bundled images and native-build qualification boundary", () => {
  const product = productCatalog("ugv");
  const readme = arm64RootReadme(product, {
    source: { revision },
    qualification: { realResourceStatus: "pending" },
  });
  assert.match(readme, /不包含 Docker 镜像/);
  assert.match(readme, /不会从公共仓库拉取 SDAR 自研应用镜像/);
  assert.match(readme, /原生 Linux ARM64/);
  assert.match(readme, /NOT_CLAIMED/);
});

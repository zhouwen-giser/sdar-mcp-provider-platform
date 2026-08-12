import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ProductionBundleError } from "../../scripts/production-bundles/lib.mjs";
import {
  assertAmd64DockerPlatform,
  expectedArchiveName,
  packageProductDeliveries,
  parseProductPackagerArguments,
  productPackagerUsage,
} from "../../scripts/production-bundles/package-product-lib.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const revision = "c".repeat(40);

test("product packager arguments default to ARM64 source-build and reject identity overrides", () => {
  assert.deepEqual(parseProductPackagerArguments([]), {
    variant: "arm64-source",
    outputDirectory: undefined,
    help: false,
  });
  assert.equal(parseProductPackagerArguments(["--variant=all"]).variant, "all");
  assert.equal(
    parseProductPackagerArguments(["--variant", "amd64-offline"]).variant,
    "amd64-offline",
  );
  assert.equal(
    parseProductPackagerArguments(["--output-dir=./artifacts"]).outputDirectory,
    resolve("artifacts"),
  );
  assert.equal(parseProductPackagerArguments(["--help"]).help, true);

  for (const arguments_ of [
    ["--product", "ugv"],
    ["--registry", "example.invalid"],
    ["--push"],
    ["--variant", "unknown"],
    ["--variant"],
    ["--variant", "all", "--variant", "arm64-source"],
    ["--help", "--variant", "arm64-source"],
  ]) {
    assert.throws(
      () => parseProductPackagerArguments(arguments_),
      (error) => error instanceof ProductionBundleError,
      arguments_.join(" "),
    );
  }
});

test("amd64 offline packaging refuses any non-amd64 Docker server", () => {
  assert.equal(assertAmd64DockerPlatform("linux/amd64\n"), "linux/amd64");
  assert.equal(assertAmd64DockerPlatform("LINUX/X86_64"), "linux/amd64");
  for (const platform of ["linux/arm64", "windows/amd64", "", "linux/386"]) {
    assert.throws(
      () => assertAmd64DockerPlatform(platform),
      (error) =>
        error instanceof ProductionBundleError &&
        error.code === "PRODUCT_PACKAGER_DOCKER_PLATFORM_UNSUPPORTED",
      platform,
    );
  }
});

test("UGV entry defaults to one verified ARM64 artifact and preserves unrelated files", async () => {
  const fixture = await createFixture();
  const sentinel = join(fixture.outputDirectory, "sdar-npc-tank-production-delivery.zip");
  await mkdir(fixture.outputDirectory, { recursive: true });
  await writeFile(sentinel, "npc-sentinel", "utf8");
  const { dependencies, calls } = fakeDependencies();

  const result = await packageProductDeliveries(
    "ugv",
    {
      repositoryRoot: fixture.repositoryRoot,
      outputDirectory: fixture.outputDirectory,
    },
    dependencies,
  );

  assert.equal(result.product, "ugv");
  assert.equal(result.sourceRevision, revision);
  assert.deepEqual(result.variants, ["arm64-source"]);
  assert.equal(result.outputs.length, 1);
  assert.equal(result.outputs[0].platform, "linux/arm64");
  assert.deepEqual(calls.slice(0, 2), ["clean", "build:arm64-source:ugv"]);
  assert.equal(calls.includes("probe:amd64"), false);
  assert.equal(calls.includes("build:amd64-offline:ugv"), false);
  assert.equal(calls.filter((value) => value === "verify:arm64-source:ugv").length, 2);
  assert.equal(await readFile(sentinel, "utf8"), "npc-sentinel");
  assert.deepEqual((await readdir(fixture.outputDirectory)).sort(), [
    "sdar-npc-tank-production-delivery.zip",
    "sdar-ugv-production-arm64-source-build-delivery.zip",
    "sdar-ugv-production-arm64-source-build-delivery.zip.sha256",
  ]);
});

test("NPC all mode validates both variants before publishing either one", async () => {
  const fixture = await createFixture();
  const { dependencies, calls } = fakeDependencies();

  const result = await packageProductDeliveries(
    "npc-tank",
    {
      repositoryRoot: fixture.repositoryRoot,
      outputDirectory: fixture.outputDirectory,
      variant: "all",
    },
    dependencies,
  );

  assert.deepEqual(result.variants, ["arm64-source", "amd64-offline"]);
  assert.equal(result.outputs.length, 2);
  assert.deepEqual(
    calls.filter((value) => value.startsWith("build:")),
    ["build:arm64-source:npc-tank", "build:amd64-offline:npc-tank"],
  );
  assert.ok(calls.indexOf("probe:amd64") < calls.indexOf("build:arm64-source:npc-tank"));
  assert.deepEqual((await readdir(fixture.outputDirectory)).sort(), [
    "sdar-npc-tank-production-arm64-source-build-delivery.zip",
    "sdar-npc-tank-production-arm64-source-build-delivery.zip.sha256",
    "sdar-npc-tank-production-delivery.zip",
    "sdar-npc-tank-production-delivery.zip.sha256",
  ]);
});

test("a failed second variant leaves the destination untouched", async () => {
  const fixture = await createFixture();
  await mkdir(fixture.outputDirectory, { recursive: true });
  const sentinel = join(fixture.outputDirectory, "keep.txt");
  await writeFile(sentinel, "keep", "utf8");
  const { dependencies } = fakeDependencies({ failVariant: "amd64-offline" });

  await assert.rejects(
    packageProductDeliveries(
      "ugv",
      {
        repositoryRoot: fixture.repositoryRoot,
        outputDirectory: fixture.outputDirectory,
        variant: "all",
      },
      dependencies,
    ),
    /FAKE_BUILD_FAILURE/,
  );
  assert.deepEqual(await readdir(fixture.outputDirectory), ["keep.txt"]);
  assert.equal(await readFile(sentinel, "utf8"), "keep");
});

test("post-publish verification failure restores existing artifacts byte-for-byte", async () => {
  const fixture = await createFixture();
  await mkdir(fixture.outputDirectory, { recursive: true });
  const archiveName = expectedArchiveName("ugv", "arm64-source");
  const archivePath = join(fixture.outputDirectory, archiveName);
  const sidecarPath = `${archivePath}.sha256`;
  await writeFile(archivePath, "old-archive", "utf8");
  await writeFile(sidecarPath, "old-sidecar", "utf8");
  const { dependencies } = fakeDependencies({ failFinalValidation: true });

  await assert.rejects(
    packageProductDeliveries(
      "ugv",
      {
        repositoryRoot: fixture.repositoryRoot,
        outputDirectory: fixture.outputDirectory,
      },
      dependencies,
    ),
    (error) =>
      error instanceof ProductionBundleError && error.code === "PRODUCT_PACKAGER_PUBLISH_FAILED",
  );
  assert.equal(await readFile(archivePath, "utf8"), "old-archive");
  assert.equal(await readFile(sidecarPath, "utf8"), "old-sidecar");
  assert.deepEqual((await readdir(fixture.outputDirectory)).sort(), [
    archiveName,
    `${archiveName}.sha256`,
  ]);
});

test("concurrent publication of the same product and directory fails closed", async () => {
  const fixture = await createFixture();
  const entered = deferred();
  const release = deferred();
  const first = fakeDependencies({
    async blockFinalValidation() {
      entered.resolve();
      await release.promise;
    },
  });
  const second = fakeDependencies();
  const firstRun = packageProductDeliveries(
    "npc-tank",
    {
      repositoryRoot: fixture.repositoryRoot,
      outputDirectory: fixture.outputDirectory,
    },
    first.dependencies,
  );
  await entered.promise;

  await assert.rejects(
    packageProductDeliveries(
      "npc-tank",
      {
        repositoryRoot: fixture.repositoryRoot,
        outputDirectory: fixture.outputDirectory,
      },
      second.dependencies,
    ),
    (error) =>
      error instanceof ProductionBundleError && error.code === "PRODUCT_PACKAGER_PUBLISH_LOCKED",
  );
  release.resolve();
  const result = await firstRun;
  assert.equal(result.outputs.length, 1);
  assert.deepEqual((await readdir(fixture.outputDirectory)).sort(), [
    "sdar-npc-tank-production-arm64-source-build-delivery.zip",
    "sdar-npc-tank-production-arm64-source-build-delivery.zip.sha256",
  ]);
});

test("a dirty source or mismatched builder result fails before publication", async () => {
  const fixture = await createFixture();
  const blocked = fakeDependencies({ cleanFailure: true });
  await assert.rejects(
    packageProductDeliveries(
      "ugv",
      {
        repositoryRoot: fixture.repositoryRoot,
        outputDirectory: fixture.outputDirectory,
        variant: "all",
      },
      blocked.dependencies,
    ),
    /PRODUCTION_BUNDLE_SOURCE_TREE_DIRTY/,
  );
  assert.deepEqual(blocked.calls, ["clean"]);

  const mismatched = fakeDependencies({ resultProduct: "npc-tank" });
  await assert.rejects(
    packageProductDeliveries(
      "ugv",
      {
        repositoryRoot: fixture.repositoryRoot,
        outputDirectory: fixture.outputDirectory,
      },
      mismatched.dependencies,
    ),
    (error) =>
      error instanceof ProductionBundleError &&
      error.code === "PRODUCT_PACKAGER_BUILD_OUTPUT_IDENTITY_INVALID",
  );
  await assert.rejects(stat(fixture.outputDirectory), { code: "ENOENT" });
});

test("sidecar identity and content are independently enforced", async () => {
  for (const sidecarMode of ["wrong-digest", "wrong-name", "extra-line"]) {
    const fixture = await createFixture();
    const { dependencies } = fakeDependencies({ sidecarMode });
    await assert.rejects(
      packageProductDeliveries(
        "npc-tank",
        {
          repositoryRoot: fixture.repositoryRoot,
          outputDirectory: fixture.outputDirectory,
        },
        dependencies,
      ),
      (error) =>
        error instanceof ProductionBundleError &&
        error.code === "PRODUCT_PACKAGER_SIDECAR_MISMATCH",
      sidecarMode,
    );
    await assert.rejects(stat(fixture.outputDirectory), { code: "ENOENT" });
  }
});

test("product entrypoints are executable, fixed to one product, and never push images or Git", async () => {
  const entryPaths = [
    join(repositoryRoot, "scripts/production-bundles/package-product-lib.mjs"),
    join(repositoryRoot, "scripts/production-bundles/package-ugv.mjs"),
    join(repositoryRoot, "scripts/production-bundles/package-npc-tank.mjs"),
  ];
  const dependencyPaths = [
    join(repositoryRoot, "scripts/production-bundles/lib.mjs"),
    join(repositoryRoot, "scripts/production-bundles/arm64-source-lib.mjs"),
    join(repositoryRoot, "scripts/production-bundles/arm64-source-scripts.mjs"),
  ];
  const [shared, ugv, npc, ...dependencies] = await Promise.all(
    [...entryPaths, ...dependencyPaths].map((path) => readFile(path, "utf8")),
  );
  assert.match(ugv, /runProductPackagerCli\("ugv"/);
  assert.doesNotMatch(ugv, /npc-tank/);
  assert.match(npc, /runProductPackagerCli\("npc-tank"/);
  assert.doesNotMatch(npc, /runProductPackagerCli\("ugv"/);
  assert.doesNotMatch(
    `${shared}\n${ugv}\n${npc}\n${dependencies.join("\n")}`,
    /\b(?:docker|git)\s+(?:push|login)\b/i,
  );
  assert.match(productPackagerUsage("ugv"), /package-ugv\.mjs/);
  assert.match(productPackagerUsage("npc-tank"), /package-npc-tank\.mjs/);

  for (const path of entryPaths.slice(1)) {
    const metadata = await stat(path);
    assert.notEqual(metadata.mode & 0o111, 0, `${path} must be executable`);
  }
  const packageJson = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  assert.equal(
    packageJson.scripts["production-bundles:package:ugv"],
    "node scripts/production-bundles/package-ugv.mjs",
  );
  assert.equal(
    packageJson.scripts["production-bundles:package:npc-tank"],
    "node scripts/production-bundles/package-npc-tank.mjs",
  );
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "sdar-product-packager-test-"));
  return {
    repositoryRoot: join(root, "repository"),
    outputDirectory: join(root, "output"),
  };
}

function fakeDependencies(options = {}) {
  const calls = [];
  const validationCounts = new Map();
  const dependencies = {
    async assertCleanCommittedHead() {
      calls.push("clean");
      if (options.cleanFailure) throw new Error("PRODUCTION_BUNDLE_SOURCE_TREE_DIRTY");
      return { revision };
    },
    async probeAmd64DockerServer() {
      calls.push("probe:amd64");
      return "linux/amd64";
    },
    async buildArm64SourceBundles(input) {
      return buildFake("arm64-source", input);
    },
    async buildProductionBundles(input) {
      return buildFake("amd64-offline", input);
    },
    async validateArm64SourceZip(_archivePath, { expectedProduct }) {
      calls.push(`verify:arm64-source:${expectedProduct}`);
      await beforeFakeValidation("arm64-source");
      return fakeManifest("arm64-source", expectedProduct);
    },
    async validateBundleZip(_archivePath, { expectedProduct }) {
      calls.push(`verify:amd64-offline:${expectedProduct}`);
      await beforeFakeValidation("amd64-offline");
      return fakeManifest("amd64-offline", expectedProduct);
    },
  };

  async function buildFake(variant, input) {
    const product = input.products[0];
    calls.push(`build:${variant}:${product}`);
    if (options.failVariant === variant) throw new Error("FAKE_BUILD_FAILURE");
    await mkdir(input.outputDirectory, { recursive: true });
    const outputProduct = options.resultProduct ?? product;
    const archiveName = expectedArchiveName(product, variant);
    const archivePath = join(input.outputDirectory, archiveName);
    const sidecarPath = `${archivePath}.sha256`;
    const body = `fake:${product}:${variant}:${revision}`;
    await writeFile(archivePath, body, "utf8");
    const digest = createHash("sha256").update(body).digest("hex");
    let sidecar = `${digest}  ${archiveName}\n`;
    if (options.sidecarMode === "wrong-digest") sidecar = `${"0".repeat(64)}  ${archiveName}\n`;
    if (options.sidecarMode === "wrong-name") sidecar = `${digest}  wrong.zip\n`;
    if (options.sidecarMode === "extra-line") sidecar += `${digest}  ${archiveName}\n`;
    await writeFile(sidecarPath, sidecar, "utf8");
    return {
      source: { revision },
      outputs: [
        {
          product: outputProduct,
          archivePath,
          sidecarPath,
          deployable: true,
        },
      ],
    };
  }

  async function beforeFakeValidation(variant) {
    const count = (validationCounts.get(variant) ?? 0) + 1;
    validationCounts.set(variant, count);
    if (count === 2 && options.failFinalValidation) throw new Error("FAKE_FINAL_VERIFY_FAILURE");
    if (count === 2 && options.blockFinalValidation) await options.blockFinalValidation();
  }

  return { calls, dependencies };
}

function fakeManifest(variant, product) {
  return {
    bundle: {
      product,
      targetPlatform: variant === "arm64-source" ? "linux/arm64" : "linux/amd64",
    },
    source: { revision },
    deployment: {
      ...(variant === "arm64-source" ? { includedImageCount: 0 } : {}),
      targetPlatform: variant === "arm64-source" ? "linux/arm64" : "linux/amd64",
    },
    images:
      variant === "amd64-offline"
        ? Array.from({ length: 6 }, () => ({ os: "linux", architecture: "amd64" }))
        : [],
  };
}

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

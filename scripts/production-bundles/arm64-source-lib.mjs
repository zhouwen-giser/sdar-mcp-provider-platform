import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  PRODUCT_IDS,
  applicationImageReference,
  bundleImageEnvironment,
  productCatalog,
} from "./catalog.mjs";
import {
  assertArchivePathSafety,
  assertCleanCommittedHead,
  assertComposeRunOptionCompatibility,
  assertNoBuildFields,
  assertNoRealEnvironmentEntries,
  coded,
  validateComposeDocument,
} from "./lib.mjs";
import { arm64BuildImagesScript } from "./arm64-source-scripts.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "../..");
const DEFAULT_BASE_IMAGE_LOCK = join(SCRIPT_DIRECTORY, "arm64-base-images.lock.json");
const SCHEMA_VERSION = 2;
const BUILD_SCHEMA_VERSION = 1;
const TARGET_PLATFORM = "linux/arm64";
const SOURCE_PREFIX = "sdar-mcp-provider-platform";
const SECRET_PATTERNS = Object.freeze([
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[oprsu]_[A-Za-z0-9]{20,}\b/,
]);

const VARIANTS = Object.freeze({
  ugv: Object.freeze({
    archiveName: "sdar-ugv-production-arm64-source-build-delivery.zip",
    rootName: "sdar-ugv-production-arm64-source-build",
  }),
  "npc-tank": Object.freeze({
    archiveName: "sdar-npc-tank-production-arm64-source-build-delivery.zip",
    rootName: "sdar-npc-tank-production-arm64-source-build",
  }),
});

export function parseArm64SourceArguments(argv) {
  const options = {
    products: [...PRODUCT_IDS],
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    outputDirectory: undefined,
    baseImageLock: DEFAULT_BASE_IMAGE_LOCK,
    keepStage: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--keep-stage") {
      options.keepStage = true;
      continue;
    }
    const [name, inlineValue] = splitArgument(argument);
    const value = inlineValue ?? argv[++index];
    if (value === undefined || value.startsWith("--"))
      throw coded("ARM64_SOURCE_ARGUMENT_VALUE_REQUIRED", name);
    switch (name) {
      case "--product":
        options.products = value === "all" ? [...PRODUCT_IDS] : [productCatalog(value).id];
        break;
      case "--repo-root":
        options.repositoryRoot = resolve(value);
        break;
      case "--output-dir":
        options.outputDirectory = resolve(value);
        break;
      case "--base-image-lock":
        options.baseImageLock = resolve(value);
        break;
      default:
        throw coded("ARM64_SOURCE_ARGUMENT_UNKNOWN", name);
    }
  }
  if (new Set(options.products).size !== options.products.length)
    throw coded("ARM64_SOURCE_PRODUCT_DUPLICATE");
  return Object.freeze(options);
}

export async function buildArm64SourceBundles(input = {}) {
  const repositoryRoot = await canonicalDirectory(
    input.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT,
    "ARM64_SOURCE_REPOSITORY_ROOT_INVALID",
  );
  const source = await assertCleanCommittedHead(repositoryRoot);
  const products = (input.products ?? PRODUCT_IDS).map((id) => productCatalog(id));
  const outputDirectory = resolve(
    input.outputDirectory ?? join(repositoryRoot, "reports/production-bundles/delivery"),
  );
  assertSafeOutput(repositoryRoot, outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const baseLock = await readAndValidateBaseImageLock(
    input.baseImageLock ?? DEFAULT_BASE_IMAGE_LOCK,
  );

  const workingRoot = await mkdtemp(join(tmpdir(), "sdar-arm64-source-bundles-"));
  const archivedRoot = join(workingRoot, "repository");
  const stageRoot = join(workingRoot, "stage");
  await mkdir(archivedRoot, { recursive: true });
  await mkdir(stageRoot, { recursive: true });

  let retainedStage;
  try {
    await materializeCommittedTree(repositoryRoot, source.revision, archivedRoot);
    const sourceArchive = await createSourceArchive(repositoryRoot, source, workingRoot);
    const outputs = [];
    for (const product of products) {
      outputs.push(
        await stageArm64SourceBundle({
          archivedRoot,
          baseLock,
          outputDirectory,
          product,
          source,
          sourceArchive,
          stageRoot,
        }),
      );
    }
    if (input.keepStage === true) {
      retainedStage = join(outputDirectory, `arm64-stage-${source.revision.slice(0, 12)}`);
      await rm(retainedStage, { recursive: true, force: true });
      await cp(stageRoot, retainedStage, { recursive: true, errorOnExist: true });
    }
    return Object.freeze({ source, outputs: Object.freeze(outputs), retainedStage });
  } finally {
    await rm(workingRoot, { recursive: true, force: true });
  }
}

async function stageArm64SourceBundle({
  archivedRoot,
  baseLock,
  outputDirectory,
  product,
  source,
  sourceArchive,
  stageRoot,
}) {
  const variant = VARIANTS[product.id];
  const bundleRoot = join(stageRoot, variant.rootName);
  const deployDestination = join(bundleRoot, "deploy", product.deployDirectory);
  await mkdir(join(bundleRoot, "build"), { recursive: true });
  await mkdir(join(bundleRoot, "source"), { recursive: true });
  await mkdir(join(bundleRoot, "licenses"), { recursive: true });
  await mkdir(join(bundleRoot, "sbom"), { recursive: true });

  await cp(
    join(archivedRoot, "deploy/production-bundles", product.deployDirectory),
    deployDestination,
    { recursive: true, errorOnExist: true, preserveTimestamps: false },
  );
  await installArm64DeploymentVariant(deployDestination);

  const postgresDigest = baseLock.images.postgres.platformManifestDigest;
  const postgresDigest12 = postgresDigest.slice("sha256:".length, "sha256:".length + 12);
  const postgres = Object.freeze({
    reference: `sdar/production-postgres:17-alpine-${postgresDigest12}`,
    digest: postgresDigest,
    digest12: postgresDigest12,
    upstreamReference: baseLock.images.postgres.reference,
  });
  const imageEnvironmentPath = join(deployDestination, ".bundle-images.env");
  await writeFile(imageEnvironmentPath, bundleImageEnvironment(source.revision, postgres, true), {
    encoding: "utf8",
    mode: 0o444,
  });
  await chmod(imageEnvironmentPath, 0o444);

  const composePath = join(deployDestination, "compose.yaml");
  const compose = injectArm64Platform(await readFile(composePath, "utf8"));
  await writeFile(composePath, compose, "utf8");
  const composeInventory = validateComposeDocument({
    source: compose,
    product,
    revision: source.revision,
    postgres,
  });
  validateArm64Compose(compose);

  const sourceDestination = join(bundleRoot, "source", sourceArchive.name);
  await copyFile(sourceArchive.path, sourceDestination);
  await copyFile(join(archivedRoot, "LICENSE"), join(bundleRoot, "licenses/LICENSE"));
  await copyFile(
    join(archivedRoot, "reports/sbom/runtime-v1.cdx.json"),
    join(bundleRoot, "sbom/runtime-v1.cdx.json"),
  );

  const targets = buildTargetRecords(product, source.revision, postgres.reference);
  await writeBuildManifestTsv(join(bundleRoot, "build/manifest.tsv"), targets);
  const baseEnvironment = baseImageEnvironment(baseLock, `source/${sourceArchive.name}`);
  await writeFile(join(bundleRoot, "build/base-images.env"), baseEnvironment, {
    encoding: "utf8",
    mode: 0o444,
  });
  await chmod(join(bundleRoot, "build/base-images.env"), 0o444);
  const buildManifest = Object.freeze({
    schemaVersion: BUILD_SCHEMA_VERSION,
    deliveryMode: "source-build-online",
    platform: TARGET_PLATFORM,
    sourceArchive: `source/${sourceArchive.name}`,
    sourceSha256: sourceArchive.sha256,
    sourceRevision: source.revision,
    baseImages: baseLock.images,
    targets,
  });
  await writeJson(join(bundleRoot, "build/manifest.json"), buildManifest);
  const buildScriptPath = join(deployDestination, "bin/build-images.sh");
  await writeFile(buildScriptPath, arm64BuildImagesScript(), { encoding: "utf8", mode: 0o555 });
  await chmod(buildScriptPath, 0o555);

  const sourcePackageVersion = await packageVersion(archivedRoot);
  const version = `${sourcePackageVersion}-${product.id}.arm64-source.${source.revision.slice(0, 12)}`;
  const manifest = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    bundle: Object.freeze({
      name: variant.rootName,
      title: `${product.title} (ARM64 source build)`,
      product: product.id,
      version,
      deployable: true,
      deliveryMode: "source-build-online",
      targetPlatform: TARGET_PLATFORM,
      generatedFromCommittedHead: true,
      productionQualificationClaimed: false,
    }),
    source: Object.freeze({
      repository: "sdar-mcp-provider-platform",
      revision: source.revision,
      branch: source.branch,
      commitTimestamp: source.commitTimestamp,
      archive: `source/${sourceArchive.name}`,
      sha256: sourceArchive.sha256,
      exportedFileCount: sourceArchive.exportedFileCount,
    }),
    providerPackage: product.providerPackage,
    qualification: Object.freeze({
      status: product.qualificationStatus,
      productionQualification: "NOT_CLAIMED",
      realResourceStatus: product.providerPackage.realResourceStatus,
      nativeArm64RuntimeVerified: false,
    }),
    deployment: Object.freeze({
      directory: `deploy/${product.deployDirectory}`,
      compose: `deploy/${product.deployDirectory}/compose.yaml`,
      transportProfile: product.transportProfile,
      runtimeAuthority: product.runtimeAuthority,
      registryAuthority: product.registryAuthority,
      services: composeInventory.services,
      persistentServices: composeInventory.persistentServices,
      seedServices: composeInventory.seedServices,
      targetPlatform: TARGET_PLATFORM,
      sourceBuildRequired: true,
      locallyBuiltApplicationImageCount: 5,
      pulledInfrastructureImageCount: 1,
      includedImageCount: 0,
      offlineImageCount: 0,
      networkRegistryRequiredDuringBuild: true,
      packageRegistryRequiredDuringBuild: true,
      gitRequiredOnDeploymentHost: false,
      nodeRequiredOnDeploymentHost: false,
      hostRequirements: [
        "native Linux ARM64",
        "bash",
        "Docker Engine with BuildKit",
        "Docker Compose v2",
        "openssl",
        "sha256sum",
      ],
    }),
    buildPlan: Object.freeze({
      script: `deploy/${product.deployDirectory}/bin/build-images.sh`,
      dockerfile: "Dockerfile",
      platform: TARGET_PLATFORM,
      packageManager: "pnpm@11.13.1",
      lockfile: "pnpm-lock.yaml",
      baseImages: baseLock.images,
      targets,
    }),
    imageArchive: null,
    compliance: Object.freeze({
      license: "licenses/LICENSE",
      sbom: "sbom/runtime-v1.cdx.json",
      sbomScope: "application Runtime scope declared by the supplied CycloneDX document",
      completeImageSbomClaimed: false,
    }),
  });
  await writeFile(join(bundleRoot, "VERSION"), `${version}\n`, "utf8");
  await writeFile(join(bundleRoot, "DEPLOYABLE"), "true\n", "utf8");
  await writeJson(join(bundleRoot, "manifest.json"), manifest);
  await writeFile(join(bundleRoot, "README.md"), arm64RootReadme(product, manifest), "utf8");
  await writeChecksums(bundleRoot);
  await validateArm64SourceStaged(bundleRoot, { expectedProduct: product.id });

  const archivePath = join(outputDirectory, variant.archiveName);
  await rm(archivePath, { force: true });
  run("zip", ["-X", "-q", "-r", archivePath, variant.rootName], {
    cwd: stageRoot,
    code: "ARM64_SOURCE_ZIP_FAILED",
  });
  const digest = await sha256File(archivePath);
  const sidecarPath = `${archivePath}.sha256`;
  await writeFile(sidecarPath, `${digest}  ${basename(archivePath)}\n`, "utf8");
  await validateArm64SourceZip(archivePath, { expectedProduct: product.id });
  return Object.freeze({
    product: product.id,
    archivePath,
    sidecarPath,
    sha256: digest,
    deployable: true,
    platform: TARGET_PLATFORM,
  });
}

async function installArm64DeploymentVariant(deployRoot) {
  const variantReadme = join(deployRoot, "README.arm64-source-build.md");
  await requireRegularFile(variantReadme, "ARM64_SOURCE_DEPLOYMENT_README_MISSING");
  await copyFile(variantReadme, join(deployRoot, "README.md"));
  await rm(variantReadme);
  const upPath = join(deployRoot, "bin/up.sh");
  const up = await readFile(upPath, "utf8");
  const occurrences = up.split("load-images.sh").length - 1;
  if (occurrences !== 1) throw coded("ARM64_SOURCE_UP_LOADER_REFERENCE_INVALID");
  await writeFile(upPath, up.replace("load-images.sh", "build-images.sh"), {
    encoding: "utf8",
    mode: 0o755,
  });
  await chmod(upPath, 0o755);
}

export function injectArm64Platform(source) {
  let document;
  try {
    document = parseYaml(source, { merge: true });
  } catch (error) {
    throw coded("ARM64_SOURCE_COMPOSE_YAML_INVALID", undefined, error);
  }
  if (!isRecord(document) || !isRecord(document.services))
    throw coded("ARM64_SOURCE_COMPOSE_SERVICES_INVALID");
  for (const [name, service] of Object.entries(document.services)) {
    if (!isRecord(service)) throw coded("ARM64_SOURCE_COMPOSE_SERVICE_INVALID", name);
    service.platform = TARGET_PLATFORM;
  }
  return stringifyYaml(document, { lineWidth: 0 });
}

function validateArm64Compose(source) {
  const document = parseYaml(source, { merge: true });
  assertNoBuildFields(document);
  if (!isRecord(document?.services)) throw coded("ARM64_SOURCE_COMPOSE_SERVICES_INVALID");
  for (const [name, service] of Object.entries(document.services)) {
    if (!isRecord(service) || service.platform !== TARGET_PLATFORM)
      throw coded("ARM64_SOURCE_COMPOSE_PLATFORM_INVALID", name);
    if (service.pull_policy !== "never")
      throw coded("ARM64_SOURCE_COMPOSE_PULL_POLICY_INVALID", name);
  }
}

function buildTargetRecords(product, revision, postgresReference) {
  const application = product.images.map((image) =>
    Object.freeze({
      kind: "application",
      role: image.role,
      target: image.target,
      reference: applicationImageReference(image, revision),
      revision,
      providerLabel: image.role === "pms-web" ? "shared" : product.id,
      profileLabel: "production",
    }),
  );
  return Object.freeze([
    ...application,
    Object.freeze({
      kind: "infrastructure",
      role: "postgres",
      target: "-",
      reference: postgresReference,
      revision: "-",
      providerLabel: "-",
      profileLabel: "-",
    }),
  ]);
}

async function writeBuildManifestTsv(path, records) {
  const lines = ["kind\trole\ttarget\treference\trevision\tprovider_label\tprofile_label"];
  for (const record of records) {
    const fields = [
      record.kind,
      record.role,
      record.target,
      record.reference,
      record.revision,
      record.providerLabel,
      record.profileLabel,
    ];
    if (fields.some((field) => typeof field !== "string" || /[\t\r\n]/.test(field)))
      throw coded("ARM64_SOURCE_BUILD_TSV_FIELD_INVALID");
    lines.push(fields.join("\t"));
  }
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
}

function baseImageEnvironment(baseLock, sourceArchive) {
  return [
    `BUNDLE_PLATFORM=${TARGET_PLATFORM}`,
    `NODE_BASE_IMAGE=${baseLock.images.node.reference}`,
    `POSTGRES_UPSTREAM_IMAGE=${baseLock.images.postgres.reference}`,
    `SOURCE_ARCHIVE=${sourceArchive}`,
    "",
  ].join("\n");
}

export async function readAndValidateBaseImageLock(path) {
  const value = await readJson(path, "ARM64_SOURCE_BASE_LOCK_INVALID");
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.platform !== TARGET_PLATFORM ||
    !isRecord(value.images)
  )
    throw coded("ARM64_SOURCE_BASE_LOCK_SCHEMA_INVALID");
  const expected = {
    node: "docker.io/library/node:22-bookworm-slim",
    postgres: "docker.io/library/postgres:17-alpine",
  };
  const images = {};
  for (const [role, requiredTag] of Object.entries(expected)) {
    const image = value.images[role];
    if (
      !isRecord(image) ||
      image.tag !== requiredTag ||
      !isDigest(image.indexDigest) ||
      !isDigest(image.platformManifestDigest)
    )
      throw coded("ARM64_SOURCE_BASE_LOCK_IMAGE_INVALID", role);
    images[role] = Object.freeze({
      tag: image.tag,
      indexDigest: image.indexDigest,
      platformManifestDigest: image.platformManifestDigest,
      reference: `${image.tag}@${image.platformManifestDigest}`,
      platform: TARGET_PLATFORM,
    });
  }
  if (Object.keys(value.images).sort().join(",") !== "node,postgres")
    throw coded("ARM64_SOURCE_BASE_LOCK_IMAGE_SET_INVALID");
  return Object.freeze({
    schemaVersion: 1,
    platform: TARGET_PLATFORM,
    resolvedAt: value.resolvedAt,
    images: Object.freeze(images),
  });
}

export async function validateArm64SourceStaged(bundleRoot, options = {}) {
  const root = await canonicalDirectory(bundleRoot, "ARM64_SOURCE_STAGE_ROOT_INVALID");
  const manifest = await readJson(join(root, "manifest.json"), "ARM64_SOURCE_MANIFEST_INVALID");
  validateRootManifest(manifest, options);
  if ((await readFile(join(root, "DEPLOYABLE"), "utf8")).trim() !== "true")
    throw coded("ARM64_SOURCE_DEPLOYABLE_MARKER_INVALID");
  const files = await walkRegularFiles(root);
  assertNoImagePayload(files);
  assertNoRealEnvironmentEntries(files);
  await assertChecksums(root);
  await scanTextSecrets(root, files);

  const sourceArchive = join(root, manifest.source.archive);
  if ((await sha256File(sourceArchive)) !== manifest.source.sha256)
    throw coded("ARM64_SOURCE_ARCHIVE_HASH_MISMATCH");
  const sourceEntries = archiveEntries(sourceArchive);
  assertArchivePathSafety(sourceEntries, "ARM64_SOURCE_ARCHIVE_PATH_UNSAFE");
  assertNoRealEnvironmentEntries(sourceEntries);
  scanSourceArchiveSecrets(sourceArchive);
  const sourceFiles = sourceEntries.filter((entry) => !entry.endsWith("/"));
  if (sourceFiles.length !== manifest.source.exportedFileCount)
    throw coded("ARM64_SOURCE_ARCHIVE_FILE_COUNT_MISMATCH");
  for (const required of [
    "Dockerfile",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".npmrc",
    "scripts/production-bundles/package-product-lib.mjs",
    "scripts/production-bundles/package-ugv.mjs",
    "scripts/production-bundles/package-npc-tank.mjs",
    `deploy/production-bundles/${productCatalog(manifest.bundle.product).deployDirectory}/compose.yaml`,
  ]) {
    if (!sourceEntries.includes(required))
      throw coded("ARM64_SOURCE_ARCHIVE_REQUIRED_PATH_MISSING", required);
  }
  const dockerfile = capture("tar", ["-xOzf", sourceArchive, "Dockerfile"], {
    code: "ARM64_SOURCE_DOCKERFILE_READ_FAILED",
  });
  if (!/^ARG NODE_BASE_IMAGE=node:22-bookworm-slim$/m.test(dockerfile))
    throw coded("ARM64_SOURCE_DOCKERFILE_BASE_ARGUMENT_MISSING");
  if ((dockerfile.match(/^FROM \$\{NODE_BASE_IMAGE\} AS /gm) ?? []).length !== 6)
    throw coded("ARM64_SOURCE_DOCKERFILE_BASE_ARGUMENT_INCOMPLETE");
  if (!dockerfile.includes("install --frozen-lockfile --ignore-scripts --prefer-offline"))
    throw coded("ARM64_SOURCE_DOCKERFILE_INSTALL_SCRIPTS_NOT_ISOLATED");
  if (!dockerfile.includes("rebuild esbuild grpc-tools"))
    throw coded("ARM64_SOURCE_DOCKERFILE_BUILD_SCRIPT_ALLOWLIST_MISSING");
  if (/rebuild[^\n]*openapi-changes/u.test(dockerfile))
    throw coded("ARM64_SOURCE_DOCKERFILE_REVIEW_TOOL_SCRIPT_FORBIDDEN");

  const buildManifest = await readJson(
    join(root, "build/manifest.json"),
    "ARM64_SOURCE_BUILD_MANIFEST_INVALID",
  );
  validateBuildManifest(buildManifest, manifest);
  const expectedBaseEnv = baseImageEnvironment(
    { images: buildManifest.baseImages },
    manifest.source.archive,
  );
  if ((await readFile(join(root, "build/base-images.env"), "utf8")) !== expectedBaseEnv)
    throw coded("ARM64_SOURCE_BASE_ENV_MISMATCH");
  await validateBuildManifestTsv(join(root, "build/manifest.tsv"), buildManifest.targets);

  const product = productCatalog(manifest.bundle.product);
  const postgresTarget = buildManifest.targets.find((record) => record.role === "postgres");
  const postgres = {
    reference: postgresTarget.reference,
    digest: buildManifest.baseImages.postgres.platformManifestDigest,
    digest12: buildManifest.baseImages.postgres.platformManifestDigest.slice(7, 19),
  };
  const deployRoot = join(root, manifest.deployment.directory);
  const compose = await readFile(join(root, manifest.deployment.compose), "utf8");
  validateComposeDocument({
    source: compose,
    product,
    revision: manifest.source.revision,
    postgres,
  });
  validateArm64Compose(compose);
  const imageEnvironment = await readFile(join(deployRoot, ".bundle-images.env"), "utf8");
  if (imageEnvironment !== bundleImageEnvironment(manifest.source.revision, postgres, true))
    throw coded("ARM64_SOURCE_IMAGE_ENV_MISMATCH");
  const buildScript = join(deployRoot, "bin/build-images.sh");
  await requireExecutableRegularFile(buildScript, "ARM64_SOURCE_BUILD_SCRIPT_INVALID");
  if ((await readFile(buildScript, "utf8")) !== arm64BuildImagesScript())
    throw coded("ARM64_SOURCE_BUILD_SCRIPT_CONTENT_MISMATCH");
  const up = await readFile(join(deployRoot, "bin/up.sh"), "utf8");
  if (!up.includes("build-images.sh") || up.includes("load-images.sh"))
    throw coded("ARM64_SOURCE_UP_SCRIPT_INVALID");
  assertComposeRunOptionCompatibility(up, "ARM64_SOURCE_COMPOSE_RUN_OPTION_UNSUPPORTED");
  const readme = await readFile(join(deployRoot, "README.md"), "utf8");
  if (
    !readme.includes("ARM64") ||
    !readme.includes("现场构建") ||
    /镜像已包含在交付包中|离线加载并核对|无需.*镜像仓库网络/.test(readme)
  )
    throw coded("ARM64_SOURCE_DEPLOYMENT_README_INVALID");
  return manifest;
}

export async function validateArm64SourceZip(zipPath, options = {}) {
  const archive = resolve(zipPath);
  const entries = zipEntries(archive);
  assertArchivePathSafety(entries, "ARM64_SOURCE_ZIP_PATH_UNSAFE");
  assertNoImagePayload(entries);
  const roots = new Set(entries.map((entry) => entry.split("/")[0]).filter(Boolean));
  if (roots.size !== 1) throw coded("ARM64_SOURCE_ZIP_ROOT_INVALID");
  const temporary = await mkdtemp(join(tmpdir(), "sdar-arm64-source-verify-"));
  try {
    run("unzip", ["-q", archive, "-d", temporary], {
      code: "ARM64_SOURCE_ZIP_EXTRACT_FAILED",
    });
    return await validateArm64SourceStaged(join(temporary, [...roots][0]), options);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function validateRootManifest(manifest, options) {
  if (
    !isRecord(manifest) ||
    manifest.schemaVersion !== SCHEMA_VERSION ||
    !isRecord(manifest.bundle) ||
    !PRODUCT_IDS.includes(manifest.bundle.product)
  )
    throw coded("ARM64_SOURCE_MANIFEST_SCHEMA_INVALID");
  if (options.expectedProduct !== undefined && manifest.bundle.product !== options.expectedProduct)
    throw coded("ARM64_SOURCE_MANIFEST_PRODUCT_MISMATCH");
  if (
    manifest.bundle.deployable !== true ||
    manifest.bundle.deliveryMode !== "source-build-online" ||
    manifest.bundle.targetPlatform !== TARGET_PLATFORM ||
    manifest.bundle.productionQualificationClaimed !== false
  )
    throw coded("ARM64_SOURCE_MANIFEST_BUNDLE_INVALID");
  if (
    !isRecord(manifest.source) ||
    !/^[0-9a-f]{40,64}$/.test(manifest.source.revision) ||
    !isDigest(manifest.source.sha256.replace(/^/, "sha256:"))
  )
    throw coded("ARM64_SOURCE_MANIFEST_SOURCE_INVALID");
  if (
    !isRecord(manifest.deployment) ||
    manifest.deployment.sourceBuildRequired !== true ||
    manifest.deployment.runtimeAuthority !== "direct_container" ||
    manifest.deployment.registryAuthority !== "pms_worker" ||
    manifest.deployment.includedImageCount !== 0 ||
    manifest.deployment.offlineImageCount !== 0 ||
    manifest.deployment.locallyBuiltApplicationImageCount !== 5 ||
    manifest.deployment.pulledInfrastructureImageCount !== 1 ||
    manifest.deployment.targetPlatform !== TARGET_PLATFORM ||
    manifest.deployment.networkRegistryRequiredDuringBuild !== true ||
    manifest.deployment.packageRegistryRequiredDuringBuild !== true
  )
    throw coded("ARM64_SOURCE_MANIFEST_DEPLOYMENT_INVALID");
  if (manifest.imageArchive !== null) throw coded("ARM64_SOURCE_MANIFEST_IMAGE_ARCHIVE_FORBIDDEN");
  if (
    !isRecord(manifest.qualification) ||
    manifest.qualification.productionQualification !== "NOT_CLAIMED" ||
    manifest.qualification.realResourceStatus !== "pending" ||
    manifest.qualification.nativeArm64RuntimeVerified !== false
  )
    throw coded("ARM64_SOURCE_MANIFEST_QUALIFICATION_INVALID");
}

function validateBuildManifest(buildManifest, rootManifest) {
  if (
    !isRecord(buildManifest) ||
    buildManifest.schemaVersion !== BUILD_SCHEMA_VERSION ||
    buildManifest.deliveryMode !== "source-build-online" ||
    buildManifest.platform !== TARGET_PLATFORM ||
    buildManifest.sourceArchive !== rootManifest.source.archive ||
    buildManifest.sourceSha256 !== rootManifest.source.sha256 ||
    buildManifest.sourceRevision !== rootManifest.source.revision ||
    !isRecord(buildManifest.baseImages) ||
    !Array.isArray(buildManifest.targets)
  )
    throw coded("ARM64_SOURCE_BUILD_MANIFEST_IDENTITY_INVALID");
  const expectedBaseTags = {
    node: "docker.io/library/node:22-bookworm-slim",
    postgres: "docker.io/library/postgres:17-alpine",
  };
  for (const role of ["node", "postgres"]) {
    const image = buildManifest.baseImages[role];
    if (
      !isRecord(image) ||
      image.tag !== expectedBaseTags[role] ||
      image.platform !== TARGET_PLATFORM ||
      !isDigest(image.indexDigest) ||
      !isDigest(image.platformManifestDigest) ||
      image.reference !== `${image.tag}@${image.platformManifestDigest}`
    )
      throw coded("ARM64_SOURCE_BUILD_BASE_IMAGE_INVALID", role);
  }
  if (buildManifest.targets.length !== 6) throw coded("ARM64_SOURCE_BUILD_TARGET_COUNT_INVALID");
  const product = productCatalog(rootManifest.bundle.product);
  const expectedTargets = new Set(product.images.map((image) => image.target));
  const applications = buildManifest.targets.filter((record) => record.kind === "application");
  if (applications.length !== 5) throw coded("ARM64_SOURCE_BUILD_APPLICATION_COUNT_INVALID");
  for (const record of applications) {
    if (
      !expectedTargets.has(record.target) ||
      record.revision !== rootManifest.source.revision ||
      record.profileLabel !== "production" ||
      /mock/i.test(record.target) ||
      /mock/i.test(record.reference)
    )
      throw coded("ARM64_SOURCE_BUILD_APPLICATION_INVALID", record.role);
    const expectedProvider = record.role === "pms-web" ? "shared" : product.id;
    if (record.providerLabel !== expectedProvider)
      throw coded("ARM64_SOURCE_BUILD_PROVIDER_INVALID", record.role);
  }
  const postgres = buildManifest.targets.filter(
    (record) => record.kind === "infrastructure" && record.role === "postgres",
  );
  if (postgres.length !== 1 || postgres[0].target !== "-")
    throw coded("ARM64_SOURCE_BUILD_POSTGRES_INVALID");
}

async function validateBuildManifestTsv(path, records) {
  const lines = (await readFile(path, "utf8")).trimEnd().split("\n");
  if (lines.shift() !== "kind\trole\ttarget\treference\trevision\tprovider_label\tprofile_label")
    throw coded("ARM64_SOURCE_BUILD_TSV_HEADER_INVALID");
  const expected = records.map((record) =>
    [
      record.kind,
      record.role,
      record.target,
      record.reference,
      record.revision,
      record.providerLabel,
      record.profileLabel,
    ].join("\t"),
  );
  if (!sameSortedSet(lines, expected)) throw coded("ARM64_SOURCE_BUILD_TSV_MISMATCH");
}

export function arm64RootReadme(product, manifest) {
  const deployPath = `deploy/${product.deployDirectory}`;
  return `# ${product.title} — ARM64 source-build delivery\n\n本包面向原生 Linux ARM64（aarch64）主机，不包含 Docker 镜像，也不会从公共仓库拉取 SDAR 自研应用镜像。它携带提交 \`${manifest.source.revision}\` 的完整可导出源码；首次执行 \`${deployPath}/bin/up.sh\` 时，由 Docker 在部署主机现场构建 5 个应用镜像，并拉取摘要锁定的官方 Node/PostgreSQL 基础镜像。\n\n现场构建需要访问 Docker Hub、npm registry 和 grpc-tools 预编译制品站点，均使用这些公共服务的系统 CA/HTTPS。仅用于仓库审查、且会额外下载 GitHub Release 附件的工具被排除在生产镜像构建之外。此网络仅用于构建期依赖下载；运行期 Device MCP、MQTT、Adapter RPC 和 Provider telemetry 仍采用既定的严格内网明文策略，不要求自签证书或安全网关。\n\n部署主机无需 Git、Node.js 或 pnpm，但必须是原生 ARM64 Linux，并安装 Bash、Docker Engine（启用 BuildKit）、Docker Compose v2、OpenSSL 和 sha256sum。包内基础镜像以 digest 锁定；应用镜像只从本包源码构建，Compose 禁止隐式构建和拉取。\n\nCompose 直接启动 Runtime，PMS 以 \`direct_container\` RuntimeDeployment 接纳并由 Worker 发布 \`pms_worker\` Registry；Worker 不通过 PM2 启动第二个 Runtime。\n\n本包可用于部署，但不声称已完成原生 ARM64 生产资格测试。real-resource status 仍为 \`${manifest.qualification.realResourceStatus}\`，production qualification 为 \`NOT_CLAIMED\`。\n\n运行：\n\n\`\`\`bash\ncd ${deployPath}\ncp .env.example .env\n# 填写真实内网 Device MCP、MQTT 与 advertised Runtime 地址。\nbash bin/init.sh\nbash bin/up.sh\n\`\`\`\n\n首次 \`up.sh\` 会校验全包、确认 Docker daemon 为 linux/arm64、在线拉取锁定基础镜像、现场构建并核验 5 个应用镜像，然后启动 8 个常驻服务、执行幂等 PMS seed 和只读 smoke。后续相同源码可复用 Docker BuildKit 缓存。\n`;
}

async function createSourceArchive(repositoryRoot, source, destinationRoot) {
  const name = `${SOURCE_PREFIX}-${source.revision}.tar.gz`;
  const path = join(destinationRoot, name);
  run(
    "git",
    ["-C", repositoryRoot, "archive", "--format=tar.gz", `--output=${path}`, source.revision],
    { code: "ARM64_SOURCE_ARCHIVE_CREATE_FAILED" },
  );
  const entries = archiveEntries(path);
  assertArchivePathSafety(entries, "ARM64_SOURCE_ARCHIVE_PATH_UNSAFE");
  assertNoRealEnvironmentEntries(entries);
  const files = entries.filter((entry) => !entry.endsWith("/"));
  return Object.freeze({
    name,
    path,
    sha256: await sha256File(path),
    exportedFileCount: files.length,
  });
}

async function materializeCommittedTree(repositoryRoot, revision, destination) {
  const tarPath = join(dirname(destination), "repository.tar");
  run("git", ["-C", repositoryRoot, "archive", "--format=tar", `--output=${tarPath}`, revision], {
    code: "ARM64_SOURCE_CONTEXT_ARCHIVE_FAILED",
  });
  run("tar", ["-xf", tarPath, "-C", destination], {
    code: "ARM64_SOURCE_CONTEXT_EXTRACT_FAILED",
  });
  await rm(tarPath, { force: true });
}

async function writeChecksums(root) {
  const files = (await walkRegularFiles(root)).filter((entry) => entry !== "SHA256SUMS");
  const lines = [];
  for (const entry of files) lines.push(`${await sha256File(join(root, entry))}  ${entry}`);
  await writeFile(join(root, "SHA256SUMS"), `${lines.join("\n")}\n`, "utf8");
}

async function assertChecksums(root) {
  const source = await readFile(join(root, "SHA256SUMS"), "utf8");
  const declared = new Map();
  for (const line of source.trimEnd().split("\n")) {
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (match === null) throw coded("ARM64_SOURCE_CHECKSUM_LINE_INVALID");
    assertArchivePathSafety([match[2]], "ARM64_SOURCE_CHECKSUM_PATH_UNSAFE");
    if (declared.has(match[2])) throw coded("ARM64_SOURCE_CHECKSUM_DUPLICATE", match[2]);
    declared.set(match[2], match[1]);
  }
  const actual = (await walkRegularFiles(root)).filter((entry) => entry !== "SHA256SUMS");
  if (!sameSortedSet([...declared.keys()], actual))
    throw coded("ARM64_SOURCE_CHECKSUM_INVENTORY_MISMATCH");
  for (const [entry, digest] of declared) {
    if ((await sha256File(join(root, entry))) !== digest)
      throw coded("ARM64_SOURCE_CHECKSUM_MISMATCH", entry);
  }
}

function assertNoImagePayload(entries) {
  for (const entry of entries) {
    const normalized = entry.toLowerCase();
    if (
      normalized === "images/images.tar" ||
      normalized === "images/images.tar.gz" ||
      normalized.startsWith("images/") ||
      normalized.includes("/images/images.tar") ||
      normalized.endsWith("/load-images.sh") ||
      normalized === "oci-layout" ||
      normalized.endsWith("/oci-layout") ||
      normalized.startsWith("blobs/sha256/") ||
      normalized.includes("/blobs/sha256/") ||
      (!normalized.startsWith("source/") &&
        !normalized.includes("/source/") &&
        /(?:^|\/)(?:[^/]+\.)?(?:oci|docker|tar|tgz|tar\.gz)$/.test(normalized))
    )
      throw coded("ARM64_SOURCE_IMAGE_PAYLOAD_FORBIDDEN", entry);
  }
}

function scanSourceArchiveSecrets(path) {
  const source = capture("tar", ["-xOzf", path], {
    code: "ARM64_SOURCE_ARCHIVE_SECRET_SCAN_FAILED",
  });
  if (SECRET_PATTERNS.some((pattern) => pattern.test(source)))
    throw coded("ARM64_SOURCE_ARCHIVE_SECRET_MATERIAL_FORBIDDEN");
}

async function scanTextSecrets(root, files) {
  for (const entry of files) {
    if (entry.startsWith("source/") || entry === "SHA256SUMS") continue;
    const metadata = await stat(join(root, entry));
    if (metadata.size > 2 * 1024 * 1024) continue;
    const source = await readFile(join(root, entry), "utf8");
    if (SECRET_PATTERNS.some((pattern) => pattern.test(source)))
      throw coded("ARM64_SOURCE_SECRET_MATERIAL_FORBIDDEN", entry);
  }
}

async function walkRegularFiles(root) {
  const result = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink())
        throw coded("ARM64_SOURCE_SYMLINK_FORBIDDEN", relative(root, path));
      if (metadata.isDirectory()) {
        pending.push(path);
      } else if (metadata.isFile()) {
        result.push(relative(root, path).split(sep).join("/"));
      } else {
        throw coded("ARM64_SOURCE_NON_REGULAR_ENTRY_FORBIDDEN", relative(root, path));
      }
    }
  }
  return result.sort();
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.once("error", rejectPromise);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function canonicalDirectory(path, code) {
  try {
    const canonical = await realpath(path);
    if (!(await stat(canonical)).isDirectory()) throw new Error("not a directory");
    return canonical;
  } catch (error) {
    throw coded(code, path, error);
  }
}

async function requireRegularFile(path, code) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("not regular");
  } catch (error) {
    throw coded(code, path, error);
  }
}

async function requireExecutableRegularFile(path, code) {
  await requireRegularFile(path, code);
  if (((await stat(path)).mode & 0o111) === 0) throw coded(code, path);
}

function assertSafeOutput(repositoryRoot, outputDirectory) {
  if (!isAbsolute(outputDirectory)) throw coded("ARM64_SOURCE_OUTPUT_ABSOLUTE_REQUIRED");
  if (outputDirectory === repositoryRoot || outputDirectory === dirname(repositoryRoot))
    throw coded("ARM64_SOURCE_OUTPUT_SCOPE_TOO_BROAD");
}

async function packageVersion(root) {
  const manifest = await readJson(join(root, "package.json"), "ARM64_SOURCE_PACKAGE_INVALID");
  if (!isRecord(manifest) || typeof manifest.version !== "string")
    throw coded("ARM64_SOURCE_PACKAGE_VERSION_INVALID");
  return manifest.version;
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(path, code) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw coded(code, path, error);
  }
}

function splitArgument(argument) {
  if (!argument.startsWith("--")) throw coded("ARM64_SOURCE_ARGUMENT_INVALID", argument);
  const separator = argument.indexOf("=");
  return separator < 0
    ? [argument, undefined]
    : [argument.slice(0, separator), argument.slice(separator + 1)];
}

function isDigest(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameSortedSet(left, right) {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined || result.status !== 0)
    throw coded(options.code ?? "ARM64_SOURCE_COMMAND_FAILED", options.detail, result.error);
  return result;
}

function capture(command, args, options = {}) {
  return run(command, args, options).stdout;
}

function archiveEntries(path) {
  return capture("tar", ["-tzf", path], { code: "ARM64_SOURCE_ARCHIVE_LIST_FAILED" })
    .split("\n")
    .filter(Boolean);
}

function zipEntries(path) {
  return capture("unzip", ["-Z1", path], { code: "ARM64_SOURCE_ZIP_LIST_FAILED" })
    .split("\n")
    .filter(Boolean);
}

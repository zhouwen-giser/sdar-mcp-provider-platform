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
import { parse as parseYaml } from "yaml";
import {
  BUNDLE_SCHEMA_VERSION,
  DEFAULT_POSTGRES_IMAGE,
  IMAGE_MANIFEST_SCHEMA_VERSION,
  PRODUCT_IDS,
  applicationImageReference,
  bundleImageEnvironment,
  productCatalog,
} from "./catalog.mjs";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "../..");
const TEXT_FILE_LIMIT = 2 * 1024 * 1024;
const PROVIDER_LABEL = "io.sdar.production-bundle.provider";
const PROFILE_LABEL = "io.sdar.production-bundle.profile";
const OFFLINE_IMAGE_OS = "linux";
const OFFLINE_IMAGE_ARCHITECTURE = "amd64";
const OFFLINE_IMAGE_PLATFORM = `${OFFLINE_IMAGE_OS}/${OFFLINE_IMAGE_ARCHITECTURE}`;
const REQUIRED_SOURCE_ARCHIVE_PATHS = Object.freeze([
  "Dockerfile",
  "LICENSE",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".npmrc",
  "apps/runtime/package.json",
  "apps/pms-api/package.json",
  "apps/pms-worker/package.json",
  "apps/pms-web/package.json",
  "apps/ugv-provider-adapter/package.json",
  "apps/npc-tank-provider-adapter/package.json",
  "provider-packages/ugv/provider-package.json",
  "provider-packages/npc-tank/provider-package.json",
  "reports/sbom/runtime-v1.cdx.json",
  "proto/io/sdar/mcp/tasks/adapter/v1/adapter.proto",
  "migrations/migration-source-map.json",
  "deploy/production-bundles/README.md",
  "scripts/production-bundles/build.mjs",
  "scripts/production-bundles/package-product-lib.mjs",
  "scripts/production-bundles/package-ugv.mjs",
  "scripts/production-bundles/package-npc-tank.mjs",
]);
const SECRET_TEXT_PATTERNS = Object.freeze([
  Object.freeze({
    code: "PRIVATE_KEY",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  }),
  Object.freeze({ code: "AWS_ACCESS_KEY", pattern: /\bAKIA[0-9A-Z]{16}\b/ }),
  Object.freeze({ code: "GITHUB_TOKEN", pattern: /\bgh[oprsu]_[A-Za-z0-9]{20,}\b/ }),
  Object.freeze({
    code: "BEARER_TOKEN",
    pattern: /\bBearer\s+(?!replace|example|placeholder)[A-Za-z0-9._~+/=-]{32,}\b/i,
  }),
]);

export class ProductionBundleError extends Error {
  constructor(code, detail = undefined, options = undefined) {
    super(detail === undefined ? code : `${code}:${detail}`, options);
    this.name = "ProductionBundleError";
    this.code = code;
    this.detail = detail;
  }
}

export function coded(code, detail = undefined, cause = undefined) {
  return new ProductionBundleError(code, detail, cause === undefined ? undefined : { cause });
}

export function defaultRepositoryRoot() {
  return DEFAULT_REPOSITORY_ROOT;
}

export function parseBuilderArguments(argv) {
  const options = {
    stageOnly: false,
    products: [...PRODUCT_IDS],
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    outputDirectory: undefined,
    postgresImage: DEFAULT_POSTGRES_IMAGE,
    pullPostgres: true,
    keepStage: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--stage-only") {
      options.stageOnly = true;
      continue;
    }
    if (argument === "--keep-stage") {
      options.keepStage = true;
      continue;
    }
    if (argument === "--no-pull-postgres") {
      options.pullPostgres = false;
      continue;
    }
    const [name, inlineValue] = splitArgument(argument);
    const value = inlineValue ?? argv[++index];
    if (value === undefined || value.startsWith("--"))
      throw coded("PRODUCTION_BUNDLE_ARGUMENT_VALUE_REQUIRED", name);
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
      case "--postgres-image":
        options.postgresImage = value;
        break;
      default:
        throw coded("PRODUCTION_BUNDLE_ARGUMENT_UNKNOWN", name);
    }
  }
  if (new Set(options.products).size !== options.products.length)
    throw coded("PRODUCTION_BUNDLE_PRODUCT_DUPLICATE");
  return Object.freeze(options);
}

export async function buildProductionBundles(input = {}) {
  const repositoryRoot = await canonicalDirectory(
    input.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT,
    "PRODUCTION_BUNDLE_REPOSITORY_ROOT_INVALID",
  );
  const products = (input.products ?? PRODUCT_IDS).map((id) => productCatalog(id));
  const stageOnly = input.stageOnly === true;
  const source = await assertCleanCommittedHead(repositoryRoot);
  const outputDirectory = resolve(
    input.outputDirectory ?? join(repositoryRoot, "reports/production-bundles/delivery"),
  );
  assertSafeOutputDirectory(repositoryRoot, outputDirectory);
  await mkdir(outputDirectory, { recursive: true });

  const workingRoot = await mkdtemp(join(tmpdir(), "sdar-production-bundles-"));
  const commonRoot = join(workingRoot, "common");
  const stageRoot = join(workingRoot, "stage");
  await mkdir(commonRoot, { recursive: true });
  await mkdir(stageRoot, { recursive: true });

  let retainedStage;
  try {
    const sourceArchive = await createSourceArchive(repositoryRoot, source, commonRoot);
    const buildContext = join(workingRoot, "build-context");
    await materializeBuildContext(repositoryRoot, source.revision, buildContext);
    let imageBuild;
    if (stageOnly) {
      imageBuild = stageOnlyImageBuild(source.revision, products);
    } else {
      imageBuild = await buildApplicationImages({
        buildContext,
        revision: source.revision,
        products,
        postgresImage: input.postgresImage ?? DEFAULT_POSTGRES_IMAGE,
        pullPostgres: input.pullPostgres !== false,
      });
    }

    const outputs = [];
    for (const product of products) {
      const result = await stageProductBundle({
        repositoryRoot,
        archivedRepositoryRoot: buildContext,
        product,
        source,
        sourceArchive,
        imageBuild,
        stageRoot,
        outputDirectory,
        stageOnly,
      });
      outputs.push(result);
    }
    if (input.keepStage === true) {
      retainedStage = join(outputDirectory, `stage-${source.revision.slice(0, 12)}`);
      await rm(retainedStage, { recursive: true, force: true });
      await cp(stageRoot, retainedStage, { recursive: true, errorOnExist: true });
    }
    return Object.freeze({ source, stageOnly, outputs: Object.freeze(outputs), retainedStage });
  } finally {
    await rm(workingRoot, { recursive: true, force: true });
  }
}

export async function assertCleanCommittedHead(repositoryRoot) {
  const root = await canonicalDirectory(
    repositoryRoot,
    "PRODUCTION_BUNDLE_REPOSITORY_ROOT_INVALID",
  );
  const topLevel = await canonicalDirectory(
    git(root, ["rev-parse", "--show-toplevel"]).trim(),
    "PRODUCTION_BUNDLE_GIT_TOP_LEVEL_INVALID",
  );
  if (topLevel !== root) throw coded("PRODUCTION_BUNDLE_REPOSITORY_ROOT_MISMATCH");
  const revision = git(root, ["rev-parse", "--verify", "HEAD^{commit}"]).trim();
  if (!/^[0-9a-f]{40,64}$/.test(revision)) throw coded("PRODUCTION_BUNDLE_REVISION_INVALID");
  const status = git(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status.length !== 0) throw coded("PRODUCTION_BUNDLE_SOURCE_TREE_DIRTY");
  const commitTimestamp = git(root, ["show", "-s", "--format=%cI", revision]).trim();
  if (Number.isNaN(Date.parse(commitTimestamp)))
    throw coded("PRODUCTION_BUNDLE_COMMIT_TIMESTAMP_INVALID");
  const branch = git(root, ["branch", "--show-current"]).trim() || "DETACHED";
  const trackedFiles = nulSeparated(git(root, ["ls-tree", "-r", "--name-only", "-z", revision]));
  if (trackedFiles.length === 0) throw coded("PRODUCTION_BUNDLE_SOURCE_TREE_EMPTY");
  if (trackedFiles.includes(".env")) throw coded("PRODUCTION_BUNDLE_TRACKED_REAL_ENV_FORBIDDEN");
  return Object.freeze({ revision, commitTimestamp, branch, trackedFiles });
}

async function createSourceArchive(repositoryRoot, source, destinationRoot) {
  const name = `sdar-mcp-provider-platform-${source.revision}.tar.gz`;
  const path = join(destinationRoot, name);
  run(
    "git",
    [
      "-C",
      repositoryRoot,
      "archive",
      "--format=tar.gz",
      `--prefix=sdar-mcp-provider-platform-${source.revision}/`,
      `--output=${path}`,
      source.revision,
    ],
    { code: "PRODUCTION_BUNDLE_SOURCE_ARCHIVE_FAILED" },
  );
  const entries = archiveEntries(path);
  const files = entries.filter((entry) => !entry.endsWith("/"));
  const prefix = `sdar-mcp-provider-platform-${source.revision}/`;
  const exportedPaths = new Set(files.map((entry) => entry.slice(prefix.length)));
  for (const required of REQUIRED_SOURCE_ARCHIVE_PATHS) {
    if (!exportedPaths.has(required))
      throw coded("PRODUCTION_BUNDLE_SOURCE_ARCHIVE_REQUIRED_PATH_MISSING", required);
  }
  for (const requiredDirectory of [
    "apps/",
    "packages/",
    "proto/",
    "migrations/",
    "deploy/",
    "scripts/",
  ]) {
    if (![...exportedPaths].some((entry) => entry.startsWith(requiredDirectory)))
      throw coded("PRODUCTION_BUNDLE_SOURCE_ARCHIVE_REQUIRED_DIRECTORY_MISSING", requiredDirectory);
  }
  assertArchivePathSafety(entries, "PRODUCTION_BUNDLE_SOURCE_ARCHIVE_PATH_UNSAFE");
  assertNoRealEnvironmentEntries(entries);
  return Object.freeze({
    name,
    path,
    sha256: await sha256File(path),
    exportedFileCount: files.length,
  });
}

async function materializeBuildContext(repositoryRoot, revision, destination) {
  await mkdir(destination, { recursive: true });
  const tarPath = join(dirname(destination), "build-context.tar");
  run("git", ["-C", repositoryRoot, "archive", "--format=tar", `--output=${tarPath}`, revision], {
    code: "PRODUCTION_BUNDLE_BUILD_CONTEXT_ARCHIVE_FAILED",
  });
  run("tar", ["-xf", tarPath, "-C", destination], {
    code: "PRODUCTION_BUNDLE_BUILD_CONTEXT_EXTRACT_FAILED",
  });
  await rm(tarPath, { force: true });
}

async function buildApplicationImages({
  buildContext,
  revision,
  products,
  postgresImage,
  pullPostgres,
}) {
  const unique = new Map();
  for (const product of products) {
    for (const image of product.images) {
      const reference = applicationImageReference(image, revision);
      unique.set(reference, {
        ...image,
        reference,
        providerLabel: image.role === "pms-web" ? "shared" : product.id,
        profileLabel: "production",
      });
    }
  }
  for (const image of unique.values()) {
    run(
      "docker",
      [
        "build",
        "--platform",
        OFFLINE_IMAGE_PLATFORM,
        "--file",
        join(buildContext, "Dockerfile"),
        "--target",
        image.target,
        "--build-arg",
        `VCS_REF=${revision}`,
        "--build-arg",
        "VITE_PMS_DATA_MODE=api",
        "--tag",
        image.reference,
        buildContext,
      ],
      { code: "PRODUCTION_BUNDLE_IMAGE_BUILD_FAILED", detail: image.target, inherit: true },
    );
  }
  const application = new Map();
  for (const image of unique.values()) {
    const inspected = inspectDockerImage(image.reference);
    validateApplicationImage(inspected, image, revision);
    application.set(
      image.reference,
      Object.freeze({
        kind: "application",
        role: image.role,
        target: image.target,
        reference: image.reference,
        id: inspected.Id,
        revision,
        user: inspected.Config?.User,
        healthcheck: true,
        os: inspected.Os,
        architecture: inspected.Architecture,
        providerLabel: image.providerLabel,
        profileLabel: image.profileLabel,
      }),
    );
  }

  if (pullPostgres) {
    run("docker", ["image", "pull", "--platform", OFFLINE_IMAGE_PLATFORM, postgresImage], {
      code: "PRODUCTION_BUNDLE_POSTGRES_PULL_FAILED",
      detail: postgresImage,
      inherit: true,
    });
  }
  const upstream = inspectDockerImage(postgresImage);
  assertOfflineImagePlatform(upstream, postgresImage);
  const upstreamDigest = selectPostgresDigest(upstream, postgresImage);
  const digest = upstreamDigest.slice(upstreamDigest.indexOf("@") + 1);
  if (!/^sha256:[0-9a-f]{64}$/.test(digest))
    throw coded("PRODUCTION_BUNDLE_POSTGRES_DIGEST_INVALID");
  const digest12 = digest.slice("sha256:".length, "sha256:".length + 12);
  const reference = `sdar/production-postgres:17-alpine-${digest12}`;
  run("docker", ["image", "tag", postgresImage, reference], {
    code: "PRODUCTION_BUNDLE_POSTGRES_TAG_FAILED",
  });
  const tagged = inspectDockerImage(reference);
  if (tagged.Id !== upstream.Id) throw coded("PRODUCTION_BUNDLE_POSTGRES_IMAGE_ID_MISMATCH");
  assertOfflineImagePlatform(tagged, reference);
  const postgres = Object.freeze({
    kind: "infrastructure",
    role: "postgres",
    target: null,
    reference,
    id: tagged.Id,
    digest,
    digest12,
    upstreamReference: upstreamDigest,
    user: tagged.Config?.User ?? "",
    healthcheck: tagged.Config?.Healthcheck !== null && tagged.Config?.Healthcheck !== undefined,
    os: tagged.Os,
    architecture: tagged.Architecture,
  });
  return Object.freeze({ deployable: true, application, postgres });
}

function stageOnlyImageBuild(revision, products) {
  const application = new Map();
  for (const product of products) {
    for (const image of product.images) {
      const reference = applicationImageReference(image, revision);
      application.set(
        reference,
        Object.freeze({
          kind: "application",
          role: image.role,
          target: image.target,
          reference,
          id: "STAGE_ONLY_NOT_BUILT",
          revision,
          user: "node",
          healthcheck: true,
          os: OFFLINE_IMAGE_OS,
          architecture: OFFLINE_IMAGE_ARCHITECTURE,
          providerLabel: image.role === "pms-web" ? "shared" : product.id,
          profileLabel: "production",
        }),
      );
    }
  }
  return Object.freeze({
    deployable: false,
    application,
    postgres: Object.freeze({
      kind: "infrastructure",
      role: "postgres",
      target: null,
      reference: "sdar/production-postgres:stage-only",
      id: "STAGE_ONLY_NOT_BUILT",
      digest: "STAGE_ONLY_NOT_BUILT",
      digest12: "STAGE_ONLY",
      upstreamReference: "STAGE_ONLY_NOT_BUILT",
      user: "postgres",
      healthcheck: false,
      os: OFFLINE_IMAGE_OS,
      architecture: OFFLINE_IMAGE_ARCHITECTURE,
    }),
  });
}

async function stageProductBundle({
  archivedRepositoryRoot,
  product,
  source,
  sourceArchive,
  imageBuild,
  stageRoot,
  outputDirectory,
  stageOnly,
}) {
  const bundleRoot = join(stageRoot, product.bundleRootName);
  await rm(bundleRoot, { recursive: true, force: true });
  await mkdir(join(bundleRoot, "deploy"), { recursive: true });
  await mkdir(join(bundleRoot, "images"), { recursive: true });
  await mkdir(join(bundleRoot, "source"), { recursive: true });

  const deploySource = join(
    archivedRepositoryRoot,
    "deploy/production-bundles",
    product.deployDirectory,
  );
  await requireDirectory(deploySource, "PRODUCTION_BUNDLE_DEPLOY_SOURCE_MISSING");
  const deployDestination = join(bundleRoot, "deploy", product.deployDirectory);
  await cp(deploySource, deployDestination, {
    recursive: true,
    errorOnExist: true,
    preserveTimestamps: false,
  });

  const imageRecords = product.images.map((image) => {
    const reference = applicationImageReference(image, source.revision);
    const record = imageBuild.application.get(reference);
    if (record === undefined) throw coded("PRODUCTION_BUNDLE_BUILT_IMAGE_MISSING", reference);
    return record;
  });
  const postgres = imageBuild.postgres;
  const imageEnvironment = bundleImageEnvironment(source.revision, postgres, !stageOnly);
  const imageEnvironmentPath = join(deployDestination, ".bundle-images.env");
  await writeFile(imageEnvironmentPath, imageEnvironment, { encoding: "utf8", mode: 0o444 });
  await chmod(imageEnvironmentPath, 0o444);

  const imageArchivePath = join(bundleRoot, "images/images.tar.gz");
  if (stageOnly) await createStageOnlyImageArchive(imageArchivePath, product, source.revision);
  else
    exportDockerImages(
      [...imageRecords.map((record) => record.reference), postgres.reference],
      imageArchivePath,
    );
  const imageArchive = Object.freeze({
    path: "images/images.tar.gz",
    sha256: await sha256File(imageArchivePath),
    stageOnly,
  });
  const images = Object.freeze([...imageRecords, postgres]);
  const imageManifest = Object.freeze({
    schemaVersion: IMAGE_MANIFEST_SCHEMA_VERSION,
    product: product.id,
    deployable: !stageOnly,
    sourceRevision: source.revision,
    archive: imageArchive,
    images,
  });
  await writeJson(join(bundleRoot, "images/manifest.json"), imageManifest);
  await writeImageManifestTsv(join(bundleRoot, "images/manifest.tsv"), images);
  const loaderPath = join(deployDestination, "bin/load-images.sh");
  await mkdir(dirname(loaderPath), { recursive: true });
  await writeFile(loaderPath, imageLoaderScript(), { encoding: "utf8", mode: 0o555 });
  await chmod(loaderPath, 0o555);

  const sourceDestination = join(bundleRoot, "source", sourceArchive.name);
  await copyFile(sourceArchive.path, sourceDestination);
  await mkdir(join(bundleRoot, "licenses"), { recursive: true });
  await mkdir(join(bundleRoot, "sbom"), { recursive: true });
  await copyFile(join(archivedRepositoryRoot, "LICENSE"), join(bundleRoot, "licenses/LICENSE"));
  await copyFile(
    join(archivedRepositoryRoot, "reports/sbom/runtime-v1.cdx.json"),
    join(bundleRoot, "sbom/runtime-v1.cdx.json"),
  );
  const packageVersion = await packageVersionFromArchiveRoot(archivedRepositoryRoot);
  const version = `${packageVersion}-${product.id}.${source.revision.slice(0, 12)}`;
  await writeFile(join(bundleRoot, "VERSION"), `${version}\n`, "utf8");
  await writeFile(join(bundleRoot, "DEPLOYABLE"), stageOnly ? "false\n" : "true\n", "utf8");

  const composePath = join(deployDestination, "compose.yaml");
  await requireRegularFile(composePath, "PRODUCTION_BUNDLE_COMPOSE_MISSING");
  const compose = await readFile(composePath, "utf8");
  const composeInventory = validateComposeDocument({
    source: compose,
    product,
    revision: source.revision,
    postgres,
  });
  const manifest = Object.freeze({
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    bundle: Object.freeze({
      name: product.bundleRootName,
      title: product.title,
      product: product.id,
      version,
      deployable: !stageOnly,
      generatedFromCommittedHead: true,
      productionQualificationClaimed: false,
      targetPlatform: OFFLINE_IMAGE_PLATFORM,
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
      applicationImageCount: imageRecords.length,
      offlineImageCount: images.length,
      targetPlatform: OFFLINE_IMAGE_PLATFORM,
      hostRequirements: ["bash", "Docker Engine", "Docker Compose v2", "openssl", "sha256sum"],
      sourceBuildRequired: false,
      gitRequiredOnDeploymentHost: false,
      nodeRequiredOnDeploymentHost: false,
      networkRegistryRequired: false,
    }),
    compliance: Object.freeze({
      license: "licenses/LICENSE",
      sbom: "sbom/runtime-v1.cdx.json",
      sbomScope: "application Runtime scope declared by the supplied CycloneDX document",
      completeImageSbomClaimed: false,
    }),
    imageArchive,
    images,
  });
  await writeJson(join(bundleRoot, "manifest.json"), manifest);
  await writeBundleReadme(bundleRoot, product, manifest);
  await writeChecksums(bundleRoot);
  await validateStagedBundle(bundleRoot, {
    expectedProduct: product.id,
    expectedDeployable: !stageOnly,
  });

  const archiveName = stageOnly ? product.stageOnlyArchiveName : product.archiveName;
  const archivePath = join(outputDirectory, archiveName);
  await rm(archivePath, { force: true });
  run("zip", ["-X", "-q", "-r", archivePath, product.bundleRootName], {
    cwd: stageRoot,
    code: "PRODUCTION_BUNDLE_ZIP_FAILED",
    detail: product.id,
  });
  const zipSha256 = await sha256File(archivePath);
  const sidecarPath = `${archivePath}.sha256`;
  await writeFile(sidecarPath, `${zipSha256}  ${basename(archivePath)}\n`, "utf8");
  await validateBundleZip(archivePath, {
    expectedProduct: product.id,
    expectedDeployable: !stageOnly,
  });
  return Object.freeze({
    product: product.id,
    archivePath,
    sha256: zipSha256,
    sidecarPath,
    deployable: !stageOnly,
  });
}

export async function validateStagedBundle(bundleRoot, options = {}) {
  const root = await canonicalDirectory(bundleRoot, "PRODUCTION_BUNDLE_STAGE_ROOT_INVALID");
  const manifestPath = join(root, "manifest.json");
  const manifest = await readJson(manifestPath, "PRODUCTION_BUNDLE_MANIFEST_INVALID");
  validateRootManifest(manifest, options);
  const deployableText = (await readFile(join(root, "DEPLOYABLE"), "utf8")).trim();
  if (deployableText !== String(manifest.bundle.deployable))
    throw coded("PRODUCTION_BUNDLE_DEPLOYABLE_MARKER_MISMATCH");
  const imageManifest = await readJson(
    join(root, "images/manifest.json"),
    "PRODUCTION_BUNDLE_IMAGE_MANIFEST_INVALID",
  );
  validateImageManifest(imageManifest, manifest);
  await validateImageManifestTsv(join(root, "images/manifest.tsv"), imageManifest.images);
  if ((await sha256File(join(root, imageManifest.archive.path))) !== imageManifest.archive.sha256)
    throw coded("PRODUCTION_BUNDLE_IMAGE_ARCHIVE_HASH_MISMATCH");
  const sourceArchive = join(root, manifest.source.archive);
  if ((await sha256File(sourceArchive)) !== manifest.source.sha256)
    throw coded("PRODUCTION_BUNDLE_SOURCE_ARCHIVE_HASH_MISMATCH");
  const sourceEntries = archiveEntries(sourceArchive);
  assertArchivePathSafety(sourceEntries, "PRODUCTION_BUNDLE_SOURCE_ARCHIVE_PATH_UNSAFE");
  assertNoRealEnvironmentEntries(sourceEntries);
  const sourceFiles = sourceEntries.filter((entry) => !entry.endsWith("/"));
  if (sourceFiles.length !== manifest.source.exportedFileCount)
    throw coded("PRODUCTION_BUNDLE_SOURCE_ARCHIVE_FILE_COUNT_MISMATCH");

  const deployRoot = join(root, manifest.deployment.directory);
  const composePath = join(root, manifest.deployment.compose);
  const product = productCatalog(manifest.bundle.product);
  const postgres = manifest.images.find((image) => image.role === "postgres");
  validateComposeDocument({
    source: await readFile(composePath, "utf8"),
    product,
    revision: manifest.source.revision,
    postgres,
  });
  await validateAnonymousIntranetLifecycle(deployRoot, product);
  assertComposeRunOptionCompatibility(
    await readFile(join(deployRoot, "bin/up.sh"), "utf8"),
    "PRODUCTION_BUNDLE_COMPOSE_RUN_OPTION_UNSUPPORTED",
  );
  await assertNoForbiddenBundlePaths(root);
  await assertNoSecretMaterial(root);
  await assertChecksums(root);
  await requireDirectory(deployRoot, "PRODUCTION_BUNDLE_DEPLOY_DIRECTORY_MISSING");
  return manifest;
}

export async function validateBundleZip(zipPath, options = {}) {
  await requireRegularFile(zipPath, "PRODUCTION_BUNDLE_ZIP_MISSING");
  const entries = zipEntries(zipPath);
  assertArchivePathSafety(entries, "PRODUCTION_BUNDLE_ZIP_PATH_UNSAFE");
  if (entries.length === 0) throw coded("PRODUCTION_BUNDLE_ZIP_EMPTY");
  const roots = new Set(entries.map((entry) => entry.split("/")[0]).filter(Boolean));
  if (roots.size !== 1) throw coded("PRODUCTION_BUNDLE_ZIP_ROOT_COUNT_INVALID");
  const temporary = await mkdtemp(join(tmpdir(), "sdar-production-bundle-verify-"));
  try {
    run("unzip", ["-q", zipPath, "-d", temporary], {
      code: "PRODUCTION_BUNDLE_ZIP_EXTRACT_FAILED",
    });
    const root = join(temporary, [...roots][0]);
    return await validateStagedBundle(root, options);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export function validateComposeDocument({ source, product, revision, postgres }) {
  let document;
  try {
    document = parseYaml(source, { merge: true });
  } catch (error) {
    throw coded("PRODUCTION_BUNDLE_COMPOSE_YAML_INVALID", undefined, error);
  }
  if (!isRecord(document) || !isRecord(document.services))
    throw coded("PRODUCTION_BUNDLE_COMPOSE_SERVICES_INVALID");
  assertNoBuildFields(document);
  validateAnonymousIntranetCompose(document.services, product);
  const expectedApplicationImages = new Set(
    product.images.map((image) => applicationImageReference(image, revision)),
  );
  const observedApplicationImages = new Map(
    [...expectedApplicationImages].map((reference) => [reference, 0]),
  );
  let postgresServices = 0;
  const services = Object.keys(document.services).sort();
  const persistentServices = [];
  const seedServices = [];
  for (const [serviceName, service] of Object.entries(document.services)) {
    if (!isRecord(service) || typeof service.image !== "string")
      throw coded("PRODUCTION_BUNDLE_COMPOSE_SERVICE_IMAGE_REQUIRED", serviceName);
    if (service.pull_policy !== "never")
      throw coded("PRODUCTION_BUNDLE_COMPOSE_PULL_POLICY_INVALID", serviceName);
    if (/mock/i.test(serviceName) || /mock/i.test(service.image))
      throw coded("PRODUCTION_BUNDLE_MOCK_RUNTIME_FORBIDDEN", serviceName);
    for (const executableField of ["command", "entrypoint"]) {
      if (
        service[executableField] !== undefined &&
        /mock/i.test(JSON.stringify(service[executableField]))
      )
        throw coded(
          "PRODUCTION_BUNDLE_MOCK_RUNTIME_FORBIDDEN",
          `${serviceName}:${executableField}`,
        );
    }
    const profiles = service.profiles;
    if (profiles === undefined) persistentServices.push(serviceName);
    else {
      if (!Array.isArray(profiles) || profiles.length !== 1 || profiles[0] !== "seed")
        throw coded("PRODUCTION_BUNDLE_COMPOSE_PROFILE_INVALID", serviceName);
      seedServices.push(serviceName);
    }
    const resolvedImage = resolveBundleImageExpression(service.image, {
      BUNDLE_REVISION: revision,
      POSTGRES_IMAGE: postgres.reference,
      POSTGRES_DIGEST: postgres.digest,
      POSTGRES_DIGEST12: postgres.digest12,
      BUNDLE_DEPLOYABLE: "true",
    });
    if (resolvedImage === postgres.reference) {
      postgresServices += 1;
      continue;
    }
    if (!expectedApplicationImages.has(resolvedImage))
      throw coded(
        "PRODUCTION_BUNDLE_COMPOSE_IMAGE_NOT_IN_MANIFEST",
        `${serviceName}:${resolvedImage}`,
      );
    observedApplicationImages.set(
      resolvedImage,
      (observedApplicationImages.get(resolvedImage) ?? 0) + 1,
    );
  }
  if (postgresServices < 1) throw coded("PRODUCTION_BUNDLE_POSTGRES_SERVICE_MISSING");
  if (persistentServices.length !== 8)
    throw coded(
      "PRODUCTION_BUNDLE_PERSISTENT_SERVICE_INVENTORY_INVALID",
      String(persistentServices.length),
    );
  if (seedServices.length !== 1)
    throw coded("PRODUCTION_BUNDLE_SEED_SERVICE_INVENTORY_INVALID", String(seedServices.length));
  for (const [image, count] of observedApplicationImages) {
    if (count < 1) throw coded("PRODUCTION_BUNDLE_COMPOSE_APPLICATION_IMAGE_MISSING", image);
  }
  return Object.freeze({
    services: Object.freeze(services),
    persistentServices: Object.freeze(persistentServices.sort()),
    seedServices: Object.freeze(seedServices.sort()),
    postgresServices,
  });
}

export function validateAnonymousIntranetCompose(services, product) {
  const pmsApi = requiredComposeService(services, "pms-api");
  const pmsApiEnvironment = requiredComposeEnvironment(pmsApi, "pms-api");
  if (pmsApiEnvironment.PMS_API_MANAGEMENT_AUTH_MODE !== "anonymous_intranet")
    throw coded("PRODUCTION_BUNDLE_PMS_API_AUTH_MODE_INVALID");
  assertExplicitInsecureOptIn(pmsApiEnvironment, "pms-api");
  if (pmsApiEnvironment.PMS_MANAGEMENT_CREDENTIAL_FILE !== undefined)
    throw coded("PRODUCTION_BUNDLE_PMS_MANAGEMENT_CREDENTIAL_FORBIDDEN");
  if (pmsApi.ports !== undefined) throw coded("PRODUCTION_BUNDLE_PMS_API_HOST_PORT_FORBIDDEN");

  const pmsWeb = requiredComposeService(services, "pms-web");
  const pmsWebEnvironment = requiredComposeEnvironment(pmsWeb, "pms-web");
  if (
    pmsWebEnvironment.PMS_WEB_DATA_MODE !== "api" ||
    pmsWebEnvironment.PMS_WEB_API_UPSTREAM !== "http://pms-api:8090" ||
    pmsWebEnvironment.PMS_WEB_RAW_API_PROXY_ENABLED !== "true"
  )
    throw coded("PRODUCTION_BUNDLE_PMS_WEB_RAW_PROXY_INVALID");
  if (
    !Array.isArray(pmsWeb.ports) ||
    pmsWeb.ports.length !== 1 ||
    typeof pmsWeb.ports[0] !== "string" ||
    !pmsWeb.ports[0].endsWith(":8080")
  )
    throw coded("PRODUCTION_BUNDLE_PMS_WEB_HOST_PORT_INVALID");

  const pmsWorker = requiredComposeService(services, "pms-worker");
  const pmsWorkerEnvironment = requiredComposeEnvironment(pmsWorker, "pms-worker");
  assertExplicitInsecureOptIn(pmsWorkerEnvironment, "pms-worker");
  if (pmsWorkerEnvironment.PMS_EXTERNAL_RUNTIME_CATALOG_AUTH_MODE !== "anonymous_intranet")
    throw coded("PRODUCTION_BUNDLE_PMS_WORKER_CATALOG_AUTH_MODE_INVALID");
  if (pmsWorkerEnvironment.PMS_EXTERNAL_RUNTIME_CATALOG_CREDENTIAL_FILE !== undefined)
    throw coded("PRODUCTION_BUNDLE_PMS_WORKER_CATALOG_CREDENTIAL_FORBIDDEN");

  const runtimeServiceName = product.id === "ugv" ? "ugv-runtime" : "npc-tank-runtime";
  const runtime = requiredComposeService(services, runtimeServiceName);
  const runtimeEnvironment = requiredComposeEnvironment(runtime, runtimeServiceName);
  if (
    runtimeEnvironment.RUNTIME_ENV !== "production" ||
    runtimeEnvironment.AUTH_MODE !== "anonymous"
  )
    throw coded("PRODUCTION_BUNDLE_RUNTIME_AUTH_MODE_INVALID", runtimeServiceName);
  assertExplicitInsecureOptIn(runtimeEnvironment, runtimeServiceName);
  const otlpPrefix = product.id === "ugv" ? "UGV" : "NPC_TANK";
  const otlpInstanceId =
    product.id === "ugv" ? "production-ugv-direct-1" : "production-npc-tank-direct-1";
  if (
    runtimeEnvironment.OTEL_ENABLED !== `\${${otlpPrefix}_OTEL_ENABLED:-false}` ||
    runtimeEnvironment.OTEL_EXPORTER_OTLP_ENDPOINT !==
      `\${${otlpPrefix}_OTEL_EXPORTER_OTLP_ENDPOINT:-http://127.0.0.1:4318}` ||
    runtimeEnvironment.OTEL_EXPORTER_OTLP_TIMEOUT_MS !==
      `\${${otlpPrefix}_OTEL_EXPORTER_OTLP_TIMEOUT_MS:-10000}` ||
    runtimeEnvironment.OTEL_EXPORTER_OTLP_TLS_MODE !== "disabled" ||
    runtimeEnvironment.OTEL_SERVICE_INSTANCE_ID !== otlpInstanceId
  )
    throw coded("PRODUCTION_BUNDLE_OTLP_CONFIGURATION_INVALID", runtimeServiceName);

  const forbiddenEnvironmentKeys = [
    "PMS_MANAGEMENT_CREDENTIAL_FILE",
    "PMS_EXTERNAL_RUNTIME_CATALOG_CREDENTIAL_FILE",
    "JWT_HS256_SECRET",
    "JWT_ISSUER",
    "JWT_AUDIENCE",
    "OTEL_EXPORTER_OTLP_CA_PATH",
    "OTEL_EXPORTER_OTLP_CERT_PATH",
    "OTEL_EXPORTER_OTLP_KEY_PATH",
    "OTEL_EXPORTER_OTLP_HEADERS_FILE",
  ];
  for (const [serviceName, serviceValue] of Object.entries(services)) {
    const service = requiredComposeService(services, serviceName);
    const environment = service.environment;
    if (environment !== undefined && !isRecord(environment))
      throw coded("PRODUCTION_BUNDLE_COMPOSE_ENVIRONMENT_INVALID", serviceName);
    for (const key of forbiddenEnvironmentKeys) {
      if (isRecord(environment) && environment[key] !== undefined)
        throw coded("PRODUCTION_BUNDLE_EXTERNAL_CREDENTIAL_FORBIDDEN", `${serviceName}:${key}`);
    }
    if (
      /management-(?:admin|reader)\.(?:json|token)|runtime[-_]jwt|external-runtime-catalog/i.test(
        JSON.stringify(serviceValue),
      )
    )
      throw coded("PRODUCTION_BUNDLE_EXTERNAL_CREDENTIAL_MOUNT_FORBIDDEN", serviceName);
  }
}

export async function validateAnonymousIntranetLifecycle(deployRoot, product) {
  const runtimeSmokeName = product.id === "ugv" ? "runtime-smoke.mjs" : "runtime-read-smoke.mjs";
  const files = ["pms-seed.mjs", "pms-web-smoke.mjs", runtimeSmokeName];
  const sourceId = product.id === "ugv" ? "ugv-smpp" : "npc-tank-smpp";
  for (const file of files) {
    const source = await readFile(join(deployRoot, "bin", file), "utf8");
    if (/\bauthorization\b/i.test(source))
      throw coded("PRODUCTION_BUNDLE_EXTERNAL_AUTHORIZATION_FORBIDDEN", file);
    if (/management-(?:admin|reader)\.token|runtime[-_]jwt|external-runtime-catalog/i.test(source))
      throw coded("PRODUCTION_BUNDLE_EXTERNAL_CREDENTIAL_REFERENCE_FORBIDDEN", file);
    if (file === "pms-web-smoke.mjs" && !source.includes(`/sources/${sourceId}/latest`))
      throw coded("PRODUCTION_BUNDLE_SDAR_PROJECTION_SMOKE_MISSING", product.id);
  }
  await validateOtlpBundleConfiguration(deployRoot, product);
}

export async function validateOtlpBundleConfiguration(deployRoot, product) {
  const prefix = product.id === "ugv" ? "UGV" : "NPC_TANK";
  const environmentExample = await readFile(join(deployRoot, ".env.example"), "utf8");
  for (const expected of [
    `${prefix}_OTEL_ENABLED=false`,
    `${prefix}_OTEL_EXPORTER_OTLP_ENDPOINT=http://REPLACE_WITH_OTLP_COLLECTOR_HOST:4318`,
    `${prefix}_OTEL_EXPORTER_OTLP_TIMEOUT_MS=10000`,
  ]) {
    if (!environmentExample.split(/\r?\n/u).includes(expected))
      throw coded("PRODUCTION_BUNDLE_OTLP_ENV_EXAMPLE_INVALID", expected);
  }
  if (
    new RegExp(`^${prefix}_OTEL_SERVICE_INSTANCE_ID=`, "mu").test(environmentExample) ||
    /OTEL_EXPORTER_OTLP_(?:CA|CERT|KEY|HEADERS)(?:_PATH|_FILE)?=/u.test(environmentExample)
  )
    throw coded("PRODUCTION_BUNDLE_OTLP_ENV_SECURITY_PROFILE_INVALID", product.id);

  const common = await readFile(join(deployRoot, "bin/common.sh"), "utf8");
  if (
    !common.includes(`${prefix}_OTEL_ENABLED`) ||
    !common.includes(`${prefix}_OTEL_EXPORTER_OTLP_ENDPOINT`) ||
    !common.includes(`${prefix}_OTEL_EXPORTER_OTLP_TIMEOUT_MS`) ||
    !common.includes("must be a base URL without an OTLP signal path")
  )
    throw coded("PRODUCTION_BUNDLE_OTLP_LIFECYCLE_VALIDATION_MISSING", product.id);

  const readme = await readFile(join(deployRoot, "README.md"), "utf8");
  if (
    !readme.includes("OTLP/HTTP") ||
    !readme.includes("/v1/traces") ||
    !readme.includes("/v1/logs") ||
    !readme.includes("/v1/metrics") ||
    !readme.includes("up.sh")
  )
    throw coded("PRODUCTION_BUNDLE_OTLP_DOCUMENTATION_MISSING", product.id);
}

function requiredComposeService(services, name) {
  const service = services[name];
  if (!isRecord(service)) throw coded("PRODUCTION_BUNDLE_COMPOSE_SERVICE_REQUIRED", name);
  return service;
}

function requiredComposeEnvironment(service, name) {
  if (!isRecord(service.environment))
    throw coded("PRODUCTION_BUNDLE_COMPOSE_ENVIRONMENT_INVALID", name);
  return service.environment;
}

function assertExplicitInsecureOptIn(environment, serviceName) {
  const value = environment.ALLOW_INSECURE_INTERNAL_TRANSPORT;
  if (typeof value !== "string" || !value.startsWith("${ALLOW_INSECURE_INTERNAL_TRANSPORT:?"))
    throw coded("PRODUCTION_BUNDLE_INSECURE_OPT_IN_INVALID", serviceName);
}

export function assertNoBuildFields(value, path = "") {
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) assertNoBuildFields(child, `${path}/${index}`);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}/${key}`;
    if (key === "build") throw coded("PRODUCTION_BUNDLE_COMPOSE_BUILD_FIELD_FORBIDDEN", childPath);
    assertNoBuildFields(child, childPath);
  }
}

export function assertComposeRunOptionCompatibility(source, code) {
  const logicalCommands = source.replace(/\\\r?\n\s*/g, " ");
  if (
    /^\s*(?:(?:docker\s+)?compose|npc_compose)\b[^\n]*\brun\b[^\n]*--(?:pull|no-build)\b/m.test(
      logicalCommands,
    )
  )
    throw coded(code);
}

export function assertArchivePathSafety(entries, code) {
  for (const entry of entries) {
    const normalized = entry.replaceAll("\\", "/");
    if (
      normalized.length === 0 ||
      normalized.startsWith("/") ||
      /^[A-Za-z]:\//.test(normalized) ||
      normalized.split("/").includes("..")
    )
      throw coded(code, entry);
  }
}

export function assertNoRealEnvironmentEntries(entries) {
  for (const entry of entries) {
    const parts = entry.replace(/\/$/, "").split("/");
    if (parts.includes(".git")) throw coded("PRODUCTION_BUNDLE_GIT_METADATA_FORBIDDEN", entry);
    if (parts.at(-1) === ".env") throw coded("PRODUCTION_BUNDLE_REAL_ENV_FORBIDDEN", entry);
  }
}

async function assertNoForbiddenBundlePaths(root) {
  const entries = await walkRegularFiles(root);
  for (const entry of entries) {
    const parts = entry.split("/");
    const name = parts.at(-1) ?? "";
    if (parts.includes(".git")) throw coded("PRODUCTION_BUNDLE_GIT_METADATA_FORBIDDEN", entry);
    if (name === ".env") throw coded("PRODUCTION_BUNDLE_REAL_ENV_FORBIDDEN", entry);
    if (
      !name.endsWith(".example") &&
      (/\.(?:pem|key|p12|pfx)$/i.test(name) || /(?:^|[-_.])id_rsa$/i.test(name))
    )
      throw coded("PRODUCTION_BUNDLE_PRIVATE_KEY_PATH_FORBIDDEN", entry);
    if (/mock/i.test(entry) && !entry.startsWith("source/"))
      throw coded("PRODUCTION_BUNDLE_MOCK_PATH_FORBIDDEN", entry);
  }
}

async function assertNoSecretMaterial(root) {
  const entries = await walkRegularFiles(root);
  for (const entry of entries) {
    if (entry.startsWith("source/") || entry === "images/images.tar.gz") continue;
    const path = join(root, entry);
    const metadata = await stat(path);
    if (metadata.size > TEXT_FILE_LIMIT) continue;
    const value = await readFile(path);
    if (value.includes(0)) continue;
    const source = value.toString("utf8");
    for (const candidate of SECRET_TEXT_PATTERNS) {
      if (candidate.pattern.test(source))
        throw coded("PRODUCTION_BUNDLE_SECRET_MATERIAL_FORBIDDEN", `${entry}:${candidate.code}`);
    }
  }
}

function validateRootManifest(manifest, options) {
  if (!isRecord(manifest) || manifest.schemaVersion !== BUNDLE_SCHEMA_VERSION)
    throw coded("PRODUCTION_BUNDLE_MANIFEST_SCHEMA_INVALID");
  if (!isRecord(manifest.bundle) || !PRODUCT_IDS.includes(manifest.bundle.product))
    throw coded("PRODUCTION_BUNDLE_MANIFEST_PRODUCT_INVALID");
  if (options.expectedProduct !== undefined && manifest.bundle.product !== options.expectedProduct)
    throw coded("PRODUCTION_BUNDLE_MANIFEST_PRODUCT_MISMATCH");
  if (typeof manifest.bundle.deployable !== "boolean")
    throw coded("PRODUCTION_BUNDLE_MANIFEST_DEPLOYABLE_INVALID");
  if (
    options.expectedDeployable !== undefined &&
    manifest.bundle.deployable !== options.expectedDeployable
  )
    throw coded("PRODUCTION_BUNDLE_MANIFEST_DEPLOYABLE_MISMATCH");
  if (manifest.bundle.productionQualificationClaimed !== false)
    throw coded("PRODUCTION_BUNDLE_QUALIFICATION_OVERCLAIM");
  if (
    manifest.bundle.targetPlatform !== OFFLINE_IMAGE_PLATFORM ||
    manifest.deployment?.targetPlatform !== OFFLINE_IMAGE_PLATFORM
  )
    throw coded("PRODUCTION_BUNDLE_MANIFEST_PLATFORM_INVALID");
  if (!isRecord(manifest.source) || !/^[0-9a-f]{40,64}$/.test(manifest.source.revision))
    throw coded("PRODUCTION_BUNDLE_MANIFEST_SOURCE_INVALID");
  if (!Array.isArray(manifest.images) || manifest.images.length !== 6)
    throw coded("PRODUCTION_BUNDLE_MANIFEST_IMAGE_COUNT_INVALID");
  if (!isRecord(manifest.deployment) || manifest.deployment.sourceBuildRequired !== false)
    throw coded("PRODUCTION_BUNDLE_MANIFEST_DEPLOYMENT_INVALID");
  if (
    manifest.deployment.runtimeAuthority !== "direct_container" ||
    manifest.deployment.registryAuthority !== "pms_worker"
  )
    throw coded("PRODUCTION_BUNDLE_MANIFEST_AUTHORITY_INVALID");
  if (
    !isRecord(manifest.deployment.transportProfile) ||
    manifest.deployment.transportProfile.id !== "strict-intranet-plaintext" ||
    manifest.deployment.transportProfile.allowInsecureInternalTransport !== true ||
    manifest.deployment.transportProfile.tlsRequired !== false ||
    manifest.deployment.transportProfile.httpsRequired !== false ||
    manifest.deployment.transportProfile.mqttTlsRequired !== false
  )
    throw coded("PRODUCTION_BUNDLE_MANIFEST_TRANSPORT_PROFILE_INVALID");
  if (
    !isRecord(manifest.compliance) ||
    manifest.compliance.license !== "licenses/LICENSE" ||
    manifest.compliance.sbom !== "sbom/runtime-v1.cdx.json" ||
    manifest.compliance.completeImageSbomClaimed !== false
  )
    throw coded("PRODUCTION_BUNDLE_MANIFEST_COMPLIANCE_INVALID");
}

function validateImageManifest(imageManifest, manifest) {
  if (
    !isRecord(imageManifest) ||
    imageManifest.schemaVersion !== IMAGE_MANIFEST_SCHEMA_VERSION ||
    imageManifest.product !== manifest.bundle.product ||
    imageManifest.deployable !== manifest.bundle.deployable ||
    imageManifest.sourceRevision !== manifest.source.revision
  )
    throw coded("PRODUCTION_BUNDLE_IMAGE_MANIFEST_IDENTITY_INVALID");
  if (!Array.isArray(imageManifest.images) || imageManifest.images.length !== 6)
    throw coded("PRODUCTION_BUNDLE_IMAGE_MANIFEST_COUNT_INVALID");
  if (canonicalJson(imageManifest.images) !== canonicalJson(manifest.images))
    throw coded("PRODUCTION_BUNDLE_IMAGE_MANIFEST_ROOT_MISMATCH");
  const product = productCatalog(manifest.bundle.product);
  const expectedTargets = new Set(product.images.map((image) => image.target));
  const application = imageManifest.images.filter((image) => image.kind === "application");
  if (application.length !== 5) throw coded("PRODUCTION_BUNDLE_APPLICATION_IMAGE_COUNT_INVALID");
  for (const image of application) {
    if (
      !expectedTargets.has(image.target) ||
      /mock/i.test(image.target) ||
      /mock/i.test(image.reference)
    )
      throw coded("PRODUCTION_BUNDLE_APPLICATION_IMAGE_IDENTITY_INVALID");
    const expectedProviderLabel = image.role === "pms-web" ? "shared" : manifest.bundle.product;
    if (
      image.revision !== manifest.source.revision ||
      image.user !== "node" ||
      image.healthcheck !== true ||
      image.os !== OFFLINE_IMAGE_OS ||
      image.architecture !== OFFLINE_IMAGE_ARCHITECTURE ||
      image.providerLabel !== expectedProviderLabel ||
      image.profileLabel !== "production"
    )
      throw coded("PRODUCTION_BUNDLE_APPLICATION_IMAGE_METADATA_INVALID", image.role);
    if (manifest.bundle.deployable && !/^sha256:[0-9a-f]{64}$/.test(image.id))
      throw coded("PRODUCTION_BUNDLE_APPLICATION_IMAGE_ID_INVALID", image.role);
  }
  const postgres = imageManifest.images.filter((image) => image.role === "postgres");
  if (postgres.length !== 1) throw coded("PRODUCTION_BUNDLE_POSTGRES_IMAGE_COUNT_INVALID");
  if (
    manifest.bundle.deployable &&
    (!/^sha256:[0-9a-f]{64}$/.test(postgres[0].id) ||
      !/^sha256:[0-9a-f]{64}$/.test(postgres[0].digest))
  )
    throw coded("PRODUCTION_BUNDLE_POSTGRES_IMAGE_METADATA_INVALID");
  if (
    postgres[0].os !== OFFLINE_IMAGE_OS ||
    postgres[0].architecture !== OFFLINE_IMAGE_ARCHITECTURE
  )
    throw coded("PRODUCTION_BUNDLE_POSTGRES_IMAGE_PLATFORM_INVALID");
}

async function writeChecksums(bundleRoot) {
  const entries = (await walkRegularFiles(bundleRoot)).filter((entry) => entry !== "SHA256SUMS");
  const lines = [];
  for (const entry of entries) lines.push(`${await sha256File(join(bundleRoot, entry))}  ${entry}`);
  await writeFile(join(bundleRoot, "SHA256SUMS"), `${lines.join("\n")}\n`, "utf8");
}

async function writeImageManifestTsv(path, images) {
  const header = [
    "kind",
    "role",
    "reference",
    "image_id",
    "os",
    "architecture",
    "revision",
    "user",
    "healthcheck",
    "provider_label",
    "profile_label",
    "digest",
  ];
  const lines = [header.join("\t")];
  for (const image of images) {
    const fields = [
      image.kind,
      image.role,
      image.reference,
      image.id,
      image.os,
      image.architecture,
      image.revision ?? "-",
      image.user || "-",
      String(image.healthcheck),
      image.providerLabel ?? "-",
      image.profileLabel ?? "-",
      image.digest ?? "-",
    ];
    if (fields.some((field) => typeof field !== "string" || /[\t\r\n]/.test(field)))
      throw coded("PRODUCTION_BUNDLE_IMAGE_TSV_FIELD_INVALID");
    lines.push(fields.join("\t"));
  }
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
}

async function validateImageManifestTsv(path, images) {
  const source = await readFile(path, "utf8");
  const lines = source.trimEnd().split("\n");
  const expectedHeader =
    "kind\trole\treference\timage_id\tos\tarchitecture\trevision\tuser\thealthcheck\tprovider_label\tprofile_label\tdigest";
  if (lines.shift() !== expectedHeader) throw coded("PRODUCTION_BUNDLE_IMAGE_TSV_HEADER_INVALID");
  if (lines.length !== images.length) throw coded("PRODUCTION_BUNDLE_IMAGE_TSV_COUNT_INVALID");
  const expected = images.map((image) =>
    [
      image.kind,
      image.role,
      image.reference,
      image.id,
      image.os,
      image.architecture,
      image.revision ?? "-",
      image.user || "-",
      String(image.healthcheck),
      image.providerLabel ?? "-",
      image.profileLabel ?? "-",
      image.digest ?? "-",
    ].join("\t"),
  );
  if (!sameSortedSet(lines, expected)) throw coded("PRODUCTION_BUNDLE_IMAGE_TSV_CONTENT_MISMATCH");
}

export function imageLoaderScript() {
  return `#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
deploy_dir="$(CDPATH= cd -- "$script_dir/.." && pwd)"
bundle_root="$(CDPATH= cd -- "$deploy_dir/../.." && pwd)"
manifest="$bundle_root/images/manifest.tsv"
archive="$bundle_root/images/images.tar.gz"
image_env="$deploy_dir/.bundle-images.env"

fail() {
  printf 'BLOCKED_BUNDLE_IMAGE: %s\\n' "$1" >&2
  exit 2
}

for command in docker sha256sum; do
  command -v "$command" >/dev/null 2>&1 || fail "$command is required"
done
[[ "$(tr -d '\\r\\n' < "$bundle_root/DEPLOYABLE")" == "true" ]] ||
  fail "stage-only bundles cannot load images"
[[ -f "$manifest" && ! -L "$manifest" ]] || fail "images/manifest.tsv is missing"
[[ -f "$archive" && ! -L "$archive" ]] || fail "images/images.tar.gz is missing"
[[ -f "$image_env" && ! -L "$image_env" ]] || fail ".bundle-images.env is missing"

cd "$bundle_root"
sha256sum --check --strict SHA256SUMS >/dev/null || fail "SHA256SUMS verification failed"
docker image load --input "$archive" >/dev/null || fail "offline image archive load failed"

postgres_digest=""
while IFS= read -r line || [[ -n "$line" ]]; do
  line="\${line%$'\\r'}"
  [[ -z "$line" || "$line" == "#"* ]] && continue
  case "$line" in
    POSTGRES_DIGEST=*) postgres_digest="\${line#*=}" ;;
  esac
done < "$image_env"
[[ "$postgres_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "POSTGRES_DIGEST is invalid"

count=0
while IFS=$'\\t' read -r kind role reference expected_id expected_os expected_arch revision expected_user expected_health provider profile digest; do
  if [[ "$kind" == "kind" ]]; then
    [[ "$role" == "role" && "$reference" == "reference" && "$expected_os" == "os" && "$expected_arch" == "architecture" ]] ||
      fail "manifest header is invalid"
    continue
  fi
  [[ -n "$reference" && -n "$expected_id" ]] || fail "manifest row is incomplete"
  actual_id="$(docker image inspect --format '{{.Id}}' "$reference" 2>/dev/null)" ||
    fail "image is missing: $reference"
  [[ "$actual_id" == "$expected_id" ]] || fail "image ID mismatch: $reference"
  actual_os="$(docker image inspect --format '{{.Os}}' "$reference")"
  actual_arch="$(docker image inspect --format '{{.Architecture}}' "$reference")"
  [[ "$expected_os" == "linux" && "$expected_arch" == "amd64" ]] ||
    fail "manifest image platform is invalid: $reference"
  [[ "$actual_os" == "$expected_os" && "$actual_arch" == "$expected_arch" ]] ||
    fail "image platform mismatch: $reference"
  if [[ "$kind" == "application" ]]; then
    actual_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$reference")"
    actual_user="$(docker image inspect --format '{{.Config.User}}' "$reference")"
    actual_health="$(docker image inspect --format '{{json .Config.Healthcheck}}' "$reference")"
    actual_provider="$(docker image inspect --format '{{index .Config.Labels "${PROVIDER_LABEL}"}}' "$reference")"
    actual_profile="$(docker image inspect --format '{{index .Config.Labels "${PROFILE_LABEL}"}}' "$reference")"
    [[ "$actual_revision" == "$revision" ]] || fail "OCI revision mismatch: $reference"
    [[ "$actual_user" == "$expected_user" && "$actual_user" != "root" && "$actual_user" != "0" ]] ||
      fail "non-root image user mismatch: $reference"
    [[ "$expected_health" == "true" && "$actual_health" != "null" ]] ||
      fail "application healthcheck is missing: $reference"
    [[ "$actual_provider" == "$provider" ]] || fail "provider label mismatch: $reference"
    [[ "$actual_profile" == "$profile" ]] || fail "profile label mismatch: $reference"
  elif [[ "$kind" == "infrastructure" && "$role" == "postgres" ]]; then
    [[ "$digest" == "$postgres_digest" ]] || fail "PostgreSQL digest lock mismatch"
    # docker save/load does not preserve RepoDigests consistently. The archive checksum,
    # exact image ID, and independently locked upstream digest provide the offline identity.
  else
    fail "manifest image kind is invalid: $kind/$role"
  fi
  count=$((count + 1))
done < "$manifest"
[[ "$count" -eq 6 ]] || fail "exactly six offline images are required"
printf 'PASS: six linux/amd64 offline images match IDs, revision, users, healthchecks, labels, and digest.\\n'
`;
}

async function assertChecksums(bundleRoot) {
  const source = await readFile(join(bundleRoot, "SHA256SUMS"), "utf8");
  const declared = new Map();
  for (const line of source.trimEnd().split("\n")) {
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (match === null) throw coded("PRODUCTION_BUNDLE_CHECKSUM_LINE_INVALID");
    const [, checksum, path] = match;
    assertArchivePathSafety([path], "PRODUCTION_BUNDLE_CHECKSUM_PATH_UNSAFE");
    if (declared.has(path)) throw coded("PRODUCTION_BUNDLE_CHECKSUM_DUPLICATE", path);
    declared.set(path, checksum);
  }
  const actual = (await walkRegularFiles(bundleRoot)).filter((entry) => entry !== "SHA256SUMS");
  if (!sameSortedSet([...declared.keys()], actual))
    throw coded("PRODUCTION_BUNDLE_CHECKSUM_INVENTORY_MISMATCH");
  for (const [path, checksum] of declared) {
    if ((await sha256File(join(bundleRoot, path))) !== checksum)
      throw coded("PRODUCTION_BUNDLE_CHECKSUM_MISMATCH", path);
  }
}

async function writeBundleReadme(bundleRoot, product, manifest) {
  await writeFile(join(bundleRoot, "README.md"), bundleReadmeText(product, manifest), "utf8");
}

export function bundleReadmeText(product, manifest) {
  const deployPath = `deploy/${product.deployDirectory}`;
  return `# ${product.title}\n\nThis is a self-contained offline deployment bundle. It includes five application images, the pinned PostgreSQL image, deployment configuration, checksums, and the complete source archive for commit \`${manifest.source.revision}\`.\n\nIt does not contain a real \`.env\`, credentials, simulator endpoints, or Git metadata. Configure the examples under \`${deployPath}\` before deployment. A stage-only archive has \`DEPLOYABLE=false\` and is intentionally rejected by its lifecycle scripts.\n\nThe transport profile is \`strict-intranet-plaintext\`: HTTP, MQTT, Adapter gRPC, and Provider telemetry do not use TLS. External PMS management/SDAR projection requests are accepted anonymously through the PMS Web \`/api/v1/**\` proxy, and the Runtime \`/mcp\` endpoint is anonymous. Database passwords and the instance-scoped Runtime-to-PMS registration token remain internal implementation credentials. Deploy it only where VLAN/firewall isolation keeps all exposed ports and upstream endpoints inside the trusted internal network.\n\nThe Compose-started Runtime is admitted as a PMS RuntimeDeployment with runtime authority \`direct_container\`; PMS Worker observes it, consumes its heartbeat/catalog, and publishes Registry authority \`pms_worker\` without starting PM2.\n\nRuntime OTLP/HTTP export is configurable in the deployment \`.env\` and remains disabled by default. When enabled with a real intranet Collector base URL, Runtime appends \`/v1/traces\`, \`/v1/logs\`, and \`/v1/metrics\`; the strict intranet profile does not add TLS certificates or authentication headers.\n\nThe bundle is deployable infrastructure, not a claim of completed production qualification. Its inherited real-resource status is \`${manifest.qualification.realResourceStatus}\`; mutating real-device tests remain opt-in. The directly exposed SBOM covers the application Runtime scope recorded by that document; it is not asserted to cover PostgreSQL or every complete image layer.\n\nRun:\n\n\`\`\`bash\ncp ${deployPath}/.env.example ${deployPath}/.env\n# Set the internal Device MCP, MQTT, and advertised Runtime endpoints documented by the deployment README.\nbash ${deployPath}/bin/init.sh\nbash ${deployPath}/bin/up.sh\n\`\`\`\n`;
}

async function createStageOnlyImageArchive(path, product, revision) {
  const temporary = await mkdtemp(join(tmpdir(), "sdar-stage-only-images-"));
  try {
    await writeFile(
      join(temporary, "STAGE_ONLY_NOT_DEPLOYABLE.txt"),
      `product=${product.id}\nrevision=${revision}\ndeployable=false\n`,
      "utf8",
    );
    const raw = path.replace(/\.gz$/, "");
    run("tar", ["-cf", raw, "-C", temporary, "STAGE_ONLY_NOT_DEPLOYABLE.txt"], {
      code: "PRODUCTION_BUNDLE_STAGE_IMAGE_ARCHIVE_FAILED",
    });
    run("gzip", ["-n", "-9", raw], {
      code: "PRODUCTION_BUNDLE_STAGE_IMAGE_ARCHIVE_COMPRESSION_FAILED",
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function exportDockerImages(references, destination) {
  const raw = destination.replace(/\.gz$/, "");
  run("docker", ["image", "save", "--output", raw, ...references], {
    code: "PRODUCTION_BUNDLE_IMAGE_EXPORT_FAILED",
    inherit: true,
  });
  run("gzip", ["-n", "-9", raw], {
    code: "PRODUCTION_BUNDLE_IMAGE_COMPRESSION_FAILED",
    inherit: true,
  });
}

function validateApplicationImage(inspected, image, revision) {
  assertOfflineImagePlatform(inspected, image.reference);
  if (!/^sha256:[0-9a-f]{64}$/.test(inspected.Id ?? ""))
    throw coded("PRODUCTION_BUNDLE_IMAGE_ID_INVALID", image.reference);
  const labels = inspected.Config?.Labels;
  if (!isRecord(labels) || labels["org.opencontainers.image.revision"] !== revision)
    throw coded("PRODUCTION_BUNDLE_IMAGE_REVISION_MISMATCH", image.reference);
  if (labels[PROVIDER_LABEL] !== image.providerLabel)
    throw coded("PRODUCTION_BUNDLE_IMAGE_PROVIDER_LABEL_MISMATCH", image.reference);
  if (labels[PROFILE_LABEL] !== image.profileLabel)
    throw coded("PRODUCTION_BUNDLE_IMAGE_PROFILE_LABEL_MISMATCH", image.reference);
  if (inspected.Config?.User !== "node")
    throw coded("PRODUCTION_BUNDLE_IMAGE_USER_INVALID", image.reference);
  if (inspected.Config?.Healthcheck === null || inspected.Config?.Healthcheck === undefined)
    throw coded("PRODUCTION_BUNDLE_IMAGE_HEALTHCHECK_MISSING", image.reference);
}

export function assertOfflineImagePlatform(inspected, reference = "image") {
  if (inspected.Os !== OFFLINE_IMAGE_OS || inspected.Architecture !== OFFLINE_IMAGE_ARCHITECTURE)
    throw coded("PRODUCTION_BUNDLE_IMAGE_PLATFORM_INVALID", reference);
}

function inspectDockerImage(reference) {
  const source = capture("docker", ["image", "inspect", reference], {
    code: "PRODUCTION_BUNDLE_IMAGE_INSPECT_FAILED",
    detail: reference,
  });
  let values;
  try {
    values = JSON.parse(source);
  } catch (error) {
    throw coded("PRODUCTION_BUNDLE_IMAGE_INSPECT_JSON_INVALID", reference, error);
  }
  if (!Array.isArray(values) || values.length !== 1 || !isRecord(values[0]))
    throw coded("PRODUCTION_BUNDLE_IMAGE_INSPECT_RESULT_INVALID", reference);
  return values[0];
}

function selectPostgresDigest(inspected, configuredReference) {
  const digests = Array.isArray(inspected.RepoDigests)
    ? inspected.RepoDigests.filter((value) => typeof value === "string")
    : [];
  if (configuredReference.includes("@sha256:")) {
    const configuredDigest = configuredReference.slice(configuredReference.indexOf("@") + 1);
    const selected = digests.find((value) => value.endsWith(`@${configuredDigest}`));
    return selected ?? configuredReference;
  }
  const selected = digests.find((value) => value.startsWith("postgres@sha256:"));
  if (selected === undefined) throw coded("PRODUCTION_BUNDLE_POSTGRES_REPO_DIGEST_MISSING");
  return selected;
}

function resolveBundleImageExpression(value, environment) {
  return value.replace(/\$\{([A-Z][A-Z0-9_]*)(?:(?::?[-+?])[^}]*)?\}/g, (_match, name) => {
    const replacement = environment[name];
    if (replacement === undefined)
      throw coded("PRODUCTION_BUNDLE_COMPOSE_IMAGE_VARIABLE_UNRESOLVED", name);
    return replacement;
  });
}

function splitArgument(argument) {
  if (!argument.startsWith("--")) throw coded("PRODUCTION_BUNDLE_ARGUMENT_INVALID", argument);
  const separator = argument.indexOf("=");
  return separator < 0
    ? [argument, undefined]
    : [argument.slice(0, separator), argument.slice(separator + 1)];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: options.inherit ? undefined : "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined || result.status !== 0) {
    const detail = options.detail ?? safeCommandFailure(result);
    throw coded(options.code ?? "PRODUCTION_BUNDLE_COMMAND_FAILED", detail, result.error);
  }
  return result;
}

function capture(command, args, options = {}) {
  const result = run(command, args, options);
  return typeof result.stdout === "string" ? result.stdout : "";
}

function git(root, args) {
  return capture("git", ["-C", root, ...args], {
    code: "PRODUCTION_BUNDLE_GIT_COMMAND_FAILED",
    detail: args[0],
  });
}

function archiveEntries(path) {
  return capture("tar", ["-tzf", path], {
    code: "PRODUCTION_BUNDLE_SOURCE_ARCHIVE_LIST_FAILED",
  })
    .split("\n")
    .filter(Boolean);
}

function zipEntries(path) {
  return capture("unzip", ["-Z1", path], {
    code: "PRODUCTION_BUNDLE_ZIP_LIST_FAILED",
  })
    .split("\n")
    .filter(Boolean);
}

async function walkRegularFiles(root) {
  const result = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink())
        throw coded("PRODUCTION_BUNDLE_SYMLINK_FORBIDDEN", relative(root, path));
      if (metadata.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (!metadata.isFile())
        throw coded("PRODUCTION_BUNDLE_NON_REGULAR_ENTRY_FORBIDDEN", relative(root, path));
      result.push(relative(root, path).split(sep).join("/"));
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
    const metadata = await stat(canonical);
    if (!metadata.isDirectory()) throw new Error("not a directory");
    return canonical;
  } catch (error) {
    throw coded(code, path, error);
  }
}

async function requireDirectory(path, code) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("invalid directory");
  } catch (error) {
    throw coded(code, path, error);
  }
}

async function requireRegularFile(path, code) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("invalid file");
  } catch (error) {
    throw coded(code, path, error);
  }
}

function assertSafeOutputDirectory(repositoryRoot, outputDirectory) {
  if (!isAbsolute(outputDirectory)) throw coded("PRODUCTION_BUNDLE_OUTPUT_ABSOLUTE_REQUIRED");
  if (outputDirectory === repositoryRoot || outputDirectory === dirname(repositoryRoot))
    throw coded("PRODUCTION_BUNDLE_OUTPUT_SCOPE_TOO_BROAD");
}

async function packageVersionFromArchiveRoot(root) {
  const value = await readJson(
    join(root, "package.json"),
    "PRODUCTION_BUNDLE_PACKAGE_JSON_INVALID",
  );
  if (typeof value.version !== "string" || !/^\d+\.\d+\.\d+/.test(value.version))
    throw coded("PRODUCTION_BUNDLE_PACKAGE_VERSION_INVALID");
  return value.version;
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

function sameSortedSet(left, right) {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

function nulSeparated(value) {
  return value.split("\0").filter(Boolean);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value))
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeCommandFailure(result) {
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  if (stderr.length === 0) return `exit-${String(result.status ?? "spawn")}`;
  return stderr
    .split("\n")[0]
    .replaceAll(/[^A-Za-z0-9_.:/ -]/g, "_")
    .slice(0, 240);
}

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { buildArm64SourceBundles, validateArm64SourceZip } from "./arm64-source-lib.mjs";
import { productCatalog } from "./catalog.mjs";
import {
  ProductionBundleError,
  assertCleanCommittedHead,
  buildProductionBundles,
  coded,
  defaultRepositoryRoot,
  validateBundleZip,
} from "./lib.mjs";

export const DELIVERY_VARIANTS = Object.freeze(["arm64-source", "amd64-offline"]);

const DEFAULT_DEPENDENCIES = Object.freeze({
  assertCleanCommittedHead,
  buildArm64SourceBundles,
  buildProductionBundles,
  probeAmd64DockerServer,
  validateArm64SourceZip,
  validateBundleZip,
});

export function parseProductPackagerArguments(argv) {
  const options = {
    variant: "arm64-source",
    outputDirectory: undefined,
    help: false,
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      if (seen.has("help")) throw coded("PRODUCT_PACKAGER_ARGUMENT_DUPLICATE", "--help");
      seen.add("help");
      options.help = true;
      continue;
    }
    const [name, inlineValue] = splitArgument(argument);
    if (seen.has(name)) throw coded("PRODUCT_PACKAGER_ARGUMENT_DUPLICATE", name);
    seen.add(name);
    const value = inlineValue ?? argv[++index];
    if (value === undefined || value.startsWith("--")) {
      throw coded("PRODUCT_PACKAGER_ARGUMENT_VALUE_REQUIRED", name);
    }
    switch (name) {
      case "--variant":
        if (![...DELIVERY_VARIANTS, "all"].includes(value)) {
          throw coded("PRODUCT_PACKAGER_VARIANT_INVALID", value);
        }
        options.variant = value;
        break;
      case "--output-dir":
        options.outputDirectory = resolve(value);
        break;
      default:
        throw coded("PRODUCT_PACKAGER_ARGUMENT_UNKNOWN", name);
    }
  }
  if (options.help && seen.size !== 1) throw coded("PRODUCT_PACKAGER_HELP_MUST_BE_EXCLUSIVE");
  return Object.freeze(options);
}

export async function packageProductDeliveries(productId, options = {}, dependencyOverrides = {}) {
  const product = productCatalog(productId);
  const dependencies = Object.freeze({ ...DEFAULT_DEPENDENCIES, ...dependencyOverrides });
  const repositoryRoot = resolve(options.repositoryRoot ?? defaultRepositoryRoot());
  const source = await dependencies.assertCleanCommittedHead(repositoryRoot);
  const variants = selectedVariants(options.variant ?? "arm64-source");
  const outputDirectory = resolve(
    options.outputDirectory ?? join(repositoryRoot, "reports/production-bundles/delivery"),
  );
  assertSafeOutputDirectory(repositoryRoot, outputDirectory);

  if (variants.includes("amd64-offline")) await dependencies.probeAmd64DockerServer();

  const workingRoot = await mkdtemp(join(tmpdir(), `sdar-${product.id}-packager-`));
  const temporaryOutput = join(workingRoot, "verified-output");
  await mkdir(temporaryOutput, { recursive: true });
  try {
    const prepared = [];
    for (const variant of variants) {
      const result =
        variant === "arm64-source"
          ? await dependencies.buildArm64SourceBundles({
              products: [product.id],
              repositoryRoot,
              outputDirectory: temporaryOutput,
            })
          : await dependencies.buildProductionBundles({
              products: [product.id],
              repositoryRoot,
              outputDirectory: temporaryOutput,
              stageOnly: false,
            });
      prepared.push(
        await validateBuilderResult({
          dependencies,
          expectedRevision: source.revision,
          product,
          result,
          variant,
        }),
      );
    }

    const published = await publishPreparedArtifacts({
      dependencies,
      expectedRevision: source.revision,
      outputDirectory,
      prepared,
      product,
    });
    return Object.freeze({
      product: product.id,
      sourceRevision: source.revision,
      variants: Object.freeze([...variants]),
      outputs: Object.freeze(published),
    });
  } finally {
    await rm(workingRoot, { recursive: true, force: true });
  }
}

export async function runProductPackagerCli(productId, argv) {
  try {
    const options = parseProductPackagerArguments(argv);
    if (options.help) {
      process.stdout.write(productPackagerUsage(productId));
      return;
    }
    const result = await packageProductDeliveries(productId, options);
    process.stdout.write(
      `${JSON.stringify({ status: "PRODUCT_DELIVERIES_PACKAGED", ...result }, null, 2)}\n`,
    );
  } catch (error) {
    const code =
      error instanceof ProductionBundleError ? error.code : "PRODUCT_DELIVERIES_PACKAGE_FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = 2;
  }
}

export function productPackagerUsage(productId) {
  return [
    `Usage: node scripts/production-bundles/package-${productId}.mjs [options]`,
    "",
    "Options:",
    "  --variant arm64-source|amd64-offline|all",
    "      Delivery type to build (default: arm64-source).",
    "  --output-dir PATH",
    "      Final artifact directory (default: reports/production-bundles/delivery).",
    "  --help",
    "      Show this help without building.",
    "",
  ].join("\n");
}

export function assertAmd64DockerPlatform(source) {
  const value = source.trim().toLowerCase();
  if (value !== "linux/amd64" && value !== "linux/x86_64") {
    throw coded("PRODUCT_PACKAGER_DOCKER_PLATFORM_UNSUPPORTED", value || "empty");
  }
  return "linux/amd64";
}

export function expectedArchiveName(productId, variant) {
  const product = productCatalog(productId);
  if (variant === "arm64-source") {
    return `sdar-${product.id}-production-arm64-source-build-delivery.zip`;
  }
  if (variant === "amd64-offline") return product.archiveName;
  throw coded("PRODUCT_PACKAGER_VARIANT_INVALID", variant);
}

async function probeAmd64DockerServer() {
  const result = spawnSync("docker", ["info", "--format", "{{.OSType}}/{{.Architecture}}"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error !== undefined || result.status !== 0) {
    throw coded("PRODUCT_PACKAGER_DOCKER_PLATFORM_PROBE_FAILED");
  }
  return assertAmd64DockerPlatform(result.stdout);
}

async function validateBuilderResult({ dependencies, expectedRevision, product, result, variant }) {
  if (
    typeof result !== "object" ||
    result === null ||
    result.source?.revision !== expectedRevision ||
    !Array.isArray(result.outputs) ||
    result.outputs.length !== 1
  ) {
    throw coded("PRODUCT_PACKAGER_BUILD_RESULT_INVALID", variant);
  }
  const output = result.outputs[0];
  const expectedName = expectedArchiveName(product.id, variant);
  if (
    output?.product !== product.id ||
    output.deployable !== true ||
    basename(output.archivePath ?? "") !== expectedName ||
    basename(output.sidecarPath ?? "") !== `${expectedName}.sha256`
  ) {
    throw coded("PRODUCT_PACKAGER_BUILD_OUTPUT_IDENTITY_INVALID", variant);
  }
  return validateArtifact({
    archivePath: resolve(output.archivePath),
    dependencies,
    expectedRevision,
    product,
    sidecarPath: resolve(output.sidecarPath),
    variant,
  });
}

async function validateArtifact({
  archivePath,
  dependencies,
  expectedRevision,
  product,
  sidecarPath,
  variant,
}) {
  await requireRegularFile(archivePath, "PRODUCT_PACKAGER_ARCHIVE_INVALID");
  await requireRegularFile(sidecarPath, "PRODUCT_PACKAGER_SIDECAR_INVALID");
  const expectedName = expectedArchiveName(product.id, variant);
  const digest = await sha256File(archivePath);
  const sidecar = await readFile(sidecarPath, "utf8");
  if (sidecar !== `${digest}  ${expectedName}\n`) {
    throw coded("PRODUCT_PACKAGER_SIDECAR_MISMATCH", variant);
  }
  const manifest =
    variant === "arm64-source"
      ? await dependencies.validateArm64SourceZip(archivePath, { expectedProduct: product.id })
      : await dependencies.validateBundleZip(archivePath, {
          expectedProduct: product.id,
          expectedDeployable: true,
        });
  if (manifest?.bundle?.product !== product.id || manifest?.source?.revision !== expectedRevision) {
    throw coded("PRODUCT_PACKAGER_MANIFEST_IDENTITY_INVALID", variant);
  }
  const includedImageCount =
    manifest.deployment?.includedImageCount ??
    (Array.isArray(manifest.images) ? manifest.images.length : undefined);
  if (
    (variant === "arm64-source" &&
      (manifest.bundle.targetPlatform !== "linux/arm64" || includedImageCount !== 0)) ||
    (variant === "amd64-offline" &&
      (manifest.bundle.targetPlatform !== "linux/amd64" ||
        manifest.deployment?.targetPlatform !== "linux/amd64" ||
        includedImageCount !== 6 ||
        !Array.isArray(manifest.images) ||
        manifest.images.some((image) => image?.os !== "linux" || image?.architecture !== "amd64")))
  ) {
    throw coded("PRODUCT_PACKAGER_MANIFEST_DISTRIBUTION_INVALID", variant);
  }
  return Object.freeze({
    variant,
    archivePath,
    sidecarPath,
    sha256: digest,
    platform: variant === "arm64-source" ? "linux/arm64" : "linux/amd64",
    includedImageCount,
  });
}

async function publishPreparedArtifacts({
  dependencies,
  expectedRevision,
  outputDirectory,
  prepared,
  product,
}) {
  await ensureOutputDirectory(outputDirectory);
  const lockPath = join(outputDirectory, `.sdar-${product.id}-packager.lock`);
  try {
    await mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      throw coded("PRODUCT_PACKAGER_PUBLISH_LOCKED", product.id, error);
    }
    throw coded("PRODUCT_PACKAGER_PUBLISH_LOCK_FAILED", product.id, error);
  }
  let result;
  let publishError;
  try {
    result = await publishPreparedArtifactsLocked({
      dependencies,
      expectedRevision,
      outputDirectory,
      prepared,
      product,
    });
  } catch (error) {
    publishError = error;
  }
  let unlockError;
  try {
    await rmdir(lockPath);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      unlockError = coded("PRODUCT_PACKAGER_PUBLISH_UNLOCK_FAILED", lockPath, error);
    }
  }
  if (publishError !== undefined) throw publishError;
  if (unlockError !== undefined) throw unlockError;
  return result;
}

async function publishPreparedArtifactsLocked({
  dependencies,
  expectedRevision,
  outputDirectory,
  prepared,
  product,
}) {
  const transaction = `${process.pid}-${randomUUID()}`;
  const plans = prepared.flatMap((artifact) => {
    const archiveName = expectedArchiveName(product.id, artifact.variant);
    return [
      {
        source: artifact.archivePath,
        destination: join(outputDirectory, archiveName),
        temporary: join(outputDirectory, `.${archiveName}.${transaction}.tmp`),
        backup: join(outputDirectory, `.${archiveName}.${transaction}.bak`),
      },
      {
        source: artifact.sidecarPath,
        destination: join(outputDirectory, `${archiveName}.sha256`),
        temporary: join(outputDirectory, `.${archiveName}.sha256.${transaction}.tmp`),
        backup: join(outputDirectory, `.${archiveName}.sha256.${transaction}.bak`),
      },
    ];
  });
  const backedUp = [];
  const installed = [];
  let published;
  try {
    for (const plan of plans) await assertPublishDestination(plan.destination);
    for (const plan of plans) await copyFile(plan.source, plan.temporary);
    for (const plan of plans) {
      if (await pathExists(plan.destination)) {
        await rename(plan.destination, plan.backup);
        backedUp.push(plan);
      }
    }
    for (const plan of plans) {
      await rename(plan.temporary, plan.destination);
      installed.push(plan);
    }
    published = [];
    for (const artifact of prepared) {
      const archiveName = expectedArchiveName(product.id, artifact.variant);
      published.push(
        await validateArtifact({
          archivePath: join(outputDirectory, archiveName),
          dependencies,
          expectedRevision,
          product,
          sidecarPath: join(outputDirectory, `${archiveName}.sha256`),
          variant: artifact.variant,
        }),
      );
    }
  } catch (error) {
    const recoveryErrors = [];
    for (const plan of [...installed].reverse()) {
      try {
        await rm(plan.destination, { force: true });
      } catch (recoveryError) {
        recoveryErrors.push(`${plan.destination}:${errorCode(recoveryError)}`);
      }
    }
    for (const plan of [...backedUp].reverse()) {
      try {
        if (await pathExists(plan.backup)) await rename(plan.backup, plan.destination);
      } catch (recoveryError) {
        recoveryErrors.push(`${plan.backup}:${errorCode(recoveryError)}`);
      }
    }
    for (const plan of plans) {
      try {
        await rm(plan.temporary, { force: true });
      } catch (recoveryError) {
        recoveryErrors.push(`${plan.temporary}:${errorCode(recoveryError)}`);
      }
    }
    if (recoveryErrors.length > 0) {
      throw coded("PRODUCT_PACKAGER_ROLLBACK_FAILED", recoveryErrors.join(","), error);
    }
    throw coded("PRODUCT_PACKAGER_PUBLISH_FAILED", product.id, error);
  }

  // Validation above is the commit point. Backup cleanup must never trigger a rollback after
  // a fully verified replacement has been installed; an undeletable hidden backup is safer than
  // losing both the old and new delivery.
  for (const plan of backedUp) {
    try {
      await rm(plan.backup, { force: true });
    } catch {
      // Best effort only. The validated destination is already the committed artifact.
    }
  }
  for (const plan of plans) await rm(plan.temporary, { force: true });
  return Object.freeze(published);
}

function selectedVariants(variant) {
  if (variant === "all") return [...DELIVERY_VARIANTS];
  if (DELIVERY_VARIANTS.includes(variant)) return [variant];
  throw coded("PRODUCT_PACKAGER_VARIANT_INVALID", variant);
}

function assertSafeOutputDirectory(repositoryRoot, outputDirectory) {
  if (!isAbsolute(outputDirectory)) throw coded("PRODUCT_PACKAGER_OUTPUT_ABSOLUTE_REQUIRED");
  if (outputDirectory === repositoryRoot || outputDirectory === dirname(repositoryRoot)) {
    throw coded("PRODUCT_PACKAGER_OUTPUT_SCOPE_TOO_BROAD");
  }
}

async function ensureOutputDirectory(path) {
  await mkdir(path, { recursive: true });
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw coded("PRODUCT_PACKAGER_OUTPUT_DIRECTORY_INVALID", path);
  }
  if ((await realpath(path)) !== path) {
    throw coded("PRODUCT_PACKAGER_OUTPUT_DIRECTORY_SYMLINK_FORBIDDEN", path);
  }
}

async function assertPublishDestination(path) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw coded("PRODUCT_PACKAGER_DESTINATION_INVALID", path);
    }
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}

async function requireRegularFile(path, code) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("not a regular file");
  } catch (error) {
    throw coded(code, path, error);
  }
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function errorCode(error) {
  return error instanceof Error && "code" in error ? String(error.code) : "UNKNOWN";
}

function splitArgument(argument) {
  if (!argument.startsWith("--")) throw coded("PRODUCT_PACKAGER_ARGUMENT_INVALID", argument);
  const separator = argument.indexOf("=");
  return separator < 0
    ? [argument, undefined]
    : [argument.slice(0, separator), argument.slice(separator + 1)];
}

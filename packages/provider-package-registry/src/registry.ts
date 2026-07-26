import type { Stats } from "node:fs";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { ZodError } from "zod";
import { parseProviderPackage, type ProviderPackage } from "./model.js";

export type ProviderPackageRegistryErrorCode =
  | "PACKAGE_ROOT_UNAVAILABLE"
  | "PACKAGE_ROOT_SYMLINK_REJECTED"
  | "PACKAGE_ENTRY_SYMLINK_REJECTED"
  | "PACKAGE_DESCRIPTOR_UNAVAILABLE"
  | "PACKAGE_JSON_INVALID"
  | "PACKAGE_SCHEMA_INVALID"
  | "TEST_FIXTURE_PACKAGE_REJECTED"
  | "DUPLICATE_PACKAGE_VERSION"
  | "AMBIGUOUS_PACKAGE_ID";

export class ProviderPackageRegistryError extends Error {
  readonly code: ProviderPackageRegistryErrorCode;
  readonly details: Readonly<Record<string, string | readonly string[]>>;

  constructor(
    code: ProviderPackageRegistryErrorCode,
    message: string,
    details: Readonly<Record<string, string | readonly string[]>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProviderPackageRegistryError";
    this.code = code;
    this.details = details;
  }
}

export class ProviderPackageRegistry {
  readonly #packages: readonly ProviderPackage[];

  constructor(packages: readonly ProviderPackage[]) {
    assertUniquePackageVersions(packages);
    this.#packages = [...packages].sort(comparePackages);
  }

  list(): readonly ProviderPackage[] {
    return [...this.#packages];
  }

  get(packageId: string, packageVersion?: string): ProviderPackage | undefined {
    const matches = this.#packages.filter(
      (providerPackage) =>
        providerPackage.packageId === packageId &&
        (packageVersion === undefined || providerPackage.packageVersion === packageVersion),
    );
    if (matches.length > 1) {
      throw new ProviderPackageRegistryError(
        "AMBIGUOUS_PACKAGE_ID",
        `Provider Package ID has multiple versions: ${packageId}`,
        {
          packageId,
          versions: matches.map(({ packageVersion: version }) => version),
        },
      );
    }
    return matches[0];
  }

  listByProviderType(providerType: string): readonly ProviderPackage[] {
    return this.#packages.filter(
      (providerPackage) => providerPackage.providerType === providerType,
    );
  }
}

export async function loadProviderPackageRegistry(
  workspaceRoot = process.cwd(),
): Promise<ProviderPackageRegistry> {
  const controlledRoot = resolve(workspaceRoot, "provider-packages");
  let rootStats: Stats;
  try {
    rootStats = await lstat(controlledRoot);
  } catch (error) {
    throw new ProviderPackageRegistryError(
      "PACKAGE_ROOT_UNAVAILABLE",
      "Controlled Provider Package root is unavailable",
      { directory: "provider-packages" },
      { cause: error },
    );
  }
  if (rootStats.isSymbolicLink()) {
    throw new ProviderPackageRegistryError(
      "PACKAGE_ROOT_SYMLINK_REJECTED",
      "Controlled Provider Package root must not be a symbolic link",
      { directory: "provider-packages" },
    );
  }
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(controlledRoot);
  } catch (error) {
    throw new ProviderPackageRegistryError(
      "PACKAGE_ROOT_UNAVAILABLE",
      "Controlled Provider Package root is unavailable",
      { directory: "provider-packages" },
      { cause: error },
    );
  }

  const entries = await readdir(canonicalRoot, { withFileTypes: true });
  const packages: ProviderPackage[] = [];
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    if (entry.isSymbolicLink()) {
      throw new ProviderPackageRegistryError(
        "PACKAGE_ENTRY_SYMLINK_REJECTED",
        `Provider Package root contains a symbolic link: ${entry.name}`,
        { entry: entry.name },
      );
    }
    if (!entry.isDirectory()) continue;
    packages.push(await loadDescriptor(canonicalRoot, entry.name));
  }
  return new ProviderPackageRegistry(packages);
}

export function validateProviderPackage(input: unknown): ProviderPackage {
  return parseProviderPackage(input);
}

async function loadDescriptor(root: string, directoryName: string): Promise<ProviderPackage> {
  const descriptorPath = resolve(root, directoryName, "provider-package.json");
  let descriptorStats: Stats;
  try {
    descriptorStats = await lstat(descriptorPath);
  } catch (error) {
    throw new ProviderPackageRegistryError(
      "PACKAGE_DESCRIPTOR_UNAVAILABLE",
      `Provider Package descriptor is unavailable: ${directoryName}`,
      { directory: directoryName },
      { cause: error },
    );
  }
  if (descriptorStats.isSymbolicLink()) {
    throw new ProviderPackageRegistryError(
      "PACKAGE_ENTRY_SYMLINK_REJECTED",
      `Provider Package descriptor must not be a symbolic link: ${directoryName}`,
      { entry: `${directoryName}/provider-package.json` },
    );
  }
  let source: string;
  try {
    source = await readFile(descriptorPath, "utf8");
  } catch (error) {
    throw new ProviderPackageRegistryError(
      "PACKAGE_DESCRIPTOR_UNAVAILABLE",
      `Provider Package descriptor is unavailable: ${directoryName}`,
      { directory: directoryName },
      { cause: error },
    );
  }

  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch (error) {
    throw new ProviderPackageRegistryError(
      "PACKAGE_JSON_INVALID",
      `Provider Package descriptor is not valid JSON: ${directoryName}`,
      { directory: directoryName },
      { cause: error },
    );
  }
  try {
    const providerPackage = validateProviderPackage(input);
    assertProductionPackage(providerPackage, directoryName);
    return providerPackage;
  } catch (error) {
    if (error instanceof ProviderPackageRegistryError) throw error;
    if (!(error instanceof ZodError)) throw error;
    throw new ProviderPackageRegistryError(
      "PACKAGE_SCHEMA_INVALID",
      `Provider Package descriptor does not match schema: ${directoryName}`,
      { directory: directoryName },
      { cause: error },
    );
  }
}

function assertProductionPackage(providerPackage: ProviderPackage, directoryName: string): void {
  const mockReference =
    identifierContainsMock(directoryName) ||
    identifierContainsMock(providerPackage.packageId) ||
    identifierContainsMock(providerPackage.providerType) ||
    providerPackage.adapter.entry.split("/").some((segment) => identifierContainsMock(segment));
  if (!mockReference) return;
  throw new ProviderPackageRegistryError(
    "TEST_FIXTURE_PACKAGE_REJECTED",
    `Mock fixture must not be loaded as a production Provider Package: ${directoryName}`,
    {
      directory: directoryName,
      packageId: providerPackage.packageId,
      entry: providerPackage.adapter.entry,
    },
  );
}

function identifierContainsMock(value: string): boolean {
  return value.toLowerCase().split(/[._-]/u).includes("mock");
}

function assertUniquePackageVersions(packages: readonly ProviderPackage[]): void {
  const seen = new Set<string>();
  for (const providerPackage of packages) {
    const key = `${providerPackage.packageId}\u0000${providerPackage.packageVersion}`;
    if (seen.has(key)) {
      throw new ProviderPackageRegistryError(
        "DUPLICATE_PACKAGE_VERSION",
        `Duplicate Provider Package ID and version: ${providerPackage.packageId}@${providerPackage.packageVersion}`,
        {
          packageId: providerPackage.packageId,
          packageVersion: providerPackage.packageVersion,
        },
      );
    }
    seen.add(key);
  }
}

function comparePackages(left: ProviderPackage, right: ProviderPackage): number {
  return (
    compareText(left.packageId, right.packageId) ||
    compareText(left.packageVersion, right.packageVersion)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

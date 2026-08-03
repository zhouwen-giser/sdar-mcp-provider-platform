import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export const CURRENT_RUNTIME_VERSION = "2.0.0-rc.1";
export const RUNTIME_RELEASE_MANIFEST_FILE = "runtime-releases.json";
export const FIXED_RUNTIME_ENTRY = "dist/apps/runtime/src/main.js";

export interface RuntimeReleaseManifestEntry {
  readonly version: string;
  readonly directory: string;
}

export interface RuntimeReleaseManifest {
  readonly schemaVersion: 1;
  readonly releases: readonly RuntimeReleaseManifestEntry[];
}

export const CURRENT_RUNTIME_RELEASE_MANIFEST: RuntimeReleaseManifest = Object.freeze({
  schemaVersion: 1,
  releases: Object.freeze([
    Object.freeze({
      version: CURRENT_RUNTIME_VERSION,
      directory: CURRENT_RUNTIME_VERSION,
    }),
  ]),
});

export interface ResolvedRuntimeRelease {
  readonly version: string;
  readonly releaseDirectory: string;
  readonly runtimeEntry: string;
  readonly manifestDigest: string;
}

export type RuntimeReleaseResolverErrorCode =
  | "RUNTIME_RELEASE_ROOT_INVALID"
  | "RUNTIME_RELEASE_MANIFEST_INVALID"
  | "RUNTIME_RELEASE_VERSION_INVALID"
  | "RUNTIME_RELEASE_VERSION_UNKNOWN"
  | "RUNTIME_RELEASE_PATH_ESCAPE"
  | "RUNTIME_RELEASE_DIRECTORY_INVALID"
  | "RUNTIME_RELEASE_ENTRY_INVALID"
  | "RUNTIME_RELEASE_ENTRY_UNREADABLE"
  | "RUNTIME_RELEASE_ENTRY_NOT_EXECUTABLE";

export class RuntimeReleaseResolverError extends Error {
  constructor(
    readonly code: RuntimeReleaseResolverErrorCode,
    readonly version?: string,
    options: ErrorOptions = {},
  ) {
    super(code, options);
    this.name = "RuntimeReleaseResolverError";
  }
}

export class RuntimeReleaseResolver {
  readonly #releaseRoot: string;
  readonly #manifest: RuntimeReleaseManifest;
  readonly #manifestDigest: string;

  constructor(releaseRoot: string, manifest: RuntimeReleaseManifest) {
    if (!isAbsolute(releaseRoot)) {
      throw new RuntimeReleaseResolverError("RUNTIME_RELEASE_ROOT_INVALID");
    }
    this.#releaseRoot = resolve(releaseRoot);
    this.#manifest = validateManifest(manifest);
    this.#manifestDigest = digestManifest(this.#manifest);
  }

  async resolve(version: string): Promise<ResolvedRuntimeRelease> {
    if (!validVersion(version)) {
      throw new RuntimeReleaseResolverError("RUNTIME_RELEASE_VERSION_INVALID");
    }
    const release = this.#manifest.releases.find((candidate) => candidate.version === version);
    if (release === undefined) {
      throw new RuntimeReleaseResolverError("RUNTIME_RELEASE_VERSION_UNKNOWN", version);
    }
    const root = await safeRealpath(this.#releaseRoot, "RUNTIME_RELEASE_ROOT_INVALID", version);
    const directoryCandidate = resolve(root, release.directory);
    assertContained(root, directoryCandidate, version);
    const directoryCandidateStatus = await safeLstat(
      directoryCandidate,
      "RUNTIME_RELEASE_DIRECTORY_INVALID",
      version,
    );
    if (directoryCandidateStatus.isSymbolicLink()) {
      throw new RuntimeReleaseResolverError("RUNTIME_RELEASE_PATH_ESCAPE", version);
    }
    const directory = await safeRealpath(
      directoryCandidate,
      "RUNTIME_RELEASE_DIRECTORY_INVALID",
      version,
    );
    assertContained(root, directory, version);
    const directoryStatus = await safeLstat(
      directory,
      "RUNTIME_RELEASE_DIRECTORY_INVALID",
      version,
    );
    if (!directoryStatus.isDirectory() || directoryStatus.isSymbolicLink()) {
      throw new RuntimeReleaseResolverError("RUNTIME_RELEASE_DIRECTORY_INVALID", version);
    }

    const entryCandidate = resolve(directory, FIXED_RUNTIME_ENTRY);
    assertContained(directory, entryCandidate, version);
    const entryCandidateStatus = await safeLstat(
      entryCandidate,
      "RUNTIME_RELEASE_ENTRY_INVALID",
      version,
    );
    if (entryCandidateStatus.isSymbolicLink()) {
      throw new RuntimeReleaseResolverError("RUNTIME_RELEASE_PATH_ESCAPE", version);
    }
    const entry = await safeRealpath(entryCandidate, "RUNTIME_RELEASE_ENTRY_INVALID", version);
    assertContained(directory, entry, version);
    const entryStatus = await safeLstat(entry, "RUNTIME_RELEASE_ENTRY_INVALID", version);
    if (!entryStatus.isFile() || entryStatus.isSymbolicLink()) {
      throw new RuntimeReleaseResolverError("RUNTIME_RELEASE_ENTRY_INVALID", version);
    }
    if ((entryStatus.mode & 0o444) === 0) {
      throw new RuntimeReleaseResolverError("RUNTIME_RELEASE_ENTRY_UNREADABLE", version);
    }
    // Windows launches the fixed JavaScript entry through Node and does not expose
    // POSIX execute bits on NTFS. Linux and other POSIX hosts still require the
    // executable bit as part of the release artifact gate.
    if (process.platform !== "win32" && (entryStatus.mode & 0o111) === 0) {
      throw new RuntimeReleaseResolverError("RUNTIME_RELEASE_ENTRY_NOT_EXECUTABLE", version);
    }
    return Object.freeze({
      version,
      releaseDirectory: directory,
      runtimeEntry: entry,
      manifestDigest: this.#manifestDigest,
    });
  }
}

export async function loadRuntimeReleaseManifest(
  releaseRoot: string,
): Promise<RuntimeReleaseManifest> {
  if (!isAbsolute(releaseRoot)) {
    throw new RuntimeReleaseResolverError("RUNTIME_RELEASE_ROOT_INVALID");
  }
  const root = await safeRealpath(resolve(releaseRoot), "RUNTIME_RELEASE_ROOT_INVALID");
  const manifestCandidate = resolve(root, RUNTIME_RELEASE_MANIFEST_FILE);
  assertContained(root, manifestCandidate);
  const manifestCandidateStatus = await safeLstat(
    manifestCandidate,
    "RUNTIME_RELEASE_MANIFEST_INVALID",
  );
  if (manifestCandidateStatus.isSymbolicLink()) {
    throw new RuntimeReleaseResolverError("RUNTIME_RELEASE_PATH_ESCAPE");
  }
  const manifestPath = await safeRealpath(manifestCandidate, "RUNTIME_RELEASE_MANIFEST_INVALID");
  assertContained(root, manifestPath);
  const status = await safeLstat(manifestPath, "RUNTIME_RELEASE_MANIFEST_INVALID");
  if (!status.isFile() || status.isSymbolicLink() || status.size > 65_536) {
    throw new RuntimeReleaseResolverError("RUNTIME_RELEASE_MANIFEST_INVALID");
  }
  try {
    return validateManifest(JSON.parse(await readFile(manifestPath, "utf8")));
  } catch (error) {
    if (error instanceof RuntimeReleaseResolverError) throw error;
    throw new RuntimeReleaseResolverError("RUNTIME_RELEASE_MANIFEST_INVALID", undefined, {
      cause: error,
    });
  }
}

function validateManifest(value: unknown): RuntimeReleaseManifest {
  if (
    typeof value !== "object" ||
    value === null ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("releases" in value) ||
    !Array.isArray(value.releases) ||
    value.releases.length === 0 ||
    Object.keys(value).some((key) => !["schemaVersion", "releases"].includes(key))
  ) {
    throw new RuntimeReleaseResolverError("RUNTIME_RELEASE_MANIFEST_INVALID");
  }
  const versions = new Set<string>();
  const releases = value.releases.map((entry: unknown) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("version" in entry) ||
      typeof entry.version !== "string" ||
      !validVersion(entry.version) ||
      !("directory" in entry) ||
      typeof entry.directory !== "string" ||
      entry.directory !== entry.version ||
      Object.keys(entry).some((key) => !["version", "directory"].includes(key)) ||
      versions.has(entry.version)
    ) {
      throw new RuntimeReleaseResolverError("RUNTIME_RELEASE_MANIFEST_INVALID");
    }
    versions.add(entry.version);
    return Object.freeze({ version: entry.version, directory: entry.directory });
  });
  return Object.freeze({
    schemaVersion: 1,
    releases: Object.freeze(releases),
  });
}

function digestManifest(manifest: RuntimeReleaseManifest): string {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

function validVersion(value: string): boolean {
  return /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function assertContained(parent: string, candidate: string, version?: string): void {
  const path = relative(parent, candidate);
  if (path.startsWith("..") || isAbsolute(path)) {
    throw new RuntimeReleaseResolverError("RUNTIME_RELEASE_PATH_ESCAPE", version);
  }
}

async function safeRealpath(
  path: string,
  code: RuntimeReleaseResolverErrorCode,
  version?: string,
): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    throw new RuntimeReleaseResolverError(code, version, { cause: error });
  }
}

async function safeLstat(path: string, code: RuntimeReleaseResolverErrorCode, version?: string) {
  try {
    return await lstat(path);
  } catch (error) {
    throw new RuntimeReleaseResolverError(code, version, { cause: error });
  }
}

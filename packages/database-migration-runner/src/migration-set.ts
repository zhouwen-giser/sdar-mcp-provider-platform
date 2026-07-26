import { readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const MIGRATION_SET_DIRECTORIES = {
  runtime: "migrations/runtime",
  "provider:ugv": "migrations/providers/ugv",
  "provider:npc-tank": "migrations/providers/npc-tank",
  pms: "migrations/pms",
} as const;

export type MigrationSet = keyof typeof MIGRATION_SET_DIRECTORIES;

export type MigrationSetResolutionErrorCode =
  | "UNKNOWN_MIGRATION_SET"
  | "MIGRATION_SET_PATH_ESCAPE"
  | "MIGRATION_SET_DIRECTORY_UNAVAILABLE"
  | "MIGRATION_SET_SYMLINK_REJECTED"
  | "DUPLICATE_MIGRATION_SEQUENCE";

type ErrorDetail = string | number | readonly string[];

export class MigrationSetResolutionError extends Error {
  readonly code: MigrationSetResolutionErrorCode;
  readonly details: Readonly<Record<string, ErrorDetail>>;

  constructor(
    code: MigrationSetResolutionErrorCode,
    message: string,
    details: Readonly<Record<string, ErrorDetail>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MigrationSetResolutionError";
    this.code = code;
    this.details = details;
  }
}

export interface MigrationFile {
  readonly set: MigrationSet;
  readonly sequence: string;
  readonly filename: string;
  readonly relativePath: string;
  readonly absolutePath: string;
}

const MIGRATION_FILENAME = /^(\d{3})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;

const ALLOWED_DUPLICATE_SEQUENCES: Readonly<
  Partial<Record<MigrationSet, Readonly<Record<string, readonly string[]>>>>
> = {
  runtime: {
    "014": ["014_observation_pagination.sql", "014_start_confirmation_watchdog.sql"],
  },
};

export function isMigrationSet(value: string): value is MigrationSet {
  return Object.hasOwn(MIGRATION_SET_DIRECTORIES, value);
}

export async function resolveMigrationSet(
  workspaceRoot: string,
  requestedSet: string,
): Promise<readonly MigrationFile[]> {
  if (!isMigrationSet(requestedSet)) {
    throw new MigrationSetResolutionError(
      "UNKNOWN_MIGRATION_SET",
      `Unknown Migration set: ${requestedSet}`,
      { requestedSet },
    );
  }

  const root = resolve(workspaceRoot);
  const migrationRoot = resolve(root, "migrations");
  const configuredDirectory = MIGRATION_SET_DIRECTORIES[requestedSet];
  const directory = resolve(root, configuredDirectory);
  assertContainedPath(migrationRoot, directory, requestedSet);

  let canonicalMigrationRoot: string;
  let canonicalDirectory: string;
  try {
    [canonicalMigrationRoot, canonicalDirectory] = await Promise.all([
      realpath(migrationRoot),
      realpath(directory),
    ]);
  } catch (error) {
    throw new MigrationSetResolutionError(
      "MIGRATION_SET_DIRECTORY_UNAVAILABLE",
      `Migration set directory is unavailable: ${configuredDirectory}`,
      { set: requestedSet, directory: configuredDirectory },
      { cause: error },
    );
  }
  assertContainedPath(canonicalMigrationRoot, canonicalDirectory, requestedSet);

  const entries = await readdir(canonicalDirectory, { withFileTypes: true });
  const filenames: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new MigrationSetResolutionError(
        "MIGRATION_SET_SYMLINK_REJECTED",
        `Migration set contains a symbolic link: ${entry.name}`,
        { set: requestedSet, filename: entry.name },
      );
    }
    if (entry.isFile() && MIGRATION_FILENAME.test(entry.name)) filenames.push(entry.name);
  }
  filenames.sort();
  assertDuplicateSequencePolicy(requestedSet, filenames);

  return filenames.map((filename) => {
    const match = MIGRATION_FILENAME.exec(filename);
    const sequence = match?.[1];
    if (sequence === undefined) {
      throw new Error(`Invariant violation for validated Migration filename: ${filename}`);
    }
    return {
      set: requestedSet,
      sequence,
      filename,
      relativePath: `${configuredDirectory}/${filename}`,
      absolutePath: resolve(canonicalDirectory, filename),
    };
  });
}

function assertContainedPath(root: string, candidate: string, set: MigrationSet): void {
  const fromRoot = relative(root, candidate);
  if (
    fromRoot === "" ||
    (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot))
  ) {
    return;
  }
  throw new MigrationSetResolutionError(
    "MIGRATION_SET_PATH_ESCAPE",
    `Migration set path escapes the controlled migrations directory: ${set}`,
    { set },
  );
}

function assertDuplicateSequencePolicy(set: MigrationSet, filenames: readonly string[]): void {
  const bySequence = new Map<string, string[]>();
  for (const filename of filenames) {
    const sequence = MIGRATION_FILENAME.exec(filename)?.[1];
    if (sequence === undefined) continue;
    const matches = bySequence.get(sequence) ?? [];
    matches.push(filename);
    bySequence.set(sequence, matches);
  }

  for (const [sequence, matches] of bySequence) {
    if (matches.length < 2) continue;
    const allowed = ALLOWED_DUPLICATE_SEQUENCES[set]?.[sequence];
    if (
      allowed?.length === matches.length &&
      allowed.every((filename, index) => filename === matches[index])
    ) {
      continue;
    }
    throw new MigrationSetResolutionError(
      "DUPLICATE_MIGRATION_SEQUENCE",
      `Migration set ${set} contains duplicate sequence ${sequence}`,
      { set, sequence, filenames: matches },
    );
  }
}

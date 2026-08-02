import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  MIGRATION_SET_DIRECTORIES,
  isMigrationSet,
  resolveMigrationSet,
  type MigrationSet,
  type MigrationSetResolutionError,
} from "../src/index.js";

const temporaryRoots: string[] = [];
const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("MigrationSet resolver", () => {
  it("defines only the four controlled Migration sets", () => {
    expect(MIGRATION_SET_DIRECTORIES).toEqual({
      runtime: "migrations/runtime",
      "provider:ugv": "migrations/providers/ugv",
      "provider:npc-tank": "migrations/providers/npc-tank",
      pms: "migrations/pms",
    });
    expect(isMigrationSet("runtime")).toBe(true);
    expect(isMigrationSet("provider:other")).toBe(false);
  });

  it("returns only SQL from the selected set in deterministic filename order", async () => {
    const root = await fixtureRoot();
    await writeMigration(root, "runtime", "002_second.sql");
    await writeMigration(root, "runtime", "001_first.sql");
    await writeMigration(root, "provider:ugv", "001_provider.sql");
    await writeFile(join(root, "migrations/runtime/README.md"), "ignored\n");

    const files = await resolveMigrationSet(root, "runtime");

    expect(files.map(({ filename }) => filename)).toEqual(["001_first.sql", "002_second.sql"]);
    expect(files.map(({ relativePath }) => relativePath)).toEqual([
      "migrations/runtime/001_first.sql",
      "migrations/runtime/002_second.sql",
    ]);
    expect(files.every(({ set }) => set === "runtime")).toBe(true);
  });

  it("resolves the delivered owner directories without cross-set files", async () => {
    const [runtime, ugv, npcTank] = await Promise.all([
      resolveMigrationSet(workspaceRoot, "runtime"),
      resolveMigrationSet(workspaceRoot, "provider:ugv"),
      resolveMigrationSet(workspaceRoot, "provider:npc-tank"),
    ]);

    expect(runtime).toHaveLength(25);
    expect(runtime.map(({ filename }) => filename)).not.toContain("024_ugv_provider.sql");
    expect(runtime.map(({ filename }) => filename)).not.toContain("025_npc_tank_provider.sql");
    expect(ugv.map(({ filename }) => filename)).toEqual(["024_ugv_provider.sql"]);
    expect(npcTank.map(({ filename }) => filename)).toEqual(["025_npc_tank_provider.sql"]);
  });

  it("fails closed for unknown and traversal-shaped set names", async () => {
    const root = await fixtureRoot();

    for (const requestedSet of ["provider:other", "../runtime", "runtime/../../outside"]) {
      await expect(resolveMigrationSet(root, requestedSet)).rejects.toMatchObject({
        code: "UNKNOWN_MIGRATION_SET",
        details: { requestedSet },
      });
    }
  });

  it("rejects an owner directory that resolves outside migrations", async () => {
    const root = await fixtureRoot({ createRuntime: false });
    const outside = join(root, "outside");
    await mkdir(outside);
    await symlink(outside, join(root, "migrations/runtime"));

    await expect(resolveMigrationSet(root, "runtime")).rejects.toMatchObject({
      code: "MIGRATION_SET_PATH_ESCAPE",
    });
  });

  it("rejects symbolic links inside a Migration set", async () => {
    const root = await fixtureRoot();
    const outside = join(root, "outside.sql");
    await writeFile(outside, "SELECT 1;\n");
    await symlink(outside, join(root, "migrations/runtime/001_link.sql"));

    await expect(resolveMigrationSet(root, "runtime")).rejects.toMatchObject({
      code: "MIGRATION_SET_SYMLINK_REJECTED",
    });
  });

  it("rejects duplicate numeric sequences by default", async () => {
    const root = await fixtureRoot();
    await writeMigration(root, "provider:ugv", "001_alpha.sql");
    await writeMigration(root, "provider:ugv", "001_beta.sql");

    await expect(resolveMigrationSet(root, "provider:ugv")).rejects.toEqual(
      expect.objectContaining<Partial<MigrationSetResolutionError>>({
        code: "DUPLICATE_MIGRATION_SEQUENCE",
        details: {
          set: "provider:ugv",
          sequence: "001",
          filenames: ["001_alpha.sql", "001_beta.sql"],
        },
      }),
    );
  });

  it("allows only the two immutable Runtime 014 files in full-filename order", async () => {
    const root = await fixtureRoot();
    await writeMigration(root, "runtime", "014_start_confirmation_watchdog.sql");
    await writeMigration(root, "runtime", "014_observation_pagination.sql");

    await expect(resolveMigrationSet(root, "runtime")).resolves.toMatchObject([
      { sequence: "014", filename: "014_observation_pagination.sql" },
      { sequence: "014", filename: "014_start_confirmation_watchdog.sql" },
    ]);

    await writeMigration(root, "runtime", "014_unapproved.sql");
    await expect(resolveMigrationSet(root, "runtime")).rejects.toMatchObject({
      code: "DUPLICATE_MIGRATION_SEQUENCE",
    });
  });

  it("fails with a stable error when a known set directory is unavailable", async () => {
    const root = await fixtureRoot();

    await expect(resolveMigrationSet(root, "pms")).rejects.toMatchObject({
      code: "MIGRATION_SET_DIRECTORY_UNAVAILABLE",
      details: { set: "pms", directory: "migrations/pms" },
    });
  });
});

async function fixtureRoot(options: { createRuntime?: boolean } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sdar-migration-set-"));
  temporaryRoots.push(root);
  await Promise.all(
    (Object.keys(MIGRATION_SET_DIRECTORIES) as MigrationSet[])
      .filter((set) => set !== "pms" && (set !== "runtime" || options.createRuntime !== false))
      .map((set) => mkdir(join(root, MIGRATION_SET_DIRECTORIES[set]), { recursive: true })),
  );
  return root;
}

async function writeMigration(root: string, set: MigrationSet, filename: string): Promise<void> {
  await writeFile(join(root, MIGRATION_SET_DIRECTORIES[set], filename), "SELECT 1;\n");
}

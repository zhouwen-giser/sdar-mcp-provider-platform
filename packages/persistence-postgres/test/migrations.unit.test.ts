import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { listRuntimeMigrations, runMigrations } from "../src/migrations.js";

const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));

describe("Runtime Migration source", () => {
  it("binds the default Runner source to only the Runtime set", async () => {
    const migrations = await listRuntimeMigrations(workspaceRoot);
    const filenames = migrations.map(({ filename }) => filename);

    expect(migrations).toHaveLength(24);
    expect(filenames).toEqual([...filenames].sort());
    expect(filenames).toContain("001_operation_snapshot.sql");
    expect(filenames).toContain("023_business_events_profile_v1.sql");
    expect(filenames).not.toContain("024_ugv_provider.sql");
    expect(filenames).not.toContain("025_npc_tank_provider.sql");
    expect(
      migrations.filter(({ sequence }) => sequence === "014").map(({ filename }) => filename),
    ).toEqual(["014_observation_pagination.sql", "014_start_confirmation_watchdog.sql"]);
    expect(migrations.every(({ set }) => set === "runtime")).toBe(true);
    expect(
      migrations.every(({ relativePath }) => relativePath.startsWith("migrations/runtime/")),
    ).toBe(true);
  });

  it("rejects invalid timeout configuration before lock acquisition", async () => {
    const connect = {
      query: vi.fn(() => Promise.resolve({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    await expect(
      runMigrations({ connect: () => Promise.resolve(connect) } as never, undefined, {
        timeoutMs: 0,
      }),
    ).rejects.toThrow("timeoutMs must be a positive integer");
    expect(connect.query).not.toHaveBeenCalledWith(expect.stringContaining("pg_advisory_lock"));
    expect(connect.release).toHaveBeenCalledOnce();
  });
});

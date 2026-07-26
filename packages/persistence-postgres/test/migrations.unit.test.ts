import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listRuntimeMigrations } from "../src/migrations.js";

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
});

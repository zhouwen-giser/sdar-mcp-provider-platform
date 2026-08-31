import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface MigrationSourceMap {
  readonly inventory: {
    readonly mappedProvenanceEntries: number;
    readonly ownerDirectoryFiles: number;
  };
  readonly pathSemantics: { readonly sequence: string };
  readonly migrationSets: Record<string, { readonly deliveredFiles: number }>;
  readonly migrations: readonly {
    readonly sequence: number;
    readonly newPath: string;
  }[];
}

describe("migration source-map provenance", () => {
  it("keeps prior sequence identities and appends new migrations", () => {
    const source = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, "../../migrations/migration-source-map.json"),
        "utf8",
      ),
    ) as MigrationSourceMap;
    expect(source.pathSemantics.sequence).not.toMatch(/\b26\b/u);
    expect(source.migrations.map(({ sequence }) => sequence)).toEqual(
      Array.from({ length: source.migrations.length }, (_, index) => index + 1),
    );
    expect(source.inventory.mappedProvenanceEntries).toBe(source.migrations.length);
    expect(source.inventory.ownerDirectoryFiles).toBe(
      Object.values(source.migrationSets).reduce(
        (count, migrationSet) => count + migrationSet.deliveredFiles,
        0,
      ),
    );
    expect(sequenceFor(source, "migrations/providers/ugv/024_ugv_provider.sql")).toBe(25);
    expect(sequenceFor(source, "migrations/providers/npc-tank/025_npc_tank_provider.sql")).toBe(26);
    expect(sequenceFor(source, "migrations/pms/009_runtime_registration.sql")).toBe(27);
    expect(sequenceFor(source, "migrations/runtime/024_accepted_task_substate.sql")).toBe(28);
    expect(sequenceFor(source, "migrations/providers/ugv/026_ugv_single_active_fire.sql")).toBe(29);
    expect(
      sequenceFor(source, "migrations/providers/npc-tank/026_allow_authoritative_status_tool.sql"),
    ).toBe(30);
    expect(sequenceFor(source, "migrations/providers/ugv/027_mutation_journal.sql")).toBe(32);
    expect(sequenceFor(source, "migrations/providers/npc-tank/027_mutation_journal.sql")).toBe(33);
    expect(sequenceFor(source, "migrations/runtime/025_smpp_dispatch_uncertainty.sql")).toBe(34);
    expect(sequenceFor(source, "migrations/runtime/026_smpp_reconciliation_audit.sql")).toBe(35);
  });
});

function sequenceFor(source: MigrationSourceMap, path: string): number | undefined {
  return source.migrations.find((migration) => migration.newPath === path)?.sequence;
}

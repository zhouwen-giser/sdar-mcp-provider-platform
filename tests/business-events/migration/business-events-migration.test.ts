import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../../packages/persistence-postgres/src/index.js";
import { BusinessEventsPostgresHarness } from "../postgres-harness.js";

const harness = new BusinessEventsPostgresHarness();

beforeAll(() => harness.start());
afterAll(() => harness.stop());

describe("Business Events migration 023", () => {
  it("applies after the complete 022 baseline and records exactly one new migration", async () => {
    const applied = await harness.pool.query<{ version: string }>(
      "SELECT version FROM runtime_schema_migration ORDER BY version",
    );
    expect(applied.rows).toHaveLength(24);
    expect(applied.rows.at(-1)?.version).toBe("023_business_events_profile_v1.sql");
    expect(readdirSync(resolve("migrations")).filter((name) => name.startsWith("023_"))).toEqual([
      "023_business_events_profile_v1.sql",
    ]);
  });

  it("creates every durable authority and no second cursor table", async () => {
    const tables = await harness.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema=$1 AND (
         table_name LIKE 'provider_business_event%' OR
         table_name LIKE 'adapter_business_event%' OR
         table_name IN ('provider_task_resource_binding','provider_task_visibility_tombstone')
       ) ORDER BY table_name`,
      [harness.schema],
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "adapter_business_event_inbox",
      "adapter_business_event_source_state",
      "provider_business_event",
      "provider_business_event_continuity_record",
      "provider_business_event_generation_source",
      "provider_business_event_relation",
      "provider_business_event_relation_projection",
      "provider_business_event_relation_projection_item",
      "provider_business_event_runtime_state",
      "provider_business_event_stream_generation",
      "provider_task_resource_binding",
      "provider_task_visibility_tombstone",
    ]);
    expect(tables.rows.some((row) => row.table_name === "adapter_business_event_cursor")).toBe(
      false,
    );
  });

  it("serializes two replica migration races and remains checksum-idempotent", async () => {
    await Promise.all([runMigrations(harness.pool), runMigrations(harness.pool)]);
    const rows = await harness.pool.query<{ count: string }>(
      "SELECT count(*) FROM runtime_schema_migration WHERE version='023_business_events_profile_v1.sql'",
    );
    expect(rows.rows[0]?.count).toBe("1");
  });

  it("keeps historical migration bytes outside the new 023 file", () => {
    const migrations = readdirSync(resolve("migrations")).filter((name) =>
      /^0(?:0[1-9]|1[0-9]|2[0-2])_/.test(name),
    );
    expect(migrations).toHaveLength(23);
    expect(migrations.every((name) => readFileSync(resolve("migrations", name)).length > 0)).toBe(
      true,
    );
  });
});

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CatalogDiscoveryClient,
  type CatalogDiscoveryTransport,
  type DiscoveredCatalog,
} from "../../catalog-manager/src/index.js";
import { PostgresCatalogSnapshotRepository, runPmsMigrations } from "../src/index.js";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const providerId = "catalog-provider";

describe("immutable PostgreSQL CatalogSnapshot persistence", () => {
  const connectionString = requiredDatabaseUrl();
  const admin = new Pool({ connectionString });
  const schema = `catalog_snapshot_${randomUUID().replaceAll("-", "")}`;
  let pool: Pool;
  let repository: PostgresCatalogSnapshotRepository;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    await runPmsMigrations(pool, workspaceRoot);
    await pool.query(
      `INSERT INTO provider_type(provider_type_id,display_name,status)
       VALUES ('test.catalog','Catalog','active')`,
    );
    await pool.query(
      `INSERT INTO provider(provider_id,provider_type_id,hosting_mode,status)
       VALUES ($1,'test.catalog','vendor_managed','active')`,
      [providerId],
    );
    repository = new PostgresCatalogSnapshotRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("publishes a revision, active pointer, and audit atomically", async () => {
    const publication = await repository.publish(input(await catalog(["alpha"])));

    expect(publication).toMatchObject({
      created: true,
      snapshot: { providerId, revision: 1 },
    });
    expect(await repository.active(providerId)).toEqual(publication.snapshot);
    const audit = await pool.query<{
      action: string;
      actor_id: string;
      correlation_id: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT action,actor_id,correlation_id,metadata
         FROM audit WHERE subject_type='catalog_snapshot'`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.action).toBe("catalog.snapshot.published");
    expect(audit.rows[0]?.actor_id).toBe("runtime-reconciler");
    expect(audit.rows[0]?.correlation_id).toBe("catalog-discovery");
    expect(audit.rows[0]?.metadata).toMatchObject({ providerId, revision: 1 });
  });

  it("makes the same checksum a no-op without consuming a revision or audit", async () => {
    const identical = await repository.publish(input(await catalog(["alpha"])));

    expect(identical).toMatchObject({ created: false, snapshot: { revision: 1 } });
    expect(await repository.history(providerId)).toHaveLength(1);
    expect((await pool.query(`SELECT count(*)::integer AS count FROM audit`)).rows[0]).toEqual({
      count: 1,
    });
  });

  it("preserves immutable history and returns a stable tool diff", async () => {
    const second = await repository.publish(input(await catalog(["bravo", "charlie"])));

    expect(second).toMatchObject({ created: true, snapshot: { revision: 2 } });
    expect((await repository.history(providerId)).map(({ revision }) => revision)).toEqual([2, 1]);
    expect(await repository.diff(providerId, 1, 2)).toMatchObject({
      added: [{ name: "bravo" }, { name: "charlie" }],
      removed: [{ name: "alpha" }],
      changed: [],
    });
  });

  it("rejects administrator mutation or deletion of discovered schemas", async () => {
    await expect(
      pool.query(
        `UPDATE catalog_snapshot
            SET catalog_document=jsonb_set(
              catalog_document,
              '{tools,0,inputSchema}',
              '{"type":"string"}'::jsonb
            )
          WHERE provider_id=$1 AND revision=1`,
        [providerId],
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      pool.query(`DELETE FROM catalog_snapshot WHERE provider_id=$1 AND revision=1`, [providerId]),
    ).rejects.toMatchObject({ code: "55000" });
    expect((await repository.get(providerId, 1))?.document.tools[0]?.inputSchema).toEqual({
      type: "object",
    });
  });
});

function input(catalogValue: DiscoveredCatalog) {
  return {
    providerId,
    catalog: catalogValue,
    actorId: "runtime-reconciler",
    correlationId: "catalog-discovery",
    discoveredAt: new Date("2026-07-26T00:00:00.000Z"),
  };
}

async function catalog(names: string[]): Promise<DiscoveredCatalog> {
  const responses = [discoveryResponse(), toolsResponse(names)];
  const transport: CatalogDiscoveryTransport = {
    call: () => Promise.resolve(responses.shift()),
  };
  return new CatalogDiscoveryClient(transport).discover();
}

function discoveryResponse(): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: "catalog-server/discover",
    result: {
      resultType: "complete",
      supportedVersions: ["2026-07-28"],
      capabilities: {
        tools: {},
        extensions: {
          "io.modelcontextprotocol/tasks": {},
          "io.sdar/taskExecution": { profileVersion: "1.0", taskNotifications: true },
        },
      },
      _meta: {
        "io.modelcontextprotocol/serverInfo": {
          name: "sdar-mcp-tasks-provider-runtime",
          version: "2.0.0",
        },
      },
    },
  };
}

function toolsResponse(names: string[]): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: "catalog-tools/list",
    result: {
      tools: names.map((name) => ({
        name,
        description: `${name} operation`,
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        _meta: {
          "io.sdar/taskExecution": {
            profileVersion: "1.0",
            taskBehavior: "task_required",
            availability: "dynamic",
            supportsScheduling: true,
            supportsMaxElapsed: true,
            supportsObservations: true,
            supportsInputRequired: true,
            idempotency: "server_managed",
          },
        },
      })),
    },
  };
}

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined) throw new Error("TEST_DATABASE_URL is required");
  return value;
}

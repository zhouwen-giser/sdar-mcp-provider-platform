import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CatalogSnapshot, CatalogTool } from "../../catalog-manager/src/index.js";
import {
  PostgresRegistrySnapshotRepository,
  runPmsMigrations,
} from "../../pms-persistence-postgres/src/index.js";
import {
  buildRegistrySnapshot,
  type PublishRegistrySnapshot,
  type RegistryProviderInput,
} from "../src/index.js";

const workspaceRoot = resolve(import.meta.dirname, "../../..");

describe("PostgreSQL Registry Snapshot persistence", () => {
  const connectionString = requiredDatabaseUrl();
  const admin = new Pool({ connectionString });
  const schema = `registry_snapshot_${randomUUID().replaceAll("-", "")}`;
  let pool: Pool;
  let repository: PostgresRegistrySnapshotRepository;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    await runPmsMigrations(pool, workspaceRoot);
    repository = new PostgresRegistrySnapshotRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("publishes a revision, audit, and active LKG atomically", async () => {
    const publication = await repository.publish(publicationInput(["provider-a"]));

    expect(publication).toMatchObject({
      created: true,
      snapshot: { environment: "production", revision: 1 },
    });
    expect(await repository.latest("production")).toEqual(publication.snapshot);
    const audit = await pool.query<{ action: string; metadata: Record<string, unknown> }>(
      `SELECT action,metadata FROM audit WHERE subject_type='registry_snapshot'`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.action).toBe("registry.snapshot.published");
    expect(audit.rows[0]?.metadata).toMatchObject({ environment: "production", revision: 1 });
  });

  it("does not create a revision or audit for the same checksum", async () => {
    const repeated = await repository.publish(publicationInput(["provider-a"]));

    expect(repeated).toMatchObject({ created: false, snapshot: { revision: 1 } });
    expect(await repository.history("production")).toHaveLength(1);
    expect((await pool.query(`SELECT count(*)::integer AS count FROM audit`)).rows[0]).toEqual({
      count: 1,
    });
  });

  it("retains immutable history and reports provider changes", async () => {
    const changed = await repository.publish(publicationInput(["provider-b"]));

    expect(changed).toMatchObject({ created: true, snapshot: { revision: 2 } });
    expect((await repository.history("production")).map(({ revision }) => revision)).toEqual([
      2, 1,
    ]);
    expect(await repository.diff("production", 1, 2)).toMatchObject({
      added: [{ providerId: "provider-b" }],
      removed: [{ providerId: "provider-a" }],
      changed: [],
    });
    await expect(
      pool.query(
        `UPDATE registry_snapshot
            SET registry_document='{"environment":"production","providers":[]}'::jsonb
          WHERE environment='production' AND revision=1`,
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("reactivates an immutable historical checksum without inserting a duplicate", async () => {
    const reactivated = await repository.publish(publicationInput(["provider-a"]));

    expect(reactivated).toMatchObject({ created: false, snapshot: { revision: 1 } });
    expect(await repository.latest("production")).toMatchObject({
      revision: 1,
      document: { providers: [{ providerId: "provider-a" }] },
    });
    expect(await repository.history("production")).toHaveLength(2);
    const audit = await pool.query<{ action: string; subject_id: string }>(
      `SELECT action,subject_id
         FROM audit
        WHERE subject_type='registry_snapshot'
        ORDER BY occurred_at DESC
        LIMIT 1`,
    );
    expect(audit.rows[0]).toEqual({
      action: "registry.snapshot.reactivated",
      subject_id: "production:1",
    });
  });

  it("keeps the LKG when a candidate fails integrity validation", async () => {
    const before = await repository.latest("production");
    const candidate = buildRegistrySnapshot("production", [provider("provider-c")]);
    await expect(
      repository.publish({
        ...publicationInput(["provider-c"]),
        candidate: { ...candidate, canonicalJson: "{}" },
      }),
    ).rejects.toThrow("REGISTRY_CANDIDATE_INTEGRITY_INVALID");

    expect(await repository.latest("production")).toEqual(before);
    expect(await repository.history("production")).toHaveLength(2);
  });
});

function publicationInput(providerIds: string[]): PublishRegistrySnapshot {
  return {
    candidate: buildRegistrySnapshot("production", providerIds.map(provider)),
    actorId: "registry-publisher",
    correlationId: "registry-reconcile",
    publishedAt: new Date("2026-07-26T00:00:00.000Z"),
  };
}

function provider(providerId: string): RegistryProviderInput {
  return {
    providerId,
    serverId: `server-${providerId}`,
    protocolMode: "frozen_v1",
    effectiveEndpoint: `https://${providerId}.example.test`,
    catalog: catalog(providerId),
  };
}

function catalog(providerId: string): CatalogSnapshot {
  return {
    providerId,
    revision: 1,
    checksum: "a".repeat(64),
    document: {
      discovery: {
        resultType: "complete",
        supportedVersions: ["2026-07-28"],
        capabilities: frozenCapabilities(),
        serverInfo: { name: "runtime", version: "2.0.0" },
      },
      tools: [tool("operate")],
    },
    discoveredAt: new Date("2026-07-26T00:00:00.000Z"),
    createdAt: new Date("2026-07-26T00:00:00.000Z"),
  };
}

function frozenCapabilities() {
  return {
    tools: {},
    extensions: {
      "io.modelcontextprotocol/tasks": {},
      "io.sdar/taskExecution": { profileVersion: "1.0" as const, taskNotifications: true as const },
    },
  };
}

function tool(name: string): CatalogTool {
  return {
    name,
    description: `${name} operation`,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    taskExecution: {
      profileVersion: "1.0",
      taskBehavior: "task_required",
      availability: "dynamic",
      supportsScheduling: true,
      supportsMaxElapsed: true,
      supportsObservations: true,
      supportsInputRequired: true,
      idempotency: "server_managed",
    },
  };
}

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined) throw new Error("TEST_DATABASE_URL is required");
  return value;
}

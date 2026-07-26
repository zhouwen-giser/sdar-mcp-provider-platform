import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseConfigurationDefinition } from "../../runtime-configuration-contract/src/index.js";
import {
  ConfigurationCenter,
  ConfigurationPublicationService,
  type ConfigurationContent,
} from "../../configuration-center/src/index.js";
import { PostgresPmsUnitOfWork, postgresRepositories, runPmsMigrations } from "../src/index.js";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const definition = parseConfigurationDefinition({
  schemaVersion: "1.0",
  definitionId: "test.publication",
  definitionVersion: 1,
  configGroup: "test.publication",
  targetTypes: ["provider"],
  inheritance: { enabled: true, order: ["provider", "system_default"] },
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["ENABLED", "ENDPOINT"],
    properties: {
      ENABLED: { type: "boolean" },
      ENDPOINT: { type: "string", minLength: 1 },
    },
  },
  defaults: { ENABLED: false, ENDPOINT: "local" },
  secretPaths: [],
  fields: [field("ENABLED", "hot_reload"), field("ENDPOINT", "reconnect_required")],
});

describe("PostgreSQL configuration publication", () => {
  const connectionString = requiredDatabaseUrl();
  const admin = new Pool({ connectionString });
  const schema = `pms_config_publish_${randomUUID().replaceAll("-", "")}`;
  let pool: Pool;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
    await runPmsMigrations(pool, workspaceRoot);
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("publishes in a short transaction, no-ops identical checksum, and audits once", async () => {
    const first = harness(pool, "provider-sequential", { ENABLED: true });
    const published = await first.service.publish(
      {
        draftId: first.draftId,
        expectedDraftVersion: first.version,
        expectedPublishedRevision: null,
      },
      context("publish-1"),
    );
    expect(published).toMatchObject({
      outcome: "published",
      revision: { revision: 1, status: "published", applyMode: "hot_reload" },
    });

    const identical = harness(pool, "provider-sequential", { ENABLED: true });
    const noChange = await identical.service.publish(
      {
        draftId: identical.draftId,
        expectedDraftVersion: identical.version,
        expectedPublishedRevision: null,
      },
      context("publish-noop"),
    );
    expect(noChange).toMatchObject({
      outcome: "no_change",
      revision: { revision: 1, revisionId: published.revision.revisionId },
    });

    const repositories = postgresRepositories(pool);
    const history = await repositories.configuration.listRevisions(published.revision.target, {
      limit: 10,
    });
    expect(history.items).toHaveLength(1);
    const audit = await repositories.audit.list({
      limit: 10,
      subjectType: "configuration_revision",
    });
    expect(audit.items).toHaveLength(1);
    expect(audit.items[0]).toMatchObject({
      action: "configuration.published",
      actorId: "admin-1",
      correlationId: "publish-1",
      metadata: { revision: 1, checksum: published.revision.checksum },
    });
  });

  it("creates a new monotonic revision for rollback and never reactivates history", async () => {
    const changed = harness(pool, "provider-sequential", { ENDPOINT: "remote" });
    const second = await changed.service.publish(
      {
        draftId: changed.draftId,
        expectedDraftVersion: changed.version,
        expectedPublishedRevision: 1,
      },
      context("publish-2"),
    );
    expect(second.revision).toMatchObject({ revision: 2, status: "published" });
    const historyBeforeRollback = await postgresRepositories(pool).configuration.listRevisions(
      second.revision.target,
      { limit: 10 },
    );
    const source = historyBeforeRollback.items.find(({ revision }) => revision === 1);
    if (source === undefined) throw new Error("ROLLBACK_SOURCE_MISSING");

    const rollback = await changed.service.rollback(
      {
        draftId: changed.draftId,
        expectedDraftVersion: changed.version,
        expectedPublishedRevision: 2,
        sourceRevisionId: source.revisionId,
      },
      context("rollback-1"),
    );

    expect(rollback).toMatchObject({
      outcome: "published",
      revision: {
        revision: 3,
        status: "published",
        checksum: source.checksum,
        content: source.content,
      },
    });
    const history = await postgresRepositories(pool).configuration.listRevisions(
      second.revision.target,
      { limit: 10 },
    );
    expect(history.items.map(({ revision, status }) => [revision, status])).toEqual([
      [3, "published"],
      [2, "superseded"],
      [1, "superseded"],
    ]);
    const rollbackAudit = await postgresRepositories(pool).audit.list({
      limit: 10,
      correlationId: "rollback-1",
    });
    expect(rollbackAudit.items[0]).toMatchObject({
      action: "configuration.rolled_back",
      metadata: { rollbackSourceRevisionId: source.revisionId },
    });
  });

  it("serializes concurrent same-content publish into one revision and one no-op", async () => {
    const left = harness(pool, "provider-concurrent-same", { ENABLED: true });
    const right = harness(pool, "provider-concurrent-same", { ENABLED: true });

    const results = await Promise.all([
      left.service.publish(
        {
          draftId: left.draftId,
          expectedDraftVersion: left.version,
          expectedPublishedRevision: null,
        },
        context("same-left"),
      ),
      right.service.publish(
        {
          draftId: right.draftId,
          expectedDraftVersion: right.version,
          expectedPublishedRevision: null,
        },
        context("same-right"),
      ),
    ]);

    expect(results.map(({ outcome }) => outcome).sort()).toEqual(["no_change", "published"]);
    const history = await postgresRepositories(pool).configuration.listRevisions(
      results[0].revision.target,
      { limit: 10 },
    );
    expect(history.items).toHaveLength(1);
  });

  it("allows only one of two concurrent different-content publishes", async () => {
    const left = harness(pool, "provider-concurrent-different", { ENABLED: true });
    const right = harness(pool, "provider-concurrent-different", { ENDPOINT: "remote" });

    const results = await Promise.allSettled([
      left.service.publish(
        {
          draftId: left.draftId,
          expectedDraftVersion: left.version,
          expectedPublishedRevision: null,
        },
        context("different-left"),
      ),
      right.service.publish(
        {
          draftId: right.draftId,
          expectedDraftVersion: right.version,
          expectedPublishedRevision: null,
        },
        context("different-right"),
      ),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { code: "CONFIGURATION_PUBLISH_CONFLICT" },
    });
  });

  it("enforces immutable revision payload and deletion in PostgreSQL", async () => {
    const revision = await pool.query<{ revision_id: string }>(
      `SELECT revision_id FROM config_revision ORDER BY created_at LIMIT 1`,
    );
    const revisionId = revision.rows[0]?.revision_id;
    if (revisionId === undefined) throw new Error("CONFIG_REVISION_MISSING");

    await expect(
      pool.query(`UPDATE config_revision SET content='{}'::jsonb WHERE revision_id=$1`, [
        revisionId,
      ]),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      pool.query(`DELETE FROM config_revision WHERE revision_id=$1`, [revisionId]),
    ).rejects.toMatchObject({ code: "55000" });
  });
});

function harness(pool: Pool, targetId: string, content: ConfigurationContent) {
  const center = new ConfigurationCenter([definition]);
  const draftId = randomUUID();
  center.createDraft({
    draftId,
    definitionId: definition.definitionId,
    key: {
      environment: "production",
      targetType: "provider",
      targetId,
      configGroup: definition.configGroup,
      dataId: "main",
    },
    content,
  });
  const validated = center.validateDraft(draftId);
  return {
    draftId,
    version: validated.version,
    service: new ConfigurationPublicationService(center, new PostgresPmsUnitOfWork(pool)),
  };
}

function context(correlationId: string) {
  return { actorId: "admin-1", correlationId };
}

function field(name: string, applyMode: "hot_reload" | "reconnect_required") {
  return {
    path: `/${name}`,
    displayName: name,
    description: `${name} setting`,
    applyMode,
    required: true,
    secret: false,
    overridePolicy: {
      mode: "inheritable" as const,
      allowedTargetTypes: ["provider"] as const,
    },
  };
}

function requiredDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (value === undefined || value.length === 0) throw new Error("TEST_DATABASE_URL is required");
  return value;
}

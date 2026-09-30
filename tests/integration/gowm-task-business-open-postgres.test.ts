import { createHash, randomUUID } from "node:crypto";
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { UgvTaskBusinessContextService } from "../../apps/ugv-provider-adapter/src/task-business-service.js";
import type { AdapterBusinessEvent } from "../../packages/adapter-protocol/src/index.js";
import { TaskRepository } from "../../packages/persistence-postgres/src/tasks.js";
import {
  createGowmPool,
  verifyGowmStorage,
  verifyGowmTaskBusinessRuntimeCommands,
  type GowmStorageConfig,
} from "../../packages/gowm-shared-storage-adapter/src/index.js";
import {
  BoundExecutionScope,
  BusinessCommandRecordSchema,
  openGowmTaskBusinessStore,
  scopeBusinessIdentity,
  taskBusinessInputResponseHash,
  type PostgresTaskBusinessStore,
  type ProviderExecution,
} from "../../packages/provider-adapter-kit/src/index.js";
import { TaskArtifactSchema } from "../../packages/vehicle-provider-core/src/task-business-artifact.js";
import {
  TaskBusinessContextSchema,
  TaskBusinessFeedbackBodySchema,
} from "../../packages/vehicle-provider-core/src/task-business-contract.js";

const enabled = process.env.SMPP_GOWM_SHARED_OPEN_TEST_ENABLE === "true";
const configFile = process.env.SMPP_GOWM_SHARED_OPEN_TEST_CONFIG_FILE;
if (enabled && !configFile) throw new Error("ISOLATED_GOWM_OPEN_TEST_CONFIG_REQUIRED");

const fixtureSchema = z
  .object({
    databaseUrl: z.url(),
    contractDir: z.string().min(1),
    serviceKey: z.string().min(1),
    sourceSessionKey: z.string().min(1),
    dataScopeKey: z.string().min(1),
    providerId: z.string().min(1),
    deviceIds: z.tuple([z.string().min(1), z.string().min(1)]),
    bindingIds: z.tuple([z.uuid(), z.uuid()]),
    resourceIds: z.tuple([z.string().min(1), z.string().min(1)]),
  })
  .strict();
type Fixture = z.infer<typeof fixtureSchema>;

function readFixture(): Fixture {
  if (!configFile) throw new Error("ISOLATED_GOWM_OPEN_TEST_CONFIG_REQUIRED");
  let fixture: Fixture;
  try {
    fixture = fixtureSchema.parse(JSON.parse(readFileSync(configFile, "utf8")) as unknown);
  } catch {
    throw new Error("ISOLATED_GOWM_OPEN_TEST_CONFIG_INVALID");
  }
  if (
    !new URL(fixture.databaseUrl).pathname.includes("test") ||
    fixture.deviceIds[0] === fixture.deviceIds[1] ||
    fixture.bindingIds[0] === fixture.bindingIds[1]
  )
    throw new Error("ISOLATED_GOWM_OPEN_TEST_DATABASE_REQUIRED");
  return fixture;
}

const suite = enabled ? describe : describe.skip;
suite("GOWM shared Task Business Store in an isolated database", () => {
  let fixture: Fixture;
  let configs: [GowmStorageConfig, GowmStorageConfig];
  let pools: [Pool, Pool];
  let stores: [PostgresTaskBusinessStore, PostgresTaskBusinessStore];
  const runKey = randomUUID();
  const taskId = `ugvb-shared-${runKey}`;
  const externalExecutionId = `ugvb-execution-${runKey}`;
  const commandId = `ugvb-command-${runKey}`;
  const now = new Date().toISOString();

  function execution(index: 0 | 1): ProviderExecution {
    const config = configs[index];
    const resourceId = fixture.resourceIds[index];
    return {
      taskId,
      externalExecutionId,
      operationName: "vehicle_navigate",
      argumentHash: createHash("sha256").update(runKey).digest("hex"),
      providerId: fixture.providerId,
      resourceId,
      tracks: [],
      arguments: {
        resourceId,
        mission: { type: "point", target: { longitude: 116.2, latitude: 39.2 } },
      },
      executionContext: {
        authorizationContextHash: "a".repeat(64),
        executionMode: "SIMULATION",
        simulationId: fixture.dataScopeKey,
        correlationId: runKey,
      },
      deviceContext: {
        deviceId: fixture.deviceIds[index],
        dataScopeKey: fixture.dataScopeKey,
        bindingId: config.bindingId,
        smppServiceKey: config.serviceKey,
        providerId: fixture.providerId,
        resourceId,
        sourceSessionKey: config.sourceSessionKey,
      },
      taskBusinessContextExpected: true,
      downstreamMissionIds: [],
      state: "RUNNING",
      revision: 1,
      reasonCode: "ISOLATED_GOWM_TEST_FIXTURE",
      createdAt: now,
      updatedAt: now,
      evidence: [],
    };
  }

  async function seedScenario(index: 0 | 1, name: string) {
    const run = {
      ...execution(index),
      taskId: `${taskId}-${name}`,
      externalExecutionId: `${externalExecutionId}-${name}`,
    };
    const scope = BoundExecutionScope.fromExecution(run);
    const store = stores[index];
    const service = new UgvTaskBusinessContextService(
      { getExecution: async (id) => (id === run.taskId ? run : undefined) },
      store,
      fixture.providerId,
      run.resourceId,
      () => undefined,
    );
    await service.ensureForCreatedExecution(run.taskId);
    const context = await store.getContext(scope);
    const artifact = await store.getArtifactVersion(scope, "navigation-requested-destination", 1);
    if (!context || !artifact) throw new Error("GOWM_SCENARIO_SEED_MISSING");
    const nextArtifact = TaskArtifactSchema.parse({
      ...artifact,
      revision: 2,
      updatedAt: new Date(Date.parse(now) + 1_000).toISOString(),
    });
    const ref = { kind: "artifact" as const, id: artifact.artifactId, revision: 2 };
    const nextContext = TaskBusinessContextSchema.parse({
      ...context,
      contextRevision: context.contextRevision + 1,
      artifactRefs: [...context.artifactRefs, ref],
      updatedAt: nextArtifact.updatedAt,
    });
    const changeSet = {
      scope,
      expectedContextRevision: context.contextRevision,
      context: nextContext,
      objects: [{ kind: "artifact" as const, value: nextArtifact }],
    };
    const event = {
      body: TaskBusinessFeedbackBodySchema.parse({
        schemaVersion: "sdar.task-business-feedback/1.0-rc2",
        kind: "ARTIFACT_CHANGED",
        contextRevision: nextContext.contextRevision,
        providerRecordedAt: nextArtifact.updatedAt,
        payload: {
          change: "update",
          artifactRef: ref,
          previousRevision: 1,
          reasonCode: "ISOLATED_GOWM_TEST_FIXTURE",
        },
      }),
      description: "Isolated GOWM artifact update",
      reasonCode: "ISOLATED_GOWM_TEST_FIXTURE",
      severityHint: "info" as const,
    };
    return { run, scope, store, context, artifact, nextArtifact, changeSet, event };
  }

  function claimFor(scope: BoundExecutionScope, name: string) {
    return BusinessCommandRecordSchema.parse({
      commandId: `${commandId}-${name}`,
      commandType: "input_response",
      entryKey: `input:${name}`,
      runtimeCommandSequence: "1",
      identity: scopeBusinessIdentity(scope),
      requestHash: "c".repeat(64),
      responseHash: taskBusinessInputResponseHash({ action: "decline" }),
      state: "accepted",
      createdAt: now,
      updatedAt: now,
    });
  }

  beforeAll(async () => {
    fixture = readFixture();
    const configFor = (index: 0 | 1): GowmStorageConfig => ({
      mode: "gowm-shared",
      databaseUrl: fixture.databaseUrl,
      contractDir: fixture.contractDir,
      serviceKey: fixture.serviceKey,
      sourceSessionKey: fixture.sourceSessionKey,
      allowedDeviceIds: [fixture.deviceIds[index]],
      bindingId: fixture.bindingIds[index],
    });
    configs = [configFor(0), configFor(1)];
    pools = [createGowmPool(configs[0], 2), createGowmPool(configs[1], 2)];
    stores = [
      await openGowmTaskBusinessStore(pools[0], configs[0]),
      await openGowmTaskBusinessStore(pools[1], configs[1]),
    ];
  }, 30_000);

  afterAll(async () => {
    await Promise.all((pools ?? []).map((pool) => pool.end()));
  });

  it("opens both device bindings under a non-bypass application role", async () => {
    for (const pool of pools) {
      const result = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      );
      expect(result.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    }
  });

  it("checks promoted Runtime input using valid scoped SQL aliases under both application bindings", async () => {
    for (const pool of pools)
      await expect(
        new TaskRepository(pool).rejectClaimedPromotedInputIfPayloadMismatch({
          taskId: runKey,
          commandSequence: 1,
          commandType: "UPDATE",
          payload: {},
          state: "CLAIMED",
          attemptCount: 1,
          claimOwner: "isolated-test",
          stopReason: null,
          adapterAck: null,
          nextAttemptAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          claimUntil: null,
        }),
      ).resolves.toBe(false);
  });

  it("persists same-name Context, Artifact and source events in two device scopes", async () => {
    for (const index of [0, 1] as const) {
      const run = execution(index);
      const events: AdapterBusinessEvent[] = [];
      const service = new UgvTaskBusinessContextService(
        { getExecution: async (requestedTaskId) => (requestedTaskId === taskId ? run : undefined) },
        stores[index],
        fixture.providerId,
        run.resourceId,
        (event) => events.push(event),
      );
      await service.ensureForCreatedExecution(taskId);
      const scope = BoundExecutionScope.fromExecution(run);
      expect(await stores[index].getContext(scope)).toMatchObject({ contextRevision: 1 });
      expect(
        await stores[index].getArtifactLatest(scope, "navigation-requested-destination"),
      ).toMatchObject({ artifactType: "navigation.destination" });
      expect(events).toHaveLength(2);
      const sourceRows = await pools[index].query<{ count: number }>(
        "SELECT count(*)::int AS count FROM ugv_business_event_source_log WHERE source_event_id=ANY($1::text[])",
        [events.map((event) => event.sourceEventId)],
      );
      expect(sourceRows.rows[0]?.count).toBe(2);
      const visible = await pools[index].query<{ count: number }>(
        "SELECT count(*)::int AS count FROM ugv_task_business_context WHERE task_id=$1",
        [taskId],
      );
      expect(visible.rows[0]?.count).toBe(1);
    }
    for (const index of [0, 1] as const) {
      await expect(
        stores[index].getContext(BoundExecutionScope.fromExecution(execution(index === 0 ? 1 : 0))),
      ).rejects.toThrow("GOWM_BUSINESS_SCOPE_MISMATCH");
    }
  });

  it("verifies the Runtime intervention overlay and rejects an unpinned replacement constraint", async () => {
    await verifyGowmTaskBusinessRuntimeCommands(pools[0], configs[0]);
    await verifyGowmStorage(pools[0], configs[0]);
    const dir = mkdtempSync(join(tmpdir(), "smpp-runtime-overlay-"));
    try {
      cpSync(configs[0].contractDir, dir, { recursive: true });
      const path = join(dir, "task-business-runtime.json");
      const altered = JSON.parse(readFileSync(path, "utf8")) as { installedSha256: string };
      altered.installedSha256 = "0".repeat(64);
      writeFileSync(path, JSON.stringify(altered));
      await expect(verifyGowmStorage(pools[0], { contractDir: dir })).rejects.toThrow(
        "GOWM_BUSINESS_RUNTIME_INSTALL_HISTORY_MISMATCH",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("claims the same command ID independently in both device scopes", async () => {
    for (const index of [0, 1] as const) {
      const scope = BoundExecutionScope.fromExecution(execution(index));
      const record = BusinessCommandRecordSchema.parse({
        commandId,
        commandType: "input_response",
        entryKey: "input:isolated-fixture",
        runtimeCommandSequence: "1",
        identity: scopeBusinessIdentity(scope),
        requestHash: "c".repeat(64),
        responseHash: taskBusinessInputResponseHash({ action: "decline" }),
        state: "accepted",
        createdAt: now,
        updatedAt: now,
      });
      expect((await stores[index].claimCommand(scope, record)).claimed).toBe(true);
      expect(await stores[index].getCommand(scope, commandId)).toMatchObject({ commandId });
      const visible = await pools[index].query<{ count: number }>(
        "SELECT count(*)::int AS count FROM ugv_task_business_command WHERE command_id=$1",
        [commandId],
      );
      expect(visible.rows[0]?.count).toBe(1);
    }
  });

  it("hydrates exact artifact versions and rejects stale Context writes", async () => {
    const { store, scope, artifact, nextArtifact, changeSet, event } = await seedScenario(
      0,
      "versions",
    );
    const committed = await store.commitBusinessChangeSet(changeSet, [event]);
    expect(committed.events).toHaveLength(1);
    expect(await store.getArtifactVersion(scope, artifact.artifactId, 1)).toEqual(artifact);
    expect(await store.getArtifactVersion(scope, artifact.artifactId, 2)).toEqual(nextArtifact);
    expect(await store.getArtifactLatest(scope, artifact.artifactId)).toEqual(nextArtifact);
    expect(await store.getArtifactVersion(scope, artifact.artifactId, 3)).toBeUndefined();
    await expect(store.commitBusinessChangeSet(changeSet, [event])).rejects.toThrow(
      "BUSINESS_CONTEXT_REVISION_CONFLICT",
    );
    expect(await store.getContext(scope)).toEqual(changeSet.context);
  });

  it("replays the original command and rejects changed requests under the same ID", async () => {
    const { store, scope } = await seedScenario(0, "idempotency");
    const record = claimFor(scope, "idempotency");
    expect(await store.claimCommand(scope, record)).toEqual({ claimed: true, record });
    expect(await store.claimCommand(scope, record)).toEqual({ claimed: false, record });
    await expect(
      store.claimCommand(scope, { ...record, requestHash: "d".repeat(64) }),
    ).rejects.toThrow("COMMAND_ID_CONFLICT");
    expect(await store.getCommand(scope, record.commandId)).toEqual(record);
  });

  it("rolls back objects, Context, command and source events on a late SQL failure", async () => {
    const { store, scope, context, artifact, changeSet, event, run } = await seedScenario(
      0,
      "rollback",
    );
    const record = claimFor(scope, "rollback");
    await store.claimCommand(scope, record);
    const completed = BusinessCommandRecordSchema.parse({
      ...record,
      state: "applied",
      resultCode: "ISOLATED_GOWM_TEST_APPLIED",
      resultRefs: [{ kind: "artifact", id: artifact.artifactId, revision: 2 }],
    });
    const atomicChange = { ...changeSet, command: completed };
    const sourceRows = async () =>
      (
        await pools[0].query<{ source_event_id: string; source_sequence: string }>(
          `SELECT source_event_id,source_sequence::text FROM ugv_business_event_source_log AS log
           WHERE payload->>'externalExecutionId'=$1 ORDER BY log.source_sequence`,
          [run.externalExecutionId],
        )
      ).rows;
    const before = await sourceRows();
    expect(before).toHaveLength(2);

    // Inject a real PostgreSQL error on the second source append, after the
    // object, Context, command and first event have already been written.
    // The app role needs no DDL, trigger, owner or privilege modifications.
    const originals = new Map<PoolClient, PoolClient["query"]>();
    let appendAttempts = 0;
    const injectFailure = (client: PoolClient) => {
      if (originals.has(client)) return;
      const original = client.query;
      originals.set(client, original);
      client.query = ((...args: unknown[]) => {
        if (
          typeof args[0] === "string" &&
          /INSERT INTO (?:ugv_smpp\.)?ugv_business_event_source_log\b/i.test(args[0]) &&
          ++appendAttempts === 2
        ) {
          const failed: unknown = Reflect.apply(original, client, ["SELECT 1 / 0"]);
          return failed;
        }
        const result: unknown = Reflect.apply(original, client, args);
        return result;
      }) as PoolClient["query"];
    };
    pools[0].on("acquire", injectFailure);
    try {
      await expect(
        store.commitBusinessChangeSet(atomicChange, [event, event]),
      ).rejects.toMatchObject({ code: "22012" });
      expect(appendAttempts).toBe(2);
    } finally {
      pools[0].off("acquire", injectFailure);
      for (const [client, original] of originals) client.query = original;
    }
    expect(await store.getContext(scope)).toEqual(context);
    expect(await store.getArtifactLatest(scope, artifact.artifactId)).toEqual(artifact);
    expect(await store.getArtifactVersion(scope, artifact.artifactId, 2)).toBeUndefined();
    expect(await store.getCommand(scope, record.commandId)).toEqual(record);
    expect(await sourceRows()).toEqual(before);

    const committed = await store.commitBusinessChangeSet(atomicChange, [event, event]);
    expect(committed.events).toHaveLength(2);
    expect(await store.getContext(scope)).toEqual(changeSet.context);
    expect(await store.getCommand(scope, record.commandId)).toEqual(completed);
    expect(await store.getArtifactVersion(scope, artifact.artifactId, 2)).toEqual(
      changeSet.objects[0]?.value,
    );
    expect((await sourceRows()).map((row) => row.source_event_id)).toEqual([
      ...before.map((row) => row.source_event_id),
      ...committed.events.map((item) => item.sourceEventId),
    ]);
  });

  it("recovers versions and command receipts through a fresh strict opener", async () => {
    const { store, scope, artifact, nextArtifact, changeSet, event } = await seedScenario(
      1,
      "reconnect",
    );
    const record = claimFor(scope, "reconnect");
    await store.claimCommand(scope, record);
    await store.commitBusinessChangeSet(changeSet, [event]);
    const pool = createGowmPool(configs[1], 1);
    try {
      const reopened = await openGowmTaskBusinessStore(pool, configs[1]);
      expect(await reopened.getContext(scope)).toEqual(changeSet.context);
      expect(await reopened.getArtifactVersion(scope, artifact.artifactId, 1)).toEqual(artifact);
      expect(await reopened.getArtifactLatest(scope, artifact.artifactId)).toEqual(nextArtifact);
      expect(await reopened.getCommand(scope, record.commandId)).toEqual(record);
      expect(await reopened.claimCommand(scope, record)).toEqual({ claimed: false, record });
      expect(await reopened.getContextSnapshot(scope)).toEqual(
        await store.getContextSnapshot(scope),
      );
    } finally {
      await pool.end();
    }
  });

  it("hides the run from different binding, service and source-session settings", async () => {
    const variations: GowmStorageConfig[] = [
      { ...configs[0], bindingId: configs[1].bindingId },
      { ...configs[0], serviceKey: `${configs[0].serviceKey}-other` },
      { ...configs[0], sourceSessionKey: `${configs[0].sourceSessionKey}-other` },
    ];
    for (const config of variations) {
      const pool = createGowmPool(config, 1);
      try {
        const context = await pool.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM ugv_task_business_context WHERE task_id=$1",
          [taskId],
        );
        const command = await pool.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM ugv_task_business_command WHERE command_id=$1",
          [commandId],
        );
        expect(context.rows[0]?.count).toBe(0);
        expect(command.rows[0]?.count).toBe(0);
      } finally {
        await pool.end();
      }
    }
  });
});

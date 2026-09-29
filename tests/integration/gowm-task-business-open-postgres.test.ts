import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { UgvTaskBusinessContextService } from "../../apps/ugv-provider-adapter/src/task-business-service.js";
import type { AdapterBusinessEvent } from "../../packages/adapter-protocol/src/index.js";
import {
  createGowmPool,
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

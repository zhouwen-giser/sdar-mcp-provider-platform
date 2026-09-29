import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { runUgvProviderMigrations } from "../../apps/ugv-provider-adapter/src/migrate.js";
import { protoStructToJson } from "../../packages/adapter-protocol/src/index.js";
import {
  BoundExecutionScope,
  PostgresTaskBusinessStore,
  TaskBusinessCommandService,
  type BusinessObjectVersion,
  type ProviderExecution,
} from "../../packages/provider-adapter-kit/src/index.js";
import { TaskArtifactSchema } from "../../packages/vehicle-provider-core/src/task-business-artifact.js";
import { TaskBusinessContextSchema } from "../../packages/vehicle-provider-core/src/task-business-contract.js";
import {
  BusinessActionSchema,
  RequiredInputSchema,
  RuntimeInterventionCommandSchema,
  RuntimeInterventionSchema,
} from "../../packages/vehicle-provider-core/src/task-business-interaction.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl)
  throw new Error("TEST_DATABASE_URL is required for native Intervention submission");

const catalog = z
  .object({
    context: TaskBusinessContextSchema,
    artifacts: z.array(TaskArtifactSchema),
    action: BusinessActionSchema,
    requiredInput: RequiredInputSchema,
    intervention: RuntimeInterventionSchema,
    interventionCommand: RuntimeInterventionCommandSchema,
  })
  .parse(
    JSON.parse(readFileSync("protocol/task-business/v1/examples/positive-catalog.json", "utf8")),
  );
const schema = `ugvb_submission_${randomUUID().replaceAll("-", "")}`;
let admin: Pool;
let pool: Pool;
let store: PostgresTaskBusinessStore;

beforeAll(async () => {
  admin = new Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(databaseUrl);
  url.searchParams.set("options", `-c search_path=${schema}`);
  pool = new Pool({ connectionString: url.toString(), max: 3 });
  await runUgvProviderMigrations(pool, resolve(import.meta.dirname, "../.."));
  store = new PostgresTaskBusinessStore(pool);
});

afterAll(async () => {
  await pool?.end();
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});

async function fixture(simulationId: string) {
  const execution: ProviderExecution = {
    taskId: catalog.context.identity.taskId,
    externalExecutionId: catalog.context.identity.executionId,
    providerId: catalog.context.identity.providerId,
    resourceId: catalog.context.identity.resourceId,
    operationName: catalog.context.identity.operationName,
    argumentHash: "a".repeat(64),
    tracks: [],
    arguments: {},
    executionContext: {
      authorizationContextHash: "b".repeat(64),
      executionMode: "simulation",
      simulationId,
      correlationId: "submission-test",
    },
    downstreamMissionIds: [],
    state: "RUNNING",
    revision: 1,
    reasonCode: "TEST",
    createdAt: "2026-09-23T00:00:00Z",
    updatedAt: "2026-09-23T00:00:00Z",
    evidence: [],
  };
  const scope = BoundExecutionScope.fromExecution(execution);
  const route = catalog.artifacts.find((item) => item.artifactId === "route-line");
  if (!route) throw new Error("CATALOG_ROUTE_MISSING");
  const context = TaskBusinessContextSchema.parse({ ...catalog.context, contextRevision: 1 });
  const objects: BusinessObjectVersion[] = [
    { kind: "artifact", value: route },
    { kind: "action", value: catalog.action },
    { kind: "input_request", value: catalog.requiredInput },
    { kind: "intervention", value: catalog.intervention },
  ];
  await store.commitChangeSet({ scope, expectedContextRevision: null, context, objects });
  const service = new TaskBusinessCommandService(store);
  return { scope, context, service };
}

const responder = {
  source: "runtime_authorization_context",
  actorType: "user",
  verified: true,
} as const;

describe("native PostgreSQL Intervention submission", () => {
  it("commits accepted command, submitted object, Context and two source events once", async () => {
    const { scope, context, service } = await fixture("submission-success");
    const first = await service.submitIntervention({
      scope,
      command: catalog.interventionCommand,
      responder,
      runtimeCommandSequence: "91",
    });
    expect(first.claimed).toBe(true);
    expect(first.events).toHaveLength(2);
    const current = await store.getContext(scope);
    expect(current).toMatchObject({
      contextRevision: 2,
      effectivePlanRevision: context.effectivePlanRevision,
      activeRefs: { route: context.activeRefs.route, intervention: { revision: 2 } },
    });
    const submittedRef = current?.activeRefs.intervention;
    if (!submittedRef) throw new Error("SUBMITTED_REF_MISSING");
    expect(await store.getObjectVersion(scope, submittedRef)).toMatchObject({
      kind: "intervention",
      value: { state: "submitted", acceptedCommandId: first.record.commandId },
    });
    const source = await pool.query<{ payload: { sourceEventId: string } }>(
      "SELECT payload FROM ugv_business_event_source_log ORDER BY source_sequence",
    );
    expect(source.rows.map((row) => row.payload.sourceEventId)).toEqual(
      first.events?.map((event) => event.sourceEventId),
    );
    expect(first.events?.map((event) => protoStructToJson(event.rawPayload))).toMatchObject([
      {
        kind: "BUSINESS_EVENT",
        contextRevision: 2,
        payload: { contextDelta: { effectivePlanRevision: context.effectivePlanRevision } },
      },
      {
        kind: "INTERVENTION_CHANGED",
        contextRevision: 2,
        payload: { interventionRef: submittedRef, previousRevision: 1 },
      },
    ]);
    expect(
      await service.submitIntervention({
        scope,
        command: catalog.interventionCommand,
        responder,
        runtimeCommandSequence: "91",
      }),
    ).toEqual({ claimed: false, record: first.record });
    expect((await pool.query("SELECT 1 FROM ugv_business_event_source_log")).rowCount).toBe(2);
    await expect(
      service.submitIntervention({
        scope,
        command: { ...catalog.interventionCommand, commandId: "another-adjustment" },
        responder,
        runtimeCommandSequence: "92",
      }),
    ).rejects.toThrow("INTERVENTION_NOT_AVAILABLE");
  });

  it("rolls back a claim if the submitted version cannot be inserted", async () => {
    const { scope, context, service } = await fixture("submission-rollback");
    const hidden = RuntimeInterventionSchema.parse({ ...catalog.intervention, revision: 2 });
    await store.commitChangeSet({
      scope,
      expectedContextRevision: 1,
      context: TaskBusinessContextSchema.parse({ ...context, contextRevision: 2 }),
      objects: [{ kind: "intervention", value: hidden }],
    });
    await expect(
      service.submitIntervention({
        scope,
        command: catalog.interventionCommand,
        responder,
        runtimeCommandSequence: "93",
      }),
    ).rejects.toThrow();
    expect(await store.getCommand(scope, catalog.interventionCommand.commandId)).toBeUndefined();
    expect((await store.getContext(scope))?.contextRevision).toBe(2);
    expect((await pool.query("SELECT 1 FROM ugv_business_event_source_log")).rowCount).toBe(2);
  });

  it("rejects same-entry Input and Intervention validity-window rewrites atomically", async () => {
    const { scope, context } = await fixture("immutable-entry-window");
    const nextContext = TaskBusinessContextSchema.parse({ ...context, contextRevision: 2 });
    const shiftedInput = RequiredInputSchema.parse({
      ...catalog.requiredInput,
      revision: 2,
      requestedAt: "2026-09-23T00:00:01Z",
    });
    await expect(
      store.commitChangeSet({
        scope,
        expectedContextRevision: 1,
        context: nextContext,
        objects: [{ kind: "input_request", value: shiftedInput }],
      }),
    ).rejects.toThrow("NEW_REQUEST_REQUIRED");
    const extendedIntervention = RuntimeInterventionSchema.parse({
      ...catalog.intervention,
      revision: 2,
      validUntil: "2026-09-24T00:00:00Z",
    });
    await expect(
      store.commitChangeSet({
        scope,
        expectedContextRevision: 1,
        context: nextContext,
        objects: [{ kind: "intervention", value: extendedIntervention }],
      }),
    ).rejects.toThrow("NEW_INTERVENTION_REQUIRED");
    expect((await store.getContext(scope))?.contextRevision).toBe(1);
    expect(
      await store.getObjectVersion(scope, {
        kind: "input_request",
        id: shiftedInput.requestId,
        revision: 2,
      }),
    ).toBeUndefined();
    expect(
      await store.getObjectVersion(scope, {
        kind: "intervention",
        id: extendedIntervention.interventionId,
        revision: 2,
      }),
    ).toBeUndefined();
  });
});

import { randomUUID } from "node:crypto";
import * as grpc from "@grpc/grpc-js";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ProviderTelemetryIngress,
  ProviderTelemetryGrpcServer,
  recordToGrpcStruct,
  telemetryClientConstructor,
  telemetryServiceDefinition,
  type ProviderTelemetryEventInput,
  type ProviderTelemetryEventType,
} from "../../packages/provider-telemetry/src/index.js";
import {
  runMigrations,
  SmppDiagnosticRepository,
} from "../../packages/persistence-postgres/src/index.js";
import { VehicleTelemetry } from "../../packages/vehicle-provider-core/src/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration");
}

const schema = `telemetry_ingress_${randomUUID().replaceAll("-", "")}`;
const adminPool = new Pool({ connectionString: databaseUrl, max: 1 });
const pool = new Pool({
  connectionString: databaseUrl,
  max: 8,
  options: `-c search_path=${schema}`,
});
const options = { providerId: "provider-1", instanceId: "runtime-1" };

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA ${schema}`);
  await runMigrations(pool);
  await pool.query(
    `INSERT INTO operation_snapshot
       (snapshot_id,provider_id,provider_version,operation_name,manifest_hash,definition)
     VALUES ('00000000-0000-4000-8000-000000000401','provider-1','1.0.0',
       'durable_task',repeat('a',64),'{}'::jsonb)`,
  );
  await pool.query(
    `INSERT INTO provider_task
       (task_id,provider_id,operation_name,operation_snapshot_id,authorization_context_hash,
        execution_mode,simulation_id,arguments,argument_hash,external_execution_id,
        internal_state,mcp_status,substate,accepted_at,timing,adapter_revision,observation_revision,
        trace_id,root_traceparent,root_tracestate,correlation_id)
     VALUES ('00000000-0000-4000-8000-000000000402','provider-1','durable_task',
       '00000000-0000-4000-8000-000000000401',repeat('b',64),'simulation','sim-1',
       '{}'::jsonb,repeat('c',64),'execution-1','RUNNING','working','running',
       clock_timestamp(),'{}'::jsonb,7,9,repeat('d',32),
       '00-dddddddddddddddddddddddddddddddd-eeeeeeeeeeeeeeee-01','vendor=task','task-correlation')`,
  );
});

beforeEach(async () => {
  await pool.query("TRUNCATE provider_ops_delivery");
});

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await adminPool.end();
});

describe("Runtime ProviderTelemetryIngress", () => {
  it.each(["RESOURCE_STATE", "RESOURCE_METRIC", "RESOURCE_HEALTH"] as const)(
    "provider_can_emit_%s as a resource-only event",
    async (eventType) => {
      const result = await emit(new ProviderTelemetryIngress(pool, options), event(eventType));
      expect(result).toMatchObject({ accepted: true, duplicate: false });
    },
  );

  it("provider_can_emit_execution_progress with authoritative Task context", async () => {
    const result = await emit(
      new ProviderTelemetryIngress(pool, options),
      event("EXECUTION_PROGRESS", {
        taskId: "00000000-0000-4000-8000-000000000402",
        externalExecutionId: "execution-1",
        operationName: "durable_task",
      }),
    );
    expect(result).toMatchObject({ accepted: true });
    const stored = await pool.query<{ record_body: Record<string, unknown> }>(
      "SELECT record_body FROM provider_ops_delivery",
    );
    expect(stored.rows[0]?.record_body).toMatchObject({
      providerId: "provider-1",
      externalExecutionId: "execution-1",
      operationName: "durable_task",
      executionMode: "simulation",
      simulationId: "sim-1",
      argumentHash: "c".repeat(64),
      authorizationContextHash: "b".repeat(64),
      adapterRevision: "7",
      observationRevision: 9,
      attributes: { linkedTaskTraceId: "d".repeat(32) },
    });
  });

  it("normalizes Provider-authoritative evidence and exact/conflicting mission identity", async () => {
    const ingress = new ProviderTelemetryIngress(pool, options);
    const identity = {
      taskId: "00000000-0000-4000-8000-000000000402",
      externalExecutionId: "execution-1",
      operationName: "durable_task",
    };
    expect(
      await emit(
        ingress,
        event("RESOURCE_STATE", {
          ...identity,
          providerEventId: "evidence-position-1",
          providerEventSequence: 10,
          attributes: {
            "sdar.evidence.kind": "position",
            "sdar.evidence.position": { latitude: 31.2, longitude: 121.5 },
          },
          payload: { state: "observed", reasonCode: "POSITION_OBSERVED" },
        }),
      ),
    ).toMatchObject({ accepted: true });
    expect(
      await emit(
        ingress,
        event("RESOURCE_STATE", {
          ...identity,
          providerEventId: "evidence-mission-1",
          providerEventSequence: 11,
          attributes: {
            "sdar.evidence.kind": "mission",
            "sdar.device.mission_id": "mission-7",
          },
          payload: { state: "running", reasonCode: "MISSION_OBSERVED" },
        }),
      ),
    ).toMatchObject({ accepted: true });

    const diagnostics = new SmppDiagnosticRepository(pool);
    expect(await diagnostics.listProviderEvidence(identity.taskId)).toEqual([
      expect.objectContaining({
        taskId: identity.taskId,
        externalExecutionId: "execution-1",
        resourceId: "resource-1",
        kind: "position",
        sourceSequence: 10,
      }),
      expect.objectContaining({
        kind: "mission",
        deviceMissionId: "mission-7",
        sourceSequence: 11,
      }),
    ]);
    expect(await diagnostics.getMissionRelation(identity.taskId)).toMatchObject({
      externalExecutionId: "execution-1",
      deviceMissionId: "mission-7",
      relationStatus: "exact",
    });
    const exactRelationFact = await pool.query<{ body: Record<string, unknown> }>(
      `SELECT record_body AS body FROM provider_ops_delivery
       WHERE record_body->>'eventType'='smpp.mission.relation'
       ORDER BY created_at DESC LIMIT 1`,
    );
    expect(exactRelationFact.rows[0]?.body).toMatchObject({
      recordType: "provider.execution.progress",
      eventCategory: "execution.progress",
      taskId: identity.taskId,
      externalExecutionId: "execution-1",
      attributes: {
        "sdar.fact.kind": "mission_relation",
        "sdar.mission.relation_status": "exact",
        "sdar.device.mission_id": "mission-7",
      },
      payload: { relationStatus: "exact", deviceMissionId: "mission-7" },
    });

    await emit(
      ingress,
      event("RESOURCE_STATE", {
        ...identity,
        providerEventId: "evidence-mission-contradiction",
        providerEventSequence: 12,
        attributes: {
          "sdar.evidence.kind": "mission",
          "sdar.device.mission_id": "mission-8",
        },
        payload: { state: "running", reasonCode: "MISSION_OBSERVED" },
      }),
    );
    expect(await diagnostics.getMissionRelation(identity.taskId)).toMatchObject({
      deviceMissionId: null,
      relationStatus: "conflict",
    });
    const conflictRelationFact = await pool.query<{ body: Record<string, unknown> }>(
      `SELECT record_body AS body FROM provider_ops_delivery
       WHERE record_body->>'eventType'='smpp.mission.relation'
         AND record_body->'payload'->>'relationStatus'='conflict'`,
    );
    expect(conflictRelationFact.rows[0]?.body).toMatchObject({
      recordType: "provider.execution.progress",
      payload: {
        relationStatus: "conflict",
        deviceMissionId: null,
      },
    });
  });

  it("keeps a mission observation without identity unresolved", async () => {
    const input = event("RESOURCE_STATE", {
      taskId: "00000000-0000-4000-8000-000000000402",
      externalExecutionId: "execution-1",
      operationName: "durable_task",
      providerEventId: "evidence-mission-unresolved",
      attributes: { "sdar.evidence.kind": "mission" },
      payload: { state: "unknown", reasonCode: "MISSION_ID_UNAVAILABLE" },
    });
    expect(await emit(new ProviderTelemetryIngress(pool, options), input)).toMatchObject({
      accepted: true,
    });
    expect(await new SmppDiagnosticRepository(pool).getMissionRelation(input.taskId)).toMatchObject(
      { relationStatus: "unresolved", deviceMissionId: null },
    );
  });

  it("execution_progress_requires_task", async () => {
    expect(
      await emit(new ProviderTelemetryIngress(pool, options), event("EXECUTION_PROGRESS")),
    ).toMatchObject({ accepted: false, reasonCode: "PROVIDER_EVENT_TASK_REQUIRED" });
  });

  it("task_identity_mismatch_is_rejected", async () => {
    expect(
      await emit(
        new ProviderTelemetryIngress(pool, options),
        event("EXECUTION_PROGRESS", {
          taskId: "00000000-0000-4000-8000-000000000402",
          externalExecutionId: "wrong-execution",
          operationName: "durable_task",
        }),
      ),
    ).toMatchObject({ accepted: false, reasonCode: "PROVIDER_EVENT_EXECUTION_ID_MISMATCH" });
  });

  it("provider_identity_mismatch_is_rejected", async () => {
    const ingress = new ProviderTelemetryIngress(pool, options);
    const response = await ingress.emit("other-provider", {
      providerId: "other-provider",
      events: [event("RESOURCE_STATE")],
    });
    expect(response.results[0]).toMatchObject({
      accepted: false,
      reasonCode: "PROVIDER_IDENTITY_MISMATCH",
    });
  });

  it("duplicate_provider_event_is_idempotent across replicas", async () => {
    const input = event("RESOURCE_STATE");
    const first = new ProviderTelemetryIngress(pool, options);
    const second = new ProviderTelemetryIngress(pool, options);
    const results = await Promise.all([emit(first, input), emit(second, input)]);
    expect(results.map((result) => result.accepted)).toEqual([true, true]);
    expect(results.map((result) => result.duplicate).sort()).toEqual([false, true]);
    expect(new Set(results.map((result) => result.recordId))).toHaveLength(1);
    expect(await pool.query("SELECT 1 FROM provider_ops_delivery")).toMatchObject({ rowCount: 1 });
  });

  it("provider_event_id_conflict_is_rejected", async () => {
    const ingress = new ProviderTelemetryIngress(pool, options);
    const input = event("RESOURCE_METRIC");
    expect(await emit(ingress, input)).toMatchObject({ accepted: true });
    expect(await emit(ingress, { ...input, payload: { value: 999 } })).toMatchObject({
      accepted: false,
      reasonCode: "PROVIDER_EVENT_ID_CONFLICT",
    });
  });

  it("provider_payload_is_sanitized", async () => {
    const input = event("RESOURCE_STATE", {
      payload: { state: "ready", token: "secret-token", authorization: "Bearer secret" },
    });
    expect(await emit(new ProviderTelemetryIngress(pool, options), input)).toMatchObject({
      accepted: true,
    });
    const stored = await pool.query<{ body: string }>(
      "SELECT record_body::text AS body FROM provider_ops_delivery",
    );
    expect(stored.rows[0]?.body).not.toContain("secret");
    expect(stored.rows[0]?.body).toContain("ready");
  });

  it("provider_event_unknown_fields_are_removed", async () => {
    const input = event("RESOURCE_STATE", {
      payload: {
        state: "ready",
        reasonCode: "HEALTHY",
        unknown: "must-not-cross-boundary",
        nestedUnknown: { value: "also-removed" },
      },
    });
    expect(await emit(new ProviderTelemetryIngress(pool, options), input)).toMatchObject({
      accepted: true,
    });
    const stored = await pool.query<{ payload: Record<string, unknown> }>(
      "SELECT record_body->'payload' AS payload FROM provider_ops_delivery",
    );
    expect(stored.rows[0]?.payload).toEqual({ state: "ready", reasonCode: "HEALTHY" });
  });

  it("oversized_provider_event_is_rejected", async () => {
    const ingress = new ProviderTelemetryIngress(pool, { ...options, maxEventBytes: 512 });
    expect(
      await emit(ingress, event("RESOURCE_STATE", { payload: { value: "x".repeat(1_000) } })),
    ).toMatchObject({ accepted: false, reasonCode: "PROVIDER_EVENT_TOO_LARGE" });
  });

  it("non-finite provider payload numbers are rejected without throwing", async () => {
    expect(
      await emit(
        new ProviderTelemetryIngress(pool, options),
        event("RESOURCE_METRIC", {
          payload: { metricName: "temperature", value: Number.NaN, unit: "c" },
        }),
      ),
    ).toMatchObject({ accepted: false, reasonCode: "PROVIDER_EVENT_PAYLOAD_INVALID" });
  });

  it("provider_event_rate_limit_is_enforced", async () => {
    const ingress = new ProviderTelemetryIngress(pool, { ...options, rateLimit: 1 });
    expect(await emit(ingress, event("RESOURCE_STATE"))).toMatchObject({ accepted: true });
    expect(
      await emit(ingress, event("RESOURCE_STATE", { providerEventId: "event-2" })),
    ).toMatchObject({ accepted: false, reasonCode: "PROVIDER_EVENT_RATE_LIMITED" });
  });

  it("preserves Struct payloads across the real VehicleTelemetry gRPC transport", async () => {
    const server = new ProviderTelemetryGrpcServer(new ProviderTelemetryIngress(pool, options), {
      host: "127.0.0.1",
      port: 0,
      tlsMode: "disabled",
    });
    const port = await server.start();
    const telemetry = new VehicleTelemetry({
      providerId: "provider-1",
      resourceId: "resource-1",
      resourceType: "database",
      enabled: true,
      endpoint: `127.0.0.1:${String(port)}`,
      tlsMode: "disabled",
      flushIntervalMs: 10_000,
    });
    try {
      await telemetry.metric("temperature", 12, "c", "good", {
        attributes: { region: "test", nested: { healthy: true } },
      });
      await telemetry.flush();
      expect(telemetry.snapshot()).toMatchObject({ sent: 1, accepted: 1, rejected: 0 });
      const stored = await pool.query<{
        attributes: Record<string, unknown>;
        payload: Record<string, unknown>;
      }>(
        "SELECT record_body->'attributes' AS attributes,record_body->'payload' AS payload FROM provider_ops_delivery",
      );
      expect(stored.rows[0]).toEqual({
        attributes: { region: "test", nested: { healthy: true } },
        payload: { metricName: "temperature", value: 12, unit: "c", quality: "good" },
      });
    } finally {
      await telemetry.closeAndDrain();
      await server.close();
    }
  });

  it("serializes plain records for every public telemetry gRPC client", async () => {
    const server = new ProviderTelemetryGrpcServer(new ProviderTelemetryIngress(pool, options), {
      host: "127.0.0.1",
      port: 0,
      tlsMode: "disabled",
    });
    const port = await server.start();
    const Client = telemetryClientConstructor();
    const client = new Client(
      `127.0.0.1:${String(port)}`,
      grpc.credentials.createInsecure(),
    ) as unknown as TelemetryClient;
    const input = event("RESOURCE_STATE", {
      providerEventId: "plain-record-client",
      attributes: { region: "west", nested: { healthy: true } },
      payload: { state: "ready", reasonCode: "RESOURCE_READY" },
    });
    try {
      const response = await new Promise<{ results: { accepted: boolean }[] }>(
        (resolve, reject) => {
          client.emitProviderEvents(
            { providerId: "provider-1", events: [input] },
            (error, value) => (error === null ? resolve(value) : reject(error)),
          );
        },
      );
      expect(response.results).toEqual([expect.objectContaining({ accepted: true })]);
      const stored = await pool.query<{
        attributes: Record<string, unknown>;
        payload: Record<string, unknown>;
      }>(
        "SELECT record_body->'attributes' AS attributes,record_body->'payload' AS payload FROM provider_ops_delivery WHERE record_body->>'providerEventId'=$1",
        [input.providerEventId],
      );
      expect(stored.rows[0]).toEqual({
        attributes: { region: "west", nested: { healthy: true } },
        payload: { state: "ready", reasonCode: "RESOURCE_READY" },
      });
    } finally {
      client.close();
      await server.close();
    }
  });

  it("applies batch and rate limits to malformed wire Struct events", async () => {
    const server = new ProviderTelemetryGrpcServer(
      new ProviderTelemetryIngress(pool, { ...options, maxBatch: 1, rateLimit: 1 }),
      { host: "127.0.0.1", port: 0, tlsMode: "disabled" },
    );
    const port = await server.start();
    const RawClient = grpc.makeGenericClientConstructor(
      telemetryServiceDefinition(),
      "RawProviderTelemetryIngress",
    );
    const client = new RawClient(
      `127.0.0.1:${String(port)}`,
      grpc.credentials.createInsecure(),
    ) as unknown as TelemetryClient;
    const valid = wireEvent(event("RESOURCE_METRIC", { providerEventId: "wire-valid" }));
    const malformed = {
      ...wireEvent(event("RESOURCE_METRIC", { providerEventId: "wire-malformed" })),
      attributes: {
        fields: { invalid: { kind: "numberValue", numberValue: Number.NaN } },
      },
    };
    try {
      const oversized = await callTelemetry(client, {
        providerId: "provider-1",
        events: [malformed, valid],
      });
      expect(oversized.results).toEqual([
        expect.objectContaining({ reasonCode: "PROVIDER_EVENT_BATCH_TOO_LARGE" }),
        expect.objectContaining({ reasonCode: "PROVIDER_EVENT_BATCH_TOO_LARGE" }),
      ]);
      expect(
        await callTelemetry(client, { providerId: "provider-1", events: [malformed] }),
      ).toMatchObject({
        results: [
          expect.objectContaining({
            accepted: false,
            reasonCode: "PROVIDER_EVENT_PAYLOAD_INVALID",
          }),
        ],
      });
      expect(
        await callTelemetry(client, { providerId: "provider-1", events: [valid] }),
      ).toMatchObject({
        results: [
          expect.objectContaining({ accepted: false, reasonCode: "PROVIDER_EVENT_RATE_LIMITED" }),
        ],
      });
    } finally {
      client.close();
      await server.close();
    }
  });
});

type TelemetryClient = grpc.Client & {
  emitProviderEvents(
    request: unknown,
    callback: (
      error: grpc.ServiceError | null,
      response: { results: { accepted: boolean; reasonCode: string }[] },
    ) => void,
  ): grpc.ClientUnaryCall;
};

function callTelemetry(
  client: TelemetryClient,
  request: unknown,
): Promise<{ results: { accepted: boolean; reasonCode: string }[] }> {
  return new Promise((resolve, reject) => {
    client.emitProviderEvents(request, (error, value) =>
      error === null ? resolve(value) : reject(error),
    );
  });
}

function wireEvent(input: ProviderTelemetryEventInput): Record<string, unknown> {
  return {
    ...input,
    attributes: recordToGrpcStruct(input.attributes),
    payload: recordToGrpcStruct(input.payload),
  };
}

async function emit(ingress: ProviderTelemetryIngress, input: ProviderTelemetryEventInput) {
  const response = await ingress.emit("provider-1", { providerId: "provider-1", events: [input] });
  const result = response.results[0];
  if (result === undefined) throw new Error("PROVIDER_EVENT_RESULT_MISSING");
  return result;
}

function event(
  eventType: ProviderTelemetryEventType,
  overrides: Partial<ProviderTelemetryEventInput> = {},
): ProviderTelemetryEventInput {
  const now = Date.now();
  return {
    providerEventId: "event-1",
    providerEventSequence: 1,
    eventType,
    resourceId: "resource-1",
    resourceType: "database",
    taskId: "",
    externalExecutionId: "",
    operationName: "",
    occurredAt: { seconds: Math.floor(now / 1_000), nanos: (now % 1_000) * 1_000_000 },
    attributes: { region: "test" },
    payload: { value: 1 },
    traceparent: "",
    tracestate: "",
    ...overrides,
  };
}

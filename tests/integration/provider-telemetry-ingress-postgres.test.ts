import { randomUUID } from "node:crypto";
import * as grpc from "@grpc/grpc-js";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ProviderTelemetryIngress,
  ProviderTelemetryGrpcServer,
  telemetryClientConstructor,
  type ProviderTelemetryEventInput,
  type ProviderTelemetryEventType,
} from "../../packages/provider-telemetry/src/index.js";
import { runMigrations } from "../../packages/persistence-postgres/src/index.js";

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

  it("provider_event_rate_limit_is_enforced", async () => {
    const ingress = new ProviderTelemetryIngress(pool, { ...options, rateLimit: 1 });
    expect(await emit(ingress, event("RESOURCE_STATE"))).toMatchObject({ accepted: true });
    expect(
      await emit(ingress, event("RESOURCE_STATE", { providerEventId: "event-2" })),
    ).toMatchObject({ accepted: false, reasonCode: "PROVIDER_EVENT_RATE_LIMITED" });
  });

  it("exposes the Runtime-hosted batch unary gRPC service", async () => {
    const server = new ProviderTelemetryGrpcServer(new ProviderTelemetryIngress(pool, options), {
      host: "127.0.0.1",
      port: 0,
      tlsMode: "disabled",
    });
    const port = await server.start();
    const Client = telemetryClientConstructor() as unknown as new (
      address: string,
      credentials: grpc.ChannelCredentials,
    ) => TelemetryClient;
    const client = new Client(`127.0.0.1:${String(port)}`, grpc.credentials.createInsecure());
    try {
      const response = await new Promise<{ results: { accepted: boolean }[] }>(
        (resolve, reject) => {
          client.emitProviderEvents(
            { providerId: "provider-1", events: [event("RESOURCE_STATE")] },
            (error, value) => {
              if (error === null) resolve(value);
              else reject(error);
            },
          );
        },
      );
      expect(response.results).toEqual([expect.objectContaining({ accepted: true })]);
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
      response: { results: { accepted: boolean }[] },
    ) => void,
  ): grpc.ClientUnaryCall;
};

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

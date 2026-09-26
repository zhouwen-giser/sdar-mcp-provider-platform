import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "../../apps/runtime/src/config.js";
import { createRuntime, type RuntimeApplication } from "../../apps/runtime/src/runtime.js";
import { UgvBusinessEventHub } from "../../apps/ugv-provider-adapter/src/business-events.js";
import { runUgvProviderMigrations } from "../../apps/ugv-provider-adapter/src/migrate.js";
import { UgvProviderRuntime } from "../../apps/ugv-provider-adapter/src/runtime.js";
import { UgvProviderServer } from "../../apps/ugv-provider-adapter/src/server.js";
import { openUgvTaskBusinessStore } from "../../apps/ugv-provider-adapter/src/task-business-bootstrap.js";
import { UgvTaskBusinessContextService } from "../../apps/ugv-provider-adapter/src/task-business-service.js";
import { UgvTelemetry } from "../../apps/ugv-provider-adapter/src/telemetry.js";
import {
  bootstrapTaskBusinessReducer,
  normalizeTaskBusinessSseNotification,
  reduceTaskBusinessFeedback,
  type TaskBusinessSnapshotPage,
  unresolvedTaskBusinessRefs,
} from "../../packages/mcp-protocol/src/index.js";
import { runMigrations } from "../../packages/persistence-postgres/src/index.js";
import {
  BoundExecutionScope,
  BusinessCommandRecordSchema,
  PostgresProviderStore,
  TaskBusinessCommandService,
  type PostgresTaskBusinessStore,
} from "../../packages/provider-adapter-kit/src/index.js";
import { DISABLED_UGV_TASK_BUSINESS_SETTINGS } from "../../packages/runtime-configuration-contract/src/providers/ugv-business.js";
import { MockUgvDeviceMcpClient } from "../../packages/vehicle-device-mcp-client/src/index.js";
import { VehicleMqttIngress } from "../../packages/vehicle-mqtt-ingress/src/index.js";
import { TaskArtifactSchema } from "../../packages/vehicle-provider-core/src/task-business-artifact.js";
import { runReadOnlyTaskBusinessProbe } from "../../scripts/task-business/read-only-probe.js";
import {
  TaskBusinessContextSchema,
  TaskBusinessFeedbackBodySchema,
} from "../../packages/vehicle-provider-core/src/task-business-contract.js";
import {
  BusinessActionSchema,
  RuntimeInterventionCommandSchema,
  RuntimeInterventionSchema,
} from "../../packages/vehicle-provider-core/src/task-business-interaction.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl)
  throw new Error("TEST_DATABASE_URL is required for UGV business Runtime integration");

const providerId = "isr.vehicle.ugv.business-public-pg";
const suffix = randomUUID().replaceAll("-", "");
const runtimeSchema = `ugvb_public_runtime_${suffix}`;
const providerSchema = `ugvb_public_provider_${suffix}`;
let admin: Pool;
let runtimePool: Pool;
let providerStore: PostgresProviderStore;
let businessStore: PostgresTaskBusinessStore;
let eventHub: UgvBusinessEventHub;
let runtime: RuntimeApplication;
let httpRuntimeUrl: string;
let adapterRuntime: UgvProviderRuntime;
let adapterServer: UgvProviderServer;
let device: MockUgvDeviceMcpClient;
let ingress: VehicleMqttIngress;

beforeAll(async () => {
  admin = new Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`CREATE SCHEMA ${runtimeSchema}`);
  await admin.query(`CREATE SCHEMA ${providerSchema}`);
  const runtimeUrl = new URL(databaseUrl);
  runtimeUrl.searchParams.set("options", `-c search_path=${runtimeSchema}`);
  const providerUrl = new URL(databaseUrl);
  providerUrl.searchParams.set("options", `-c search_path=${providerSchema}`);
  runtimePool = new Pool({ connectionString: runtimeUrl.toString(), max: 3 });
  await runMigrations(runtimePool);

  providerStore = new PostgresProviderStore(providerUrl.toString(), 4);
  await runUgvProviderMigrations(providerStore.pool, resolve(import.meta.dirname, "../.."));
  await providerStore.initialize();
  const business = await openUgvTaskBusinessStore(providerStore, {
    ...DISABLED_UGV_TASK_BUSINESS_SETTINGS,
    enabled: true,
    coverage: { mode: "device_reported" },
  });
  if (!business) throw new Error("UGV_TASK_BUSINESS_STORE_NOT_OPEN");
  businessStore = business;
  ingress = new VehicleMqttIngress("direct_domain_json", {
    maxPayloadBytes: 65_536,
    maxDepth: 16,
    maxNodes: 4_096,
    maxStringBytes: 16_384,
  });
  ingress.setConnected(true);
  ingress.handle(
    "/ugv/gnss",
    Buffer.from('{"entity_id":"ugv1","latitude":30.1,"longitude":114.1}'),
  );
  ingress.handle(
    "/ugv/component_status",
    Buffer.from(
      '{"entity_id":"ugv1","power_battery":0,"lvbattery":0,"fuel":0,"water_temp":0,"motor":0,"sensor":0,"gnss":0,"comms":0,"weapon":0,"navigation":0}',
    ),
  );
  ingress.handle(
    "status/ugv",
    Buffer.from(
      '{"vehicle_id":"ugv1","role_name":"ugv","speed_kmh":0,"chassis_task":{"state":-1,"progress":0},"eo_task":{"state":-1,"progress":0},"weapon_task":{"state":-1,"progress":0},"available":true}',
    ),
  );
  device = new MockUgvDeviceMcpClient();
  eventHub = new UgvBusinessEventHub(providerStore);
  const service = new UgvTaskBusinessContextService(
    providerStore,
    business,
    providerId,
    "vehicle:ugv1",
    (event) => eventHub.notifyCommittedTaskBusinessEvent(event),
  );
  adapterRuntime = new UgvProviderRuntime(
    {
      providerId,
      resourceId: "vehicle:ugv1",
      freshness: { chassis: 3_000, mission: 3_000, health: 5_000, target: 3_000, payload: 3_000 },
      allowNavigationWithRecon: true,
      fireRequiresChassisStopped: true,
      pollIntervalMs: 60_000,
    },
    providerStore,
    ingress,
    device,
    eventHub,
    new UgvTelemetry({
      providerId,
      enabled: false,
      endpoint: "127.0.0.1:7002",
      tlsMode: "disabled",
    }),
    service,
  );
  await adapterRuntime.initialize();
  adapterServer = new UgvProviderServer(
    { providerId, providerVersion: "1.0.0", host: "127.0.0.1", port: 0, tlsMode: "disabled" },
    adapterRuntime,
    providerStore,
    eventHub,
  );
  const port = await adapterServer.start();
  runtime = createRuntime(
    loadRuntimeConfig({
      RUNTIME_ENV: "test",
      PROVIDER_ID: providerId,
      DATABASE_URL: runtimeUrl.toString(),
      ADAPTER_ENDPOINT: `127.0.0.1:${String(port)}`,
      ADAPTER_TLS_MODE: "disabled",
      AUTH_MODE: "trusted_headers",
      LOG_LEVEL: "error",
      OTEL_ENABLED: "false",
      PROVIDER_TELEMETRY_INGRESS_ENABLED: "false",
      BUSINESS_EVENTS_ENABLED: "true",
      SCHEDULER_POLL_MS: "60000",
      BUSINESS_EVENTS_POLL_INTERVAL_MS: "100",
    }),
  );
  await runtime.initialize();
  await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  const address = runtime.app.server.address();
  if (address === null || typeof address === "string") throw new Error("RUNTIME_BIND_FAILED");
  httpRuntimeUrl = `http://127.0.0.1:${String(address.port)}/mcp`;
});

afterAll(async () => {
  await runtime?.app.close();
  await adapterServer?.close();
  await adapterRuntime?.close();
  await runtimePool?.end();
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS ${providerSchema} CASCADE`);
    await admin.query(`DROP SCHEMA IF EXISTS ${runtimeSchema} CASCADE`);
    await admin.end();
  }
});

async function request(
  method: string,
  params: Record<string, unknown>,
  name?: string,
  subject = "ugvb-public-pg-user",
) {
  const response = await fetch(httpRuntimeUrl, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...(name === undefined ? {} : { "mcp-name": name }),
      "x-sdar-subject": subject,
      "x-sdar-tenant": "ugvb-public-pg-tenant",
      "x-sdar-execution-mode": "simulation",
      "x-sdar-simulation-id": "ugvb-public-pg-isolated",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "ugvb-public-pg", version: "1.0.0" },
          "io.modelcontextprotocol/clientCapabilities": {
            extensions: {
              "io.modelcontextprotocol/tasks": {},
              "io.sdar/taskBusiness": { profileVersion: "1.0-rc2" },
            },
          },
          ...(params._meta as Record<string, unknown> | undefined),
        },
      },
    }),
  });
  const body = await response.text();
  return {
    statusCode: response.status,
    body,
    json(): unknown {
      return JSON.parse(body) as unknown;
    },
  };
}

describe("UGV public business Runtime and Adapter integration", () => {
  it("publishes a PostgreSQL navigation Task, destination and observed trajectory through public reads and SSE", async () => {
    const discovery = await request("server/discover", {});
    expect(discovery.statusCode).toBe(200);
    const capabilities = (
      discovery.json() as {
        result: { capabilities: { extensions: Record<string, unknown> } };
      }
    ).result.capabilities.extensions;
    expect(capabilities["io.sdar/taskBusiness"]).toBeDefined();

    const created = await request(
      "tools/call",
      {
        name: "vehicle_navigate",
        arguments: {
          resourceId: "vehicle:ugv1",
          mission: { type: "point", target: { latitude: 30.2, longitude: 114.2 } },
          speedLimitKmh: 20,
          stopOnObstacle: true,
        },
        _meta: {
          "io.sdar/taskExecution": {
            profileVersion: "1.0",
            idempotencyKey: "ugvb-local-navigation-read",
          },
        },
      },
      "vehicle_navigate",
    );
    expect(created.statusCode).toBe(200);
    const task = (created.json() as { result: { resultType: string; taskId: string } }).result;
    expect(task.resultType, created.body).toBe("task");
    const persisted = await runtime.pool.query<{ external_execution_id: string }>(
      "SELECT external_execution_id FROM provider_task WHERE task_id=$1",
      [task.taskId],
    );
    expect(persisted.rows[0]?.external_execution_id).toBeTruthy();

    const context = await request(
      "io.sdar/taskBusiness/context/get",
      { taskId: task.taskId, maxPageBytes: 16_384 },
      task.taskId,
    );
    expect(context.statusCode, context.body).toBe(200);
    const result = (
      context.json() as {
        result: {
          resultType: string;
          snapshot: {
            context: {
              identity: { taskId: string; executionId: string };
              artifactRefs: { id: string; revision: number }[];
              activeRefs: Record<string, unknown>;
            };
            objects: { kind: string; value: { artifactType: string } }[];
          };
        };
      }
    ).result;
    expect(result).toMatchObject({
      resultType: "complete",
      snapshot: {
        context: {
          identity: {
            taskId: task.taskId,
            executionId: persisted.rows[0]?.external_execution_id,
          },
        },
        objects: [{ kind: "artifact", value: { artifactType: "navigation.destination" } }],
      },
    });
    expect(result.snapshot.context.activeRefs.route).toBeUndefined();
    const destination = result.snapshot.context.artifactRefs[0];
    if (!destination) throw new Error("REQUESTED_DESTINATION_REF_MISSING");
    const artifact = await request(
      "io.sdar/taskBusiness/artifacts/get",
      { taskId: task.taskId, artifactId: destination.id, revision: destination.revision },
      task.taskId,
    );
    expect(artifact.statusCode).toBe(200);
    expect(artifact.json()).toMatchObject({
      result: {
        resultType: "complete",
        artifact: { artifactId: destination.id, artifactType: "navigation.destination" },
      },
    });
    const published = await waitForPublishedBusinessEvents(task.taskId, 2);
    expect(published.map((event) => event.source_sequence)).toEqual(["1", "2"]);
    expect(published.map((event) => event.kind)).toEqual(["BUSINESS_EVENT", "ARTIFACT_CHANGED"]);
    const streamId = published[0]?.stream_id;
    if (!streamId) throw new Error("PUBLIC_BUSINESS_STREAM_MISSING");
    const notifications = await listenForBusinessEvents(streamId, task.taskId, 2);
    const normalized = notifications.map((notification) =>
      normalizeTaskBusinessSseNotification(notification, {
        taskId: task.taskId,
        executionId: persisted.rows[0]?.external_execution_id ?? "",
        providerId,
        resourceId: "vehicle:ugv1",
        operationName: "vehicle_navigate",
        simulationId: "ugvb-public-pg-isolated",
      }),
    );
    expect(normalized.map((event) => event.kind)).toEqual(["BUSINESS_EVENT", "ARTIFACT_CHANGED"]);
    expect(normalized.map((event) => event.sourceCursor.sourceSequence)).toEqual(["1", "2"]);
    expect(normalized.every((event) => event.resumeFrom.streamId === streamId)).toBe(true);
    expect(normalized.map((event) => event.resumeFrom.afterSequence)).toEqual(
      published.map((event) => event.sequence),
    );
    const providerExecution = await providerStore.getExecution(task.taskId);
    const missionId = providerExecution?.downstreamMissionIds.at(-1);
    if (!providerExecution || !missionId) throw new Error("NAVIGATION_MISSION_NOT_PERSISTED");
    const observedAt = Math.max(Date.now() - 10, Date.parse(providerExecution.createdAt) + 1);
    ingress.handle(
      "/ugv/mission_state",
      Buffer.from(JSON.stringify({ id: Number(missionId), state: 1, progress: 10 })),
      false,
      new Date(observedAt).toISOString(),
    );
    for (const [offset, longitude] of [
      [1, 114.11],
      [2, 114.12],
    ] as const) {
      ingress.handle(
        "/ugv/gnss",
        Buffer.from(JSON.stringify({ latitude: 30.1, longitude })),
        false,
        new Date(observedAt + offset).toISOString(),
      );
    }
    await adapterRuntime.pollActive();
    const updated = await request(
      "io.sdar/taskBusiness/context/get",
      { taskId: task.taskId, maxPageBytes: 16_384 },
      task.taskId,
    );
    expect(updated.statusCode, updated.body).toBe(200);
    const updatedContext = (
      updated.json() as {
        result: {
          snapshot: {
            context: {
              activeRefs: {
                route?: { id: string; revision: number };
                trajectory?: { id: string; revision: number };
              };
            };
          };
        };
      }
    ).result.snapshot.context;
    expect(updatedContext.activeRefs.route).toBeUndefined();
    const trajectoryRef = updatedContext.activeRefs.trajectory;
    if (!trajectoryRef) throw new Error("PUBLIC_TRAJECTORY_REF_MISSING");
    expect(trajectoryRef.revision).toBe(2);
    const firstPoint = await request(
      "io.sdar/taskBusiness/artifacts/get",
      { taskId: task.taskId, artifactId: trajectoryRef.id, revision: 1 },
      task.taskId,
    );
    expect(firstPoint.statusCode, firstPoint.body).toBe(200);
    expect(firstPoint.json()).toMatchObject({
      result: {
        resultType: "complete",
        artifact: {
          revision: 1,
          artifactType: "navigation.trajectory",
          content: { geometry: { type: "Point", coordinates: [114.11, 30.1] } },
        },
      },
    });
    const trajectory = await request(
      "io.sdar/taskBusiness/artifacts/get",
      { taskId: task.taskId, artifactId: trajectoryRef.id, revision: trajectoryRef.revision },
      task.taskId,
    );
    expect(trajectory.statusCode, trajectory.body).toBe(200);
    expect(trajectory.json()).toMatchObject({
      result: {
        resultType: "complete",
        artifact: {
          artifactType: "navigation.trajectory",
          semantics: "observed",
          properties: { sampleCount: 2 },
          content: {
            geometry: {
              type: "LineString",
              coordinates: [
                [114.11, 30.1],
                [114.12, 30.1],
              ],
            },
          },
        },
      },
    });
    const allPublished = await waitForPublishedBusinessEvents(task.taskId, 4);
    expect(allPublished.map((event) => event.source_sequence)).toEqual(["1", "2", "3", "4"]);
    expect(allPublished.slice(2).map((event) => event.kind)).toEqual([
      "ARTIFACT_CHANGED",
      "ARTIFACT_CHANGED",
    ]);
    const pages: {
      resumeFrom: { streamId: string; afterSequence: string };
      snapshot: {
        contextRevision: number;
        context: unknown;
        objects: { kind: string; value: { artifactId: string; revision: number } }[];
        objectDescriptors: unknown[];
        nextCursor?: string;
      };
    }[] = [];
    let pageCursor: string | undefined;
    for (let index = 0; index < 8; index += 1) {
      const response = await request(
        "io.sdar/taskBusiness/context/get",
        { taskId: task.taskId, maxPageBytes: 2_560, ...(pageCursor ? { pageCursor } : {}) },
        task.taskId,
      );
      expect(response.statusCode, response.body).toBe(200);
      const page = (response.json() as { result: (typeof pages)[number] }).result;
      pages.push(page);
      pageCursor = page.snapshot.nextCursor;
      if (!pageCursor) break;
    }
    expect(pageCursor).toBeUndefined();
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => page.resumeFrom.streamId === streamId)).toBe(true);
    expect(
      pages.every((page) => page.resumeFrom.afterSequence === pages[0]?.resumeFrom.afterSequence),
    ).toBe(true);
    expect(
      pages.every((page) => page.snapshot.contextRevision === pages[0]?.snapshot.contextRevision),
    ).toBe(true);
    expect(
      pages.flatMap((page) => page.snapshot.objects.map((object) => object.value.artifactId)),
    ).toEqual([destination.id, trajectoryRef.id]);
    const firstPage = pages[0];
    if (!firstPage) throw new Error("PUBLIC_SNAPSHOT_PAGE_MISSING");
    const snapshotState = bootstrapTaskBusinessReducer(
      pages.map((page) => page.snapshot),
      firstPage.resumeFrom,
    );
    expect(unresolvedTaskBusinessRefs(snapshotState)).toEqual([]);
    const continued = await listenForBusinessEvents(
      streamId,
      task.taskId,
      2,
      published[1]?.sequence,
    );
    const normalizedContinuation = continued.map((notification) =>
      normalizeTaskBusinessSseNotification(notification, {
        taskId: task.taskId,
        executionId: persisted.rows[0]?.external_execution_id ?? "",
        providerId,
        resourceId: "vehicle:ugv1",
        operationName: "vehicle_navigate",
        simulationId: "ugvb-public-pg-isolated",
      }),
    );
    expect(normalizedContinuation.map((event) => event.sourceCursor.sourceSequence)).toEqual([
      "3",
      "4",
    ]);
    expect(normalizedContinuation.map((event) => event.resumeFrom.afterSequence)).toEqual(
      allPublished.slice(2).map((event) => event.sequence),
    );
    for (const [offset, longitude] of [
      [3, 114.13],
      [4, 114.14],
    ] as const) {
      ingress.handle(
        "/ugv/gnss",
        Buffer.from(JSON.stringify({ latitude: 30.1, longitude })),
        false,
        new Date(observedAt + offset).toISOString(),
      );
    }
    await adapterRuntime.pollActive();
    const afterPages = await waitForPublishedBusinessEvents(task.taskId, 6);
    expect(afterPages.slice(4).map((event) => event.source_sequence)).toEqual(["5", "6"]);
    const snapshotCursor = pages[0]?.resumeFrom.afterSequence;
    if (!snapshotCursor) throw new Error("PUBLIC_SNAPSHOT_RESUME_MISSING");
    const afterSnapshot = await listenForBusinessEvents(streamId, task.taskId, 2, snapshotCursor);
    const normalizedAfterSnapshot = afterSnapshot.map((notification) =>
      normalizeTaskBusinessSseNotification(notification, {
        taskId: task.taskId,
        executionId: persisted.rows[0]?.external_execution_id ?? "",
        providerId,
        resourceId: "vehicle:ugv1",
        operationName: "vehicle_navigate",
        simulationId: "ugvb-public-pg-isolated",
      }),
    );
    expect(normalizedAfterSnapshot.map((event) => event.sourceCursor.sourceSequence)).toEqual([
      "5",
      "6",
    ]);
    expect(normalizedAfterSnapshot.map((event) => event.resumeFrom.afterSequence)).toEqual(
      afterPages.slice(4).map((event) => event.sequence),
    );
    const reduced = normalizedAfterSnapshot.reduce(reduceTaskBusinessFeedback, snapshotState);
    expect(reduced.context.artifactRefs.find((ref) => ref.id === trajectoryRef.id)?.revision).toBe(
      4,
    );
    expect(unresolvedTaskBusinessRefs(reduced)).toContainEqual({
      kind: "artifact",
      id: trajectoryRef.id,
      revision: 4,
    });
    const otherSubject = await request(
      "io.sdar/taskBusiness/context/get",
      { taskId: task.taskId, maxPageBytes: 16_384 },
      task.taskId,
      "ugvb-other-user",
    );
    expect(otherSubject.statusCode).not.toBe(200);
    expect(device.calls.some((call) => call.name === "ugv_path_follow_mission")).toBe(true);

    const terminalObservedAt = Date.now();
    ingress.handle(
      "/ugv/mission_state",
      Buffer.from(JSON.stringify({ id: Number(missionId), type: 1, state: 4, progress: 100 })),
      false,
      new Date(terminalObservedAt).toISOString(),
    );
    ingress.handle(
      "/ugv/gnss",
      Buffer.from(JSON.stringify({ latitude: 30.2, longitude: 114.2 })),
      false,
      new Date(terminalObservedAt + 1).toISOString(),
    );
    ingress.handle(
      "status/ugv",
      Buffer.from(
        JSON.stringify({
          vehicle_id: "ugv1",
          role_name: "ugv",
          speed_kmh: 0.05,
          chassis_task: { id: Number(missionId), state: 4, progress: 100 },
          eo_task: { state: -1, progress: 0 },
          weapon_task: { state: -1, progress: 0 },
          available: true,
        }),
      ),
      false,
      new Date(terminalObservedAt + 2).toISOString(),
    );
    ingress.handle(
      "/ugv/speed",
      Buffer.from(JSON.stringify({ speed_kmh: 0.05 })),
      false,
      new Date(terminalObservedAt + 2).toISOString(),
    );
    await adapterRuntime.pollActive();
    ingress.handle(
      "/ugv/speed",
      Buffer.from(JSON.stringify({ speed_kmh: 0 })),
      false,
      new Date(terminalObservedAt + 3).toISOString(),
    );
    await adapterRuntime.pollActive();
    const terminalExecution = await providerStore.getExecution(task.taskId);
    expect(
      terminalExecution?.state,
      JSON.stringify({
        reasonCode: terminalExecution?.reasonCode,
        missionIds: terminalExecution?.downstreamMissionIds,
        chassis: ingress.snapshot().chassis,
      }),
    ).toBe("SUCCEEDED");
    const terminalPublished = await waitForPublishedBusinessEvents(task.taskId, 8);
    expect(terminalPublished.slice(-2).map((event) => event.kind)).toEqual([
      "BUSINESS_EVENT",
      "CONTEXT_FINALIZED",
    ]);
    expect(terminalPublished.slice(-2).map((event) => event.source_sequence)).toEqual(["7", "8"]);
    const terminalNotifications = await listenForBusinessEvents(
      streamId,
      task.taskId,
      2,
      afterPages[5]?.sequence,
    );
    const terminalEvents = terminalNotifications.map((notification) =>
      normalizeTaskBusinessSseNotification(notification, snapshotState.context.identity),
    );
    const terminalState = terminalEvents.reduce(reduceTaskBusinessFeedback, reduced);
    expect(terminalState.context.summary.status).toBe("finalized");
    expect(terminalState.context.phase?.code).toBe("execution.succeeded");
    expect(terminalState.context.activeRefs).toEqual({});
    expect(terminalState.context.finalizedAt).toBeDefined();
    const terminalContext = await request(
      "io.sdar/taskBusiness/context/get",
      { taskId: task.taskId, maxPageBytes: 16_384 },
      task.taskId,
    );
    expect(terminalContext.statusCode, terminalContext.body).toBe(200);
    expect(terminalContext.json()).toMatchObject({
      result: {
        snapshot: {
          context: {
            summary: { status: "finalized" },
            phase: { code: "execution.succeeded" },
            activeRefs: {},
          },
        },
      },
    });
  });

  it("relays submitted and synthetic applied Intervention facts through native source, public HTTP/SSE and the consumer reducer", async () => {
    const created = await request(
      "tools/call",
      {
        name: "vehicle_navigate",
        arguments: {
          resourceId: "vehicle:ugv1",
          mission: { type: "point", target: { latitude: 30.3, longitude: 114.3 } },
          speedLimitKmh: 20,
          stopOnObstacle: true,
        },
        _meta: {
          "io.sdar/taskExecution": {
            profileVersion: "1.0",
            idempotencyKey: "ugvb-local-synthetic-applied-read",
          },
        },
      },
      "vehicle_navigate",
    );
    expect(created.statusCode, created.body).toBe(200);
    const task = (created.json() as { result: { resultType: string; taskId: string } }).result;
    expect(task.resultType, created.body).toBe("task");
    const execution = await providerStore.getExecution(task.taskId);
    if (!execution) throw new Error("SYNTHETIC_APPLIED_EXECUTION_MISSING");
    const scope = BoundExecutionScope.fromExecution(execution);
    const initial = await businessStore.getContext(scope);
    if (!initial) throw new Error("SYNTHETIC_APPLIED_CONTEXT_MISSING");
    const initialPublished = await waitForPublishedBusinessEvents(task.taskId, 2);
    const beforeTaskState = await runtime.pool.query<{
      internal_state: string;
      mcp_status: string;
    }>("SELECT internal_state,mcp_status FROM provider_task WHERE task_id=$1", [task.taskId]);
    const catalog = JSON.parse(
      readFileSync("protocol/task-business/v1/examples/positive-catalog.json", "utf8"),
    ) as {
      artifacts: Record<string, unknown>[];
      intervention: Record<string, unknown>;
      interventionCommand: Record<string, unknown>;
    };
    const routeFixture = catalog.artifacts.find((item) => item.artifactId === "route-line");
    if (!routeFixture) throw new Error("SYNTHETIC_ROUTE_FIXTURE_MISSING");
    const route = TaskArtifactSchema.parse({
      ...routeFixture,
      identity: initial.identity,
      source: { producer: "provider", sourceRecordRef: "synthetic-public-wire" },
      properties: { adoption: "adopted", purpose: "navigation", routeSource: "test_double" },
    });
    const routeRef = { kind: "artifact" as const, id: route.artifactId, revision: 1 };
    const intervention = RuntimeInterventionSchema.parse({
      ...catalog.intervention,
      identity: initial.identity,
      effectivePlanRevision: initial.effectivePlanRevision,
      appliesTo: [routeRef],
    });
    const interventionRef = {
      kind: "intervention" as const,
      id: intervention.interventionId,
      revision: 1,
    };
    let current = TaskBusinessContextSchema.parse({
      ...initial,
      contextRevision: initial.contextRevision + 1,
      activeRefs: { ...initial.activeRefs, route: routeRef, intervention: interventionRef },
      artifactRefs: [...initial.artifactRefs, routeRef],
      interventionRefs: [interventionRef],
    });
    await businessStore.commitChangeSet({
      scope,
      expectedContextRevision: initial.contextRevision,
      context: current,
      objects: [
        { kind: "artifact", value: route },
        { kind: "intervention", value: intervention },
      ],
    });
    const available = await request(
      "io.sdar/taskBusiness/context/get",
      { taskId: task.taskId, maxPageBytes: 65_536 },
      task.taskId,
    );
    expect(available.statusCode, available.body).toBe(200);
    const availableResult = (
      available.json() as {
        result: {
          snapshot: TaskBusinessSnapshotPage;
          resumeFrom: { streamId: string; afterSequence: string };
        };
      }
    ).result;
    const availableReadModel = bootstrapTaskBusinessReducer(
      [availableResult.snapshot],
      availableResult.resumeFrom,
    );
    const submission = await new TaskBusinessCommandService(businessStore).submitIntervention({
      scope,
      command: RuntimeInterventionCommandSchema.parse({
        ...catalog.interventionCommand,
        commandId: `synthetic-public-applied-${task.taskId}`,
        taskId: task.taskId,
        executionId: initial.identity.executionId,
        guard: {
          mode: "semantic",
          expectedInterventionRevision: intervention.revision,
          expectedEffectivePlanRevision: initial.effectivePlanRevision,
        },
      }),
      responder: {
        source: "runtime_authorization_context",
        actorType: "user",
        verified: true,
      },
      runtimeCommandSequence: "91",
    });
    expect(submission.claimed).toBe(true);
    expect(submission.events).toHaveLength(2);
    const accepted = submission.record;
    for (const sourceEvent of submission.events ?? []) {
      eventHub.notifyCommittedTaskBusinessEvent(sourceEvent);
    }
    const submittedPublished = await waitForPublishedBusinessEvents(task.taskId, 4);
    expect(submittedPublished.slice(2).map((item) => item.kind)).toEqual([
      "BUSINESS_EVENT",
      "INTERVENTION_CHANGED",
    ]);
    const submissionNotifications = await listenForBusinessEvents(
      availableResult.resumeFrom.streamId,
      task.taskId,
      2,
      availableResult.resumeFrom.afterSequence,
    );
    const submittedReadModel = submissionNotifications
      .map((notification) => normalizeTaskBusinessSseNotification(notification, initial.identity))
      .reduce(reduceTaskBusinessFeedback, availableReadModel);
    const submittedContext = await businessStore.getContext(scope);
    if (!submittedContext) throw new Error("SYNTHETIC_SUBMITTED_CONTEXT_MISSING");
    current = submittedContext;
    const submittedRef = current.activeRefs.intervention;
    if (!submittedRef) throw new Error("SYNTHETIC_SUBMITTED_REF_MISSING");
    expect(submittedRef).toMatchObject({ revision: 2 });
    expect(submittedReadModel.context.activeRefs).toEqual(current.activeRefs);
    expect(submittedReadModel.context.interventionRefs).toEqual(current.interventionRefs);
    expect(unresolvedTaskBusinessRefs(submittedReadModel)).toEqual([submittedRef]);
    const submittedPublic = await request(
      "io.sdar/taskBusiness/context/get",
      { taskId: task.taskId, maxPageBytes: 65_536 },
      task.taskId,
    );
    expect(submittedPublic.statusCode, submittedPublic.body).toBe(200);
    const submittedSnapshot = (
      submittedPublic.json() as { result: { snapshot: TaskBusinessSnapshotPage } }
    ).result.snapshot;
    expect(TaskBusinessContextSchema.parse(submittedSnapshot.context)).toEqual(current);
    const submittedObject = submittedSnapshot.objects.find(
      (object) =>
        typeof object === "object" &&
        object !== null &&
        "kind" in object &&
        object.kind === "intervention",
    ) as { kind: "intervention"; value: unknown } | undefined;
    expect(RuntimeInterventionSchema.parse(submittedObject?.value)).toMatchObject({
      revision: 2,
      state: "submitted",
      acceptedCommandId: accepted.commandId,
    });
    for (const state of ["applying"] as const) {
      const currentInterventionRef = current.interventionRefs[0];
      if (!currentInterventionRef) throw new Error("SYNTHETIC_INTERVENTION_REF_MISSING");
      const version = RuntimeInterventionSchema.parse({
        ...intervention,
        revision: currentInterventionRef.revision + 1,
        state,
        acceptedCommandId: accepted.commandId,
      });
      const ref = {
        kind: "intervention" as const,
        id: version.interventionId,
        revision: version.revision,
      };
      const next = TaskBusinessContextSchema.parse({
        ...current,
        contextRevision: current.contextRevision + 1,
        activeRefs: { ...current.activeRefs, intervention: ref },
        interventionRefs: [ref],
      });
      await businessStore.commitChangeSet({
        scope,
        expectedContextRevision: current.contextRevision,
        context: next,
        objects: [{ kind: "intervention", value: version }],
      });
      current = next;
    }
    const before = await request(
      "io.sdar/taskBusiness/context/get",
      { taskId: task.taskId, maxPageBytes: 65_536 },
      task.taskId,
    );
    expect(before.statusCode, before.body).toBe(200);
    const beforeResult = (
      before.json() as {
        result: {
          resultType: string;
          snapshot: TaskBusinessSnapshotPage;
          resumeFrom: { streamId: string; afterSequence: string };
        };
      }
    ).result;
    expect(beforeResult.resultType).toBe("complete");
    expect(beforeResult.snapshot.contextRevision).toBe(current.contextRevision);
    let readModel = bootstrapTaskBusinessReducer([beforeResult.snapshot], beforeResult.resumeFrom);
    expect(unresolvedTaskBusinessRefs(readModel)).toEqual([]);

    const adoptedRoute = TaskArtifactSchema.parse({ ...route, revision: 2 });
    const adoptedRef = { kind: "artifact" as const, id: route.artifactId, revision: 2 };
    const appliedIntervention = RuntimeInterventionSchema.parse({
      ...intervention,
      revision: 4,
      state: "applied",
      acceptedCommandId: accepted.commandId,
      resultRefs: [adoptedRef],
    });
    const appliedRef = {
      kind: "intervention" as const,
      id: intervention.interventionId,
      revision: 4,
    };
    const activeRefs: Record<string, unknown> = { ...current.activeRefs, route: adoptedRef };
    delete activeRefs.intervention;
    const finalContext = TaskBusinessContextSchema.parse({
      ...current,
      contextRevision: current.contextRevision + 1,
      effectivePlanRevision: current.effectivePlanRevision + 1,
      activeRefs,
      artifactRefs: current.artifactRefs.map((ref) =>
        ref.id === route.artifactId ? adoptedRef : ref,
      ),
      interventionRefs: [appliedRef],
    });
    const appliedCommand = BusinessCommandRecordSchema.parse({
      ...accepted,
      state: "applied",
      resultCode: "ROUTE_ADOPTED",
      resultRefs: [adoptedRef],
      updatedAt: new Date().toISOString(),
    });
    const event = (kind: string, payload: unknown) => ({
      body: TaskBusinessFeedbackBodySchema.parse({
        schemaVersion: "sdar.task-business-feedback/1.0-rc2",
        kind,
        contextRevision: finalContext.contextRevision,
        providerRecordedAt: new Date().toISOString(),
        payload,
      }),
      description: "Synthetic route adoption for public wire verification",
      reasonCode: "TEST_DOUBLE",
      severityHint: "info" as const,
    });
    const committed = await businessStore.commitBusinessChangeSet(
      {
        scope,
        expectedContextRevision: current.contextRevision,
        context: finalContext,
        objects: [
          { kind: "artifact", value: adoptedRoute },
          { kind: "intervention", value: appliedIntervention },
        ],
        command: appliedCommand,
      },
      [
        event("BUSINESS_EVENT", {
          eventType: "business.plan_applied",
          severity: "info",
          reasonCode: "TEST_DOUBLE",
          description: "Synthetic route adoption for public wire verification",
          contextDelta: {
            activeRefs: finalContext.activeRefs,
            effectivePlanRevision: finalContext.effectivePlanRevision,
          },
        }),
        event("ARTIFACT_CHANGED", {
          change: "update",
          artifactRef: adoptedRef,
          previousRevision: 1,
          reasonCode: "TEST_DOUBLE",
        }),
        event("INTERVENTION_CHANGED", {
          change: "update",
          interventionRef: appliedRef,
          previousRevision: 3,
          reasonCode: "TEST_DOUBLE",
        }),
      ],
    );
    for (const sourceEvent of committed.events) {
      eventHub.notifyCommittedTaskBusinessEvent(sourceEvent);
    }
    const published = await waitForPublishedBusinessEvents(task.taskId, 7);
    expect(published.slice(4).map((item) => item.kind)).toEqual([
      "BUSINESS_EVENT",
      "ARTIFACT_CHANGED",
      "INTERVENTION_CHANGED",
    ]);
    expect(published.slice(4).map((item) => item.source_sequence)).toEqual(
      committed.events.map((item) => item.sourceSequence),
    );
    expect(beforeResult.resumeFrom.streamId).toBe(initialPublished[0]?.stream_id);
    const notifications = await listenForBusinessEvents(
      beforeResult.resumeFrom.streamId,
      task.taskId,
      3,
      beforeResult.resumeFrom.afterSequence,
    );
    const normalized = notifications.map((notification) =>
      normalizeTaskBusinessSseNotification(notification, initial.identity),
    );
    expect(normalized.map((item) => item.sourceCursor.sourceSequence)).toEqual(
      committed.events.map((item) => item.sourceSequence),
    );
    expect(normalized.map((item) => item.resumeFrom.afterSequence)).toEqual(
      published.slice(4).map((item) => item.sequence),
    );
    readModel = normalized.reduce(reduceTaskBusinessFeedback, readModel);
    expect(readModel.context.contextRevision).toBe(finalContext.contextRevision);
    expect(readModel.context.effectivePlanRevision).toBe(finalContext.effectivePlanRevision);
    expect(readModel.context.activeRefs).toEqual(finalContext.activeRefs);
    expect(readModel.context.artifactRefs).toEqual(finalContext.artifactRefs);
    expect(readModel.context.interventionRefs).toEqual(finalContext.interventionRefs);
    expect(unresolvedTaskBusinessRefs(readModel)).toEqual([adoptedRef, appliedRef]);

    const publicArtifact = await request(
      "io.sdar/taskBusiness/artifacts/get",
      { taskId: task.taskId, artifactId: adoptedRef.id, revision: adoptedRef.revision },
      task.taskId,
    );
    expect(publicArtifact.statusCode, publicArtifact.body).toBe(200);
    expect(publicArtifact.json()).toMatchObject({
      result: {
        artifact: { artifactId: adoptedRef.id, revision: adoptedRef.revision },
      },
    });
    const after = await request(
      "io.sdar/taskBusiness/context/get",
      { taskId: task.taskId, maxPageBytes: 65_536 },
      task.taskId,
    );
    expect(after.statusCode, after.body).toBe(200);
    const afterResult = (
      after.json() as {
        result: {
          resultType: string;
          snapshot: TaskBusinessSnapshotPage;
          resumeFrom: { streamId: string; afterSequence: string };
        };
      }
    ).result;
    expect(afterResult.resultType).toBe("complete");
    const afterIntervention = afterResult.snapshot.objects.find(
      (object) =>
        typeof object === "object" &&
        object !== null &&
        "kind" in object &&
        object.kind === "intervention",
    ) as { kind: "intervention"; value: unknown } | undefined;
    expect(RuntimeInterventionSchema.parse(afterIntervention?.value)).toMatchObject({
      state: "applied",
      resultRefs: [adoptedRef],
    });
    expect(
      unresolvedTaskBusinessRefs(
        bootstrapTaskBusinessReducer([afterResult.snapshot], afterResult.resumeFrom),
      ),
    ).toEqual([]);
    const taskState = await runtime.pool.query<{ internal_state: string; mcp_status: string }>(
      "SELECT internal_state,mcp_status FROM provider_task WHERE task_id=$1",
      [task.taskId],
    );
    expect(taskState.rows[0]).toEqual(beforeTaskState.rows[0]);
    expect(taskState.rows[0]?.mcp_status).toBe("working");
    await finishSyntheticNavigationTask(task.taskId, 30.3, 114.3);
  });

  it("relays one synthetic failed Intervention without replacing the active route through public HTTP/SSE", async () => {
    const created = await request(
      "tools/call",
      {
        name: "vehicle_navigate",
        arguments: {
          resourceId: "vehicle:ugv1",
          mission: { type: "point", target: { latitude: 30.4, longitude: 114.4 } },
          speedLimitKmh: 20,
          stopOnObstacle: true,
        },
        _meta: {
          "io.sdar/taskExecution": {
            profileVersion: "1.0",
            idempotencyKey: "ugvb-local-synthetic-failed-read",
          },
        },
      },
      "vehicle_navigate",
    );
    expect(created.statusCode, created.body).toBe(200);
    const task = (created.json() as { result: { resultType: string; taskId: string } }).result;
    expect(task.resultType, created.body).toBe("task");
    const execution = await providerStore.getExecution(task.taskId);
    if (!execution) throw new Error("SYNTHETIC_FAILED_EXECUTION_MISSING");
    const scope = BoundExecutionScope.fromExecution(execution);
    const initial = await businessStore.getContext(scope);
    if (!initial) throw new Error("SYNTHETIC_FAILED_CONTEXT_MISSING");
    const initialPublished = await waitForPublishedBusinessEvents(task.taskId, 2);
    const beforeTaskState = await runtime.pool.query<{
      internal_state: string;
      mcp_status: string;
    }>("SELECT internal_state,mcp_status FROM provider_task WHERE task_id=$1", [task.taskId]);
    const catalog = JSON.parse(
      readFileSync("protocol/task-business/v1/examples/positive-catalog.json", "utf8"),
    ) as { artifacts: Record<string, unknown>[]; intervention: Record<string, unknown> };
    const routeFixture = catalog.artifacts.find((item) => item.artifactId === "route-line");
    if (!routeFixture) throw new Error("SYNTHETIC_FAILED_ROUTE_FIXTURE_MISSING");
    const route = TaskArtifactSchema.parse({
      ...routeFixture,
      identity: initial.identity,
      source: { producer: "provider", sourceRecordRef: "synthetic-failed-public-wire" },
      properties: { adoption: "adopted", purpose: "navigation", routeSource: "test_double" },
    });
    const routeRef = { kind: "artifact" as const, id: route.artifactId, revision: 1 };
    const intervention = RuntimeInterventionSchema.parse({
      ...catalog.intervention,
      identity: initial.identity,
      effectivePlanRevision: initial.effectivePlanRevision,
      appliesTo: [routeRef],
    });
    const offeredRef = {
      kind: "intervention" as const,
      id: intervention.interventionId,
      revision: 1,
    };
    let current = TaskBusinessContextSchema.parse({
      ...initial,
      contextRevision: initial.contextRevision + 1,
      activeRefs: { ...initial.activeRefs, route: routeRef, intervention: offeredRef },
      artifactRefs: [...initial.artifactRefs, routeRef],
      interventionRefs: [offeredRef],
    });
    await businessStore.commitChangeSet({
      scope,
      expectedContextRevision: initial.contextRevision,
      context: current,
      objects: [
        { kind: "artifact", value: route },
        { kind: "intervention", value: intervention },
      ],
    });
    const recordedAt = new Date().toISOString();
    const accepted = BusinessCommandRecordSchema.parse({
      commandId: `synthetic-public-failed-${task.taskId}`,
      commandType: "intervention",
      entryKey: `intervention:${intervention.interventionId}`,
      identity: initial.identity,
      requestHash: "e".repeat(64),
      state: "accepted",
      createdAt: recordedAt,
      updatedAt: recordedAt,
    });
    expect((await businessStore.claimCommand(scope, accepted, offeredRef)).claimed).toBe(true);
    for (const state of ["submitted", "applying"] as const) {
      const previousRef = current.interventionRefs[0];
      if (!previousRef) throw new Error("SYNTHETIC_FAILED_INTERVENTION_REF_MISSING");
      const version = RuntimeInterventionSchema.parse({
        ...intervention,
        revision: previousRef.revision + 1,
        state,
        acceptedCommandId: accepted.commandId,
      });
      const ref = {
        kind: "intervention" as const,
        id: version.interventionId,
        revision: version.revision,
      };
      const next = TaskBusinessContextSchema.parse({
        ...current,
        contextRevision: current.contextRevision + 1,
        activeRefs: { ...current.activeRefs, intervention: ref },
        interventionRefs: [ref],
      });
      await businessStore.commitChangeSet({
        scope,
        expectedContextRevision: current.contextRevision,
        context: next,
        objects: [{ kind: "intervention", value: version }],
      });
      current = next;
    }
    const before = await request(
      "io.sdar/taskBusiness/context/get",
      { taskId: task.taskId, maxPageBytes: 65_536 },
      task.taskId,
    );
    expect(before.statusCode, before.body).toBe(200);
    const beforeResult = (
      before.json() as {
        result: {
          resultType: string;
          snapshot: TaskBusinessSnapshotPage;
          resumeFrom: { streamId: string; afterSequence: string };
        };
      }
    ).result;
    expect(beforeResult.resultType).toBe("complete");
    expect(beforeResult.snapshot.contextRevision).toBe(current.contextRevision);
    let readModel = bootstrapTaskBusinessReducer([beforeResult.snapshot], beforeResult.resumeFrom);
    expect(unresolvedTaskBusinessRefs(readModel)).toEqual([]);

    const failedIntervention = RuntimeInterventionSchema.parse({
      ...intervention,
      revision: 4,
      state: "failed",
      reasonCode: "REPLAN_FAILED",
      acceptedCommandId: accepted.commandId,
    });
    const failedRef = {
      kind: "intervention" as const,
      id: intervention.interventionId,
      revision: 4,
    };
    const activeRefs: Record<string, unknown> = { ...current.activeRefs };
    delete activeRefs.intervention;
    const finalContext = TaskBusinessContextSchema.parse({
      ...current,
      contextRevision: current.contextRevision + 1,
      activeRefs,
      interventionRefs: [failedRef],
    });
    const rejectedCommand = BusinessCommandRecordSchema.parse({
      ...accepted,
      state: "rejected",
      resultCode: "REPLAN_FAILED",
      updatedAt: new Date().toISOString(),
    });
    const event = (kind: string, payload: unknown) => ({
      body: TaskBusinessFeedbackBodySchema.parse({
        schemaVersion: "sdar.task-business-feedback/1.0-rc2",
        kind,
        contextRevision: finalContext.contextRevision,
        providerRecordedAt: new Date().toISOString(),
        payload,
      }),
      description: "Synthetic replan failure for public wire verification",
      reasonCode: "REPLAN_FAILED",
      severityHint: "warning" as const,
    });
    const committed = await businessStore.commitBusinessChangeSet(
      {
        scope,
        expectedContextRevision: current.contextRevision,
        context: finalContext,
        objects: [{ kind: "intervention", value: failedIntervention }],
        command: rejectedCommand,
      },
      [
        event("BUSINESS_EVENT", {
          eventType: "business.plan_failed",
          severity: "warning",
          reasonCode: "REPLAN_FAILED",
          description: "Synthetic replan failure for public wire verification",
          contextDelta: {
            activeRefs: finalContext.activeRefs,
            effectivePlanRevision: finalContext.effectivePlanRevision,
          },
        }),
        event("INTERVENTION_CHANGED", {
          change: "update",
          interventionRef: failedRef,
          previousRevision: 3,
          reasonCode: "REPLAN_FAILED",
        }),
      ],
    );
    for (const sourceEvent of committed.events) {
      eventHub.notifyCommittedTaskBusinessEvent(sourceEvent);
    }
    const published = await waitForPublishedBusinessEvents(task.taskId, 4);
    expect(published.slice(2).map((item) => item.kind)).toEqual([
      "BUSINESS_EVENT",
      "INTERVENTION_CHANGED",
    ]);
    expect(published.slice(2).map((item) => item.source_sequence)).toEqual(
      committed.events.map((item) => item.sourceSequence),
    );
    expect(beforeResult.resumeFrom.streamId).toBe(initialPublished[0]?.stream_id);
    const notifications = await listenForBusinessEvents(
      beforeResult.resumeFrom.streamId,
      task.taskId,
      2,
      beforeResult.resumeFrom.afterSequence,
    );
    const normalized = notifications.map((notification) =>
      normalizeTaskBusinessSseNotification(notification, initial.identity),
    );
    expect(normalized.map((item) => item.sourceCursor.sourceSequence)).toEqual(
      committed.events.map((item) => item.sourceSequence),
    );
    expect(normalized.map((item) => item.resumeFrom.afterSequence)).toEqual(
      published.slice(2).map((item) => item.sequence),
    );
    readModel = normalized.reduce(reduceTaskBusinessFeedback, readModel);
    expect(readModel.context.contextRevision).toBe(finalContext.contextRevision);
    expect(readModel.context.effectivePlanRevision).toBe(initial.effectivePlanRevision);
    expect(readModel.context.activeRefs.route).toEqual(routeRef);
    expect(readModel.context.activeRefs.intervention).toBeUndefined();
    expect(readModel.context.artifactRefs).toEqual(finalContext.artifactRefs);
    expect(readModel.context.interventionRefs).toEqual([failedRef]);
    expect(unresolvedTaskBusinessRefs(readModel)).toEqual([failedRef]);

    const publicArtifact = await request(
      "io.sdar/taskBusiness/artifacts/get",
      { taskId: task.taskId, artifactId: routeRef.id, revision: routeRef.revision },
      task.taskId,
    );
    expect(publicArtifact.statusCode, publicArtifact.body).toBe(200);
    expect(publicArtifact.json()).toMatchObject({
      result: {
        artifact: {
          artifactId: routeRef.id,
          revision: routeRef.revision,
          properties: { adoption: "adopted" },
        },
      },
    });
    const after = await request(
      "io.sdar/taskBusiness/context/get",
      { taskId: task.taskId, maxPageBytes: 65_536 },
      task.taskId,
    );
    expect(after.statusCode, after.body).toBe(200);
    const afterResult = (
      after.json() as {
        result: {
          resultType: string;
          snapshot: TaskBusinessSnapshotPage;
          resumeFrom: { streamId: string; afterSequence: string };
        };
      }
    ).result;
    expect(afterResult.resultType).toBe("complete");
    const afterContext = TaskBusinessContextSchema.parse(afterResult.snapshot.context);
    expect(afterContext.activeRefs.route).toEqual(routeRef);
    expect(afterContext.effectivePlanRevision).toBe(initial.effectivePlanRevision);
    const afterIntervention = afterResult.snapshot.objects.find(
      (object) =>
        typeof object === "object" &&
        object !== null &&
        "kind" in object &&
        object.kind === "intervention",
    ) as { kind: "intervention"; value: unknown } | undefined;
    expect(RuntimeInterventionSchema.parse(afterIntervention?.value)).toMatchObject({
      state: "failed",
      reasonCode: "REPLAN_FAILED",
      acceptedCommandId: accepted.commandId,
    });
    expect(
      unresolvedTaskBusinessRefs(
        bootstrapTaskBusinessReducer([afterResult.snapshot], afterResult.resumeFrom),
      ),
    ).toEqual([]);
    expect(await businessStore.claimCommand(scope, accepted)).toEqual({
      claimed: false,
      record: rejectedCommand,
    });
    const taskState = await runtime.pool.query<{ internal_state: string; mcp_status: string }>(
      "SELECT internal_state,mcp_status FROM provider_task WHERE task_id=$1",
      [task.taskId],
    );
    expect(taskState.rows[0]).toEqual(beforeTaskState.rows[0]);
    expect(taskState.rows[0]?.mcp_status).toBe("working");
    await finishSyntheticNavigationTask(task.taskId, 30.4, 114.4);
  });

  it("reads native PostgreSQL Recon Context and in-Profile Action descriptors through public /mcp chunks", async () => {
    const created = await request(
      "tools/call",
      {
        name: "vehicle_area_recon",
        arguments: {
          resourceId: "vehicle:ugv1",
          area: {
            polygon: [
              { latitude: 30.1, longitude: 114.1 },
              { latitude: 30.1, longitude: 114.2 },
              { latitude: 30.2, longitude: 114.2 },
            ],
          },
          scanMode: "area",
          scanCount: 1,
          targetTypes: [3],
        },
        _meta: {
          "io.sdar/taskExecution": {
            profileVersion: "1.0",
            idempotencyKey: "ugvb-local-large-version-read",
          },
        },
      },
      "vehicle_area_recon",
    );
    expect(created.statusCode, created.body).toBe(200);
    const task = (created.json() as { result: { resultType: string; taskId: string } }).result;
    expect(task.resultType).toBe("task");
    const selectedProfile = await runtime.pool.query<{
      definition: { businessFeedbackProfile?: { actionTypes?: string[] } };
    }>(
      `SELECT snapshot.definition
         FROM provider_task AS task
         JOIN operation_snapshot AS snapshot
           ON snapshot.snapshot_id = task.operation_snapshot_id
        WHERE task.task_id = $1`,
      [task.taskId],
    );
    expect(selectedProfile.rows[0]?.definition.businessFeedbackProfile?.actionTypes).toContain(
      "sensor.visual_lock",
    );
    const execution = await providerStore.getExecution(task.taskId);
    if (!execution) throw new Error("LARGE_VERSION_EXECUTION_MISSING");
    const scope = BoundExecutionScope.fromExecution(execution);
    const initial = await businessStore.getContext(scope);
    if (!initial) throw new Error("LARGE_VERSION_CONTEXT_MISSING");
    const action = BusinessActionSchema.parse({
      schemaVersion: "sdar.business-action/1.0-rc2",
      actionId: "large-test-visual-lock",
      actionType: "sensor.visual_lock",
      identity: initial.identity,
      revision: 1,
      state: "active",
      actor: { type: "device" },
      triggerOrigin: "unknown",
      reasonCode: "LOCAL_TEST_OBSERVATION",
      startedAt: execution.createdAt,
      properties: { detail: "a".repeat(1_100_000), source: "local_test_double" },
    });
    const actionRef = { kind: "action" as const, id: action.actionId, revision: 1 };
    const next = TaskBusinessContextSchema.parse({
      ...initial,
      contextRevision: initial.contextRevision + 1,
      summary: { status: "in_progress", properties: { detail: "c".repeat(1_100_000) } },
      actionRefs: [...initial.actionRefs, actionRef],
    });
    await businessStore.commitChangeSet({
      scope,
      expectedContextRevision: initial.contextRevision,
      context: next,
      objects: [{ kind: "action", value: action }],
    });

    const pages: {
      snapshot: Record<string, unknown>;
      snapshotToken: string;
      resumeFrom: unknown;
    }[] = [];
    let cursor: string | undefined;
    for (let index = 0; index < 4; index += 1) {
      const read = await request(
        "io.sdar/taskBusiness/context/get",
        {
          taskId: task.taskId,
          maxPageBytes: 1_048_576,
          ...(cursor === undefined ? {} : { pageCursor: cursor }),
        },
        task.taskId,
      );
      expect(read.statusCode, read.body).toBe(200);
      const result = (read.json() as { result: (typeof pages)[number] }).result;
      pages.push(result);
      cursor =
        typeof result.snapshot.nextCursor === "string" ? result.snapshot.nextCursor : undefined;
      if (cursor === undefined) break;
    }
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(pages.at(-1)?.snapshot.nextCursor).toBeUndefined();
    expect(pages.every((page) => page.snapshot.contextRevision === next.contextRevision)).toBe(
      true,
    );
    expect(pages.every((page) => page.snapshot.contextDescriptor !== undefined)).toBe(true);
    expect(
      pages.every(
        (page) => JSON.stringify(page.resumeFrom) === JSON.stringify(pages[0]?.resumeFrom),
      ),
    ).toBe(true);
    const descriptors: unknown[] = [];
    for (const page of pages) {
      const values: unknown = page.snapshot.objectDescriptors;
      if (Array.isArray(values)) descriptors.push(...(values as unknown[]));
    }
    expect(descriptors).toContainEqual({
      ref: actionRef,
      sizeBytes: Buffer.byteLength(JSON.stringify({ kind: "action", value: action })),
      readMethod: "getObjectVersion",
    });
    const snapshotToken = pages[0]?.snapshotToken;
    if (!snapshotToken) throw new Error("PUBLIC_SNAPSHOT_TOKEN_MISSING");
    const readVersion = async (objectRef?: typeof actionRef): Promise<unknown> => {
      const chunks: Uint8Array[] = [];
      let offset = 0;
      for (;;) {
        const response = await request(
          "io.sdar/taskBusiness/snapshotParts/get",
          {
            taskId: task.taskId,
            snapshotToken,
            ...(objectRef === undefined ? {} : { objectRef }),
            offset,
            maxBytes: 1_048_576,
          },
          task.taskId,
        );
        expect(response.statusCode, response.body).toBe(200);
        const part = (
          response.json() as {
            result: {
              part: {
                bytes: string;
                totalBytes: string;
                sha256: string;
                offset: number;
                nextOffset?: string;
              };
            };
          }
        ).result.part;
        expect(part.offset).toBe(offset);
        chunks.push(Buffer.from(part.bytes, "base64"));
        if (part.nextOffset === undefined) {
          const bytes = Buffer.concat(chunks);
          expect(bytes.length).toBe(Number(part.totalBytes));
          expect(createHash("sha256").update(bytes).digest("hex")).toBe(part.sha256);
          return JSON.parse(bytes.toString("utf8")) as unknown;
        }
        offset = Number(part.nextOffset);
      }
    };
    expect(await readVersion()).toEqual(next);
    expect(await readVersion(actionRef)).toEqual({ kind: "action", value: action });
    const otherSubject = await request(
      "io.sdar/taskBusiness/snapshotParts/get",
      { taskId: task.taskId, snapshotToken, objectRef: actionRef },
      task.taskId,
      "other-subject",
    );
    expect(otherSubject.statusCode).not.toBe(200);
    const revised = TaskBusinessContextSchema.parse({
      ...next,
      contextRevision: next.contextRevision + 1,
    });
    await businessStore.commitChangeSet({
      scope,
      expectedContextRevision: next.contextRevision,
      context: revised,
      objects: [],
    });
    const stale = await request(
      "io.sdar/taskBusiness/snapshotParts/get",
      { taskId: task.taskId, snapshotToken },
      task.taskId,
    );
    expect(stale.statusCode).toBe(400);
    expect(stale.body).toContain("BUSINESS_SNAPSHOT_REVISION_CHANGED");
    await waitForPublishedBusinessEvents(task.taskId, 2);
    const probeLines: Record<string, unknown>[] = [];
    let publishedProbeEvent = false;
    await runReadOnlyTaskBusinessProbe({
      mcpUrl: httpRuntimeUrl,
      taskId: task.taskId,
      maxPageBytes: 1_048_576,
      maxEvents: 1,
      durationMs: 30_000,
      fetchImpl: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("x-sdar-subject", "ugvb-public-pg-user");
        headers.set("x-sdar-tenant", "ugvb-public-pg-tenant");
        headers.set("x-sdar-execution-mode", "simulation");
        headers.set("x-sdar-simulation-id", "ugvb-public-pg-isolated");
        return fetch(input, { ...init, headers });
      },
      emit: async (line) => {
        probeLines.push(line);
        if (line.type !== "snapshot" || publishedProbeEvent) return;
        publishedProbeEvent = true;
        const current = await businessStore.getContext(scope);
        if (!current) throw new Error("PROBE_CONTEXT_MISSING");
        const recordedAt = new Date(
          Math.max(Date.now(), Date.parse(current.updatedAt) + 1),
        ).toISOString();
        const phase = { code: "probe_observing", since: recordedAt };
        const changed = TaskBusinessContextSchema.parse({
          ...current,
          contextRevision: current.contextRevision + 1,
          phase,
          updatedAt: recordedAt,
        });
        const committed = await businessStore.commitBusinessChangeSet(
          {
            scope,
            expectedContextRevision: current.contextRevision,
            context: changed,
            objects: [],
          },
          [
            {
              body: TaskBusinessFeedbackBodySchema.parse({
                schemaVersion: "sdar.task-business-feedback/1.0-rc2",
                kind: "BUSINESS_EVENT",
                contextRevision: changed.contextRevision,
                providerRecordedAt: recordedAt,
                payload: {
                  eventType: "business.probe_observing",
                  severity: "info",
                  reasonCode: "LOCAL_TEST",
                  description: "Native snapshot-to-SSE consumer continuation",
                  contextDelta: { phase },
                },
              }),
              description: "Native snapshot-to-SSE consumer continuation",
              reasonCode: "LOCAL_TEST",
              severityHint: "info",
            },
          ],
        );
        for (const event of committed.events) eventHub.notifyCommittedTaskBusinessEvent(event);
      },
    });
    expect(publishedProbeEvent).toBe(true);
    expect(probeLines.find((line) => line.type === "snapshot")).toMatchObject({
      contextRevision: revised.contextRevision,
      objectCount: initial.artifactRefs.length + 1,
    });
    expect(
      probeLines.filter((line) => line.type === "businessObject").map((line) => line.object),
    ).toContainEqual({ kind: "action", value: action });
    expect(probeLines.find((line) => line.type === "businessEvent")).toMatchObject({
      kind: "BUSINESS_EVENT",
      contextRevision: revised.contextRevision + 1,
    });
    expect(probeLines.at(-1)).toMatchObject({
      type: "stopped",
      reason: "max_events",
      appliedEvents: 1,
    });
    await finishSyntheticReconTask(task.taskId);
  }, 45_000);
});

async function finishSyntheticReconTask(taskId: string) {
  const execution = await providerStore.getExecution(taskId);
  const missionId = execution?.downstreamMissionIds.at(-1);
  if (!execution || !missionId) throw new Error("SYNTHETIC_RECON_MISSION_MISSING");
  const observedAt = Math.max(Date.now(), Date.parse(execution.createdAt) + 10);
  for (const [index, status] of [5, 11].entries()) {
    ingress.handle(
      "/ugv/area_recon/status",
      Buffer.from(
        JSON.stringify({
          mission_id: missionId,
          status,
          status_label: status === 11 ? "finished" : "running",
          scan_mode: 1,
          progress: status === 11 ? 100 : 50,
          coverage: status === 11 ? 100 : 50,
          lock: { stage: 1, target_id: 0 },
          online: true,
        }),
      ),
      false,
      new Date(observedAt + index).toISOString(),
    );
    await adapterRuntime.pollActive();
  }
  expect((await providerStore.getExecution(taskId))?.state).toBe("SUCCEEDED");
}

async function finishSyntheticNavigationTask(taskId: string, latitude: number, longitude: number) {
  const execution = await providerStore.getExecution(taskId);
  const missionId = execution?.downstreamMissionIds.at(-1);
  if (!execution || !missionId) throw new Error("SYNTHETIC_NAVIGATION_MISSION_MISSING");
  const observedAt = Math.max(Date.now(), Date.parse(execution.createdAt) + 10);
  ingress.handle(
    "/ugv/mission_state",
    Buffer.from(JSON.stringify({ id: Number(missionId), type: 1, state: 4, progress: 100 })),
    false,
    new Date(observedAt).toISOString(),
  );
  ingress.handle(
    "/ugv/gnss",
    Buffer.from(JSON.stringify({ latitude, longitude })),
    false,
    new Date(observedAt + 1).toISOString(),
  );
  ingress.handle(
    "status/ugv",
    Buffer.from(
      JSON.stringify({
        vehicle_id: "ugv1",
        role_name: "ugv",
        speed_kmh: 0.05,
        chassis_task: { id: Number(missionId), state: 4, progress: 100 },
        eo_task: { state: -1, progress: 0 },
        weapon_task: { state: -1, progress: 0 },
        available: true,
      }),
    ),
    false,
    new Date(observedAt + 2).toISOString(),
  );
  ingress.handle(
    "/ugv/speed",
    Buffer.from(JSON.stringify({ speed_kmh: 0.05 })),
    false,
    new Date(observedAt + 2).toISOString(),
  );
  await adapterRuntime.pollActive();
  ingress.handle(
    "/ugv/speed",
    Buffer.from(JSON.stringify({ speed_kmh: 0 })),
    false,
    new Date(observedAt + 3).toISOString(),
  );
  await adapterRuntime.pollActive();
  expect((await providerStore.getExecution(taskId))?.state).toBe("SUCCEEDED");
}

async function waitForPublishedBusinessEvents(taskId: string, count: number) {
  const deadline = Date.now() + 10_000;
  let observed: { source_sequence: string; kind: string }[] = [];
  while (Date.now() < deadline) {
    const result = await runtime.pool.query<{
      stream_id: string;
      sequence: string;
      source_sequence: string;
      kind: string;
    }>(
      `SELECT stream_id, sequence, source_sequence, raw_payload->>'kind' AS kind
       FROM provider_business_event
       WHERE provider_id=$1 AND source_id='vehicle.business' AND task_id=$2
       ORDER BY source_sequence`,
      [providerId, taskId],
    );
    observed = result.rows.map((event) => ({
      source_sequence: event.source_sequence,
      kind: event.kind,
    }));
    if (result.rows.length >= count) return result.rows.slice(0, count);
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`PUBLIC_BUSINESS_EVENTS_NOT_PUBLISHED:${JSON.stringify(observed)}`);
}

async function listenForBusinessEvents(
  streamId: string,
  taskId: string,
  count: number,
  afterSequence = "0",
) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 5_000);
  try {
    const method = "io.sdar/businessEvents/listen";
    const response = await fetch(httpRuntimeUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
        "x-sdar-subject": "ugvb-public-pg-user",
        "x-sdar-tenant": "ugvb-public-pg-tenant",
        "x-sdar-execution-mode": "simulation",
        "x-sdar-simulation-id": "ugvb-public-pg-isolated",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: randomUUID(),
        method,
        params: {
          cursor: { streamId, afterSequence },
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": { name: "ugvb-public-pg", version: "1.0.0" },
            "io.modelcontextprotocol/clientCapabilities": {
              extensions: { "io.sdar/businessEvents": { profileVersion: "1.0" } },
            },
          },
        },
      }),
    });
    if (response.status !== 200 || !response.body) {
      throw new Error(`PUBLIC_BUSINESS_LISTEN_FAILED: ${response.status} ${await response.text()}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const messages: unknown[] = [];
    while (messages.length < count) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true }).replaceAll("\r\n", "\n");
      let end = buffer.indexOf("\n\n");
      while (end >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame.split("\n").find((line) => line.startsWith("data: "));
        if (data) {
          const parsed = JSON.parse(data.slice(6)) as {
            method?: string;
            params?: { sourceId?: string; taskId?: string };
          };
          if (
            parsed.method === "notifications/io.sdar/businessEvents" &&
            parsed.params?.sourceId === "vehicle.business" &&
            parsed.params.taskId === taskId
          )
            messages.push(parsed);
        }
        end = buffer.indexOf("\n\n");
      }
    }
    if (messages.length !== count) throw new Error("PUBLIC_BUSINESS_NOTIFICATIONS_MISSING");
    return messages;
  } finally {
    clearTimeout(deadline);
    controller.abort();
  }
}

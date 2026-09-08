import {
  insertCommittedTaskEvent,
  OutboxRepository,
} from "../../packages/persistence-postgres/src/index.js";
import { requireValue } from "../../packages/gowm-shared-storage-adapter/src/value.js";
import { BusinessEventRepository } from "../../packages/persistence-postgres/src/business-events.js";
import { NativeMissionStorage } from "../../packages/gowm-shared-storage-adapter/src/native-missions.js";
import { recordMissionReceipt } from "../../packages/gowm-shared-storage-adapter/src/mission-links.js";
import { TtlCleaner } from "../../packages/task-engine/src/ttl-cleaner.js";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Pool } from "pg";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import {
  loadGowmStorageConfig,
  createGowmPool,
  verifyGowmStorage,
  inTransaction,
} from "../../packages/gowm-shared-storage-adapter/src/index.js";
import { reconcileMcpExecutionLinks } from "../../packages/gowm-shared-storage-adapter/src/mission-links.js";
import {
  TaskRepository,
  OperationSnapshotRepository,
  IdempotencyRepository,
} from "../../packages/persistence-postgres/src/index.js";
import {
  PostgresProviderStore,
  type ProviderExecution,
  type MutationJournalEntry,
} from "../../packages/provider-adapter-kit/src/index.js";
import { ugvManifest } from "../../apps/ugv-provider-adapter/src/manifest.js";
import { mockUgvToolContracts } from "../../packages/vehicle-device-mcp-client/src/index.js";
import { OperationRegistry } from "../../packages/operation-registry/src/index.js";
import type { ProviderManifest } from "../../packages/adapter-protocol/src/index.js";
import type { AdmissionIntentInput } from "../../packages/persistence-postgres/src/tasks.js";
import { defaultTiming } from "../../packages/domain/src/timing.js";
const url = process.env.SMPP_GOWM_TEST_DATABASE_URL;
if (process.env.SMPP_GOWM_TEST_ENABLE !== "true" || !url || !new URL(url).pathname.includes("test"))
  throw Error(
    "NOT_RUN: explicit isolated SMPP_GOWM_TEST_DATABASE_URL and SMPP_GOWM_TEST_ENABLE=true required",
  );
const admin = new Pool({ connectionString: url });
const run = randomUUID();
const devices: {
  pool: Pool;
  store: PostgresProviderStore;
  tasks: TaskRepository;
  id: string;
  binding: string;
  snapshot: string;
  resource: string;
}[] = [];
const hash = "a".repeat(64);
const authorization = {
  hash,
  executionMode: "simulation" as const,
  simulationId: "same-simulation",
};
beforeAll(async () => {
  const scope = `TEST:smpp-${run}`;
  await admin.query<Record<string, unknown>>(
    "INSERT INTO public.data_scope(scope_key,operational_domain,description) VALUES($1,'TEST','SMPP actual repository integration')",
    [scope],
  );
  for (const letter of ["A", "B"]) {
    const id = `smpp-test-${run}-${letter}`,
      binding = randomUUID(),
      resource = `test:${run}:${letter}`;
    await admin.query<Record<string, unknown>>(
      "INSERT INTO public.world_object(id,object_type,data_scope_key) VALUES($1,'VEHICLE',$2)",
      [id, scope],
    );
    await admin.query<Record<string, unknown>>(
      `INSERT INTO gowm_device.device(device_id,data_scope_key,identifier_namespace,device_identifier,device_name,device_type)
      VALUES($1,$2,$3,$4,$4,'UGV')`,
      [id, scope, run, letter],
    );
    await admin.query<Record<string, unknown>>(
      `INSERT INTO gowm_device.device_service_binding(binding_id,device_id,data_scope_key,smpp_service_key,provider_id,resource_id)
      VALUES($1,$2,$3,'test-smpp','test-ugv',$4)`,
      [binding, id, scope, resource],
    );
    const config = requireValue(
      loadGowmStorageConfig({
        SMPP_STORAGE_MODE: "gowm-shared",
        GOWM_DATABASE_URL: url,
        SMPP_SERVICE_KEY: "test-smpp",
        SMPP_ALLOWED_DEVICE_IDS: JSON.stringify([id]),
        SMPP_GOWM_BINDING_ID: binding,
        SMPP_SOURCE_SESSION_KEY: "test-ingress-session",
      }),
    );
    const pool = createGowmPool(config);
    const store = new PostgresProviderStore(requireValue(url), 8, "ugv", config);
    const manifest = new OperationRegistry().validate(
      ugvManifest("test-ugv", "test", store, resource, {
        contracts: mockUgvToolContracts(new Date().toISOString()),
        executionMode: "simulation",
      }) as unknown as ProviderManifest,
    );
    const snapshots = await new OperationSnapshotRepository(pool).saveManifest(manifest);
    devices.push({
      pool,
      store,
      tasks: new TaskRepository(pool),
      id,
      binding,
      snapshot: requireValue(snapshots.get("vehicle_navigate")),
      resource,
    });
  }
}, 30000);
afterAll(async () => {
  await Promise.all(devices.flatMap((d) => [d.pool.end(), d.store.close()]));
  await admin.end();
});
function admission(d: (typeof devices)[number], taskId = randomUUID()): AdmissionIntentInput {
  const now = new Date();
  return {
    taskId,
    providerId: "test-ugv",
    operationName: "vehicle_navigate",
    operationSnapshotId: d.snapshot,
    authorization,
    arguments: { resourceId: d.resource, destination: { x: 1, y: 2 } },
    argumentHash: hash,
    acceptedAt: now,
    notBefore: now,
    latestStartAt: new Date(now.getTime() + 30000),
    deadlineAt: null,
    ttlMs: null,
    timing: defaultTiming,
    reservationRef: null,
  };
}
function execution(d: (typeof devices)[number], task: AdmissionIntentInput): ProviderExecution {
  const now = new Date().toISOString();
  return {
    taskId: task.taskId,
    externalExecutionId: `external:${randomUUID()}`,
    providerId: "test-ugv",
    operationName: "vehicle_navigate",
    argumentHash: hash,
    resourceId: d.resource,
    tracks: ["CHASSIS"],
    arguments: task.arguments,
    executionContext: {
      authorizationContextHash: hash,
      executionMode: "simulation",
      simulationId: "same-simulation",
      correlationId: "test",
    },
    downstreamMissionIds: [],
    state: "ACCEPTED",
    revision: 1,
    reasonCode: "TEST",
    createdAt: now,
    updatedAt: now,
    evidence: [],
  };
}
async function publish(
  d: (typeof devices)[number],
  task: AdmissionIntentInput,
  e: ProviderExecution,
) {
  return d.tasks.publishAccepted({
    ...task,
    externalExecutionId: e.externalExecutionId,
    adapterRevision: 1,
    adapterResponse: { externalExecutionId: e.externalExecutionId },
    transition: {
      internalState: "RUNNING",
      mcpStatus: "working",
      substate: null,
      statusMessage: "test",
      result: null,
      error: null,
      terminal: false,
      observationType: "accepted",
    },
  });
}
describe("actual GOWM-installed SMPP repositories", () => {
  it("verifies the consumed SMPP contract", async () => {
    await verifyGowmStorage(
      requireValue(devices[0]).pool,
      requireValue(requireValue(devices[0]).store.gowm),
    );
  });
  it("rejects a mismatched core contract without changing installed history", async () => {
    const d = requireValue(devices[0]);
    const dir = await mkdtemp(join(tmpdir(), "smpp-contract-negative-"));
    try {
      const source = JSON.parse(
        await readFile("contracts/gowm-shared-storage/current/source.json", "utf8"),
      ) as { core: { sha256: string } };
      const original = source.core.sha256;
      source.core.sha256 = "0".repeat(64);
      await writeFile(join(dir, "source.json"), JSON.stringify(source));
      await writeFile(join(dir, "consumed-schema.json"), "{}");
      await expect(verifyGowmStorage(d.pool, { contractDir: dir })).rejects.toThrow(
        "GOWM_STORAGE_CONTRACT_MISMATCH",
      );
      const history = await admin.query<{ checksum: string }>(
        "SELECT checksum FROM public.schema_migration WHERE version='078_device_shared_business_storage.sql'",
      );
      expect(history.rows[0]?.checksum).toBe(original);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("isolates the same device and idempotency text across services", async () => {
    const d = requireValue(devices[0]);
    const second = createGowmPool({
      ...requireValue(d.store.gowm),
      serviceKey: "test-smpp-second",
    });
    try {
      const input = {
        authorization,
        operationName: "vehicle_get_state",
        idempotencyKey: "service-test",
        argumentHash: hash,
      };
      const first = await new IdempotencyRepository(d.pool).execute(input, async () => ({
        kind: "result",
        result: { service: "first" },
      }));
      const other = await new IdempotencyRepository(second).execute(input, async () => ({
        kind: "result",
        result: { service: "second" },
      }));
      expect(first).toEqual({ kind: "result", result: { service: "first" } });
      expect(other).toEqual({ kind: "result", result: { service: "second" } });
    } finally {
      await second.end();
    }
  });
  it("isolates equal idempotency text and preserves argument conflicts", async () => {
    let calls = 0;
    for (const d of devices) {
      const repo = new IdempotencyRepository(d.pool);
      const input = {
        authorization,
        operationName: "vehicle_get_state",
        idempotencyKey: run,
        argumentHash: hash,
      };
      const invoke = async () => {
        calls++;
        return { kind: "result" as const, result: { device: d.id } };
      };
      expect(await repo.execute(input, invoke)).toEqual({
        kind: "result",
        result: { device: d.id },
      });
      await repo.execute(input, invoke);
      await expect(
        repo.execute({ ...input, argumentHash: "b".repeat(64) }, invoke),
      ).rejects.toThrow("IDEMPOTENCY_KEY_CONFLICT");
    }
    expect(calls).toBe(2);
  });
  it("writes A/B same snapshot revision and rejects conflicting payloads", async () => {
    const now = new Date().toISOString();
    for (const d of devices) {
      const r = { revision: "1", observedAt: now, channel: "chassis", snapshot: { device: d.id } };
      await d.store.putSnapshot(r);
      await d.store.putSnapshot(r);
      await expect(d.store.putSnapshot({ ...r, snapshot: { different: true } })).rejects.toThrow(
        "SNAPSHOT_IDENTITY_CONFLICT",
      );
    }
    const rows = await admin.query<Record<string, unknown>>(
      "SELECT * FROM ugv_smpp.ugv_state_snapshot WHERE device_id=ANY($1)",
      [devices.map((d) => d.id)],
    );
    expect(rows.rowCount).toBe(2);
  });
  it("publishes late MCP parents and keeps equal native Mission 7 separate", async () => {
    const missions = [];
    for (const d of devices) {
      const task = admission(d),
        e = execution(d, task);
      await d.tasks.createAdmissionIntent(task);
      await d.store.putExecution(e);
      const intent: MutationJournalEntry = {
        taskId: e.taskId,
        stepId: "primary",
        phase: "PRIMARY",
        toolName: "navigate",
        argumentHash: hash,
        state: "INTENT_PERSISTED",
        intentPersistedAt: new Date().toISOString(),
      };
      expect((await d.store.claimMutationJournal(intent)).claimed).toBe(true);
      const dispatch = {
        ...intent,
        state: "DISPATCHING" as const,
        dispatchedAt: new Date().toISOString(),
      };
      expect(await d.store.advanceMutationJournal(dispatch, "INTENT_PERSISTED")).toBe(true);
      const receipt = {
        ...dispatch,
        state: "ACCEPTED" as const,
        externalMissionId: "7",
        resultHash: hash,
        completedAt: new Date().toISOString(),
      };
      expect(await d.store.advanceMutationJournal(receipt, "DISPATCHING")).toBe(true);
      const before = await admin.query<Record<string, unknown>>(
        "SELECT mcp_task_id FROM ugv_smpp.ugv_execution WHERE task_id=$1",
        [e.taskId],
      );
      expect(before.rows[0]?.mcp_task_id).toBeNull();
      const published = await publish(d, task, e);
      expect(published.deviceId).toBe(d.id);
      await inTransaction(d.pool, reconcileMcpExecutionLinks);
      const links = await admin.query<Record<string, unknown>>(
        "SELECT * FROM gowm_execution.execution_mission_link WHERE device_id=$1 AND provider_task_record_id=$2",
        [d.id, e.taskId],
      );
      expect(links.rows).toHaveLength(1);
      expect(links.rows[0]?.mcp_task_id).toBe(task.taskId);
      expect(links.rows[0]?.link_state).toBe("LINKED");
      missions.push(links.rows[0]?.mission_instance_id);
      const other = requireValue(devices.find((x) => x !== d));
      expect(await other.tasks.getById(task.taskId)).toBeNull();
      expect(await other.store.getExecution(e.taskId)).toBeUndefined();
    }
    expect(new Set(missions).size).toBe(2);
  });
  it("same-device workers claim once while B claims its own commands", async () => {
    const taskIds = [];
    for (const d of devices) {
      const task = admission(d),
        e = execution(d, task);
      await d.tasks.createAdmissionIntent(task);
      await d.store.putExecution(e);
      await publish(d, task, e);
      await d.tasks.beginCancel(task.taskId, hash);
      taskIds.push(task.taskId);
    }
    const a = requireValue(devices[0]),
      b = requireValue(devices[1]);
    const claimed = await Promise.all([
      a.tasks.claimDueCommands(new Date(), "worker-a1"),
      new TaskRepository(a.pool).claimDueCommands(new Date(), "worker-a2"),
      b.tasks.claimDueCommands(new Date(), "worker-b"),
    ]);
    expect(requireValue(claimed[0]).length + requireValue(claimed[1]).length).toBe(1);
    expect(requireValue(claimed[2]).map((x) => x.taskId)).toEqual([taskIds[1]]);
  });
  it("scope lease keys fence concurrent workers independently per device", async () => {
    const a = requireValue(devices[0]),
      b = requireValue(devices[1]);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const ready = new Promise<void>((r) => (entered = r));
    const first = a.tasks.withRecoveryLock("same-native-key", async () => {
      entered();
      await held;
      return "a";
    });
    await ready;
    expect(await a.tasks.withRecoveryLock("same-native-key", async () => "wrong")).toBeNull();
    expect(await b.tasks.withRecoveryLock("same-native-key", async () => "b")).toBe("b");
    release();
    expect(await first).toBe("a");
  });
  it("receipt and Mission rollback together, then replay is idempotent and conflicting evidence fails", async () => {
    const d = requireValue(devices[0]),
      task = admission(d),
      e = execution(d, task);
    await d.tasks.createAdmissionIntent(task);
    await d.store.putExecution(e);
    const intent: MutationJournalEntry = {
      taskId: e.taskId,
      stepId: "rollback",
      phase: "PRIMARY",
      toolName: "navigate",
      argumentHash: hash,
      state: "INTENT_PERSISTED",
      intentPersistedAt: new Date().toISOString(),
    };
    await d.store.claimMutationJournal(intent);
    const dispatch = {
      ...intent,
      state: "DISPATCHING" as const,
      dispatchedAt: new Date().toISOString(),
    };
    await d.store.advanceMutationJournal(dispatch, "INTENT_PERSISTED");
    const receipt = {
      ...dispatch,
      state: "ACCEPTED" as const,
      externalMissionId: "7",
      resultHash: hash,
      completedAt: new Date().toISOString(),
    };
    const spy = vi
      .spyOn(NativeMissionStorage.prototype, "linkExecutionToMission")
      .mockRejectedValueOnce(Error("INJECTED_LINK_FAILURE"));
    await expect(d.store.advanceMutationJournal(receipt, "DISPATCHING")).rejects.toThrow(
      "INJECTED_LINK_FAILURE",
    );
    spy.mockRestore();
    expect((await d.store.getMutationJournalEntry(e.taskId, "rollback"))?.state).toBe(
      "DISPATCHING",
    );
    expect(
      (
        await admin.query<Record<string, unknown>>(
          "SELECT 1 FROM gowm_execution.mission_identity WHERE native_session_key=$1",
          [e.externalExecutionId],
        )
      ).rowCount,
    ).toBe(0);
    expect(await d.store.advanceMutationJournal(receipt, "DISPATCHING")).toBe(true);
    await inTransaction(d.pool, (c) => recordMissionReceipt(c, receipt));
    await expect(
      inTransaction(d.pool, (c) =>
        recordMissionReceipt(c, { ...receipt, resultHash: "b".repeat(64) }),
      ),
    ).rejects.toThrow("MISSION_RECEIPT_CONFLICT");
  });
  it("source sequences and duplicate event IDs are isolated; foreign leases are rejected", async () => {
    const leases = [];
    for (const d of devices) {
      const repo = new BusinessEventRepository(d.pool);
      const source = {
        sourceId: "vehicle.health",
        sourceStreamId: "00000000-0000-4000-8000-000000000007",
        deliverySemantics: "durable_at_least_once" as const,
      };
      await repo.initializeProvider("event-test", [source], 86400000);
      const lease = await repo.acquireSourceLease(
        "event-test",
        source.sourceId,
        source.sourceStreamId,
        "same-worker",
        30000,
      );
      expect(lease).toBeDefined();
      leases.push(requireValue(lease));
      const fact = {
        sourceEventId: "same-event",
        sourceSequence: "1",
        sourceStreamId: source.sourceStreamId,
        scope: "resource" as const,
        resourceRef: d.resource,
        occurredAt: new Date().toISOString(),
        eventType: "vehicle.health.changed",
        description: "test",
        rawPayload: { test: true },
      };
      const first = await repo.intakeSourceFact(requireValue(lease), fact, 86400000, 60000);
      expect(first.disposition).toBe("received");
      expect(
        (await repo.intakeSourceFact(requireValue(lease), fact, 86400000, 60000)).disposition,
      ).toBe("duplicate");
    }
    await expect(
      new BusinessEventRepository(requireValue(devices[1]).pool).renewSourceLease(
        requireValue(leases[0]),
        30000,
      ),
    ).rejects.toThrow("DEVICE_SCOPE_MISMATCH");
  });
  it("cross-device journal writes fail the actual composite parent FK", async () => {
    const a = requireValue(devices[0]),
      b = requireValue(devices[1]),
      task = admission(a),
      e = execution(a, task);
    await a.tasks.createAdmissionIntent(task);
    await a.store.putExecution(e);
    await expect(
      b.store.claimMutationJournal({
        taskId: e.taskId,
        stepId: "wrong-device",
        phase: "PRIMARY",
        toolName: "navigate",
        argumentHash: hash,
        state: "INTENT_PERSISTED",
        intentPersistedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/foreign key/i);
  });
  it("known targets normalize and unknown local frames retain native coordinates", async () => {
    for (const [index, d] of devices.entries()) {
      const task = admission(d);
      task.arguments = {
        resourceId: d.resource,
        mission: { target: index === 0 ? { latitude: 30, longitude: 114 } : { x: 1, y: 2 } },
      };
      const e = execution(d, task);
      await d.tasks.createAdmissionIntent(task);
      await d.store.putExecution(e);
      await publish(d, task, e);
      const rows = await admin.query<Record<string, unknown>>(
        `SELECT g.normalization_state,g.geometry_wgs84 FROM gowm_task.target_geometry g JOIN gowm_task.target_binding b USING(target_id) WHERE b.owner_key=$1`,
        [{ taskId: task.taskId }],
      );
      expect(rows.rows[0]?.normalization_state).toBe(index === 0 ? "NORMALIZED" : "NATIVE_ONLY");
      if (index === 1) expect(rows.rows[0]?.geometry_wgs84).toBeNull();
    }
  });
  it("handle expiry never physically purges retained native history", async () => {
    const d = requireValue(devices[0]),
      task = admission(d),
      e = execution(d, task);
    task.ttlMs = 1;
    await d.tasks.createAdmissionIntent(task);
    await d.store.putExecution(e);
    await d.tasks.publishAccepted({
      ...task,
      externalExecutionId: e.externalExecutionId,
      adapterRevision: 1,
      adapterResponse: {},
      transition: {
        internalState: "TERMINAL_COMPLETED",
        mcpStatus: "completed",
        substate: null,
        statusMessage: "test",
        result: { test: true },
        error: null,
        terminal: true,
        observationType: "completed",
      },
    });
    const cleaner = new TtlCleaner(d.tasks, { purgeGraceMs: 1 });
    await cleaner.tick(new Date(Date.now() + 10000));
    await cleaner.tick(new Date(Date.now() + 20000));
    const history = await d.tasks.getById(task.taskId);
    expect(history).not.toBeNull();
    expect(history?.expiredAt).not.toBeNull();
    expect(await d.store.getExecution(e.taskId)).toBeDefined();
  });
  it("same outbox key can coexist on A/B and B cannot publish A's row", async () => {
    const events = [];
    for (const d of devices) {
      const task = admission(d),
        e = execution(d, task);
      await d.tasks.createAdmissionIntent(task);
      await d.store.putExecution(e);
      await publish(d, task, e);
      await inTransaction(d.pool, (c) =>
        insertCommittedTaskEvent(c, task.taskId, "task.test", { test: true }, "same-outbox-key"),
      );
      const rows = await d.pool.query<{ event_id: string }>(
        "SELECT event_id FROM ugv_smpp.outbox_event WHERE aggregate_id=$1 AND event_type='task.test'",
        [task.taskId],
      );
      events.push(requireValue(rows.rows[0]).event_id);
    }
    expect(
      await new OutboxRepository(requireValue(devices[1]).pool).markPublished([
        requireValue(events[0]),
      ]),
    ).toBe(0);
    expect(new Set(events).size).toBe(2);
  });
  it("uncertain dispatch remains durable and cannot be claimed as a new send", async () => {
    const d = requireValue(devices[0]),
      task = admission(d),
      e = execution(d, task);
    await d.tasks.createAdmissionIntent(task);
    await d.store.putExecution(e);
    const intent: MutationJournalEntry = {
      taskId: e.taskId,
      stepId: "uncertain",
      phase: "PRIMARY",
      toolName: "navigate",
      argumentHash: hash,
      state: "INTENT_PERSISTED",
      intentPersistedAt: new Date().toISOString(),
    };
    await d.store.claimMutationJournal(intent);
    const sending = {
      ...intent,
      state: "DISPATCHING" as const,
      dispatchedAt: new Date().toISOString(),
    };
    await d.store.advanceMutationJournal(sending, "INTENT_PERSISTED");
    await d.store.advanceMutationJournal(
      { ...sending, state: "UNCERTAIN", completedAt: new Date().toISOString() },
      "DISPATCHING",
    );
    const restored = await d.store.claimMutationJournal(intent);
    expect(restored.claimed).toBe(false);
    expect(restored.record.state).toBe("UNCERTAIN");
    const link = await admin.query<Record<string, unknown>>(
      "SELECT link_state,mission_instance_id FROM gowm_execution.execution_mission_link WHERE provider_task_record_id=$1",
      [e.taskId],
    );
    expect(link.rows[0]?.link_state).toBe("UNCERTAIN");
    expect(link.rows[0]?.mission_instance_id).toBeNull();
  });
  it("replacing a binding cannot mutate old task ownership or admit through the retired route", async () => {
    const d = requireValue(devices[0]),
      task = admission(d),
      e = execution(d, task);
    await d.tasks.createAdmissionIntent(task);
    await d.store.putExecution(e);
    await publish(d, task, e);
    const next = randomUUID();
    await admin.query(
      "UPDATE gowm_device.device_service_binding SET valid_to=clock_timestamp() WHERE binding_id=$1",
      [d.binding],
    );
    await admin.query(
      `INSERT INTO gowm_device.device_service_binding(binding_id,device_id,data_scope_key,smpp_service_key,provider_id,resource_id)
      SELECT $2,device_id,data_scope_key,smpp_service_key,provider_id,resource_id FROM gowm_device.device_service_binding WHERE binding_id=$1`,
      [d.binding, next],
    );
    await expect(d.tasks.createAdmissionIntent(admission(d))).rejects.toThrow(
      "EXECUTION_ROUTE_UNAVAILABLE",
    );
    expect((await d.tasks.getById(task.taskId))?.gowmBindingId).toBe(d.binding);
    await d.store.putExecution(requireValue(await d.store.getExecution(e.taskId)));
    const fresh = createGowmPool({ ...requireValue(d.store.gowm), bindingId: next });
    try {
      const repo = new TaskRepository(fresh);
      const newer = admission(d);
      expect(await repo.createAdmissionIntent(newer)).toBe(true);
      expect(await repo.getById(task.taskId)).toBeNull();
      await expect(
        admin.query("UPDATE ugv_smpp.provider_task SET gowm_binding_id=$2 WHERE task_id=$1", [
          task.taskId,
          next,
        ]),
      ).rejects.toThrow("BUSINESS_OWNERSHIP_IMMUTABLE");
    } finally {
      await fresh.end();
    }
  });
});

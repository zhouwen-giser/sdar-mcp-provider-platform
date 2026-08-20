import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UgvBusinessEventHub } from "../../apps/ugv-provider-adapter/src/business-events.js";
import { runUgvProviderMigrations } from "../../apps/ugv-provider-adapter/src/migrate.js";
import { UgvProviderRuntime } from "../../apps/ugv-provider-adapter/src/runtime.js";
import { UgvTelemetry } from "../../apps/ugv-provider-adapter/src/telemetry.js";
import {
  MemoryProviderStore,
  PostgresProviderStore,
  type MutationJournalClaim,
  type MutationJournalEntry,
  type MutationJournalState,
  type ProviderExecution,
} from "../../packages/provider-adapter-kit/src/index.js";
import { MockUgvDeviceMcpClient } from "../../packages/vehicle-device-mcp-client/src/index.js";
import { VehicleMqttIngress } from "../../packages/vehicle-mqtt-ingress/src/index.js";
import {
  capturePhysicalDispatchBaseline,
  decodeObservationCursorV1,
} from "../../packages/vehicle-provider-core/src/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined) throw new Error("TEST_DATABASE_URL is required");

describe("UGV observation cursor JSONB regression", () => {
  const admin = new Pool({ connectionString: databaseUrl });
  const schema = `ugv_cursor_fix_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = withSearchPath(databaseUrl, schema);

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const migrationPool = new Pool({ connectionString: scopedUrl, max: 1 });
    try {
      await runUgvProviderMigrations(migrationPool, resolve(import.meta.dirname, "../.."));
    } finally {
      await migrationPool.end();
    }
  });

  afterAll(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("round-trips actual ingress cursors and authorities through PostgreSQL JSONB", async () => {
    const ingress = seededIngress();
    const authorities = ingress.fieldObservationAuthorities([
      "chassis.position.geodetic",
      "chassis.speed",
      "chassis.mission",
    ]);
    const baseline = capturePhysicalDispatchBaseline(
      ingress.snapshot(),
      authorities,
      "2026-08-20T00:00:04.000Z",
    );
    const execution = completedExecution("cursor-postgres-roundtrip", ingress, baseline);
    expect(JSON.stringify(execution)).not.toContain("\\u0000");
    for (const authority of authorities) {
      expect(decodeObservationCursorV1(authority.cursor)).toMatchObject({
        kind: "field",
        field: authority.field,
        topic: authority.topic,
        observedAt: authority.observedAt,
      });
    }

    const store = new PostgresProviderStore(scopedUrl, 1, "ugv");
    await store.initialize();
    try {
      await store.putExecution(execution);
      expect(await store.getExecution(execution.taskId)).toEqual(execution);
      const unsafe = structuredClone(execution);
      unsafe.taskId = "cursor-postgres-unsafe";
      unsafe.externalExecutionId = "vehicle:ugv1:chassis:cursor-postgres-unsafe";
      unsafe.observationCursors = { track: "unsafe\0cursor" };
      await expect(store.putExecution(unsafe)).rejects.toMatchObject({
        code: "PROVIDER_STORE_JSONB_UNSAFE_PAYLOAD",
        rootName: "execution",
        path: "$/observationCursors/track",
        unsafeKind: "nul_string",
      });
      expect(await store.getExecution(unsafe.taskId)).toBeUndefined();
    } finally {
      await store.close();
    }
  });

  it("persists navigation, journals both mutations, and recovers without redispatch", async () => {
    const events: string[] = [];
    const store = new ObservedPostgresStore(scopedUrl, events);
    await store.initialize();
    const ingress = seededIngress();
    const device = observedDevice(events);
    const runtime = runtimeFixture(store, ingress, device);
    await runtime.initialize();

    await runtime.start(startInput("cursor-navigation-start"));
    const execution = required(await store.getExecution("cursor-navigation-start"));
    const journal = await store.listMutationJournal("cursor-navigation-start");
    expect(execution.downstreamMissionIds).toEqual(["1"]);
    expect(JSON.stringify(execution)).not.toContain("\\u0000");
    expect(
      (execution.dispatchBaseline as { observationAuthorities?: { cursor: string }[] })
        .observationAuthorities,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cursor: expect.stringMatching(/^oc1\./) }),
      ]),
    );
    expect(journal).toEqual([
      expect.objectContaining({
        phase: "PRIMARY",
        toolName: "ugv_path_follow_mission",
        state: "ACCEPTED",
        externalMissionId: "1",
      }),
      expect.objectContaining({
        phase: "FOLLOWUP",
        toolName: "ugv_mission_control",
        state: "ACCEPTED",
        externalMissionId: "1",
      }),
    ]);
    expect(device.calls.map(({ name }) => name)).toEqual([
      "ugv_path_follow_mission",
      "ugv_mission_control",
    ]);
    expect(events).toEqual([
      "execution:initial",
      "journal:PRIMARY:INTENT_PERSISTED",
      "journal:PRIMARY:DISPATCHING",
      "transport:PRIMARY",
      "execution:mission:1",
      "journal:PRIMARY:ACCEPTED",
      "journal:FOLLOWUP:INTENT_PERSISTED",
      "journal:FOLLOWUP:DISPATCHING",
      "transport:FOLLOWUP",
      "journal:FOLLOWUP:ACCEPTED",
    ]);
    await runtime.close();

    const recoveredStore = new ObservedPostgresStore(scopedUrl, []);
    await recoveredStore.initialize();
    const recoveredDevice = new MockUgvDeviceMcpClient();
    const recovered = runtimeFixture(recoveredStore, ingress, recoveredDevice);
    await recovered.initialize();
    try {
      expect(await recovered.get("cursor-navigation-start")).toMatchObject({
        downstreamMissionIds: ["1"],
        state: "STARTING",
      });
      expect(recoveredDevice.calls).toHaveLength(0);
      expect(await recoveredStore.listMutationJournal("cursor-navigation-start")).toEqual(journal);
    } finally {
      await recovered.close();
    }
  });

  it("releases the track and performs no mutation when initial execution persistence fails", async () => {
    const store = new InitialExecutionFailingStore();
    const ingress = seededIngress();
    const device = new MockUgvDeviceMcpClient();
    const runtime = runtimeFixture(store, ingress, device);
    await runtime.initialize();
    try {
      await expect(runtime.start(startInput("cursor-persistence-failure"))).rejects.toThrow(
        "TEST_EXECUTION_WRITE_FAILED",
      );
      expect(await store.listMutationJournal("cursor-persistence-failure")).toEqual([]);
      expect(device.calls).toHaveLength(0);
      expect(runtime.arbiter.owner("chassis")).toBeUndefined();
      expect(await store.getExecution("cursor-persistence-failure")).toBeUndefined();
    } finally {
      await runtime.close();
    }
  });
});

class ObservedPostgresStore extends PostgresProviderStore {
  #initialRecorded = false;
  #missionRecorded = false;

  constructor(
    connectionString: string,
    readonly events: string[],
  ) {
    super(connectionString, 1, "ugv");
  }

  override async putExecution(execution: ProviderExecution): Promise<void> {
    await super.putExecution(execution);
    if (!this.#initialRecorded && execution.taskId === "cursor-navigation-start") {
      this.#initialRecorded = true;
      this.events.push("execution:initial");
    }
    if (!this.#missionRecorded && execution.downstreamMissionIds[0] !== undefined) {
      this.#missionRecorded = true;
      this.events.push(`execution:mission:${execution.downstreamMissionIds[0]}`);
    }
  }

  override async claimMutationJournal(entry: MutationJournalEntry): Promise<MutationJournalClaim> {
    const result = await super.claimMutationJournal(entry);
    this.events.push(`journal:${entry.phase}:${entry.state}`);
    return result;
  }

  override async advanceMutationJournal(
    entry: MutationJournalEntry,
    expectedState: MutationJournalState,
  ): Promise<boolean> {
    const result = await super.advanceMutationJournal(entry, expectedState);
    this.events.push(`journal:${entry.phase}:${entry.state}`);
    return result;
  }
}

class InitialExecutionFailingStore extends MemoryProviderStore {
  override putExecution(): Promise<void> {
    return Promise.reject(new Error("TEST_EXECUTION_WRITE_FAILED"));
  }
}

function observedDevice(events: string[]): MockUgvDeviceMcpClient {
  const device = new MockUgvDeviceMcpClient();
  device.handlers.set("ugv_path_follow_mission", () => {
    events.push("transport:PRIMARY");
    return acceptedMutationResult(1, 0);
  });
  device.handlers.set("ugv_mission_control", () => {
    events.push("transport:FOLLOWUP");
    return acceptedMutationResult(1, 1);
  });
  return device;
}

function runtimeFixture(
  store: MemoryProviderStore | PostgresProviderStore,
  ingress: VehicleMqttIngress,
  device: MockUgvDeviceMcpClient,
): UgvProviderRuntime {
  return new UgvProviderRuntime(
    {
      providerId: "isr.vehicle.ugv.ugv1",
      freshness: { chassis: 3000, mission: 3000, health: 5000, target: 3000, payload: 3000 },
      allowNavigationWithRecon: true,
      fireRequiresChassisStopped: true,
      fireEnabled: true,
      stationaryStabilityMs: 0,
      stationaryMinimumSamples: 1,
      pollIntervalMs: 60_000,
    },
    store,
    ingress,
    device,
    new UgvBusinessEventHub(store),
    new UgvTelemetry({
      providerId: "isr.vehicle.ugv.ugv1",
      enabled: false,
      endpoint: "127.0.0.1:7002",
      tlsMode: "disabled",
    }),
  );
}

function seededIngress(): VehicleMqttIngress {
  const ingress = new VehicleMqttIngress("direct_domain_json", {
    maxPayloadBytes: 65_536,
    maxDepth: 16,
    maxNodes: 4096,
    maxStringBytes: 16_384,
  });
  ingress.setConnected(true);
  const now = Date.now();
  ingress.handle(
    "/ugv/gnss",
    json({ entity_id: "ugv1", latitude: 30.1, longitude: 114.1, altitude: 10 }),
    false,
    new Date(now - 300).toISOString(),
  );
  ingress.handle(
    "/ugv/component_status",
    json({
      entity_id: "ugv1",
      power_battery: 0,
      lvbattery: 0,
      fuel: 0,
      water_temp: 0,
      motor: 0,
      sensor: 0,
      gnss: 0,
      comms: 0,
      weapon: 0,
      navigation: 0,
    }),
    false,
    new Date(now - 200).toISOString(),
  );
  ingress.handle(
    "status/ugv",
    json({
      vehicle_id: "ugv1",
      role_name: "ugv",
      speed_kmh: 0,
      eo_task: { state: -1, progress: 0 },
      weapon_task: { state: -1, progress: 0 },
      available: true,
    }),
    false,
    new Date(now - 100).toISOString(),
  );
  ingress.handle(
    "/ugv/mission_state",
    json({ entity_id: "ugv1", type: 1, state: 0, progress: 0 }),
    false,
    new Date(now).toISOString(),
  );
  return ingress;
}

function completedExecution(
  taskId: string,
  ingress: VehicleMqttIngress,
  baseline: ReturnType<typeof capturePhysicalDispatchBaseline>,
): ProviderExecution {
  const observedAt = "2026-08-20T00:00:04.000Z";
  return {
    taskId,
    externalExecutionId: `vehicle:ugv1:chassis:${taskId}`,
    operationName: "vehicle_navigate",
    argumentHash: "a".repeat(64),
    providerId: "isr.vehicle.ugv.ugv1",
    resourceId: "vehicle:ugv1",
    tracks: ["chassis"],
    arguments: navigateArguments(),
    executionContext: {
      authorizationContextHash: "b".repeat(64),
      executionMode: "SIMULATION",
      simulationId: "cursor-jsonb-test",
      correlationId: taskId,
    },
    downstreamMissionIds: ["1"],
    observationCursors: {
      track: JSON.stringify([
        ["/ugv/mission_state", required(ingress.observationCursor("/ugv/mission_state"))],
      ]),
    },
    dispatchBaseline: baseline as unknown as Record<string, unknown>,
    lastStationarySpeedCursor: required(ingress.fieldObservationAuthority("chassis.speed")).cursor,
    state: "SUCCEEDED",
    revision: 4,
    reasonCode: "UGV_TASK_SUCCEEDED",
    progress: 100,
    createdAt: observedAt,
    updatedAt: observedAt,
    terminalAt: observedAt,
    evidence: [],
  };
}

function startInput(taskId: string) {
  return {
    taskId,
    operationName: "vehicle_navigate",
    arguments: navigateArguments(),
    argumentHash: "a".repeat(64),
    executionContext: {
      authorizationContextHash: "b".repeat(64),
      executionMode: "SIMULATION" as const,
      simulationId: "cursor-jsonb-test",
      correlationId: taskId,
    },
  };
}

function navigateArguments() {
  return {
    resourceId: "vehicle:ugv1",
    mission: { type: "point", target: { latitude: 30.2, longitude: 114.2 } },
    speedLimitKmh: 20,
    stopOnObstacle: true,
  };
}

function acceptedMutationResult(missionId: number, state: number): Record<string, unknown> {
  return {
    mission_id: missionId,
    state,
    state_label: "accepted",
    message: "accepted",
    error_code: 0,
  };
}

function json(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("UGV_CURSOR_JSONB_TEST_VALUE_REQUIRED");
  return value;
}

function withSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

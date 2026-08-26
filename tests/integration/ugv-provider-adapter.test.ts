import { createHash } from "node:crypto";
import * as grpc from "@grpc/grpc-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalJson,
  jsonToProtoStruct,
  protoStructToJson,
  type ExecutionSnapshot,
  type ProviderManifest,
} from "../../packages/adapter-protocol/src/index.js";
import { OperationRegistry } from "../../packages/operation-registry/src/index.js";
import {
  MemoryProviderStore,
  type MutationJournalEntry,
  type MutationJournalPhase,
  type MutationJournalState,
  type ProviderExecution,
  type VehicleStartFailureDiagnostic,
} from "../../packages/provider-adapter-kit/src/index.js";
import { synchronousResult } from "../../packages/task-engine/src/result-contract.js";
import {
  buildUgvStartFollowupCall,
  controlDeviceCalls,
  MockUgvDeviceMcpClient,
  mockUgvToolContracts,
  startDeviceCalls,
  UncertainMutatingDeviceCallError,
  type CapturedToolContract,
  type DeviceToolCall,
  type UgvDeviceToolName,
} from "../../packages/vehicle-device-mcp-client/src/index.js";
import { VehicleMqttIngress } from "../../packages/vehicle-mqtt-ingress/src/index.js";
import { UgvBusinessEventHub } from "../../apps/ugv-provider-adapter/src/business-events.js";
import { ugvManifest } from "../../apps/ugv-provider-adapter/src/manifest.js";
import {
  UgvProviderRuntime,
  type CommandIdentity,
} from "../../apps/ugv-provider-adapter/src/runtime.js";
import { UgvTelemetry } from "../../apps/ugv-provider-adapter/src/telemetry.js";
import { UgvProviderServer } from "../../apps/ugv-provider-adapter/src/server.js";

const active: UgvProviderRuntime[] = [];
let lastReconObservationMs = 0;
afterEach(async () => {
  while (active.length > 0) await active.pop()?.close();
});

describe("UGV long-running operation integration", () => {
  it("persists every navigation dispatch fence and mission ID before transport dependencies", async () => {
    const events: string[] = [];
    const store = new DispatchOrderStore(events);
    const device = new MockUgvDeviceMcpClient();
    device.handlers.set("ugv_path_follow_mission", () => {
      events.push("transport:PRIMARY");
      return acceptedMutationResult(1, 0);
    });
    device.handlers.set("ugv_mission_control", () => {
      events.push("transport:FOLLOWUP");
      return acceptedMutationResult(1, 1);
    });
    const fixture = await createFixture(false, store, {}, device);

    await fixture.runtime.start(
      startInput("nav-dispatch-order", "vehicle_navigate", navigateArgs()),
    );

    expect(events).toEqual([
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
    const startingProgress = fixture.telemetry.records.find(
      (record) => record.eventType === "EXECUTION_PROGRESS",
    );
    expect(startingProgress?.payload).toEqual({
      current: 0,
      total: 100,
      percentage: 0,
      unit: "percent",
    });
    expect(startingProgress?.attributes).toMatchObject({
      transition: "STARTING",
      reasonCode: "UGV_WAITING_DEVICE_CONFIRMATION",
      progressKnown: false,
    });
  });

  it("persists an ambiguous primary result as uncertain and never replays it", async () => {
    const device = new MockUgvDeviceMcpClient();
    device.handlers.set("ugv_path_follow_mission", () => ({
      mission_id: 1,
      state: "ambiguous",
      state_label: "unknown",
      message: "unknown",
      error_code: 0,
    }));
    const fixture = await createFixture(false, new MemoryProviderStore(), {}, device);
    const input = startInput("nav-ambiguous-result", "vehicle_navigate", navigateArgs());

    await expect(fixture.runtime.start(input)).resolves.toMatchObject({
      initialSnapshot: { state: "ACCEPTED", reasonCode: "UNCERTAIN_EXECUTION_STATE" },
    });
    expect(await fixture.runtime.get(input.taskId)).toMatchObject({
      state: "STARTING",
      reasonCode: "UNCERTAIN_EXECUTION_STATE",
    });
    expect(device.calls).toHaveLength(1);
    expect(await fixture.store.listMutationJournal(input.taskId)).toEqual([
      expect.objectContaining({
        phase: "PRIMARY",
        state: "UNCERTAIN",
      }),
    ]);

    await expect(fixture.runtime.start(structuredClone(input))).resolves.toMatchObject({
      initialSnapshot: { state: "ACCEPTED", reasonCode: "UNCERTAIN_EXECUTION_STATE" },
    });
    expect(device.calls).toHaveLength(1);
  });

  it("persists mission-write failure after primary acceptance as uncertain without replay", async () => {
    const store = new MissionPersistenceFailingStore();
    const fixture = await createFixture(false, store);
    const input = startInput("nav-mission-persist-failed", "vehicle_navigate", navigateArgs());

    await expect(fixture.runtime.start(input)).resolves.toMatchObject({
      initialSnapshot: { state: "ACCEPTED", reasonCode: "UNCERTAIN_EXECUTION_STATE" },
    });
    expect(fixture.device.calls).toHaveLength(1);
    const journal = await store.listMutationJournal(input.taskId);
    expect(journal).toEqual([
      expect.objectContaining({
        phase: "PRIMARY",
        state: "UNCERTAIN",
        externalMissionId: "1",
      }),
    ]);
    expect(journal[0]?.resultHash).toMatch(/^[a-f0-9]{64}$/);

    await fixture.runtime.start(structuredClone(input));
    expect(fixture.device.calls).toHaveLength(1);
  });

  it("converts accepted-result journal persistence failure to uncertainty without replay", async () => {
    const store = new JournalCompletionFailingStore();
    const fixture = await createFixture(false, store);
    const input = startInput("nav-journal-persist-failed", "vehicle_navigate", navigateArgs());

    await expect(fixture.runtime.start(input)).resolves.toMatchObject({
      initialSnapshot: { state: "ACCEPTED", reasonCode: "UNCERTAIN_EXECUTION_STATE" },
    });
    expect(fixture.device.calls).toHaveLength(1);
    expect(await store.listMutationJournal(input.taskId)).toEqual([
      expect.objectContaining({ phase: "PRIMARY", state: "UNCERTAIN" }),
    ]);

    await fixture.runtime.start(structuredClone(input));
    expect(fixture.device.calls).toHaveLength(1);
  });

  it("keeps an accepted mission with rejected follow-up in an explicit ready-not-started state", async () => {
    const device = new MockUgvDeviceMcpClient();
    device.handlers.set("ugv_mission_control", () => acceptedMutationResult(1, 5));
    const fixture = await createFixture(false, new MemoryProviderStore(), {}, device);
    const input = startInput("nav-ready-not-started", "vehicle_navigate", navigateArgs());

    await expect(fixture.runtime.start(input)).resolves.toMatchObject({
      initialSnapshot: {
        state: "ACCEPTED",
        reasonCode: "DOWNSTREAM_MISSION_READY_NOT_STARTED",
      },
    });
    expect(await fixture.runtime.get(input.taskId)).toMatchObject({
      state: "STARTING",
      reasonCode: "DOWNSTREAM_MISSION_READY_NOT_STARTED",
      downstreamMissionIds: ["1"],
    });
    expect(await fixture.store.listMutationJournal(input.taskId)).toEqual([
      expect.objectContaining({ phase: "PRIMARY", state: "ACCEPTED", externalMissionId: "1" }),
      expect.objectContaining({ phase: "FOLLOWUP", state: "REJECTED", externalMissionId: "1" }),
    ]);
    expect(device.calls).toHaveLength(2);

    await fixture.runtime.start(structuredClone(input));
    expect(device.calls).toHaveLength(2);
  });

  it("persists phase deadlines from their authoritative observations and command fence", async () => {
    let now = Date.now();
    const fixture = await createFixture(false, new MemoryProviderStore(), {
      now: () => new Date(now),
      startObservationTimeoutMs: 1_000,
      activeObservationTimeoutMs: 2_000,
      terminalObservationTimeoutMs: 3_000,
      physicalConfirmationTimeoutMs: 4_000,
      controlConfirmationTimeoutMs: 5_000,
    });
    await fixture.runtime.start(
      startInput("nav-phase-deadlines", "vehicle_navigate", navigateArgs()),
    );
    let execution = required(await fixture.runtime.get("nav-phase-deadlines"));
    const followup = required(
      await fixture.store.getMutationJournalEntry("nav-phase-deadlines", "start:02:followup"),
    );
    expect(Date.parse(required(execution.startObservationDeadline))).toBe(
      Date.parse(required(followup.completedAt)) + 1_000,
    );

    now += 10;
    missionRaw(fixture.ingress, 0, 0);
    execution = required(await fixture.runtime.get("nav-phase-deadlines"));
    expect(Date.parse(required(execution.activeObservationDeadline))).toBe(
      Date.parse(fixture.ingress.snapshot().observedAt) + 2_000,
    );

    now += 10;
    missionRaw(fixture.ingress, 1, 10);
    execution = required(await fixture.runtime.get("nav-phase-deadlines"));
    expect(Date.parse(required(execution.terminalObservationDeadline))).toBe(
      Date.parse(fixture.ingress.snapshot().observedAt) + 3_000,
    );

    now += 10;
    const identity = identityOf(execution, "1");
    await fixture.runtime.command("pause", identity);
    execution = required(await fixture.runtime.get("nav-phase-deadlines"));
    const fencedAt = execution.controlConfirmation?.fencedAt;
    expect(typeof fencedAt).toBe("string");
    expect(Date.parse(required(execution.controlConfirmationDeadline))).toBe(
      Date.parse(String(fencedAt)) + 5_000,
    );

    now += 10;
    missionRaw(fixture.ingress, 4, 100);
    execution = required(await fixture.runtime.get("nav-phase-deadlines"));
    expect(Date.parse(required(execution.physicalConfirmationDeadline))).toBe(
      Date.parse(fixture.ingress.snapshot().observedAt) + 4_000,
    );
  });

  it("enforces a persisted start-observation deadline after restart without redispatch", async () => {
    let now = Date.now();
    const options = {
      ...runtimeOptions(),
      now: () => new Date(now),
      startObservationTimeoutMs: 100,
    };
    const store = new MemoryProviderStore();
    const fixture = await createFixture(false, store, options);
    await fixture.runtime.start(
      startInput("nav-restart-deadline", "vehicle_navigate", navigateArgs()),
    );
    const beforeRestart = required(await store.getExecution("nav-restart-deadline"));
    expect(beforeRestart.startObservationDeadline).toBe(new Date(now + 100).toISOString());
    const callsBeforeRestart = fixture.device.calls.length;
    await fixture.runtime.close();

    now += 101;
    const recovered = new UgvProviderRuntime(
      options,
      store,
      fixture.ingress,
      fixture.device,
      fixture.events,
      fixture.telemetry,
    );
    active.push(recovered);
    await recovered.initialize();

    expect(await store.getExecution("nav-restart-deadline")).toMatchObject({
      state: "TECHNICAL_FAILED",
      reasonCode: "UGV_START_OBSERVATION_TIMEOUT",
      startObservationDeadline: beforeRestart.startObservationDeadline,
      result: { status: "timeout" },
    });
    expect(fixture.device.calls).toHaveLength(callsBeforeRestart);
  });

  it("expires control and physical confirmation deadlines without a new MQTT cursor", async () => {
    let now = Date.now();
    const controlFixture = await createFixture(false, new MemoryProviderStore(), {
      now: () => new Date(now),
      controlConfirmationTimeoutMs: 100,
    });
    now = Date.now() + 100;
    await controlFixture.runtime.start(
      startInput("pause-no-observation", "vehicle_navigate", navigateArgs()),
    );
    missionRaw(controlFixture.ingress, 1, 10, new Date(now).toISOString());
    const running = required(await controlFixture.runtime.get("pause-no-observation"));
    await controlFixture.runtime.command("pause", identityOf(running, "1"));
    now += 101;
    expect(await controlFixture.runtime.get("pause-no-observation")).toMatchObject({
      state: "TECHNICAL_FAILED",
      reasonCode: "UGV_CONTROL_CONFIRMATION_TIMEOUT",
      result: { status: "timeout", observedAt: new Date(now).toISOString() },
    });

    const physicalFixture = await createFixture(false, new MemoryProviderStore(), {
      now: () => new Date(now),
      stationaryStabilityMs: 1_000,
      stationaryMinimumSamples: 2,
      physicalConfirmationTimeoutMs: 100,
    });
    now = Date.now() + 100;
    await physicalFixture.runtime.start(
      startInput("terminal-no-observation", "vehicle_navigate", navigateArgs()),
    );
    missionRaw(physicalFixture.ingress, 1, 10, new Date(now).toISOString());
    await physicalFixture.runtime.get("terminal-no-observation");
    now += 10;
    missionRaw(physicalFixture.ingress, 4, 100, new Date(now).toISOString());
    physicalFixture.ingress.handle(
      "/ugv/gnss",
      Buffer.from('{"entity_id":"ugv1","latitude":30.1001,"longitude":114.1001}'),
      false,
      new Date(now).toISOString(),
    );
    physicalFixture.ingress.handle(
      "/ugv/speed",
      Buffer.from('{"entity_id":"ugv1","speed_kmh":0}'),
      false,
      new Date(now).toISOString(),
    );
    expect(await physicalFixture.runtime.get("terminal-no-observation")).toMatchObject({
      state: "RUNNING",
      reasonCode: "UGV_STATIONARY_STABILITY_PENDING",
      consecutiveStationaryObservations: 1,
    });
    now += 101;
    expect(await physicalFixture.runtime.get("terminal-no-observation")).toMatchObject({
      state: "TECHNICAL_FAILED",
      reasonCode: "UGV_PHYSICAL_CONFIRMATION_TIMEOUT",
      result: { status: "timeout", observedAt: new Date(now).toISOString() },
    });
  });

  it("fails closed on execution-mode mismatch before any physical call", async () => {
    const fixture = await createFixture();
    const input = startInput("live-mismatch", "vehicle_navigate", navigateArgs());
    await expect(
      fixture.runtime.start({
        ...input,
        executionContext: {
          authorizationContextHash: input.executionContext.authorizationContextHash,
          executionMode: "LIVE",
          simulationId: "not-applicable-live",
          correlationId: input.executionContext.correlationId,
        },
      }),
    ).rejects.toThrow("UGV_EXECUTION_MODE_MISMATCH");
    expect(fixture.device.calls).toHaveLength(0);
  });

  it("allows LIVE only for an explicitly live Provider and rejects SIMULATION side effects", async () => {
    const fixture = await createFixture(false, new MemoryProviderStore(), {
      executionMode: "live",
    });
    const live = startInput("live-allowed", "vehicle_navigate", navigateArgs());
    live.executionContext.executionMode = "LIVE";
    live.executionContext.simulationId = "not-applicable-live";
    await expect(fixture.runtime.start(live)).resolves.toMatchObject({
      initialSnapshot: { state: "ACCEPTED" },
    });
    expect(fixture.device.calls).toHaveLength(2);

    const simulation = startInput("simulation-rejected", "vehicle_navigate", navigateArgs());
    await expect(fixture.runtime.start(simulation)).rejects.toThrow("UGV_EXECUTION_MODE_MISMATCH");
    expect(fixture.device.calls).toHaveLength(2);
  });

  it("keeps fire disabled in availability and direct start with zero device calls", async () => {
    const fixture = await createFixture(true, new MemoryProviderStore(), { fireEnabled: false });
    expect(fixture.runtime.availability("vehicle_fire_weapon", fireArgs())).toMatchObject({
      availability: "DISABLED",
      reasonCode: "UGV_FIRE_DISABLED",
    });
    await expect(
      fixture.runtime.start(startInput("fire-disabled", "vehicle_fire_weapon", fireArgs())),
    ).rejects.toThrow("UGV_FIRE_DISABLED");
    expect(fixture.device.calls).toHaveLength(0);
  });

  it("completes WI050 get-state with source-derived simulator fixtures locally", async () => {
    const device = new MockUgvDeviceMcpClient();
    // Source-derived fixture, not a captured wire response: mock-ugv-device-mcp
    // initial state and get_status at 9603527c60841681d68366abb0f3c75393bb4c89.
    device.responses.set("get_status", {
      available: true,
      heading: 0,
      veh_speed: 0,
      chassis_task: { id: 1001, state: 0, progress: 0 },
      eo_task: { id: 3001, state: 0, progress: 0 },
      weapon_task: { id: 4001, state: 0, progress: 0 },
      gimbal: { yaw: 0, pitch: 0, zoom: 1 },
    });
    const fixture = await createFixture(
      false,
      new MemoryProviderStore(),
      {
        allowNavigationWithRecon: false,
        fireEnabled: false,
        executionMode: "simulation",
      },
      device,
    );
    // The publisher's deterministic chassis/health frames, once progress reaches
    // 100; these topics have the same envelope in direct and ros_bridge modes.
    const frames: Record<string, unknown> = {
      "/ugv/gnss": { entity_id: "ugv1", latitude: 30.123, longitude: 114.456, altitude: 42 },
      "/ugv/imu": { entity_id: "ugv1", yaw: 0, pitch: 0, roll: 0 },
      "/ugv/speed": { speed_kmh: 0 },
      "status/ugv": {
        vehicle_id: "ugv1",
        role_name: "ugv",
        veh_speed: 0,
        heading: 0,
        chassis_task: { id: 1001, state: 4, progress: 100 },
        eo_task: { id: 3001, state: 4, progress: 100 },
        weapon_task: { id: 4001, state: 0, progress: 0 },
        gimbal: { yaw: 0, pitch: 0, zoom: 1 },
        available: true,
      },
      "/ugv/system_state": {
        entity_id: "ugv1",
        run_state: 1,
        mode: 1,
        speed_limit: 20,
        err_list: [],
      },
      "/ugv/component_status": {
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
      },
      "/ugv/battery_range_km": { range_km: 35.2 },
      "/ugv/mission_state": { entity_id: "ugv1", id: 1001, type: 1, state: -1, progress: 0 },
      "/ugv/nav_state": {
        entity_id: "ugv1",
        position_x: 0,
        position_y: 0,
        position_z: 0,
        speed_kmh: 0,
        battery_range_km: 35.2,
      },
    };
    for (const [topic, payload] of Object.entries(frames)) {
      // VehicleMqttClient isolates rejected frames at its message boundary.
      if (topic === "/ugv/mission_state")
        expect(() => fixture.ingress.handle(topic, Buffer.from(JSON.stringify(payload)))).toThrow(
          "UGV_MQTT_TASK_STATE_INVALID",
        );
      else fixture.ingress.handle(topic, Buffer.from(JSON.stringify(payload)));
    }
    const input = startInput("wi050-local-reproduction", "vehicle_get_state", {
      include: ["chassis", "health"],
      resourceId: "vehicle:ugv1",
    });
    input.executionContext.simulationId = "uap-p3-b02-wi050-20260826t012850z";
    input.argumentHash = createHash("sha256").update(canonicalJson(input.arguments)).digest("hex");
    const started = await fixture.runtime.start(input);
    expect(started.initialSnapshot.state).toBe("SUCCEEDED");
    expect(protoStructToJson(started.initialSnapshot.result)).toMatchObject({
      identity: { resourceId: "vehicle:ugv1", executionMode: "simulation" },
      chassis: { speedKmh: 0 },
      health: { chassisErrorCodes: [] },
    });
  });

  it("records a correlated start failure diagnostic without secret text or changing rejection", async () => {
    const message =
      "connection postgresql://dev:secret-password@db/test failed; Bearer secret-token";
    const error = Object.assign(new TypeError(message), {
      code: "ECONNREFUSED",
      toolName: "get_status",
      authorization: "secret-token",
    });
    error.stack = `TypeError: ${message}\n    at UgvProviderRuntime.#callDevice (/app/dist/apps/ugv-provider-adapter/src/runtime.js:1856:40)\n    at normalizeMqttObservation (/app/dist/packages/vehicle-mqtt-ingress/src/normalizers.js:36:10)\n    at secret-token (/app/node_modules/client.js:1:1)`;
    const diagnostics: VehicleStartFailureDiagnostic[] = [];
    const response = await invokeStartFailure(error, (value) => {
      diagnostics.push(value);
    });

    expect(response).toEqual({
      result: "rejected",
      rejected: {
        reasonCode: "UGV_ADAPTER_INTERNAL_ERROR",
        message: "UGV_ADAPTER_INTERNAL_ERROR",
        retryable: false,
      },
    });
    expect(diagnostics).toEqual([
      {
        taskId: "wi050-local-diagnostic",
        operationName: "vehicle_get_state",
        resourceId: "vehicle:ugv1",
        executionMode: "SIMULATION",
        simulationId: "uap-p3-b02-wi050-20260826t012850z",
        correlationId: "correlation-wi050-local-diagnostic",
        toolName: "get_status",
        errorName: "TypeError",
        errorCode: "ECONNREFUSED",
        messageHash: `sha256:${createHash("sha256").update(message).digest("hex")}`,
        frames: [
          {
            file: "apps/ugv-provider-adapter/src/runtime.js",
            function: "UgvProviderRuntime.#callDevice",
            line: 1856,
            column: 40,
          },
          {
            file: "packages/vehicle-mqtt-ingress/src/normalizers.js",
            function: "normalizeMqttObservation",
            line: 36,
            column: 10,
          },
        ],
      },
    ]);
    const serialized = JSON.stringify(diagnostics);
    for (const secret of [
      "secret-password",
      "secret-token",
      "postgresql://",
      "Bearer",
      "authorizationContextHash",
      "private-argument",
      "/app/dist/",
      "node_modules",
    ])
      expect(serialized).not.toContain(secret);
  });

  it.each(["throws", "rejects", "serializer throws"])(
    "isolates a start failure diagnostic when the logger %s",
    async (failure) => {
      const error = new Error("non-token internal failure");
      if (failure === "serializer throws")
        Object.defineProperty(error, "stack", {
          get() {
            throw new Error("diagnostic serialization failed");
          },
        });
      const response = await invokeStartFailure(error, () => {
        if (failure === "rejects") return Promise.reject(new Error("diagnostic sink failed"));
        throw new Error("diagnostic sink failed");
      });
      expect(response).toEqual({
        result: "rejected",
        rejected: {
          reasonCode: "UGV_ADAPTER_INTERNAL_ERROR",
          message: "UGV_ADAPTER_INTERNAL_ERROR",
          retryable: false,
        },
      });
    },
  );

  it("returns Runtime-valid evidence for every core synchronous read", async () => {
    const fixture = await createFixture();
    const mqttSequence = fixture.ingress.ingestSequence();
    const mqttFreshness = fixture.ingress.snapshot().freshness;
    const manifest = new OperationRegistry().validate(
      ugvManifest(
        "isr.vehicle.ugv.ugv1",
        "1.0.0",
        fixture.store,
        "vehicle:ugv1",
        fixture.runtime.qualificationContext(),
      ) as unknown as ProviderManifest,
    );
    for (const operationName of [
      "vehicle_get_state",
      "vehicle_get_capabilities",
      "vehicle_get_payload_status",
      "vehicle_get_targets",
    ]) {
      const started = await fixture.runtime.start(
        startInput(`read-${operationName}`, operationName, { resourceId: "vehicle:ugv1" }),
      );
      const operation = required(
        manifest.operations.find((candidate) => candidate.name === operationName),
      );
      expect(() =>
        synchronousResult(operation, started.initialSnapshot as unknown as ExecutionSnapshot),
      ).not.toThrow();
    }
    expect(fixture.ingress.ingestSequence()).toBe(mqttSequence);
    expect(fixture.ingress.snapshot().freshness).toEqual(mqttFreshness);
  });

  it("validates stable state, capability and evidence DTOs without raw device status", async () => {
    const fixture = await createFixture();
    fixture.device.responses.set("get_status", { available: true, raw_internal_code: 731 });
    const manifest = new OperationRegistry().validate(
      ugvManifest(
        "isr.vehicle.ugv.ugv1",
        "1.0.0",
        fixture.store,
        "vehicle:ugv1",
        fixture.runtime.qualificationContext(),
      ) as unknown as ProviderManifest,
    );

    for (const operationName of ["vehicle_get_state", "vehicle_get_capabilities"]) {
      const started = await fixture.runtime.start(
        startInput(`stable-${operationName}`, operationName, { resourceId: "vehicle:ugv1" }),
      );
      const operation = required(
        manifest.operations.find((candidate) => candidate.name === operationName),
      );
      expect(() =>
        synchronousResult(operation, started.initialSnapshot as unknown as ExecutionSnapshot),
      ).not.toThrow();
      expect(started.initialSnapshot.evidence).toEqual([
        expect.objectContaining({
          subjectRef: `execution:${started.externalExecutionId}`,
        }),
      ]);
      if (operationName === "vehicle_get_state") {
        const result = protoStructToJson(started.initialSnapshot.result);
        expect(JSON.stringify(result)).not.toContain("deviceStatus");
        expect(JSON.stringify(result)).not.toContain("raw_internal_code");
      }
    }
  });

  it("keeps Runtime availability, capability output and manifest flags on one qualification verdict", async () => {
    const runtimeValidatedContracts = mockUgvToolContracts("2026-08-20T00:00:00.000Z").map(
      withoutOutputSchema,
    );
    const qualifiedFixture = await createFixture(
      false,
      new MemoryProviderStore(),
      {},
      new ContractFixtureUgvDevice(runtimeValidatedContracts),
    );
    const argumentsValue = navigateArgs();
    expect(
      qualifiedFixture.runtime.operationQualification("vehicle_navigate", argumentsValue),
    ).toMatchObject({
      qualified: true,
      reasonCodes: [
        "UGV_OPERATION_QUALIFIED",
        "UGV_TOOL_OUTPUT_SCHEMA_UNDECLARED_RUNTIME_VALIDATED",
      ],
    });
    expect(qualifiedFixture.runtime.availability("vehicle_navigate", argumentsValue)).toMatchObject(
      {
        availability: "AVAILABLE",
        reasonCode: "UGV_AVAILABLE",
      },
    );
    const qualifiedCapabilities = await qualifiedFixture.runtime.start(
      startInput("qualification-capabilities-present", "vehicle_get_capabilities", {
        resourceId: "vehicle:ugv1",
      }),
    );
    expect(
      protoStructToJson(qualifiedCapabilities.initialSnapshot.result).navigation,
    ).toMatchObject({ point: true });
    const qualifiedManifest = ugvManifest(
      "isr.vehicle.ugv.ugv1",
      "1.0.0",
      qualifiedFixture.store,
      "vehicle:ugv1",
      qualifiedFixture.runtime.qualificationContext(),
    );
    expect(JSON.stringify(qualifiedManifest)).toContain("planningMode");

    const missingPathContracts = runtimeValidatedContracts.filter(
      ({ name }) => name !== "ugv_path_follow_mission",
    );
    const blockedFixture = await createFixture(
      false,
      new MemoryProviderStore(),
      {},
      new ContractFixtureUgvDevice(missingPathContracts),
    );
    const blockedQualification = blockedFixture.runtime.operationQualification(
      "vehicle_navigate",
      argumentsValue,
    );
    expect(blockedQualification.qualified).toBe(false);
    expect(blockedQualification.reasonCodes).toContain("UGV_TOOL_MISSING");
    expect(blockedFixture.runtime.availability("vehicle_navigate", argumentsValue)).toMatchObject({
      availability: "UNKNOWN",
      reasonCode: "UGV_TOOL_MISSING",
      description: "UGV_TOOL_MISSING:ugv_path_follow_mission",
    });
    const blockedCapabilities = await blockedFixture.runtime.start(
      startInput("qualification-capabilities-missing", "vehicle_get_capabilities", {
        resourceId: "vehicle:ugv1",
      }),
    );
    expect(protoStructToJson(blockedCapabilities.initialSnapshot.result).navigation).toMatchObject({
      point: false,
    });
    const blockedManifest = ugvManifest(
      "isr.vehicle.ugv.ugv1",
      "1.0.0",
      blockedFixture.store,
      "vehicle:ugv1",
      blockedFixture.runtime.qualificationContext(),
    );
    expect(JSON.stringify(blockedManifest)).not.toContain("planningMode");
    const blockedNavigation = (
      blockedManifest.operations as { name: string; inputSchema: unknown }[]
    ).find(({ name }) => name === "vehicle_navigate");
    const blockedNavigationSchema = protoStructToJson(required(blockedNavigation).inputSchema);
    const navigationProperties = required(blockedNavigationSchema.properties) as Record<
      string,
      Record<string, unknown>
    >;
    const missionVariants = navigationProperties.mission?.oneOf as {
      properties: { type: { const: string } };
    }[];
    expect(missionVariants.map((variant) => variant.properties.type.const)).toEqual([
      "distance",
      "return_home",
    ]);
  });

  it("confirms navigate progress, pause/resume, completion and durable event replay", async () => {
    const fixture = await createFixture();
    const started = await fixture.runtime.start(
      startInput("nav-1", "vehicle_navigate", navigateArgs()),
    );
    expect(fixture.device.calls).toMatchObject([
      {
        name: "ugv_path_follow_mission",
        arguments: { mission_id: 0 },
      },
      {
        name: "ugv_mission_control",
        arguments: { action: "start", mission_id: 1 },
      },
    ]);
    expect(started.initialSnapshot).toMatchObject({ state: "ACCEPTED" });
    const journal = await fixture.store.listMutationJournal("nav-1");
    expect(journal).toEqual([
      expect.objectContaining({
        stepId: "start:01:primary",
        phase: "PRIMARY",
        toolName: "ugv_path_follow_mission",
        state: "ACCEPTED",
        externalMissionId: "1",
      }),
      expect.objectContaining({
        stepId: "start:02:followup",
        phase: "FOLLOWUP",
        toolName: "ugv_mission_control",
        state: "ACCEPTED",
        externalMissionId: "1",
      }),
    ]);
    for (const entry of journal) {
      expect(entry.argumentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.resultHash).toMatch(/^[a-f0-9]{64}$/);
    }

    mission(fixture.ingress, 1, 25);
    let execution = await fixture.runtime.get("nav-1");
    expect(execution).toMatchObject({ state: "RUNNING", progress: 25 });

    const identity = identityOf(required(execution), "1");
    expect(await fixture.runtime.command("pause", identity)).toMatchObject({ accepted: true });
    mission(fixture.ingress, 2, 30);
    execution = await fixture.runtime.get("nav-1");
    expect(execution?.state).toBe("PAUSED");

    expect(
      await fixture.runtime.command("pause", identity),
      "same command sequence must replay the exact persisted ack",
    ).toEqual(await fixture.runtime.command("pause", identity));
    expect(
      await fixture.runtime.command("resume", identityOf(required(execution), "2")),
    ).toMatchObject({ accepted: true });
    expect((await fixture.runtime.get("nav-1"))?.state).toBe("RESUMING");
    mission(fixture.ingress, 1, 60);
    expect((await fixture.runtime.get("nav-1"))?.state).toBe("RUNNING");
    mission(fixture.ingress, 4, 100);
    execution = await fixture.runtime.get("nav-1");
    expect(execution).toMatchObject({ state: "SUCCEEDED", progress: 100 });
    expect(execution?.result).toMatchObject({ resourceId: "vehicle:ugv1", status: "completed" });

    const source = required(fixture.store.businessEventSources()[0]);
    const replay = await fixture.store.replayBusinessEvents(
      source.sourceId,
      source.sourceStreamId,
      0n,
    );
    expect(replay.map((event) => event.eventType)).toContain("vehicle.mission.started");
    expect(replay.map((event) => event.eventType)).toContain("vehicle.mission.completed");
    expect(telemetryMetricNames(fixture.telemetry)).toEqual(
      expect.arrayContaining([
        "device_mcp_call_total",
        "device_mcp_call_latency_ms",
        "provider_task_start_latency_ms",
        "provider_task_terminal_latency_ms",
        "pause_confirmation_latency_ms",
        "snapshot_freshness_seconds",
        "navigation_terminal_results",
      ]),
    );
  });

  it("does not confirm pause from ACK or paused mission without a new stopped-speed fact", async () => {
    const fixture = await createFixture();
    await fixture.runtime.start(startInput("pause-proof", "vehicle_navigate", navigateArgs()));
    missionRaw(fixture.ingress, 1, 10);
    const running = required(await fixture.runtime.get("pause-proof"));
    await fixture.runtime.command("pause", identityOf(running, "1"));
    expect((await fixture.runtime.get("pause-proof"))?.state).not.toBe("PAUSED");

    missionRaw(fixture.ingress, 2, 20);
    expect(await fixture.runtime.get("pause-proof")).toMatchObject({
      state: "RUNNING",
      reasonCode: "UGV_PAUSE_PHYSICAL_CONFIRMATION_PENDING",
    });
    fixture.ingress.handle("/ugv/speed", Buffer.from('{"entity_id":"ugv1","speed_kmh":1}'));
    expect((await fixture.runtime.get("pause-proof"))?.state).not.toBe("PAUSED");
    fixture.ingress.handle("/ugv/speed", Buffer.from('{"entity_id":"ugv1","speed_kmh":0}'));
    expect((await fixture.runtime.get("pause-proof"))?.state).toBe("PAUSED");
  });

  it("bounds high-rate resource telemetry while preserving lifecycle events", async () => {
    let now = Date.now() + 1_000;
    const fixture = await createFixture(false, new MemoryProviderStore(), {
      now: () => new Date(now),
    });
    fixture.telemetry.records.splice(0);
    now += 10_000;

    for (let index = 0; index < 72; index++) {
      const result = fixture.ingress.handle(
        "/ugv/gnss",
        Buffer.from(
          JSON.stringify({
            entity_id: "ugv1",
            latitude: 30.1 + index / 100_000,
            longitude: 114.1,
            altitude: 10,
          }),
        ),
        false,
        new Date(now + index).toISOString(),
      );
      if (index === 0) {
        expect(result).toMatchObject({ duplicate: false, olderObservation: false });
        await settleSnapshotObservers();
      }
    }
    await settleSnapshotObservers();

    const resourceStates = () =>
      fixture.telemetry.records.filter((record) => record.eventType === "RESOURCE_STATE");
    const freshnessMetrics = () =>
      fixture.telemetry.records.filter(
        (record) => record.payload.metricName === "snapshot_freshness_seconds",
      );
    expect(resourceStates()).toHaveLength(1);
    expect(freshnessMetrics().length).toBeGreaterThan(0);
    expect(freshnessMetrics().length).toBeLessThanOrEqual(5);

    now += 1_000;
    fixture.ingress.handle(
      "/ugv/gnss",
      Buffer.from('{"entity_id":"ugv1","latitude":30.2,"longitude":114.1,"altitude":10}'),
      false,
      new Date(now).toISOString(),
    );
    await settleSnapshotObservers();
    expect(resourceStates()).toHaveLength(2);
    const freshnessBefore = freshnessMetrics().length;

    now += 9_000;
    fixture.ingress.handle(
      "/ugv/gnss",
      Buffer.from('{"entity_id":"ugv1","latitude":30.3,"longitude":114.1,"altitude":10}'),
      false,
      new Date(now).toISOString(),
    );
    await settleSnapshotObservers();
    expect(freshnessMetrics().length).toBeGreaterThan(freshnessBefore);
    expect(freshnessMetrics().length - freshnessBefore).toBeLessThanOrEqual(5);
  });

  it("reconciles conflicting primary and secondary task states without terminal success", async () => {
    const fixture = await createFixture();
    await fixture.runtime.start(
      startInput("nav-source-conflict", "vehicle_navigate", navigateArgs()),
    );
    missionRaw(fixture.ingress, 1, 10);
    expect((await fixture.runtime.get("nav-source-conflict"))?.state).toBe("RUNNING");

    status(fixture.ingress, { chassis: { state: 4, progress: 100 } });
    expect(await fixture.runtime.get("nav-source-conflict")).toMatchObject({
      state: "RUNNING",
      reasonCode: "UGV_TASK_STATE_CONFLICT",
    });
    expect(fixture.ingress.snapshot().chassis.mission).toMatchObject({ id: "1", state: 1 });

    status(fixture.ingress, { chassis: { state: 1, progress: 10 } });
    expect(fixture.ingress.stateConflict()).toBe(false);
    expect(await fixture.runtime.get("nav-source-conflict")).toMatchObject({
      state: "RUNNING",
      reasonCode: "UGV_DEVICE_TASK_RUNNING",
    });
  });

  it("requires distinct continuously stationary samples and resets on movement or staleness", async () => {
    let now = Date.now();
    const fixture = await createFixture(false, new MemoryProviderStore(), {
      now: () => new Date(now),
      stationaryStabilityMs: 1_000,
      stationaryMinimumSamples: 2,
    });
    now = Date.now() + 100;
    await fixture.runtime.start(
      startInput("pause-stability-window", "vehicle_navigate", navigateArgs()),
    );
    now += 10;
    fixture.ingress.handle(
      "/ugv/mission_state",
      Buffer.from('{"entity_id":"ugv1","id":1,"state":1,"progress":10}'),
      false,
      new Date(now).toISOString(),
    );
    const running = required(await fixture.runtime.get("pause-stability-window"));
    await fixture.runtime.command("pause", identityOf(running, "1"));
    now += 10;
    fixture.ingress.handle(
      "/ugv/mission_state",
      Buffer.from('{"entity_id":"ugv1","id":1,"state":2,"progress":20}'),
      false,
      new Date(now).toISOString(),
    );

    now += 10;
    fixture.ingress.handle(
      "/ugv/speed",
      Buffer.from('{"entity_id":"ugv1","speed_kmh":0}'),
      false,
      new Date(now).toISOString(),
    );
    let pending = required(await fixture.runtime.get("pause-stability-window"));
    expect(pending).toMatchObject({
      state: "RUNNING",
      reasonCode: "UGV_PAUSE_PHYSICAL_CONFIRMATION_PENDING",
      stationaryCandidateSince: new Date(now).toISOString(),
      consecutiveStationaryObservations: 1,
    });
    expect(
      (await fixture.runtime.get("pause-stability-window"))?.consecutiveStationaryObservations,
    ).toBe(1);

    now += 3_001;
    pending = required(await fixture.runtime.get("pause-stability-window"));
    expect(pending.consecutiveStationaryObservations).toBe(0);
    expect(pending.stationaryCandidateSince).toBeUndefined();

    now += 500;
    fixture.ingress.handle(
      "/ugv/speed",
      Buffer.from('{"entity_id":"ugv1","speed_kmh":1}'),
      false,
      new Date(now).toISOString(),
    );
    pending = required(await fixture.runtime.get("pause-stability-window"));
    expect(pending.consecutiveStationaryObservations).toBe(0);
    expect(pending.stationaryCandidateSince).toBeUndefined();
    expect(pending.lastNonStationaryObservedAt).toBe(new Date(now).toISOString());

    now += 10;
    fixture.ingress.handle(
      "/ugv/speed",
      Buffer.from('{"entity_id":"ugv1","speed_kmh":0}'),
      false,
      new Date(now).toISOString(),
    );
    const candidateSince = new Date(now).toISOString();
    expect(await fixture.runtime.get("pause-stability-window")).toMatchObject({
      state: "RUNNING",
      stationaryCandidateSince: candidateSince,
      consecutiveStationaryObservations: 1,
    });
    now += 500;
    fixture.ingress.handle(
      "/ugv/speed",
      Buffer.from('{"entity_id":"ugv1","speed_kmh":0}'),
      false,
      new Date(now).toISOString(),
    );
    expect(await fixture.runtime.get("pause-stability-window")).toMatchObject({
      state: "RUNNING",
      stationaryCandidateSince: candidateSince,
      consecutiveStationaryObservations: 2,
    });

    now += 600;
    fixture.ingress.handle(
      "/ugv/speed",
      Buffer.from('{"entity_id":"ugv1","speed_kmh":0}'),
      false,
      new Date(now).toISOString(),
    );
    expect(await fixture.runtime.get("pause-stability-window")).toMatchObject({
      state: "PAUSED",
      stationaryCandidateSince: candidateSince,
      consecutiveStationaryObservations: 3,
    });
  });

  it("applies bounded future clock skew to stationary stability observations", async () => {
    let now = Date.now();
    const fixture = await createFixture(false, new MemoryProviderStore(), {
      now: () => new Date(now),
      freshness: {
        ...runtimeOptions().freshness,
        maximumFutureSkewMs: 1_000,
      },
      stationaryStabilityMs: 0,
      stationaryMinimumSamples: 2,
    });
    await fixture.runtime.start(
      startInput("pause-future-skew", "vehicle_navigate", navigateArgs()),
    );
    missionRaw(fixture.ingress, 1, 10, new Date(now).toISOString());
    const running = required(await fixture.runtime.get("pause-future-skew"));
    await fixture.runtime.command("pause", identityOf(running, "1"));
    missionRaw(fixture.ingress, 2, 20, new Date(now).toISOString());

    fixture.ingress.handle(
      "/ugv/speed",
      Buffer.from('{"entity_id":"ugv1","speed_kmh":0}'),
      false,
      new Date(now + 500).toISOString(),
    );
    expect(await fixture.runtime.get("pause-future-skew")).toMatchObject({
      state: "RUNNING",
      consecutiveStationaryObservations: 1,
    });

    now += 100;
    fixture.ingress.handle(
      "/ugv/speed",
      Buffer.from('{"entity_id":"ugv1","speed_kmh":0}'),
      false,
      new Date(now + 500).toISOString(),
    );
    expect(await fixture.runtime.get("pause-future-skew")).toMatchObject({
      state: "PAUSED",
      consecutiveStationaryObservations: 2,
    });

    const rejected = await createFixture(false, new MemoryProviderStore(), {
      now: () => new Date(now),
      freshness: {
        ...runtimeOptions().freshness,
        maximumFutureSkewMs: 1_000,
      },
      stationaryStabilityMs: 0,
      stationaryMinimumSamples: 1,
    });
    await rejected.runtime.start(
      startInput("pause-excessive-future-skew", "vehicle_navigate", navigateArgs()),
    );
    missionRaw(rejected.ingress, 1, 10, new Date(now).toISOString());
    const rejectedRunning = required(await rejected.runtime.get("pause-excessive-future-skew"));
    await rejected.runtime.command("pause", identityOf(rejectedRunning, "1"));
    missionRaw(rejected.ingress, 2, 20, new Date(now).toISOString());
    rejected.ingress.handle(
      "/ugv/speed",
      Buffer.from('{"entity_id":"ugv1","speed_kmh":0}'),
      false,
      new Date(now + 1_001).toISOString(),
    );
    expect(await rejected.runtime.get("pause-excessive-future-skew")).toMatchObject({
      state: "RUNNING",
      consecutiveStationaryObservations: 0,
    });
  });

  it("fails a terminal mission closed when physical confirmation times out", async () => {
    const fixture = await createFixture(false, new MemoryProviderStore(), {
      physicalConfirmationTimeoutMs: 0,
    });
    await fixture.runtime.start(startInput("nav-timeout", "vehicle_navigate", navigateArgs()));
    missionRaw(fixture.ingress, 1, 10);
    expect((await fixture.runtime.get("nav-timeout"))?.state).toBe("RUNNING");
    missionRaw(fixture.ingress, 4, 100);
    expect(await fixture.runtime.get("nav-timeout")).toMatchObject({
      state: "TECHNICAL_FAILED",
      reasonCode: "UGV_PHYSICAL_CONFIRMATION_TIMEOUT",
      result: { status: "timeout" },
    });
  });

  it("does not accept a terminal navigation observation before an active observation", async () => {
    const fixture = await createFixture();
    await fixture.runtime.start(
      startInput("nav-terminal-first", "vehicle_navigate", navigateArgs()),
    );
    missionRaw(fixture.ingress, 4, 100);
    expect(await fixture.runtime.get("nav-terminal-first")).toMatchObject({
      state: "STARTING",
      reasonCode: "UGV_TASK_TERMINAL_UNCONFIRMED",
    });
  });

  it("accepts immediate completion only with correlated post-dispatch physical proof", async () => {
    let now = Date.now();
    const fixture = await createFixture(false, new MemoryProviderStore(), {
      now: () => new Date(now),
      stationaryStabilityMs: 0,
      stationaryMinimumSamples: 2,
    });
    await fixture.runtime.start(
      startInput("nav-immediate-completion", "vehicle_navigate", navigateArgs()),
    );
    now += 10;
    missionWithId(fixture.ingress, 1, 4, 100, new Date(now).toISOString());
    fixture.ingress.handle(
      "/ugv/gnss",
      Buffer.from('{"entity_id":"ugv1","latitude":30.1001,"longitude":114.1001,"altitude":10}'),
      false,
      new Date(now).toISOString(),
    );
    fixture.ingress.handle(
      "/ugv/speed",
      Buffer.from('{"entity_id":"ugv1","speed_kmh":0}'),
      false,
      new Date(now).toISOString(),
    );
    expect(await fixture.runtime.get("nav-immediate-completion")).toMatchObject({
      state: "STARTING",
      reasonCode: "UGV_TASK_TERMINAL_UNCONFIRMED",
      consecutiveStationaryObservations: 1,
    });

    now += 10;
    fixture.ingress.handle(
      "/ugv/speed",
      Buffer.from('{"entity_id":"ugv1","speed_kmh":0}'),
      false,
      new Date(now).toISOString(),
    );
    expect(await fixture.runtime.get("nav-immediate-completion")).toMatchObject({
      state: "SUCCEEDED",
      reasonCode: "UGV_DEVICE_TASK_COMPLETED",
      consecutiveStationaryObservations: 2,
      result: {
        status: "completed",
        missionId: "1",
        stationaryAtCompletion: true,
        correlationStrength: "STRICT_CORRELATED",
        observationAuthority: "post_dispatch",
      },
    });
  });

  it("persists an uncertain pause ACK and never replays the ambiguous mutation", async () => {
    const fixture = await createFixture();
    await fixture.runtime.start(startInput("pause-uncertain", "vehicle_navigate", navigateArgs()));
    missionRaw(fixture.ingress, 1, 10);
    const running = required(await fixture.runtime.get("pause-uncertain"));
    const before = fixture.device.calls.length;
    fixture.device.handlers.set("ugv_mission_control", () => {
      throw new UncertainMutatingDeviceCallError("UGV", "ugv_mission_control");
    });
    const identity = identityOf(running, "1");
    const first = await fixture.runtime.command("pause", identity);
    expect(first).toMatchObject({
      accepted: false,
      reasonCode: "UGV_DEVICE_MUTATING_CALL_UNCERTAIN",
    });
    expect(await fixture.runtime.get("pause-uncertain")).toMatchObject({
      state: "RUNNING",
      reasonCode: "UNCERTAIN_EXECUTION_STATE",
    });
    expect(fixture.device.calls).toHaveLength(before + 1);
    await expect(fixture.runtime.command("pause", identity)).resolves.toEqual(first);
    expect(fixture.device.calls).toHaveLength(before + 1);
  });

  it("replays one task identity without another device call and rejects identity drift", async () => {
    const fixture = await createFixture();
    const input = startInput("nav-idempotent", "vehicle_navigate", navigateArgs());
    const first = await fixture.runtime.start(input);
    const callCount = fixture.device.calls.length;
    await expect(fixture.runtime.start(structuredClone(input))).resolves.toEqual(first);
    expect(fixture.device.calls).toHaveLength(callCount);

    await expect(
      fixture.runtime.start({ ...structuredClone(input), argumentHash: "c".repeat(64) }),
    ).rejects.toThrow("TASK_IDENTITY_CONFLICT");
    await expect(
      fixture.runtime.start({
        ...structuredClone(input),
        executionContext: {
          ...input.executionContext,
          authorizationContextHash: "d".repeat(64),
        },
      }),
    ).rejects.toThrow("TASK_IDENTITY_CONFLICT");
    expect(fixture.device.calls).toHaveLength(callCount);
  });

  it("waits for device cancellation confirmation instead of treating command ack as terminal", async () => {
    const fixture = await createFixture();
    await fixture.runtime.start(startInput("nav-cancel", "vehicle_navigate", navigateArgs()));
    mission(fixture.ingress, 1, 10);
    const running = await fixture.runtime.get("nav-cancel");
    const ack = await fixture.runtime.command("cancel", identityOf(required(running), "1"));
    expect(ack).toMatchObject({ accepted: true });
    expect((await fixture.runtime.get("nav-cancel"))?.state).toBe("STOPPING");
    missionRaw(fixture.ingress, 3, 10);
    expect((await fixture.runtime.get("nav-cancel"))?.state).toBe("STOPPING");
    fixture.ingress.handle("/ugv/speed", Buffer.from('{"entity_id":"ugv1","speed_kmh":0}'));
    expect((await fixture.runtime.get("nav-cancel"))?.state).toBe("CANCELLED");
  });

  it("requires matching mission identity and a stable stop before cancellation", async () => {
    let now = Date.now();
    const fixture = await createFixture(false, new MemoryProviderStore(), {
      now: () => new Date(now),
      stationaryStabilityMs: 100,
      stationaryMinimumSamples: 2,
    });
    now = Date.now() + 100;
    await fixture.runtime.start(
      startInput("nav-cancel-stable", "vehicle_navigate", navigateArgs()),
    );
    missionWithId(fixture.ingress, 2, 1, 10, new Date(now).toISOString());
    expect(await fixture.runtime.get("nav-cancel-stable")).toMatchObject({
      state: "STARTING",
      reasonCode: "UGV_DOWNSTREAM_MISSION_ID_MISMATCH",
    });

    now += 10;
    missionWithId(fixture.ingress, 1, 1, 10, new Date(now).toISOString());
    const running = required(await fixture.runtime.get("nav-cancel-stable"));
    expect(running.state).toBe("RUNNING");
    await fixture.runtime.command("cancel", identityOf(running, "1"));
    now += 10;
    missionWithId(fixture.ingress, 1, 3, 10, new Date(now).toISOString());
    now += 10;
    fixture.ingress.handle(
      "/ugv/speed",
      Buffer.from('{"entity_id":"ugv1","speed_kmh":0}'),
      false,
      new Date(now).toISOString(),
    );
    expect((await fixture.runtime.get("nav-cancel-stable"))?.state).toBe("STOPPING");
    now += 50;
    fixture.ingress.handle(
      "/ugv/speed",
      Buffer.from('{"entity_id":"ugv1","speed_kmh":0}'),
      false,
      new Date(now).toISOString(),
    );
    expect((await fixture.runtime.get("nav-cancel-stable"))?.state).toBe("STOPPING");
    now += 60;
    fixture.ingress.handle(
      "/ugv/speed",
      Buffer.from('{"entity_id":"ugv1","speed_kmh":0}'),
      false,
      new Date(now).toISOString(),
    );
    expect(await fixture.runtime.get("nav-cancel-stable")).toMatchObject({
      state: "CANCELLED",
      consecutiveStationaryObservations: 3,
    });
  });

  it("runs area recon and fails target tracking truthfully when lock is lost", async () => {
    const fixture = await createFixture(true);
    await fixture.runtime.start(startInput("recon-1", "vehicle_area_recon", reconArgs()));
    expect(await fixture.store.listMutationJournal("recon-1")).toEqual([
      expect.objectContaining({
        stepId: "start:01:primary",
        phase: "PRIMARY",
        toolName: "ugv_area_recon_configure",
        state: "ACCEPTED",
        externalMissionId: "1",
      }),
      expect.objectContaining({
        stepId: "start:02:followup",
        phase: "FOLLOWUP",
        toolName: "ugv_area_recon_control",
        state: "ACCEPTED",
        externalMissionId: "1",
      }),
    ]);
    reconStatus(fixture.ingress, 5, 50);
    expect((await fixture.runtime.get("recon-1"))?.state).toBe("RUNNING");
    reconStatus(fixture.ingress, 11, 100);
    const completedRecon = await fixture.runtime.get("recon-1");
    expect(completedRecon?.state).toBe("SUCCEEDED");
    const manifest = new OperationRegistry().validate(
      ugvManifest(
        "isr.vehicle.ugv.ugv1",
        "1.0.0",
        fixture.store,
        "vehicle:ugv1",
        fixture.runtime.qualificationContext(),
      ) as unknown as ProviderManifest,
    );
    const reconOperation = required(
      manifest.operations.find((operation) => operation.name === "vehicle_area_recon"),
    );
    expect(() => reconOperation.validateOutput(required(completedRecon?.result))).not.toThrow();

    await fixture.runtime.start(
      startInput("track-1", "vehicle_track_target", {
        resourceId: "vehicle:ugv1",
        targetId: "101",
        maintainLock: true,
        timeoutMs: 5000,
        desiredZoom: 2,
      }),
    );
    reconStatus(fixture.ingress, 5, 50, "101");
    expect((await fixture.runtime.get("track-1"))?.state).toBe("RUNNING");
    reconStatus(fixture.ingress, 5, 50);
    expect(await fixture.runtime.get("track-1")).toMatchObject({
      state: "BUSINESS_FAILED",
      reasonCode: "UGV_TARGET_LOST",
    });
  });

  it("does not terminalize weak or mismatched Recon observations", async () => {
    const fixture = await createFixture();
    await fixture.runtime.start(startInput("recon-correlation", "vehicle_area_recon", reconArgs()));
    reconStatus(fixture.ingress, 5, 50, undefined, null);
    expect((await fixture.runtime.get("recon-correlation"))?.state).toBe("RUNNING");
    reconStatus(fixture.ingress, 11, 100, undefined, null);
    expect(await fixture.runtime.get("recon-correlation")).toMatchObject({
      state: "RUNNING",
      reasonCode: "UGV_RECON_WEAK_CORRELATION",
    });

    reconStatus(fixture.ingress, 11, 100, undefined, "2");
    expect(await fixture.runtime.get("recon-correlation")).toMatchObject({
      state: "RUNNING",
      reasonCode: "UGV_DOWNSTREAM_MISSION_ID_MISMATCH",
    });

    reconStatus(fixture.ingress, 11, 100, undefined, "1");
    expect(await fixture.runtime.get("recon-correlation")).toMatchObject({
      state: "SUCCEEDED",
      result: { correlationStrength: "STRICT_CORRELATED", missionId: "1" },
    });
  });

  it("does not complete a new recon task from a terminal observation captured before dispatch", async () => {
    const fixture = await createFixture();
    reconStatus(fixture.ingress, 11, 100);
    await fixture.runtime.start(startInput("recon-stale", "vehicle_area_recon", reconArgs()));
    expect(await fixture.runtime.get("recon-stale")).toMatchObject({ state: "STARTING" });

    reconStatus(fixture.ingress, 11, 100);
    expect(await fixture.runtime.get("recon-stale")).toMatchObject({
      state: "STARTING",
      reasonCode: "UGV_RECON_TERMINAL_UNCONFIRMED",
    });

    reconStatus(fixture.ingress, 5, 50);
    expect(await fixture.runtime.get("recon-stale")).toMatchObject({ state: "RUNNING" });
    reconStatus(fixture.ingress, 11, 100);
    expect(await fixture.runtime.get("recon-stale")).toMatchObject({ state: "SUCCEEDED" });
  });

  it("treats a legacy safe cursor as opaque and uses explicit Recon authority time", async () => {
    const fixture = await createFixture();
    await fixture.runtime.start(
      startInput("recon-legacy-cursor", "vehicle_area_recon", reconArgs()),
    );
    const persisted = required(await fixture.store.getExecution("recon-legacy-cursor"));
    persisted.observationCursors = { reconnaissance: "source:41" };
    await fixture.store.putExecution(persisted);

    reconStatus(fixture.ingress, 5, 50, undefined, "1");
    await expect(fixture.runtime.get("recon-legacy-cursor")).resolves.toMatchObject({
      state: "RUNNING",
    });
    reconStatus(fixture.ingress, 11, 100, undefined, "1");
    const completed = required(await fixture.runtime.get("recon-legacy-cursor"));
    expect(completed.state).toBe("SUCCEEDED");
    expect(typeof completed.result?.observedAt).toBe("string");
    expect(String(completed.result?.observedAt)).toMatch(/^\d{4}-/);
  });

  it("requires fire confirmation and strips destroyed/damage from every persisted output", async () => {
    const fixture = await createFixture(true);
    fixture.device.responses.set("ugv_area_recon_attack_confirm", {
      mission_id: 1,
      state: 1,
      state_label: "running",
      message: "fire cycle accepted",
      error_code: 0,
      cmd_res: 0,
      fail_data: "",
      destroyed: true,
      damage: 100,
      remaining_hp: 0,
      nested: { hit: true },
    });
    fixture.ingress.applyDeviceObservation(
      {
        payload: {
          online: true,
          lockedTargetId: "101",
          attackReady: true,
          weapon: { state: 0, progress: 0 },
        },
      },
      ["payload"],
    );
    const started = await fixture.runtime.start(
      startInput("fire-1", "vehicle_fire_weapon", {
        resourceId: "vehicle:ugv1",
        targetId: "101",
        engagementMode: "single",
        requireConfirmation: true,
      }),
    );
    expect(started.initialSnapshot).toMatchObject({ state: "WAITING_INPUT" });
    expect(fixture.device.calls).toEqual([]);

    const waiting = await fixture.runtime.get("fire-1");
    const ack = await fixture.runtime.updateFire(identityOf(required(waiting), "1"), [
      {
        key: "fire_confirmation",
        result: jsonToProtoStruct({ action: "accept", content: { confirmed: true } }),
      },
    ]);
    expect(ack).toMatchObject({ accepted: true, reasonCode: "UGV_FIRE_CONFIRMATION_ACCEPTED" });
    expect((await fixture.runtime.get("fire-1"))?.downstreamMissionIds).toEqual(["1"]);
    expect(fixture.device.calls.at(-1)).toMatchObject({
      name: "ugv_area_recon_attack_confirm",
      arguments: { confirm: 1, mission_id: 0 },
    });
    const callsBeforeCancel = fixture.device.calls.length;
    await expect(
      fixture.runtime.command(
        "cancel",
        identityOf(required(await fixture.runtime.get("fire-1")), "2"),
      ),
    ).resolves.toMatchObject({
      accepted: false,
      reasonCode: "UGV_FIRE_CANCEL_UNSUPPORTED_AFTER_DISPATCH",
    });
    expect(fixture.device.calls).toHaveLength(callsBeforeCancel);
    status(fixture.ingress, { weapon: { id: 99, state: 4, progress: 100 } });
    expect((await fixture.runtime.get("fire-1"))?.state).toBe("STARTING");
    status(fixture.ingress, { weapon: { id: 1, state: 1, progress: 50 } });
    expect((await fixture.runtime.get("fire-1"))?.state).toBe("RUNNING");
    status(fixture.ingress, { weapon: { id: 1, state: 4, progress: 100 } });
    const completed = await fixture.runtime.get("fire-1");
    expect(completed).toMatchObject({
      state: "SUCCEEDED",
      result: { status: "fire_cycle_completed" },
    });
    const fireOperation = required(
      new OperationRegistry()
        .validate(
          ugvManifest(
            "isr.vehicle.ugv.ugv1",
            "1.0.0",
            fixture.store,
            "vehicle:ugv1",
            fixture.runtime.qualificationContext(),
          ) as unknown as ProviderManifest,
        )
        .operations.find((operation) => operation.name === "vehicle_fire_weapon"),
    );
    expect(() => fireOperation.validateOutput(required(completed?.result))).not.toThrow();
    const persisted = JSON.stringify({ completed, telemetry: fixture.telemetry.records });
    expect(persisted).not.toMatch(/destroyed|damage|remaining_hp|\bhit\b/);
    expect(
      fixture.telemetry.records.some(
        (event) =>
          event.eventType === "RESOURCE_METRIC" &&
          event.payload.metricName === "fire_verdict_fields_stripped_total" &&
          event.attributes.diagnostic === "fire_verdict_fields_stripped",
      ),
    ).toBe(true);
  });

  it("terminalizes declined or cancelled fire confirmation without dispatch and releases tracks", async () => {
    const fixture = await createFixture(true);
    makeFireReady(fixture.ingress);
    await fixture.runtime.start(startInput("fire-declined", "vehicle_fire_weapon", fireArgs()));
    const declined = required(await fixture.runtime.get("fire-declined"));
    await expect(
      fixture.runtime.updateFire(identityOf(declined, "1"), [
        {
          key: "fire_confirmation",
          result: jsonToProtoStruct({ action: "decline" }),
        },
      ]),
    ).resolves.toMatchObject({
      accepted: true,
      reasonCode: "UGV_FIRE_CONFIRMATION_REJECTED",
    });
    expect(await fixture.runtime.get("fire-declined")).toMatchObject({
      state: "CANCELLED",
      reasonCode: "UGV_FIRE_CONFIRMATION_REJECTED",
      result: { status: "cancelled" },
    });
    await expect(
      fixture.runtime.updateFire(
        identityOf(required(await fixture.runtime.get("fire-declined")), "2"),
        fireConfirmation(),
      ),
    ).resolves.toMatchObject({
      accepted: true,
      reasonCode: "UGV_FIRE_CONFIRMATION_REJECTED",
      commandSequence: "2",
    });
    expect(fixture.device.calls).toHaveLength(0);

    await fixture.runtime.start(startInput("fire-cancelled", "vehicle_fire_weapon", fireArgs()));
    const waiting = required(await fixture.runtime.get("fire-cancelled"));
    await expect(
      fixture.runtime.command("cancel", identityOf(waiting, "1")),
    ).resolves.toMatchObject({
      accepted: true,
      reasonCode: "UGV_FIRE_CANCELLED_BEFORE_DISPATCH",
    });
    expect(await fixture.runtime.get("fire-cancelled")).toMatchObject({
      state: "CANCELLED",
      reasonCode: "UGV_FIRE_CANCELLED_BEFORE_DISPATCH",
      result: { status: "cancelled" },
    });
    expect(fixture.device.calls).toHaveLength(0);

    await expect(
      fixture.runtime.start(startInput("fire-after-cancel", "vehicle_fire_weapon", fireArgs())),
    ).resolves.toMatchObject({ initialSnapshot: { state: "WAITING_INPUT" } });
  });

  it("recovers a durable fire rejection fence after terminal persistence fails", async () => {
    const store = new FailNthExecutionWriteStore();
    const fixture = await createFixture(true, store);
    makeFireReady(fixture.ingress);
    await fixture.runtime.start(
      startInput("fire-reject-recovery", "vehicle_fire_weapon", fireArgs()),
    );
    const waiting = required(await fixture.runtime.get("fire-reject-recovery"));
    store.failOnNthNextWrite(1);

    await expect(
      fixture.runtime.updateFire(identityOf(waiting, "1"), [
        {
          key: "fire_confirmation",
          result: jsonToProtoStruct({ action: "decline" }),
        },
      ]),
    ).resolves.toMatchObject({ accepted: true, reasonCode: "UNCERTAIN_EXECUTION_STATE" });
    await fixture.runtime.recover();
    expect(await fixture.runtime.get("fire-reject-recovery")).toMatchObject({
      state: "CANCELLED",
      reasonCode: "UGV_FIRE_CONFIRMATION_REJECTED",
    });
    expect(fixture.device.calls).toHaveLength(0);

    await expect(
      fixture.runtime.start(
        startInput("fire-after-reject-recovery", "vehicle_fire_weapon", fireArgs()),
      ),
    ).resolves.toMatchObject({ initialSnapshot: { state: "WAITING_INPUT" } });
  });

  it("claims fire dispatch once across concurrent replicas and command sequences", async () => {
    const fixture = await createFixture(true);
    makeFireReady(fixture.ingress);
    let releaseDevice!: () => void;
    let observedDispatch!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      observedDispatch = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseDevice = resolve;
    });
    fixture.device.handlers.set("ugv_area_recon_attack_confirm", async () => {
      observedDispatch();
      await release;
      return fireAcceptedResult();
    });
    await fixture.runtime.start(startInput("fire-concurrent", "vehicle_fire_weapon", fireArgs()));
    const waiting = required(await fixture.runtime.get("fire-concurrent"));
    const replica = new UgvProviderRuntime(
      runtimeOptions(),
      fixture.store,
      fixture.ingress,
      fixture.device,
      fixture.events,
      fixture.telemetry,
    );

    const first = fixture.runtime.updateFire(identityOf(waiting, "1"), fireConfirmation());
    await dispatched;
    await expect(
      replica.updateFire(identityOf(waiting, "2"), fireConfirmation()),
    ).resolves.toMatchObject({ accepted: true, reasonCode: "UNCERTAIN_EXECUTION_STATE" });
    releaseDevice();
    await expect(first).resolves.toMatchObject({
      accepted: true,
      reasonCode: "UGV_FIRE_CONFIRMATION_ACCEPTED",
    });
    await expect(
      replica.updateFire(identityOf(waiting, "3"), fireConfirmation()),
    ).resolves.toMatchObject({ accepted: true, reasonCode: "UGV_FIRE_CONFIRMATION_ACCEPTED" });
    expect(
      fixture.device.calls.filter((call) => call.name === "ugv_area_recon_attack_confirm"),
    ).toHaveLength(1);
  });

  it("lets a pre-arm cancellation win across replicas without a physical fire call", async () => {
    const store = new PauseFireIntentWriteStore();
    const fixture = await createFixture(true, store);
    makeFireReady(fixture.ingress);
    fixture.device.responses.set("ugv_area_recon_attack_confirm", fireAcceptedResult());
    await fixture.runtime.start(startInput("fire-cancel-race", "vehicle_fire_weapon", fireArgs()));
    const waiting = required(await fixture.runtime.get("fire-cancel-race"));
    const replica = new UgvProviderRuntime(
      runtimeOptions(),
      fixture.store,
      fixture.ingress,
      fixture.device,
      fixture.events,
      fixture.telemetry,
    );

    const accepting = fixture.runtime.updateFire(identityOf(waiting, "1"), fireConfirmation());
    await store.intentWritePaused;
    await expect(replica.command("cancel", identityOf(waiting, "2"))).resolves.toMatchObject({
      accepted: true,
      reasonCode: "UGV_FIRE_CANCELLED_BEFORE_DISPATCH",
    });
    store.releaseIntentWrite();
    await expect(accepting).resolves.toMatchObject({
      accepted: true,
      reasonCode: "UGV_FIRE_CANCELLED_BEFORE_DISPATCH",
    });
    expect(await fixture.runtime.get("fire-cancel-race")).toMatchObject({
      state: "CANCELLED",
      reasonCode: "UGV_FIRE_CANCELLED_BEFORE_DISPATCH",
    });
    expect(
      fixture.device.calls.filter((call) => call.name === "ugv_area_recon_attack_confirm"),
    ).toHaveLength(0);
    await expect(
      fixture.runtime.start(
        startInput("fire-after-cancel-race", "vehicle_fire_weapon", fireArgs()),
      ),
    ).resolves.toMatchObject({ initialSnapshot: { state: "WAITING_INPUT" } });
  });

  it("keeps a task-level fire claim uncertain after a post-dispatch persistence failure", async () => {
    const store = new FailNthExecutionWriteStore();
    const fixture = await createFixture(true, store);
    makeFireReady(fixture.ingress);
    fixture.device.responses.set("ugv_area_recon_attack_confirm", fireAcceptedResult());
    await fixture.runtime.start(
      startInput("fire-store-failure", "vehicle_fire_weapon", fireArgs()),
    );
    const waiting = required(await fixture.runtime.get("fire-store-failure"));
    store.failOnNthNextWrite(2);

    await expect(
      fixture.runtime.updateFire(identityOf(waiting, "1"), fireConfirmation()),
    ).resolves.toMatchObject({ accepted: true, reasonCode: "UNCERTAIN_EXECUTION_STATE" });
    await expect(
      fixture.runtime.updateFire(identityOf(waiting, "2"), fireConfirmation()),
    ).resolves.toMatchObject({ accepted: true, reasonCode: "UNCERTAIN_EXECUTION_STATE" });
    expect(
      fixture.device.calls.filter((call) => call.name === "ugv_area_recon_attack_confirm"),
    ).toHaveLength(1);
    expect(await fixture.runtime.get("fire-store-failure")).toMatchObject({
      state: "STARTING",
      reasonCode: "UNCERTAIN_EXECUTION_STATE",
      downstreamMissionIds: ["1"],
    });
  });

  it("acknowledges a structured device rejection and persists a schema-valid business failure", async () => {
    const fixture = await createFixture(true);
    makeFireReady(fixture.ingress);
    fixture.device.responses.set("ugv_area_recon_attack_confirm", {
      ...fireAcceptedResult(),
      error_code: 17,
      message: "device rejected fire command",
    });
    await fixture.runtime.start(
      startInput("fire-device-rejected", "vehicle_fire_weapon", fireArgs()),
    );
    const waiting = required(await fixture.runtime.get("fire-device-rejected"));

    await expect(
      fixture.runtime.updateFire(identityOf(waiting, "1"), fireConfirmation()),
    ).resolves.toMatchObject({ accepted: true, reasonCode: "UGV_DEVICE_TOOL_REJECTED" });
    const failed = required(await fixture.runtime.get("fire-device-rejected"));
    expect(failed).toMatchObject({
      state: "BUSINESS_FAILED",
      reasonCode: "UGV_DEVICE_TOOL_REJECTED",
      result: { status: "fire_command_rejected" },
    });
    const operation = required(
      new OperationRegistry()
        .validate(
          ugvManifest(
            "isr.vehicle.ugv.ugv1",
            "1.0.0",
            fixture.store,
            "vehicle:ugv1",
            fixture.runtime.qualificationContext(),
          ) as unknown as ProviderManifest,
        )
        .operations.find((candidate) => candidate.name === "vehicle_fire_weapon"),
    );
    expect(() => operation.validateOutput(required(failed.result))).not.toThrow();
    expect(
      fixture.device.calls.filter((call) => call.name === "ugv_area_recon_attack_confirm"),
    ).toHaveLength(1);
    await expect(
      fixture.runtime.start(
        startInput("fire-after-device-reject", "vehicle_fire_weapon", fireArgs()),
      ),
    ).resolves.toMatchObject({ initialSnapshot: { state: "WAITING_INPUT" } });
  });

  it("does not dispatch fire when the pre-dispatch intent cannot be persisted", async () => {
    const store = new FailNthExecutionWriteStore();
    const fixture = await createFixture(true, store);
    makeFireReady(fixture.ingress);
    await fixture.runtime.start(
      startInput("fire-intent-failure", "vehicle_fire_weapon", fireArgs()),
    );
    const waiting = required(await fixture.runtime.get("fire-intent-failure"));
    store.failOnNthNextWrite(1);

    await expect(
      fixture.runtime.updateFire(identityOf(waiting, "1"), fireConfirmation()),
    ).resolves.toMatchObject({ accepted: true, reasonCode: "UGV_FIRE_DISPATCH_ABORTED" });
    await expect(
      fixture.runtime.updateFire(identityOf(waiting, "2"), fireConfirmation()),
    ).resolves.toMatchObject({ accepted: true, reasonCode: "UGV_FIRE_DISPATCH_ABORTED" });
    expect(
      fixture.device.calls.filter((call) => call.name === "ugv_area_recon_attack_confirm"),
    ).toHaveLength(0);
    expect(await fixture.runtime.get("fire-intent-failure")).toMatchObject({
      state: "TECHNICAL_FAILED",
      reasonCode: "UGV_FIRE_DISPATCH_ABORTED",
      result: { status: "fire_command_rejected" },
    });
    await expect(
      fixture.runtime.start(
        startInput("fire-after-intent-failure", "vehicle_fire_weapon", fireArgs()),
      ),
    ).resolves.toMatchObject({ initialSnapshot: { state: "WAITING_INPUT" } });
  });

  it("recovers a crash between a persisted fire intent and arming the physical dispatch", async () => {
    const fixture = await createFixture(true);
    makeFireReady(fixture.ingress);
    await fixture.runtime.start(
      startInput("fire-unarmed-recovery", "vehicle_fire_weapon", fireArgs()),
    );
    const waiting = required(await fixture.runtime.get("fire-unarmed-recovery"));
    const prepared: ProviderExecution = {
      ...structuredClone(waiting),
      state: "STARTING",
      reasonCode: "UGV_FIRE_DISPATCH_PREPARED",
      revision: waiting.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    await fixture.store.putExecution(prepared);
    await fixture.store.claimCommandAck({
      taskId: waiting.taskId,
      command: "fire_dispatch",
      commandSequence: "0",
      response: {
        accepted: true,
        reasonCode: "UGV_FIRE_DISPATCH_NOT_ARMED",
        message: "UGV_FIRE_DISPATCH_NOT_ARMED",
        commandSequence: "0",
        identity: identityOf(waiting, "1"),
      },
      createdAt: new Date().toISOString(),
    });

    await fixture.runtime.recover();
    expect(await fixture.runtime.get("fire-unarmed-recovery")).toMatchObject({
      state: "TECHNICAL_FAILED",
      reasonCode: "UGV_FIRE_DISPATCH_ABORTED",
      result: { status: "fire_command_rejected" },
    });
    expect(fixture.device.calls).toHaveLength(0);
    await expect(
      fixture.runtime.start(
        startInput("fire-after-unarmed-recovery", "vehicle_fire_weapon", fireArgs()),
      ),
    ).resolves.toMatchObject({ initialSnapshot: { state: "WAITING_INPUT" } });
  });

  it("keeps an ambiguous fire without a mission ID uncertain despite unrelated weapon telemetry", async () => {
    const fixture = await createFixture(true);
    makeFireReady(fixture.ingress);
    fixture.device.handlers.set("ugv_area_recon_attack_confirm", () => {
      throw new Error("TEST_DEVICE_RESPONSE_LOST");
    });
    await fixture.runtime.start(startInput("fire-no-id", "vehicle_fire_weapon", fireArgs()));
    const waiting = required(await fixture.runtime.get("fire-no-id"));

    await expect(
      fixture.runtime.updateFire(identityOf(waiting, "1"), fireConfirmation()),
    ).resolves.toMatchObject({ accepted: true, reasonCode: "UNCERTAIN_EXECUTION_STATE" });
    expect(await fixture.runtime.get("fire-no-id")).toMatchObject({
      state: "STARTING",
      reasonCode: "UNCERTAIN_EXECUTION_STATE",
      downstreamMissionIds: [],
    });

    status(fixture.ingress, { weapon: { id: 999, state: 1, progress: 50 } });
    status(fixture.ingress, { weapon: { id: 999, state: 4, progress: 100 } });
    expect(await fixture.runtime.get("fire-no-id")).toMatchObject({
      state: "STARTING",
      reasonCode: "UNCERTAIN_EXECUTION_STATE",
      downstreamMissionIds: [],
    });
  });

  it("requires a post-dispatch gimbal lifecycle before terminal completion and preserves cancel IDs", async () => {
    const fixture = await createFixture();
    const manifest = new OperationRegistry().validate(
      ugvManifest(
        "isr.vehicle.ugv.ugv1",
        "1.0.0",
        fixture.store,
        "vehicle:ugv1",
        fixture.runtime.qualificationContext(),
      ) as unknown as ProviderManifest,
    );
    const operation = required(
      manifest.operations.find((candidate) => candidate.name === "vehicle_control_gimbal"),
    );
    status(fixture.ingress, { eo: { id: 1, state: 4, progress: 100 } });

    await fixture.runtime.start(
      startInput("gimbal-1", "vehicle_control_gimbal", {
        resourceId: "vehicle:ugv1",
        mode: "absolute",
        yaw: 10,
        pitch: -2,
      }),
    );
    expect((await fixture.runtime.get("gimbal-1"))?.downstreamMissionIds).toEqual(["1"]);
    status(fixture.ingress, { eo: { id: 1, state: 4, progress: 100 } });
    expect(await fixture.runtime.get("gimbal-1")).toMatchObject({
      state: "STARTING",
      reasonCode: "UGV_TASK_TERMINAL_UNCONFIRMED",
    });
    status(fixture.ingress, { eo: { id: 1, state: 1, progress: 50 } });
    expect((await fixture.runtime.get("gimbal-1"))?.state).toBe("RUNNING");
    status(fixture.ingress, { eo: { id: 1, state: 4, progress: 100 } });
    const completed = required(await fixture.runtime.get("gimbal-1"));
    expect(completed.state).toBe("SUCCEEDED");
    expect(() => operation.validateOutput(required(completed.result))).not.toThrow();

    await fixture.runtime.start(
      startInput("gimbal-cancel", "vehicle_control_gimbal", {
        resourceId: "vehicle:ugv1",
        mode: "reset",
      }),
    );
    status(fixture.ingress, { eo: { id: 1, state: 1, progress: 10 } });
    const running = required(await fixture.runtime.get("gimbal-cancel"));
    expect(running.state).toBe("RUNNING");
    expect(await fixture.runtime.command("cancel", identityOf(running, "1"))).toMatchObject({
      accepted: true,
    });
    expect(fixture.device.calls.at(-1)).toMatchObject({
      name: "ugv_gimbal_move",
      arguments: { mode: "velocity", mission_id: 1, yaw_speed: 0, pitch_speed: 0 },
    });
    status(fixture.ingress, { eo: { id: 1, state: 3, progress: 10 } });
    const cancelled = required(await fixture.runtime.get("gimbal-cancel"));
    expect(cancelled.state).toBe("CANCELLED");
    expect(() => operation.validateOutput(required(cancelled.result))).not.toThrow();
  });

  it("preempts active local chassis and EO tracks with an emergency stop", async () => {
    const fixture = await createFixture();
    await fixture.runtime.start(startInput("nav-active", "vehicle_navigate", navigateArgs()));
    await fixture.runtime.start(startInput("recon-active", "vehicle_area_recon", reconArgs()));
    missionRaw(fixture.ingress, 1, 10);
    reconStatus(fixture.ingress, 5, 10);
    const stopped = await fixture.runtime.start(
      startInput("stop-1", "vehicle_emergency_stop", { resourceId: "vehicle:ugv1" }),
    );
    expect(stopped.initialSnapshot).toMatchObject({ state: "ACCEPTED" });
    fixture.ingress.handle("/ugv/speed", Buffer.from('{"entity_id":"ugv1","speed_kmh":0}'));
    expect((await fixture.runtime.get("stop-1"))?.state).not.toBe("SUCCEEDED");
    missionRaw(fixture.ingress, 3, 10);
    expect((await fixture.runtime.get("stop-1"))?.state).not.toBe("SUCCEEDED");
    reconStatus(fixture.ingress, 11, 100);
    expect(await fixture.runtime.get("stop-1")).toMatchObject({
      state: "SUCCEEDED",
      result: { status: "stopped" },
    });
    expect(fixture.device.calls.slice(-4)).toMatchObject([
      { name: "ugv_motion_stop", arguments: {} },
      {
        name: "ugv_mission_control",
        arguments: { action: "terminate", mission_id: 1 },
      },
      {
        name: "ugv_area_recon_control",
        arguments: { cmd_type: 4, mission_id: 1 },
      },
      {
        name: "ugv_area_recon_lock",
        arguments: { lock: false, target_id: 0, mission_id: 1 },
      },
    ]);
  });

  it("persists preemption ownership across restart and cancels old tasks after confirmation", async () => {
    const fixture = await createFixture();
    await fixture.runtime.start(startInput("nav-preempted", "vehicle_navigate", navigateArgs()));
    await fixture.runtime.start(startInput("recon-preempted", "vehicle_area_recon", reconArgs()));
    missionRaw(fixture.ingress, 1, 10);
    reconStatus(fixture.ingress, 5, 10);
    await fixture.runtime.start(
      startInput("stop-owner", "vehicle_emergency_stop", { resourceId: "vehicle:ugv1" }),
    );

    expect(await fixture.store.getExecution("stop-owner")).toMatchObject({
      preemptedTaskIds: ["nav-preempted", "recon-preempted"],
    });
    for (const taskId of ["nav-preempted", "recon-preempted"]) {
      const preempted = required(await fixture.store.getExecution(taskId));
      expect(preempted).toMatchObject({
        state: "STOPPING",
        preemptedByTaskId: "stop-owner",
        preemptReason: "UGV_EMERGENCY_STOP",
      });
      expect(typeof preempted.preemptedAt).toBe("string");
    }

    await fixture.runtime.close();
    active.splice(active.indexOf(fixture.runtime), 1);
    const recovered = new UgvProviderRuntime(
      runtimeOptions(),
      fixture.store,
      fixture.ingress,
      fixture.device,
      fixture.events,
      fixture.telemetry,
    );
    active.push(recovered);
    await recovered.initialize();
    expect(recovered.availability("vehicle_navigate", navigateArgs())).toMatchObject({
      availability: "DISABLED",
      reasonCode: "UGV_CHASSIS_TRACK_BUSY",
    });

    fixture.ingress.handle("/ugv/speed", Buffer.from('{"entity_id":"ugv1","speed_kmh":0}'));
    missionRaw(fixture.ingress, 3, 10);
    reconStatus(fixture.ingress, 11, 100);
    expect(await recovered.get("stop-owner")).toMatchObject({
      state: "SUCCEEDED",
      reasonCode: "STOP_CONFIRMED",
    });
    for (const taskId of ["nav-preempted", "recon-preempted"])
      expect(await recovered.get(taskId)).toMatchObject({
        state: "CANCELLED",
        reasonCode: "UGV_PREEMPTED_BY_EMERGENCY_STOP",
      });
  });

  it("blocks conflicting admission for externally observed device work", async () => {
    const fixture = await createFixture();
    missionWithId(fixture.ingress, 77, 1, 20);

    expect(fixture.runtime.availability("vehicle_navigate", navigateArgs())).toMatchObject({
      availability: "DISABLED",
      reasonCode: "UGV_EXTERNAL_CHASSIS_TRACK_BUSY",
    });
    await expect(
      fixture.runtime.start(startInput("blocked-external", "vehicle_navigate", navigateArgs())),
    ).rejects.toThrow("UGV_EXTERNAL_CHASSIS_TRACK_BUSY");
    expect(fixture.runtime.availability("vehicle_emergency_stop", {})).toMatchObject({
      availability: "AVAILABLE",
    });

    missionWithId(fixture.ingress, 77, 3, 20);
    reconStatus(fixture.ingress, 5, 20, undefined, "88");
    expect(fixture.runtime.availability("vehicle_area_recon", reconArgs())).toMatchObject({
      availability: "DISABLED",
      reasonCode: "UGV_EXTERNAL_EO_TRACK_BUSY",
    });
    reconStatus(fixture.ingress, 11, 100, undefined, "88");
    expect(fixture.runtime.availability("vehicle_area_recon", reconArgs())).toMatchObject({
      availability: "AVAILABLE",
    });
  });

  it("dispatches primary emergency stop when every optional cleanup tool is missing", async () => {
    const device = new MockUgvDeviceMcpClient(new Set(["ugv_motion_stop"]));
    const fixture = await createFixture(false, new MemoryProviderStore(), {}, device);

    await expect(
      fixture.runtime.start(
        startInput("stop-primary-only", "vehicle_emergency_stop", {
          resourceId: "vehicle:ugv1",
        }),
      ),
    ).resolves.toMatchObject({
      initialSnapshot: { reasonCode: "STOP_DISPATCHED_CONFIRMATION_PENDING" },
    });
    expect(device.calls).toEqual([
      { name: "ugv_motion_stop", arguments: {}, taskId: "stop-primary-only" },
    ]);
    expect(await fixture.store.listMutationJournal("stop-primary-only")).toEqual([
      expect.objectContaining({ phase: "EMERGENCY_STOP", state: "ACCEPTED" }),
      expect.objectContaining({ phase: "CLEANUP", state: "REJECTED" }),
      expect.objectContaining({ phase: "CLEANUP", state: "REJECTED" }),
      expect.objectContaining({ phase: "CLEANUP", state: "REJECTED" }),
    ]);
  });

  it("dispatches emergency stop without MQTT but keeps physical confirmation pending", async () => {
    const fixture = await createFixture();
    fixture.ingress.setConnected(false);

    expect(fixture.runtime.availability("vehicle_emergency_stop", {})).toMatchObject({
      availability: "AVAILABLE",
      reasonCode: "UGV_AVAILABLE",
    });
    await fixture.runtime.start(
      startInput("stop-mqtt-offline", "vehicle_emergency_stop", {
        resourceId: "vehicle:ugv1",
      }),
    );
    expect(fixture.device.calls[0]).toMatchObject({ name: "ugv_motion_stop" });
    expect(await fixture.runtime.get("stop-mqtt-offline")).toMatchObject({
      state: "STARTING",
      reasonCode: "UGV_STOP_OBSERVATION_NOT_NEW",
    });
  });

  it("records primary emergency stop rejection as a dispatch failure", async () => {
    const device = new MockUgvDeviceMcpClient();
    device.handlers.set("ugv_motion_stop", () => acceptedMutationResult(0, 5));
    const fixture = await createFixture(false, new MemoryProviderStore(), {}, device);

    await expect(
      fixture.runtime.start(
        startInput("stop-primary-rejected", "vehicle_emergency_stop", {
          resourceId: "vehicle:ugv1",
        }),
      ),
    ).rejects.toBeInstanceOf(Error);
    expect(await fixture.runtime.get("stop-primary-rejected")).toMatchObject({
      state: "BUSINESS_FAILED",
      reasonCode: "STOP_DISPATCH_FAILED",
    });
    expect(device.calls).toHaveLength(1);
  });

  it("does not confirm emergency stop until a new stopped-speed fact exists", async () => {
    const fixture = await createFixture();
    await fixture.runtime.start(
      startInput("stop-proof", "vehicle_emergency_stop", { resourceId: "vehicle:ugv1" }),
    );
    missionRaw(fixture.ingress, 3, 0);
    expect((await fixture.runtime.get("stop-proof"))?.state).not.toBe("SUCCEEDED");
    fixture.ingress.handle("/ugv/speed", Buffer.from('{"entity_id":"ugv1","speed_kmh":0}'));
    expect(await fixture.runtime.get("stop-proof")).toMatchObject({
      state: "SUCCEEDED",
      reasonCode: "STOP_CONFIRMED",
    });
    expect(telemetryMetricNames(fixture.telemetry)).toContain(
      "emergency_stop_confirmation_latency_ms",
    );
  });

  it("emits persisted MQTT disconnect and restoration resource facts", async () => {
    const fixture = await createFixture();
    await fixture.runtime.pollActive();
    fixture.ingress.setConnected(false);
    await fixture.runtime.pollActive();
    fixture.ingress.setConnected(true);
    await fixture.runtime.pollActive();

    const source = required(
      fixture.store
        .businessEventSources()
        .find((candidate) => candidate.sourceId === "vehicle.health"),
    );
    const replay = await fixture.store.replayBusinessEvents(
      source.sourceId,
      source.sourceStreamId,
      0n,
    );
    expect(replay.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "vehicle.connectivity.mqtt_disconnected",
        "vehicle.connectivity.mqtt_restored",
      ]),
    );
  });

  it("reconciles after restart without dispatching a duplicate side effect", async () => {
    const fixture = await createFixture();
    await fixture.runtime.start(startInput("recover-1", "vehicle_navigate", navigateArgs()));
    mission(fixture.ingress, 1, 40);
    await fixture.runtime.get("recover-1");
    const callsBeforeRestart = fixture.device.calls.length;
    await fixture.runtime.close();
    active.splice(active.indexOf(fixture.runtime), 1);

    const recovered = new UgvProviderRuntime(
      runtimeOptions(),
      fixture.store,
      fixture.ingress,
      fixture.device,
      fixture.events,
      fixture.telemetry,
    );
    active.push(recovered);
    await recovered.initialize();
    expect(fixture.device.calls).toHaveLength(callsBeforeRestart);
    const recoveredExecution = await recovered.get("recover-1");
    expect(recoveredExecution).toBeDefined();
    const result = await recovered.reconcile({
      ...startInput("recover-1", "vehicle_navigate", navigateArgs()),
      externalExecutionId: required(recoveredExecution).externalExecutionId,
    });
    expect(result).toMatchObject({ status: "FOUND", reasonCode: "EXECUTION_FOUND" });
  });

  it("recovers a persisted pre-primary intent by dispatching primary and follow-up once", async () => {
    const fixture = await createFixture();
    const execution = recoveryExecution("recover-before-primary");
    await fixture.store.putExecution(execution);
    const primaryCall = required(startDeviceCalls(execution.operationName, execution.arguments)[0]);
    await seedMutationJournal(
      fixture.store,
      execution,
      "start:01:primary",
      "PRIMARY",
      primaryCall,
      "INTENT_PERSISTED",
    );

    await restartFixture(fixture);

    expect(fixture.device.calls.map(({ name }) => name)).toEqual([
      "ugv_path_follow_mission",
      "ugv_mission_control",
    ]);
    expect(await fixture.store.listMutationJournal(execution.taskId)).toEqual([
      expect.objectContaining({ phase: "PRIMARY", state: "ACCEPTED" }),
      expect.objectContaining({ phase: "FOLLOWUP", state: "ACCEPTED" }),
    ]);
  });

  it.each([
    { label: "before result persistence", missionIds: [] as string[] },
    { label: "after mission ID persistence", missionIds: ["1"] },
  ])("does not replay primary after dispatch $label", async ({ missionIds }) => {
    const fixture = await createFixture();
    const execution = recoveryExecution("recover-primary-dispatching", missionIds);
    await fixture.store.putExecution(execution);
    const primaryCall = required(startDeviceCalls(execution.operationName, execution.arguments)[0]);
    await seedMutationJournal(
      fixture.store,
      execution,
      "start:01:primary",
      "PRIMARY",
      primaryCall,
      "DISPATCHING",
    );

    await restartFixture(fixture);

    expect(fixture.device.calls).toHaveLength(0);
    expect(await fixture.store.getExecution(execution.taskId)).toMatchObject({
      state: "STARTING",
      reasonCode: "UNCERTAIN_EXECUTION_STATE",
      downstreamMissionIds: missionIds,
    });
  });

  it("continues only the follow-up after durable primary acceptance and mission identity", async () => {
    const fixture = await createFixture();
    const execution = recoveryExecution("recover-before-followup", ["1"]);
    await fixture.store.putExecution(execution);
    const primaryCall = required(startDeviceCalls(execution.operationName, execution.arguments)[0]);
    await seedMutationJournal(
      fixture.store,
      execution,
      "start:01:primary",
      "PRIMARY",
      primaryCall,
      "ACCEPTED",
      "1",
    );

    await restartFixture(fixture);

    expect(fixture.device.calls).toHaveLength(1);
    expect(fixture.device.calls[0]).toMatchObject({
      name: "ugv_mission_control",
      arguments: { action: "start", mission_id: 1 },
    });
    expect(await fixture.store.listMutationJournal(execution.taskId)).toEqual([
      expect.objectContaining({ phase: "PRIMARY", state: "ACCEPTED" }),
      expect.objectContaining({ phase: "FOLLOWUP", state: "ACCEPTED" }),
    ]);
  });

  it("does not replay a follow-up whose dispatch outcome was not persisted", async () => {
    const fixture = await createFixture();
    const execution = recoveryExecution("recover-followup-dispatching", ["1"]);
    await fixture.store.putExecution(execution);
    const primaryCall = required(startDeviceCalls(execution.operationName, execution.arguments)[0]);
    const followupCall = buildUgvStartFollowupCall(execution.operationName, "1");
    await seedMutationJournal(
      fixture.store,
      execution,
      "start:01:primary",
      "PRIMARY",
      primaryCall,
      "ACCEPTED",
      "1",
    );
    await seedMutationJournal(
      fixture.store,
      execution,
      "start:02:followup",
      "FOLLOWUP",
      followupCall,
      "DISPATCHING",
    );

    await restartFixture(fixture);

    expect(fixture.device.calls).toHaveLength(0);
    expect(await fixture.store.getExecution(execution.taskId)).toMatchObject({
      state: "STARTING",
      reasonCode: "UNCERTAIN_EXECUTION_STATE",
    });
  });

  it.each(["pause", "resume", "cancel"] as const)(
    "does not replay a %s mutation left in dispatching state across restart or retry",
    async (command) => {
      const fixture = await createFixture();
      const execution = recoveryExecution(`recover-${command}-dispatching`, ["1"], "RUNNING");
      await fixture.store.putExecution(execution);
      const controlCall = required(controlDeviceCalls("vehicle_navigate", command, "1")[0]);
      await seedMutationJournal(
        fixture.store,
        execution,
        `control:${command}:1:01`,
        command === "pause" ? "PAUSE" : command === "resume" ? "RESUME" : "CANCEL",
        controlCall,
        "DISPATCHING",
      );

      const recovered = await restartFixture(fixture);
      const afterRestart = required(await fixture.store.getExecution(execution.taskId));
      expect(fixture.device.calls).toHaveLength(0);
      expect(afterRestart.reasonCode).toBe("UNCERTAIN_EXECUTION_STATE");

      await expect(
        recovered.command(command, identityOf(afterRestart, "1")),
      ).resolves.toMatchObject({
        accepted: false,
        reasonCode: "UGV_DEVICE_MUTATING_CALL_UNCERTAIN",
      });
      expect(fixture.device.calls).toHaveLength(0);
    },
  );
});

async function restartFixture(
  fixture: Awaited<ReturnType<typeof createFixture>>,
): Promise<UgvProviderRuntime> {
  await fixture.runtime.close();
  const activeIndex = active.indexOf(fixture.runtime);
  if (activeIndex >= 0) active.splice(activeIndex, 1);
  const recovered = new UgvProviderRuntime(
    runtimeOptions(),
    fixture.store,
    fixture.ingress,
    fixture.device,
    fixture.events,
    fixture.telemetry,
  );
  active.push(recovered);
  await recovered.initialize();
  return recovered;
}

function recoveryExecution(
  taskId: string,
  downstreamMissionIds: string[] = [],
  state: ProviderExecution["state"] = "ACCEPTED",
): ProviderExecution {
  const input = startInput(taskId, "vehicle_navigate", navigateArgs());
  const now = new Date().toISOString();
  return {
    taskId,
    externalExecutionId: `vehicle:ugv1:chassis:${taskId}`,
    operationName: input.operationName,
    argumentHash: input.argumentHash,
    providerId: "isr.vehicle.ugv.ugv1",
    resourceId: "vehicle:ugv1",
    tracks: ["chassis"],
    arguments: structuredClone(input.arguments),
    executionContext: structuredClone(input.executionContext),
    downstreamMissionIds: structuredClone(downstreamMissionIds),
    state,
    revision: 1,
    reasonCode: state === "RUNNING" ? "UGV_DEVICE_TASK_RUNNING" : "UGV_OPERATION_ACCEPTED",
    createdAt: now,
    updatedAt: now,
    evidence: [],
  };
}

async function seedMutationJournal(
  store: MemoryProviderStore,
  execution: ProviderExecution,
  stepId: string,
  phase: MutationJournalPhase,
  call: DeviceToolCall,
  state: MutationJournalState,
  externalMissionId?: string,
): Promise<void> {
  const intent: MutationJournalEntry = {
    taskId: execution.taskId,
    stepId,
    phase,
    toolName: call.name,
    argumentHash: createHash("sha256").update(canonicalJson(call.arguments), "utf8").digest("hex"),
    state: "INTENT_PERSISTED",
    intentPersistedAt: execution.createdAt,
  };
  await store.claimMutationJournal(intent);
  if (state === "INTENT_PERSISTED") return;
  const dispatching: MutationJournalEntry = {
    ...intent,
    state: "DISPATCHING",
    dispatchedAt: new Date(Date.parse(execution.createdAt) + 1).toISOString(),
  };
  await store.advanceMutationJournal(dispatching, "INTENT_PERSISTED");
  if (state === "DISPATCHING") return;
  await store.advanceMutationJournal(
    {
      ...dispatching,
      state,
      ...(externalMissionId === undefined ? {} : { externalMissionId }),
      resultHash: "d".repeat(64),
      completedAt: new Date(Date.parse(execution.createdAt) + 2).toISOString(),
    },
    "DISPATCHING",
  );
}

async function invokeStartFailure(
  error: Error,
  onStartFailure: (diagnostic: VehicleStartFailureDiagnostic) => void | Promise<void>,
): Promise<unknown> {
  const fixture = await createFixture();
  vi.spyOn(fixture.runtime, "start").mockRejectedValueOnce(error);
  const registration = vi.spyOn(grpc.Server.prototype, "addService");
  const server = new UgvProviderServer(
    {
      providerId: "isr.vehicle.ugv.ugv1",
      providerVersion: "1.0.0",
      host: "127.0.0.1",
      port: 0,
      tlsMode: "disabled",
      onStartFailure,
    },
    fixture.runtime,
    fixture.store,
    fixture.events,
  );
  // Invoke the actual registered handler without starting a gRPC server or socket.
  const handler = registration.mock.calls[0]?.[1].startOperation as
    grpc.handleUnaryCall<unknown, unknown> | undefined;
  if (handler === undefined) throw new Error("START_OPERATION_HANDLER_MISSING");
  const input = startInput("wi050-local-diagnostic", "vehicle_get_state", {
    resourceId: "vehicle:ugv1",
    include: ["chassis", "health"],
    secret: "private-argument",
  });
  input.executionContext.simulationId = "uap-p3-b02-wi050-20260826t012850z";
  try {
    return await new Promise((resolve, reject) => {
      handler(
        {
          request: { ...input, arguments: jsonToProtoStruct(input.arguments) },
        } as grpc.ServerUnaryCall<unknown, unknown>,
        (rpcError, response) => {
          if (rpcError !== null) reject(rpcError);
          else resolve(response);
        },
      );
    });
  } finally {
    await server.close();
  }
}

async function createFixture(
  withTarget = false,
  store = new MemoryProviderStore(),
  overrides: Partial<UgvProviderRuntime["options"]> = {},
  device: MockUgvDeviceMcpClient = new MockUgvDeviceMcpClient(),
) {
  const ingress = new VehicleMqttIngress("direct_domain_json", {
    maxPayloadBytes: 65536,
    maxDepth: 16,
    maxNodes: 4096,
    maxStringBytes: 16384,
  });
  ingress.setConnected(true);
  ingress.handle(
    "/ugv/gnss",
    Buffer.from('{"entity_id":"ugv1","latitude":30.1,"longitude":114.1,"altitude":10}'),
  );
  ingress.handle(
    "/ugv/component_status",
    Buffer.from(
      '{"entity_id":"ugv1","power_battery":0,"lvbattery":0,"fuel":0,"water_temp":0,"motor":0,"sensor":0,"gnss":0,"comms":0,"weapon":0,"navigation":0}',
    ),
  );
  status(ingress, {});
  if (withTarget)
    ingress.handle(
      "/ugv/detected_objects",
      Buffer.from(
        '{"entity_id":"ugv1","objects":[{"id":101,"object_type":"3:target-vehicle","x":1,"y":2,"z":0}]}',
      ),
    );
  const telemetry = new UgvTelemetry({
    providerId: "isr.vehicle.ugv.ugv1",
    enabled: false,
    endpoint: "127.0.0.1:7002",
    tlsMode: "disabled",
  });
  const events = new UgvBusinessEventHub(store);
  const runtime = new UgvProviderRuntime(
    { ...runtimeOptions(), ...overrides },
    store,
    ingress,
    device,
    events,
    telemetry,
  );
  active.push(runtime);
  await runtime.initialize();
  return { store, ingress, device, telemetry, events, runtime };
}

class ContractFixtureUgvDevice extends MockUgvDeviceMcpClient {
  constructor(readonly fixtureContracts: readonly CapturedToolContract[]) {
    super(new Set(fixtureContracts.map(({ name }) => name as UgvDeviceToolName)));
  }

  override contracts(): CapturedToolContract[] {
    return this.fixtureContracts.map((contract) => structuredClone(contract));
  }
}

class DispatchOrderStore extends MemoryProviderStore {
  #missionRecorded = false;

  constructor(readonly events: string[]) {
    super();
  }

  override putExecution(execution: ProviderExecution): Promise<void> {
    const missionId = execution.downstreamMissionIds[0];
    if (!this.#missionRecorded && missionId !== undefined) {
      this.#missionRecorded = true;
      this.events.push(`execution:mission:${missionId}`);
    }
    return super.putExecution(execution);
  }

  override claimMutationJournal(entry: MutationJournalEntry) {
    this.events.push(`journal:${entry.phase}:${entry.state}`);
    return super.claimMutationJournal(entry);
  }

  override advanceMutationJournal(
    entry: MutationJournalEntry,
    expectedState: MutationJournalState,
  ) {
    this.events.push(`journal:${entry.phase}:${entry.state}`);
    return super.advanceMutationJournal(entry, expectedState);
  }
}

class MissionPersistenceFailingStore extends MemoryProviderStore {
  #failed = false;

  override putExecution(execution: ProviderExecution): Promise<void> {
    if (!this.#failed && execution.downstreamMissionIds.length > 0) {
      this.#failed = true;
      return Promise.reject(new Error("TEST_MISSION_PERSISTENCE_FAILED"));
    }
    return super.putExecution(execution);
  }
}

class JournalCompletionFailingStore extends MemoryProviderStore {
  #failed = false;

  override advanceMutationJournal(
    entry: MutationJournalEntry,
    expectedState: MutationJournalState,
  ) {
    if (!this.#failed && entry.state === "ACCEPTED") {
      this.#failed = true;
      return Promise.reject(new Error("TEST_JOURNAL_COMPLETION_FAILED"));
    }
    return super.advanceMutationJournal(entry, expectedState);
  }
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

function withoutOutputSchema(contract: CapturedToolContract): CapturedToolContract {
  const withoutOutput = { ...contract };
  delete withoutOutput.outputSchema;
  return withoutOutput;
}
function runtimeOptions() {
  return {
    providerId: "isr.vehicle.ugv.ugv1",
    freshness: { chassis: 3000, mission: 3000, health: 5000, target: 3000, payload: 3000 },
    allowNavigationWithRecon: true,
    fireRequiresChassisStopped: true,
    fireEnabled: true,
    stationaryStabilityMs: 0,
    stationaryMinimumSamples: 1,
    pollIntervalMs: 60_000,
  };
}
function startInput(
  taskId: string,
  operationName: string,
  argumentsValue: Record<string, unknown>,
) {
  return {
    taskId,
    operationName,
    arguments: argumentsValue,
    argumentHash: "a".repeat(64),
    executionContext: {
      authorizationContextHash: "b".repeat(64),
      executionMode: "SIMULATION",
      simulationId: "sim-1",
      correlationId: `correlation-${taskId}`,
    },
  };
}
function identityOf(
  execution: NonNullable<Awaited<ReturnType<UgvProviderRuntime["get"]>>>,
  sequence: string,
): CommandIdentity {
  return {
    taskId: execution.taskId,
    externalExecutionId: execution.externalExecutionId,
    operationName: execution.operationName,
    argumentHash: execution.argumentHash,
    executionContext: execution.executionContext,
    commandSequence: sequence,
  };
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("UGV_TEST_FIXTURE_VALUE_MISSING");
  return value;
}

function telemetryMetricNames(telemetry: UgvTelemetry): string[] {
  return telemetry.records.flatMap((record) => {
    const metricName = record.payload.metricName;
    return typeof metricName === "string" ? [metricName] : [];
  });
}

async function settleSnapshotObservers(): Promise<void> {
  for (let iteration = 0; iteration < 4; iteration++)
    await new Promise<void>((resolve) => setImmediate(resolve));
}

class FailNthExecutionWriteStore extends MemoryProviderStore {
  #remaining: number | undefined;

  failOnNthNextWrite(writeNumber: number): void {
    this.#remaining = writeNumber;
  }

  override putExecution(execution: ProviderExecution): Promise<void> {
    if (this.#remaining !== undefined) {
      this.#remaining--;
      if (this.#remaining === 0) {
        this.#remaining = undefined;
        return Promise.reject(new Error("TEST_EXECUTION_WRITE_FAILED"));
      }
    }
    return super.putExecution(execution);
  }
}

class PauseFireIntentWriteStore extends MemoryProviderStore {
  readonly intentWritePaused: Promise<void>;
  #notifyIntentWritePaused!: () => void;
  #resumeIntentWrite!: () => void;
  #pauseNextIntent = true;

  constructor() {
    super();
    this.intentWritePaused = new Promise<void>((resolve) => {
      this.#notifyIntentWritePaused = resolve;
    });
  }

  releaseIntentWrite(): void {
    this.#resumeIntentWrite();
  }

  override async putExecution(execution: ProviderExecution): Promise<void> {
    if (
      this.#pauseNextIntent &&
      execution.operationName === "vehicle_fire_weapon" &&
      execution.state === "STARTING" &&
      execution.reasonCode === "UGV_FIRE_DISPATCH_PREPARED"
    ) {
      this.#pauseNextIntent = false;
      this.#notifyIntentWritePaused();
      await new Promise<void>((resolve) => {
        this.#resumeIntentWrite = resolve;
      });
    }
    return super.putExecution(execution);
  }
}
function navigateArgs() {
  return {
    resourceId: "vehicle:ugv1",
    mission: { type: "point", target: { latitude: 30.2, longitude: 114.2 } },
    speedLimitKmh: 20,
    stopOnObstacle: true,
  };
}
function fireArgs() {
  return {
    resourceId: "vehicle:ugv1",
    targetId: "101",
    engagementMode: "single",
    requireConfirmation: true,
  };
}
function fireConfirmation() {
  return [
    {
      key: "fire_confirmation",
      result: jsonToProtoStruct({ action: "accept", content: { confirmed: true } }),
    },
  ];
}
function fireAcceptedResult() {
  return {
    mission_id: 1,
    state: 1,
    state_label: "running",
    message: "fire cycle accepted",
    error_code: 0,
    cmd_res: 0,
    fail_data: "",
  };
}
function makeFireReady(ingress: VehicleMqttIngress): void {
  ingress.applyDeviceObservation(
    { payload: { online: true, lockedTargetId: "101", attackReady: true } },
    [],
  );
}
function reconArgs() {
  return {
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
  };
}
function mission(ingress: VehicleMqttIngress, state: number, progress: number) {
  missionRaw(ingress, state, progress);
  if (state === 2 || state === 3 || state === 4)
    ingress.handle("/ugv/speed", Buffer.from(JSON.stringify({ entity_id: "ugv1", speed_kmh: 0 })));
  if (state === 4)
    ingress.handle(
      "/ugv/gnss",
      Buffer.from(JSON.stringify({ entity_id: "ugv1", latitude: 30.1001, longitude: 114.1001 })),
    );
}

function missionRaw(
  ingress: VehicleMqttIngress,
  state: number,
  progress: number,
  observedAt?: string,
) {
  missionWithId(ingress, 1, state, progress, observedAt);
}

function missionWithId(
  ingress: VehicleMqttIngress,
  missionId: number,
  state: number,
  progress: number,
  observedAt?: string,
) {
  ingress.handle(
    "/ugv/mission_state",
    Buffer.from(JSON.stringify({ entity_id: "ugv1", id: missionId, type: 1, state, progress })),
    false,
    observedAt,
  );
}
function reconStatus(
  ingress: VehicleMqttIngress,
  motionStatus: number,
  progress: number,
  lockedTargetId?: string,
  missionId: string | null = "1",
) {
  ingress.handle(
    "/ugv/area_recon/status",
    Buffer.from(
      JSON.stringify({
        status: motionStatus,
        ...(missionId === null ? {} : { mission_id: missionId }),
        status_label: motionStatus === 11 ? "finished" : "running",
        scan_mode: 1,
        out_of_range: false,
        camera_fault: false,
        progress,
        coverage: progress,
        lock: {
          stage: lockedTargetId === undefined ? 1 : 3,
          target_id: lockedTargetId === undefined ? 0 : Number(lockedTargetId),
          role_name: "",
          duration_sec: 0,
        },
        attack_ready: false,
        online: true,
      }),
    ),
    false,
    nextReconObservedAt(),
  );
}

function nextReconObservedAt(): string {
  lastReconObservationMs = Math.max(Date.now(), lastReconObservationMs + 1);
  return new Date(lastReconObservationMs).toISOString();
}
function status(
  ingress: VehicleMqttIngress,
  tracks: {
    chassis?: { state: number; progress: number };
    eo?: { id?: number; state: number; progress: number };
    weapon?: { id?: number; state: number; progress: number };
  },
) {
  ingress.handle(
    "status/ugv",
    Buffer.from(
      JSON.stringify({
        vehicle_id: "ugv1",
        role_name: "ugv",
        speed_kmh: 0,
        ...(tracks.chassis === undefined ? {} : { chassis_task: { id: 1, ...tracks.chassis } }),
        eo_task: tracks.eo ?? { state: -1, progress: 0 },
        weapon_task: tracks.weapon ?? { state: -1, progress: 0 },
        available: true,
      }),
    ),
  );
}

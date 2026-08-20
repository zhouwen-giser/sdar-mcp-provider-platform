import { afterEach, describe, expect, it } from "vitest";
import {
  jsonToProtoStruct,
  protoStructToJson,
  type ExecutionSnapshot,
  type ProviderManifest,
} from "../../packages/adapter-protocol/src/index.js";
import { OperationRegistry } from "../../packages/operation-registry/src/index.js";
import {
  MemoryProviderStore,
  type ProviderExecution,
} from "../../packages/provider-adapter-kit/src/index.js";
import { synchronousResult } from "../../packages/task-engine/src/result-contract.js";
import { MockNpcTankDeviceMcpClient } from "../../packages/vehicle-device-mcp-client/src/index.js";
import {
  npcTankMqttProfile,
  VehicleMqttIngress,
} from "../../packages/vehicle-mqtt-ingress/src/index.js";
import {
  VehicleBusinessEventHub,
  VehicleTelemetry,
  type NpcTankSnapshot,
} from "../../packages/vehicle-provider-core/src/index.js";
import { npcTankManifest } from "../../apps/npc-tank-provider-adapter/src/manifest.js";
import {
  NpcTankProviderRuntime,
  type CommandIdentity,
} from "../../apps/npc-tank-provider-adapter/src/runtime.js";

const active: NpcTankProviderRuntime[] = [];
let lastReconObservationMs = 0;
afterEach(async () => {
  while (active.length > 0) await active.pop()?.close();
});

describe("NPC Tank long-running operation integration", () => {
  it("returns Runtime-valid evidence for every core synchronous read", async () => {
    const fixture = await createFixture();
    const mqttSequence = fixture.ingress.ingestSequence();
    const mqttFreshness = fixture.ingress.snapshot().freshness;
    const manifest = new OperationRegistry().validate(
      npcTankManifest(
        "isr.vehicle.npc-tank.npc-tank1",
        "1.0.0",
        fixture.store,
        fixture.runtime.circularScanSupported(),
      ) as unknown as ProviderManifest,
    );
    expect(manifest.operations.map(({ name }) => name)).toEqual([
      "vehicle_get_state",
      "vehicle_get_capabilities",
      "vehicle_get_payload_status",
      "vehicle_get_targets",
      "vehicle_laser_range",
      "vehicle_navigate",
      "vehicle_area_recon",
      "vehicle_track_target",
      "vehicle_control_gimbal",
      "vehicle_fire_weapon",
      "vehicle_emergency_stop",
    ]);
    for (const operationName of [
      "vehicle_get_state",
      "vehicle_get_capabilities",
      "vehicle_get_payload_status",
      "vehicle_get_targets",
    ]) {
      const started = await fixture.runtime.start(
        startInput(`read-${operationName}`, operationName, { resourceId: "vehicle:npc_tank1" }),
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

  it("sanitizes reported capabilities, propagates available=false and disables the absent laser API", async () => {
    const fixture = await createFixture();
    fixture.device.responses.set("npc_tank_get_capabilities", {
      capabilities: {
        sensors: { gnss: true, camera: true },
        max_speed_kmh: 25,
        destroyed: true,
      },
      error_code: 0,
      message: "ok",
      mission_id: 9,
      state: 4,
      state_label: "completed",
    });

    const capabilities = await fixture.runtime.start(
      startInput("capabilities-clean", "vehicle_get_capabilities", {
        resourceId: "vehicle:npc_tank1",
      }),
    );
    const capabilityResult = protoStructToJson(capabilities.initialSnapshot.result);
    expect(capabilityResult).toMatchObject({
      resourceId: "vehicle:npc_tank1",
      available: true,
      navigation: {
        point: true,
        route: true,
        distance: true,
        returnHome: true,
        pauseResumeCancel: true,
      },
      payload: {
        reconnaissance: { area: true, circular: true, scanModes: [1, 2] },
        gimbal: { supported: true },
        targetTracking: true,
        laserRange: false,
      },
      deviceReported: { sensors: { gnss: true, camera: true }, max_speed_kmh: 25 },
    });
    expect(JSON.stringify(capabilityResult)).not.toMatch(
      /destroyed|damage|remaining_hp|error_code|state_label|mission_id/,
    );

    fixture.device.responses.set("get_status", { available: false });
    const unavailable = await fixture.runtime.start(
      startInput("state-unavailable", "vehicle_get_state", {
        resourceId: "vehicle:npc_tank1",
      }),
    );
    expect(protoStructToJson(unavailable.initialSnapshot.result)).toMatchObject({
      connectivity: { deviceAvailable: false },
    });
    expect(JSON.stringify(protoStructToJson(unavailable.initialSnapshot.result))).not.toContain(
      "deviceStatus",
    );
    expect(fixture.runtime.availability("vehicle_navigate", navigateArgs())).toMatchObject({
      availability: "DISABLED",
      reasonCode: "NPC_TANK_DEVICE_UNAVAILABLE",
    });

    expect(fixture.runtime.availability("vehicle_laser_range", {})).toMatchObject({
      availability: "DISABLED",
      reasonCode: "PRD_REQUIRED_EXTERNAL_INTERFACE_UNAVAILABLE",
    });
    await expect(
      fixture.runtime.start(
        startInput("laser-unavailable", "vehicle_laser_range", {
          resourceId: "vehicle:npc_tank1",
        }),
      ),
    ).rejects.toThrow("PRD_REQUIRED_EXTERNAL_INTERFACE_UNAVAILABLE");
  });

  it("confirms navigate progress, pause/resume, completion and durable event replay", async () => {
    const fixture = await createFixture();
    const started = await fixture.runtime.start(
      startInput("nav-1", "vehicle_navigate", navigateArgs()),
    );
    expect(fixture.device.calls).toMatchObject([
      {
        name: "npc_tank_path_follow_mission",
        arguments: { mission_id: 0 },
      },
      {
        name: "npc_tank_mission_control",
        arguments: { action: "start", mission_id: 1 },
      },
    ]);
    expect(started.initialSnapshot).toMatchObject({ state: "ACCEPTED" });

    mission(fixture.ingress, 1, 25);
    let execution = await fixture.runtime.get("nav-1");
    expect(execution).toMatchObject({ state: "RUNNING", progress: 25 });

    const identity = identityOf(required(execution), "1");
    expect(await fixture.runtime.command("pause", identity)).toMatchObject({ accepted: true });
    expect(fixture.device.calls.at(-1)).toMatchObject({
      name: "npc_tank_mission_control",
      arguments: { action: "pause", mission_id: 1 },
    });
    mission(fixture.ingress, 2, 30);
    execution = await fixture.runtime.get("nav-1");
    expect(execution?.state).toBe("PAUSED");

    const callsAfterPause = fixture.device.calls.length;
    expect(
      await fixture.runtime.command("pause", identity),
      "same command sequence must replay the exact persisted ack",
    ).toEqual(await fixture.runtime.command("pause", identity));
    expect(fixture.device.calls).toHaveLength(callsAfterPause);
    expect(
      await fixture.runtime.command("resume", identityOf(required(execution), "2")),
    ).toMatchObject({ accepted: true });
    expect(fixture.device.calls.at(-1)).toMatchObject({
      name: "npc_tank_mission_control",
      arguments: { action: "start", mission_id: 1 },
    });
    mission(fixture.ingress, 1, 60);
    expect((await fixture.runtime.get("nav-1"))?.state).toBe("RUNNING");
    mission(fixture.ingress, 4, 100);
    execution = await fixture.runtime.get("nav-1");
    expect(execution).toMatchObject({ state: "SUCCEEDED", progress: 100 });
    expect(execution?.result).toMatchObject({
      resourceId: "vehicle:npc_tank1",
      status: "completed",
    });

    const source = required(fixture.store.businessEventSources()[0]);
    const replay = await fixture.store.replayBusinessEvents(
      source.sourceId,
      source.sourceStreamId,
      0n,
    );
    expect(replay.map((event) => event.eventType)).toContain("vehicle.mission.started");
    expect(replay.map((event) => event.eventType)).toContain("vehicle.mission.completed");
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
    expect(fixture.device.calls.at(-1)).toMatchObject({
      name: "npc_tank_mission_control",
      arguments: { action: "terminate", mission_id: 1 },
    });
    expect((await fixture.runtime.get("nav-cancel"))?.state).toBe("STOPPING");
    mission(fixture.ingress, 3, 10);
    expect((await fixture.runtime.get("nav-cancel"))?.state).toBe("CANCELLED");
  });

  it("runs area recon and fails target tracking truthfully when lock is lost", async () => {
    const fixture = await createFixture(true);
    await fixture.runtime.start(startInput("recon-1", "vehicle_area_recon", reconArgs()));
    reconStatus(fixture.ingress, 5, 50);
    expect((await fixture.runtime.get("recon-1"))?.state).toBe("RUNNING");
    reconStatus(fixture.ingress, 11, 100);
    const completedRecon = await fixture.runtime.get("recon-1");
    expect(completedRecon?.state).toBe("SUCCEEDED");
    const manifest = new OperationRegistry().validate(
      npcTankManifest(
        "isr.vehicle.npc-tank.npc-tank1",
        "1.0.0",
        fixture.store,
        fixture.runtime.circularScanSupported(),
      ) as unknown as ProviderManifest,
    );
    const reconOperation = required(
      manifest.operations.find((operation) => operation.name === "vehicle_area_recon"),
    );
    expect(() => reconOperation.validateOutput(required(completedRecon?.result))).not.toThrow();

    await fixture.runtime.start(
      startInput("track-1", "vehicle_track_target", {
        resourceId: "vehicle:npc_tank1",
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
      reasonCode: "NPC_TANK_TARGET_LOST",
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
      reasonCode: "NPC_TANK_RECON_TERMINAL_UNCONFIRMED",
    });

    reconStatus(fixture.ingress, 5, 50);
    expect(await fixture.runtime.get("recon-stale")).toMatchObject({ state: "RUNNING" });
    reconStatus(fixture.ingress, 11, 100);
    expect(await fixture.runtime.get("recon-stale")).toMatchObject({ state: "SUCCEEDED" });
  });

  it("maps circular recon to scan_mode=2 with no polygon and starts the returned integer mission ID", async () => {
    const fixture = await createFixture();
    expect(fixture.runtime.circularScanSupported()).toBe(true);

    await fixture.runtime.start(
      startInput("recon-circular", "vehicle_area_recon", {
        resourceId: "vehicle:npc_tank1",
        scanMode: "circular",
        scanCount: 2,
        scanPitch: -4,
        targetTypes: [3],
      }),
    );

    expect(fixture.device.calls).toMatchObject([
      {
        name: "npc_tank_area_recon_configure",
        arguments: {
          region_points: null,
          scan_mode: 2,
          scan_num: 2,
          scan_pitch: -4,
          mission_id: 0,
        },
      },
      {
        name: "npc_tank_area_recon_control",
        arguments: { cmd_type: 1, mission_id: 1 },
      },
    ]);
    expect((await fixture.runtime.get("recon-circular"))?.downstreamMissionIds).toEqual(["1"]);
  });

  it("treats MotionStatus as recon authority while preserving camera fault and out-of-range facts", async () => {
    const fixture = await createFixture();
    await fixture.runtime.start(startInput("recon-authority", "vehicle_area_recon", reconArgs()));

    reconStatus(fixture.ingress, 5, 40, undefined, { cameraFault: true });
    expect(await fixture.runtime.get("recon-authority")).toMatchObject({
      state: "STARTING",
      reasonCode: "NPC_TANK_RECON_CAMERA_FAULT",
    });
    expect(fixture.ingress.snapshot().payload.reconnaissance).toMatchObject({
      motionStatus: 5,
      cameraFault: true,
      progressAuthoritative: false,
    });

    reconStatus(fixture.ingress, 5, 45, undefined, { outOfRange: true });
    expect(await fixture.runtime.get("recon-authority")).toMatchObject({
      state: "RUNNING",
      reasonCode: "NPC_TANK_RECON_RUNNING",
      progress: 45,
    });
    expect(fixture.ingress.snapshot().payload.reconnaissance).toMatchObject({
      motionStatus: 5,
      outOfRange: true,
      cameraFault: false,
    });

    reconStatus(fixture.ingress, 10, 45, undefined, { outOfRange: true });
    expect(await fixture.runtime.get("recon-authority")).toMatchObject({
      state: "BUSINESS_FAILED",
      reasonCode: "NPC_TANK_RECON_FAILED",
      result: { status: "failed", outOfRange: true },
    });
  });

  it("requires fire confirmation and strips destroyed/damage from every persisted output", async () => {
    const fixture = await createFixture(true);
    fixture.device.responses.set("npc_tank_area_recon_attack_confirm", {
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
        resourceId: "vehicle:npc_tank1",
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
    expect(ack).toMatchObject({
      accepted: true,
      reasonCode: "NPC_TANK_FIRE_CONFIRMATION_ACCEPTED",
    });
    expect((await fixture.runtime.get("fire-1"))?.downstreamMissionIds).toEqual(["1"]);
    expect(fixture.device.calls.at(-1)).toMatchObject({
      name: "npc_tank_area_recon_attack_confirm",
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
      reasonCode: "NPC_TANK_FIRE_CANCEL_UNSUPPORTED_AFTER_DISPATCH",
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
          npcTankManifest(
            "isr.vehicle.npc-tank.npc-tank1",
            "1.0.0",
            fixture.store,
            fixture.runtime.circularScanSupported(),
          ) as unknown as ProviderManifest,
        )
        .operations.find((operation) => operation.name === "vehicle_fire_weapon"),
    );
    expect(() => fireOperation.validateOutput(required(completed?.result))).not.toThrow();
    const persisted = JSON.stringify({ completed, telemetry: fixture.telemetry.records });
    expect(persisted).not.toMatch(/destroyed|damage|remaining_hp|\bhit\b/);
    expect(
      fixture.telemetry.records.some(
        (event) => event.payload.diagnostic === "fire_verdict_fields_stripped",
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
      reasonCode: "NPC_TANK_FIRE_CONFIRMATION_REJECTED",
    });
    expect(await fixture.runtime.get("fire-declined")).toMatchObject({
      state: "CANCELLED",
      reasonCode: "NPC_TANK_FIRE_CONFIRMATION_REJECTED",
      result: { status: "cancelled" },
    });
    await expect(
      fixture.runtime.updateFire(
        identityOf(required(await fixture.runtime.get("fire-declined")), "2"),
        fireConfirmation(),
      ),
    ).resolves.toMatchObject({
      accepted: true,
      reasonCode: "NPC_TANK_FIRE_CONFIRMATION_REJECTED",
      commandSequence: "2",
    });
    expect(fixture.device.calls).toHaveLength(0);

    await fixture.runtime.start(startInput("fire-cancelled", "vehicle_fire_weapon", fireArgs()));
    const waiting = required(await fixture.runtime.get("fire-cancelled"));
    await expect(
      fixture.runtime.command("cancel", identityOf(waiting, "1")),
    ).resolves.toMatchObject({
      accepted: true,
      reasonCode: "NPC_TANK_FIRE_CANCELLED_BEFORE_DISPATCH",
    });
    expect(await fixture.runtime.get("fire-cancelled")).toMatchObject({
      state: "CANCELLED",
      reasonCode: "NPC_TANK_FIRE_CANCELLED_BEFORE_DISPATCH",
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
      reasonCode: "NPC_TANK_FIRE_CONFIRMATION_REJECTED",
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
    fixture.device.handlers.set("npc_tank_area_recon_attack_confirm", async () => {
      observedDispatch();
      await release;
      return fireAcceptedResult();
    });
    await fixture.runtime.start(startInput("fire-concurrent", "vehicle_fire_weapon", fireArgs()));
    const waiting = required(await fixture.runtime.get("fire-concurrent"));
    const replica = new NpcTankProviderRuntime(
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
      reasonCode: "NPC_TANK_FIRE_CONFIRMATION_ACCEPTED",
    });
    await expect(
      replica.updateFire(identityOf(waiting, "3"), fireConfirmation()),
    ).resolves.toMatchObject({ accepted: true, reasonCode: "NPC_TANK_FIRE_CONFIRMATION_ACCEPTED" });
    expect(
      fixture.device.calls.filter((call) => call.name === "npc_tank_area_recon_attack_confirm"),
    ).toHaveLength(1);
  });

  it("lets a pre-arm cancellation win across replicas without a physical fire call", async () => {
    const store = new PauseFireIntentWriteStore();
    const fixture = await createFixture(true, store);
    makeFireReady(fixture.ingress);
    fixture.device.responses.set("npc_tank_area_recon_attack_confirm", fireAcceptedResult());
    await fixture.runtime.start(startInput("fire-cancel-race", "vehicle_fire_weapon", fireArgs()));
    const waiting = required(await fixture.runtime.get("fire-cancel-race"));
    const replica = new NpcTankProviderRuntime(
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
      reasonCode: "NPC_TANK_FIRE_CANCELLED_BEFORE_DISPATCH",
    });
    store.releaseIntentWrite();
    await expect(accepting).resolves.toMatchObject({
      accepted: true,
      reasonCode: "NPC_TANK_FIRE_CANCELLED_BEFORE_DISPATCH",
    });
    expect(await fixture.runtime.get("fire-cancel-race")).toMatchObject({
      state: "CANCELLED",
      reasonCode: "NPC_TANK_FIRE_CANCELLED_BEFORE_DISPATCH",
    });
    expect(
      fixture.device.calls.filter((call) => call.name === "npc_tank_area_recon_attack_confirm"),
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
    fixture.device.responses.set("npc_tank_area_recon_attack_confirm", fireAcceptedResult());
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
      fixture.device.calls.filter((call) => call.name === "npc_tank_area_recon_attack_confirm"),
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
    fixture.device.responses.set("npc_tank_area_recon_attack_confirm", {
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
    ).resolves.toMatchObject({ accepted: true, reasonCode: "NPC_TANK_DEVICE_TOOL_REJECTED" });
    const failed = required(await fixture.runtime.get("fire-device-rejected"));
    expect(failed).toMatchObject({
      state: "BUSINESS_FAILED",
      reasonCode: "NPC_TANK_DEVICE_TOOL_REJECTED",
      result: { status: "fire_command_rejected" },
    });
    const operation = required(
      new OperationRegistry()
        .validate(
          npcTankManifest(
            "isr.vehicle.npc-tank.npc-tank1",
            "1.0.0",
            fixture.store,
            fixture.runtime.circularScanSupported(),
          ) as unknown as ProviderManifest,
        )
        .operations.find((candidate) => candidate.name === "vehicle_fire_weapon"),
    );
    expect(() => operation.validateOutput(required(failed.result))).not.toThrow();
    expect(
      fixture.device.calls.filter((call) => call.name === "npc_tank_area_recon_attack_confirm"),
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
    ).resolves.toMatchObject({ accepted: true, reasonCode: "NPC_TANK_FIRE_DISPATCH_ABORTED" });
    await expect(
      fixture.runtime.updateFire(identityOf(waiting, "2"), fireConfirmation()),
    ).resolves.toMatchObject({ accepted: true, reasonCode: "NPC_TANK_FIRE_DISPATCH_ABORTED" });
    expect(
      fixture.device.calls.filter((call) => call.name === "npc_tank_area_recon_attack_confirm"),
    ).toHaveLength(0);
    expect(await fixture.runtime.get("fire-intent-failure")).toMatchObject({
      state: "TECHNICAL_FAILED",
      reasonCode: "NPC_TANK_FIRE_DISPATCH_ABORTED",
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
      reasonCode: "NPC_TANK_FIRE_DISPATCH_PREPARED",
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
        reasonCode: "NPC_TANK_FIRE_DISPATCH_NOT_ARMED",
        message: "NPC_TANK_FIRE_DISPATCH_NOT_ARMED",
        commandSequence: "0",
        identity: identityOf(waiting, "1"),
      },
      createdAt: new Date().toISOString(),
    });

    await fixture.runtime.recover();
    expect(await fixture.runtime.get("fire-unarmed-recovery")).toMatchObject({
      state: "TECHNICAL_FAILED",
      reasonCode: "NPC_TANK_FIRE_DISPATCH_ABORTED",
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
    fixture.device.handlers.set("npc_tank_area_recon_attack_confirm", () => {
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
      npcTankManifest(
        "isr.vehicle.npc-tank.npc-tank1",
        "1.0.0",
        fixture.store,
        fixture.runtime.circularScanSupported(),
      ) as unknown as ProviderManifest,
    );
    const operation = required(
      manifest.operations.find((candidate) => candidate.name === "vehicle_control_gimbal"),
    );
    status(fixture.ingress, { eo: { id: 1, state: 4, progress: 99 } });

    await fixture.runtime.start(
      startInput("gimbal-1", "vehicle_control_gimbal", {
        resourceId: "vehicle:npc_tank1",
        mode: "absolute",
        yaw: 10,
        pitch: -2,
      }),
    );
    expect((await fixture.runtime.get("gimbal-1"))?.downstreamMissionIds).toEqual(["1"]);
    status(fixture.ingress, { eo: { id: 1, state: 4, progress: 100 } });
    expect(await fixture.runtime.get("gimbal-1")).toMatchObject({
      state: "STARTING",
      reasonCode: "NPC_TANK_TASK_TERMINAL_UNCONFIRMED",
    });
    status(fixture.ingress, { eo: { id: 1, state: 1, progress: 50 } });
    expect((await fixture.runtime.get("gimbal-1"))?.state).toBe("RUNNING");
    status(fixture.ingress, { eo: { id: 1, state: 4, progress: 100 } });
    const completed = required(await fixture.runtime.get("gimbal-1"));
    expect(completed.state).toBe("SUCCEEDED");
    expect(() => operation.validateOutput(required(completed.result))).not.toThrow();

    await fixture.runtime.start(
      startInput("gimbal-cancel", "vehicle_control_gimbal", {
        resourceId: "vehicle:npc_tank1",
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
      name: "npc_tank_gimbal_move",
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
    const stopped = await fixture.runtime.start(
      startInput("stop-1", "vehicle_emergency_stop", { resourceId: "vehicle:npc_tank1" }),
    );
    expect(stopped.initialSnapshot).toMatchObject({ state: "ACCEPTED" });
    status(fixture.ingress, {});
    expect(await fixture.runtime.get("stop-1")).toMatchObject({
      state: "SUCCEEDED",
      result: { status: "stopped" },
    });
    expect(fixture.device.calls.slice(-4)).toMatchObject([
      { name: "npc_tank_motion_stop", arguments: {} },
      {
        name: "npc_tank_mission_control",
        arguments: { action: "terminate", mission_id: 1 },
      },
      {
        name: "npc_tank_area_recon_control",
        arguments: { cmd_type: 4, mission_id: 1 },
      },
      {
        name: "npc_tank_area_recon_lock",
        arguments: { lock: false, target_id: 0, mission_id: 1 },
      },
    ]);
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
    const callsBeforeReconnect = fixture.device.calls.length;
    await fixture.device.close();
    await fixture.runtime.pollActive();
    expect(fixture.device.connected()).toBe(true);
    expect(fixture.device.calls).toHaveLength(callsBeforeReconnect);

    const callsBeforeRestart = fixture.device.calls.length;
    await fixture.runtime.close();
    active.splice(active.indexOf(fixture.runtime), 1);

    const recovered = new NpcTankProviderRuntime(
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
});

async function createFixture(withTarget = false, store = new MemoryProviderStore()) {
  const ingress = new VehicleMqttIngress<NpcTankSnapshot>(
    "direct_domain_json",
    {
      maxPayloadBytes: 65536,
      maxDepth: 16,
      maxNodes: 4096,
      maxStringBytes: 16384,
    },
    npcTankMqttProfile(),
  );
  ingress.setConnected(true);
  ingress.handle(
    "/npc_tank1/gnss",
    Buffer.from('{"entity_id":"npc_tank1","latitude":30.1,"longitude":114.1,"altitude":10}'),
  );
  ingress.handle(
    "/npc_tank1/component_status",
    Buffer.from(
      '{"entity_id":"npc_tank1","power_battery":0,"lvbattery":0,"fuel":0,"water_temp":0,"motor":0,"sensor":0,"gnss":0,"comms":0,"weapon":0,"navigation":0}',
    ),
  );
  status(ingress, {});
  if (withTarget)
    ingress.handle(
      "/npc_tank1/detected_objects",
      Buffer.from(
        '{"entity_id":"npc_tank1","objects":[{"id":101,"object_type":"3:target-vehicle","x":1,"y":2,"z":0}]}',
      ),
    );
  const device = new MockNpcTankDeviceMcpClient();
  const telemetry = new VehicleTelemetry({
    providerId: "isr.vehicle.npc-tank.npc-tank1",
    resourceId: "vehicle:npc_tank1",
    resourceType: "isr.vehicle.npc_tank",
    enabled: false,
    endpoint: "127.0.0.1:7002",
    tlsMode: "disabled",
  });
  const events = new VehicleBusinessEventHub(store, {
    reasonPrefix: "NPC_TANK",
    resourceId: "vehicle:npc_tank1",
  });
  const runtime = new NpcTankProviderRuntime(
    runtimeOptions(),
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
function runtimeOptions() {
  return {
    providerId: "isr.vehicle.npc-tank.npc-tank1",
    freshness: { chassis: 3000, mission: 3000, health: 5000, target: 3000, payload: 3000 },
    allowNavigationWithRecon: true,
    fireRequiresChassisStopped: true,
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
      simulationId: "sim-npc",
      correlationId: `correlation-${taskId}`,
    },
  };
}
function identityOf(
  execution: NonNullable<Awaited<ReturnType<NpcTankProviderRuntime["get"]>>>,
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
  if (value === undefined) throw new Error("NPC_TANK_TEST_FIXTURE_VALUE_MISSING");
  return value;
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
      execution.reasonCode === "NPC_TANK_FIRE_DISPATCH_PREPARED"
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
    resourceId: "vehicle:npc_tank1",
    mission: { type: "point", target: { latitude: 30.2, longitude: 114.2 } },
    speedLimitKmh: 20,
    stopOnObstacle: true,
  };
}
function fireArgs() {
  return {
    resourceId: "vehicle:npc_tank1",
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
function makeFireReady(ingress: VehicleMqttIngress<NpcTankSnapshot>): void {
  ingress.applyDeviceObservation(
    { payload: { online: true, lockedTargetId: "101", attackReady: true } },
    [],
  );
}
function reconArgs() {
  return {
    resourceId: "vehicle:npc_tank1",
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
function mission(ingress: VehicleMqttIngress<NpcTankSnapshot>, state: number, progress: number) {
  ingress.handle(
    "/npc_tank1/mission_state",
    Buffer.from(JSON.stringify({ entity_id: "npc_tank1", id: 1, type: 1, state, progress })),
  );
}
function reconStatus(
  ingress: VehicleMqttIngress<NpcTankSnapshot>,
  motionStatus: number,
  progress: number,
  lockedTargetId?: string,
  options: { cameraFault?: boolean; outOfRange?: boolean; scanMode?: 1 | 2 } = {},
) {
  ingress.handle(
    "/npc_tank1/area_recon/status",
    Buffer.from(
      JSON.stringify({
        status: motionStatus,
        status_label: motionStatus === 11 ? "finished" : "running",
        scan_mode: options.scanMode ?? 1,
        out_of_range: options.outOfRange ?? false,
        camera_fault: options.cameraFault ?? false,
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
  ingress: VehicleMqttIngress<NpcTankSnapshot>,
  tracks: {
    chassis?: { state: number; progress: number };
    eo?: { id?: number; state: number; progress: number };
    weapon?: { id?: number; state: number; progress: number };
  },
) {
  ingress.handle(
    "/npc_tank1/status",
    Buffer.from(
      JSON.stringify({
        vehicle_id: "npc_tank1",
        role_name: "npc_tank1",
        speed_kmh: 0,
        chassis_task: tracks.chassis ?? { state: -1, progress: 0 },
        eo_task: tracks.eo ?? { state: -1, progress: 0 },
        weapon_task: tracks.weapon ?? { state: -1, progress: 0 },
        available: true,
      }),
    ),
  );
}

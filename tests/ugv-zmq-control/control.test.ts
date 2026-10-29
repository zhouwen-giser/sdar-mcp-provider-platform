import { afterEach, describe, expect, it } from "vitest";
import { decodeChassisFrame } from "../../packages/vehicle-zmq-contract/src/index.js";
import {
  StartControl,
  ZmqControlEngine,
  commandFor,
  controlScope,
} from "../../packages/vehicle-zmq-control/src/index.js";
import {
  camera,
  area,
  device,
  feedbackFrame,
  identity,
  missionFrame,
  navigation,
  request,
  rig,
  systemFrame,
  task,
  TestTransport,
  testScope,
} from "./helpers.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
const setup = async () => {
  const r = await rig();
  cleanup.push(() => r.engine.close());
  return r;
};

describe("SIMULATED scoped control lifecycle", () => {
  it("rejects externally routable profiles and preserves an omitted controller ID", async () => {
    const s = testScope();
    s.profile.components.eo.commandEndpoint = "tcp://192.168.2.63:5555";
    expect(() => controlScope(s.profile, s.settings)).toThrow("ISOLATION_REQUIRED");
    const r = await setup();
    r.scope.profile.components.chassis.controllerSystemId = null;
    expect(r.engine.availability(navigation)).toMatchObject({
      available: false,
      reasonCode: "ZMQ_CHASSIS_CONTROL_SENDER_UNSPECIFIED",
    });
    expect(r.scope.profile.components.chassis.controllerSystemId).toBeNull();
  });
  it("validates WGS84 axes, exact four-point area height and deployment limits before sending", async () => {
    const r = await setup();
    expect(() =>
      StartControl.parse(
        request(r.clock, {
          ...navigation,
          params: { ...navigation.params, destination: { longitude: 106, latitude: 106 } },
        }),
      ),
    ).toThrow();
    expect(() =>
      StartControl.parse(
        request(r.clock, { name: "recon.area", params: { ...area.params, region_wgs84: [] } }),
      ),
    ).toThrow();
    await expect(
      r.engine.start(
        request(r.clock, {
          name: "camera.zoom",
          params: { zoom_ratio: 50, zoom_timeout_ms: 1000 },
        }),
      ),
    ).rejects.toThrow("LIMIT_EXCEEDED");
    expect(r.transport.commands).toHaveLength(0);
  });
  it("deduplicates concurrent submissions, rejects same ID with changed content and scopes reads", async () => {
    const r = await setup(),
      input = request(r.clock);
    const [a, b] = await Promise.all([r.engine.start(input), r.engine.start(input)]);
    await r.pulse();
    expect(a.externalExecutionId).toBe(b.externalExecutionId);
    expect(r.transport.commands.filter((c) => c.action === "camera")).toHaveLength(1);
    await expect(
      r.engine.start({
        ...input,
        operation: { name: "camera.zoom", params: { zoom_ratio: 2, zoom_timeout_ms: 1000 } },
      }),
    ).rejects.toThrow("COMMAND_ID_CONFLICT");
    await expect(
      r.engine.get(a.taskId, { ...a.executionContext, simulationId: "OTHER" }),
    ).rejects.toThrow("IDENTITY_MISMATCH");
  });
  it("does not treat camera accepted or unrelated/old completion as business success", async () => {
    const r = await setup(),
      e = await r.engine.start(request(r.clock));
    await r.pulse();
    expect((await r.repository.get(e.taskId))?.state).toBe("STARTING");
    const c = r.transport.commands[0];
    expect(c).toBeDefined();
    const tele = {
      action: "position",
      state: "succeeded",
      remaining_ms: 0,
      command: {
        request_id: "foreign-request",
        method: "TeleControl",
        task_id: null,
        state: "accepted",
        reason: null,
      },
    };
    await r.eo("device_status", device({ telecontrol: tele }));
    expect((await r.repository.get(e.taskId))?.state).toBe("STARTING");
    tele.command.request_id = c?.requestId ?? "";
    await r.eo("device_status", device({ telecontrol: tele, gimbal_yaw_rad: 0.5 }));
    const final = await r.repository.get(e.taskId);
    expect(final).toMatchObject({
      state: "SUCCEEDED",
      zmqControl: { stopConfirmed: true, occupancy: "released" },
    });
    expect(final?.result).toMatchObject({
      qualification: "isolated_simulator_only",
      runtimeAdmission: "not_published",
    });
  });
  it("waits until scheduled start and fails a missed window without dispatch", async () => {
    const r = await setup(),
      input = request(r.clock);
    input.timing.startAt = new Date(r.clock.utc + 1000).toISOString();
    input.timing.startToleranceMs = 50;
    const e = await r.engine.start(input);
    await r.pulse();
    expect(r.transport.commands).toHaveLength(0);
    r.clock.advance(1100);
    await r.pulse();
    expect((await r.repository.get(e.taskId))?.reasonCode).toBe("START_WINDOW_MISSED");
    expect(r.transport.commands).toHaveLength(0);
  });
  it("cancels a waiting mode gate and never sends task or START afterward", async () => {
    const r = await setup(),
      e = await r.engine.start(request(r.clock, navigation));
    await r.pulse();
    expect(r.transport.commands.map((c) => c.action)).toEqual(["mode"]);
    await r.engine.control("cancel", identity(e));
    await r.receive("chassis", systemFrame(3));
    await r.pulse();
    expect(r.transport.commands.map((c) => c.action)).toEqual(["mode"]);
    expect((await r.repository.get(e.taskId))?.state).toBe("CANCELLED");
  });
  it("retries only identical mode three times at the documented 3000ms bound", async () => {
    const r = await setup(),
      e = await r.engine.start(request(r.clock, navigation));
    await r.pulse();
    for (let i = 0; i < 3; i++) {
      r.clock.advance(2999);
      await r.receive("chassis", systemFrame(0));
      await r.pulse();
      if (i < 2) {
        r.clock.advance(1);
        await r.pulse();
      }
    }
    r.clock.advance(1);
    await r.pulse();
    const modes = r.transport.commands.filter((c) => c.action === "mode");
    expect(modes).toHaveLength(3);
    expect(new Set(modes.map((c) => c.frames[0])).size).toBe(1);
    expect((await r.repository.get(e.taskId))?.reasonCode).toBe("ZMQ_MODE_ECHO_TIMEOUT");
    expect(r.transport.commands.some((c) => c.action === "configure" || c.action === "start")).toBe(
      false,
    );
  });
  it("builds lossless sender headers, lon/lat navigation payloads and requires post-send feedback", async () => {
    const r = await setup(),
      e = await r.engine.start(request(r.clock, navigation));
    await r.pulse();
    await r.receive("chassis", feedbackFrame()); // Cannot satisfy feedback gate before call_task.
    await r.receive("chassis", systemFrame(3));
    await r.pulse();
    await r.pulse();
    const configure = r.transport.commands.find((c) => c.action === "configure");
    expect(configure).toBeDefined();
    const decoded = decodeChassisFrame(Buffer.from(configure?.frames[0] ?? "", "base64"));
    expect(decoded.systemId).toBe("18446744073709551614");
    expect(decoded.body.taskPoints).toEqual([
      { longitude: 106.81307318, latitude: 29.71952521, headingAngle: 0, property: 2, reserved: 0 },
    ]);
    expect(r.transport.commands.some((c) => c.action === "start")).toBe(false);
    await r.receive("chassis", feedbackFrame(1));
    expect(r.transport.commands.filter((c) => c.action === "start")).toHaveLength(1);
    await r.receive("chassis", missionFrame(e.zmqControl.nativeTaskId ?? "0", 1));
    expect((await r.repository.get(e.taskId))?.state).toBe("RUNNING");
    expect((await r.repository.get(e.taskId))?.zmqControl.missingEvidence).toContain(
      "CHASSIS_FEEDBACK_UNCORRELATED",
    );
  });
  it("retains unknown outcomes and occupancy without replaying a timed-out mutation", async () => {
    const r = await setup();
    r.transport.outcome = "uncertain";
    const input = request(r.clock),
      e = await r.engine.start(input);
    await r.pulse();
    for (let i = 0; i < 5; i++) await r.pulse();
    expect(r.transport.commands).toHaveLength(1);
    expect((await r.repository.get(e.taskId))?.zmqControl).toMatchObject({
      stage: "uncertain",
      occupancy: "held",
    });
    await expect(r.engine.start(request(r.clock))).rejects.toThrow("OCCUPIED");
    const second = new ZmqControlEngine(r.scope, r.repository, new TestTransport(), r.clock);
    await second.initialize();
    cleanup.push(() => second.close());
    expect((await r.repository.get(e.taskId))?.reasonCode).toBe("ZMQ_RESTART_OUTCOME_UNKNOWN");
    await expect(second.control("cancel", identity(e))).rejects.toThrow(
      "RESTART_RECONCILIATION_REQUIRED",
    );
  });
  it.each(["cancel", "deadline"] as const)(
    "terminates an unacknowledged EO configuration on %s without inventing an identity or replaying",
    async (action) => {
      const r = await setup();
      r.transport.outcome = "uncertain";
      const input = request(r.clock, area);
      input.timing.maxElapsedMs = 2000;
      const e = await r.engine.start(input);
      await r.pulse();
      expect(r.transport.commands).toHaveLength(1);
      expect(r.transport.commands[0]?.action).toBe("configure");
      if (action === "cancel") await r.engine.control("cancel", identity(e));
      else {
        r.clock.advance(2001);
        await r.pulse();
      }
      const ended = await r.repository.get(e.taskId);
      expect(ended).toMatchObject({
        state: "TECHNICAL_FAILED",
        reasonCode: "ZMQ_NATIVE_TASK_UNKNOWN_STOP_UNAVAILABLE",
        zmqControl: {
          stage: "uncertain",
          occupancy: "held",
          nativeTaskId: null,
          stopConfirmed: false,
        },
        result: {
          occupancy: "held",
          stopConfirmed: false,
        },
      });
      expect(typeof ended?.terminalAt).toBe("string");
      expect(ended?.result?.missingEvidence).toContain("NATIVE_TASK_ID_UNKNOWN");
      expect(ended?.result?.missingEvidence).toContain("PHYSICAL_STOP_UNCONFIRMED");
      const result = ended?.result;
      r.clock.advance(10000);
      for (let i = 0; i < 5; i++) await r.pulse();
      expect(r.transport.commands).toHaveLength(1);
      expect((await r.repository.get(e.taskId))?.result).toEqual(result);
      await expect(r.engine.start(request(r.clock, area))).rejects.toThrow("OCCUPIED");
    },
  );
  it("does not reset platform budget across pause/resume and sends stop on expiration", async () => {
    const r = await setup(),
      input = request(r.clock, area);
    input.timing.maxElapsedMs = 2000;
    const e = await r.engine.start(input);
    await r.pulse();
    const native = (await r.repository.get(e.taskId))?.zmqControl.nativeTaskId ?? "";
    await r.eo("device_status", device({ mode: "task", ready: false, active_task_id: native }));
    await r.eo("task_status", task(native, "ready"));
    await r.pulse();
    await r.eo("task_status", task(native, "searching"));
    await r.engine.control("pause", identity(e));
    await r.eo("device_status", device({ mode: "task", ready: false, active_task_id: native }));
    await r.eo("task_status", task(native, "paused"));
    const deadline = (await r.repository.get(e.taskId))?.zmqControl.deadlineAt;
    expect((await r.repository.get(e.taskId))?.state).toBe("PAUSED");
    r.clock.advance(2500);
    await r.pulse();
    const stopped = await r.repository.get(e.taskId);
    expect(stopped?.zmqControl.deadlineAt).toBe(deadline);
    expect(r.transport.commands.filter((c) => c.action === "stop")).toHaveLength(1);
    expect(stopped?.state).toBe("STOPPING");
  });
  it("does not release after stop ACK or timeout and preserves failed result when late stop is confirmed", async () => {
    const r = await setup(),
      e = await r.engine.start(request(r.clock));
    await r.pulse();
    const cancelId = identity(e);
    await r.engine.control("cancel", cancelId);
    await r.engine.control("cancel", cancelId);
    expect(r.transport.commands.filter((c) => c.action === "stop")).toHaveLength(1);
    r.clock.advance(3001);
    await r.pulse();
    expect(await r.repository.get(e.taskId)).toMatchObject({
      state: "TECHNICAL_FAILED",
      reasonCode: "ZMQ_STOP_UNCONFIRMED",
      zmqControl: { occupancy: "held" },
    });
    const stop = r.transport.commands.find((c) => c.action === "stop");
    await r.eo(
      "device_status",
      device({
        telecontrol: {
          action: "stop",
          state: "succeeded",
          remaining_ms: 0,
          command: {
            request_id: stop?.requestId,
            method: "TeleControl",
            task_id: null,
            state: "accepted",
            reason: null,
          },
        },
      }),
    );
    expect(await r.repository.get(e.taskId)).toMatchObject({
      state: "TECHNICAL_FAILED",
      reasonCode: "ZMQ_STOP_UNCONFIRMED",
      zmqControl: { occupancy: "released", stopConfirmed: true },
    });
  });
  it("carries parent deadline into every dispatch and does not turn polygon completion into evidence completeness", async () => {
    const r = await setup(),
      input = request(r.clock, area);
    input.timing.parentDeadlineAt = new Date(r.clock.utc + 1500).toISOString();
    const e = await r.engine.start(input);
    await r.pulse();
    const configure = r.transport.commands.find((c) => c.action === "configure");
    expect(JSON.parse(Buffer.from(configure?.frames[0] ?? "", "base64").toString())).toMatchObject({
      params: { task_timeout_ms: 1500 },
    });
    const final = await r.repository.get(e.taskId);
    expect(final?.zmqControl.deadlineAt).toBe(input.timing.parentDeadlineAt);
  });
  it("supports native return/route payloads without guessed heading or return points", async () => {
    const r = await setup(),
      e = await r.engine.start(request(r.clock, navigation));
    await r.pulse();
    for (const op of [
      {
        name: "navigation.route",
        params: {
          waypoints: [navigation.params.destination],
          speedLimitMps: 1,
          obstacleAvoidance: true,
        },
      },
      {
        name: "navigation.returnHome",
        params: { waypoints: [], returnType: 0, speedLimitMps: 1, obstacleAvoidance: false },
      },
    ] as const) {
      const value = structuredClone(e);
      value.arguments.operation = op;
      const wire = commandFor(value, "configure", r.scope, new Date(r.clock.utc).toISOString());
      const decoded = decodeChassisFrame(Buffer.from(wire.frames[0] ?? "", "base64"));
      expect(decoded.body.type).toBe(op.name === "navigation.route" ? "pathFollow" : "returnHome");
      expect(decoded.body.taskPoints).toHaveLength(op.params.waypoints.length);
    }
  });
  it("refuses a succeeded camera status whose physical angle disagrees with the request", async () => {
    const r = await setup(),
      e = await r.engine.start(request(r.clock));
    await r.pulse();
    const c = r.transport.commands.find((c) => c.action === "camera");
    await r.eo(
      "device_status",
      device({
        telecontrol: {
          action: "position",
          state: "succeeded",
          remaining_ms: 0,
          command: {
            request_id: c?.requestId,
            method: "TeleControl",
            task_id: null,
            state: "accepted",
            reason: null,
          },
        },
      }),
    );
    expect((await r.repository.get(e.taskId))?.state).toBe("STOPPING");
    expect((await r.repository.get(e.taskId))?.zmqControl.missingEvidence).toContain(
      "PHYSICAL_COMPLETION_FEEDBACK_CONFLICT",
    );
  });
  it("revokes a queued START when cancel arrives while its final send fence is waiting", async () => {
    const r = await setup(),
      e = await r.engine.start(request(r.clock, navigation));
    await r.pulse();
    await r.receive("chassis", systemFrame(3));
    await r.pulse();
    await r.pulse();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    r.transport.before = async (command) => {
      if (command.action === "start") await gate;
    };
    const receipt = r.receive("chassis", feedbackFrame());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const cancelled = r.engine.control("cancel", identity(e));
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await Promise.all([receipt, cancelled]);
    await r.pulse();
    expect(r.transport.commands.some((c) => c.action === "start")).toBe(false);
    expect(r.transport.commands.filter((c) => c.action === "stop")).toHaveLength(1);
  });
  it("blocks stale sources and clock discontinuity without repeating a mutation", async () => {
    const r = await setup(),
      e = await r.engine.start(request(r.clock));
    await r.pulse();
    r.clock.advance(3001);
    await r.pulse();
    expect(r.transport.commands.filter((c) => c.action === "stop")).toHaveLength(1);
    expect((await r.repository.get(e.taskId))?.zmqControl.occupancy).toBe("held");
    r.clock.utc -= 10000;
    await r.pulse();
    expect(r.engine.availability(navigation).available).toBe(false);
    expect(r.transport.commands.filter((c) => c.action === "camera")).toHaveLength(1);
  });
  it("stops all dispatch after losing the writer lease, including the prearmed stop path", async () => {
    const r = await setup(),
      e = await r.engine.start(request(r.clock));
    await r.pulse();
    r.repository.writer = false;
    await expect(r.engine.control("cancel", identity(e))).rejects.toThrow("WRITER_LOST");
    expect(r.transport.commands.filter((c) => c.action === "stop")).toHaveLength(0);
    expect((await r.repository.get(e.taskId))?.zmqControl.occupancy).toBe("held");
  });
  it("does not admit a measured optical source into the simulated execution domain", async () => {
    const r = await setup();
    await r.eo("device_status", device({ data_origin: "measured" }));
    expect(r.engine.availability(camera).available).toBe(false);
    expect(r.transport.commands).toHaveLength(0);
  });
  it("rejects one command ID used concurrently for different component controls", async () => {
    const r = await setup(),
      nav = await r.engine.start(request(r.clock, navigation)),
      cam = await r.engine.start(request(r.clock));
    await r.pulse();
    const results = await Promise.allSettled([
      r.engine.control("cancel", identity(nav, "shared-id")),
      r.engine.control("cancel", identity(cam, "shared-id")),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.status === "rejected" && String(rejected.reason)).toContain(
      "COMMAND_ID_CONFLICT",
    );
    expect(r.transport.commands.filter((c) => c.action === "stop")).toHaveLength(0);
  });
  it("does not complete or control a matching native ID reported with another task type", async () => {
    const r = await setup(),
      e = await r.engine.start(request(r.clock, area));
    await r.pulse();
    const native = (await r.repository.get(e.taskId))?.zmqControl.nativeTaskId ?? "";
    const original = task(native, "completed");
    const report = {
      ...original,
      task: {
        ...original.task,
        task_type: "CircularSearch",
        coverage_ratio: null,
        coverage_complete: null,
        completed_cycles: 1,
        total_cycles: 1,
      },
    };
    await r.eo("task_status", report);
    expect(await r.repository.get(e.taskId)).toMatchObject({
      state: "TECHNICAL_FAILED",
      reasonCode: "ZMQ_NATIVE_TASK_IDENTITY_CONFLICT",
      zmqControl: { occupancy: "held" },
    });
    expect(r.transport.commands.some((c) => c.action === "start")).toBe(false);
  });
});

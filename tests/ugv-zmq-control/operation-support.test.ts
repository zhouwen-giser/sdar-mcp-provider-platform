import { afterEach, describe, expect, it } from "vitest";
import {
  ControlSettings,
  operationAdmissionKey,
  operationSupport,
  Operation,
  isZmqExecution,
} from "../../packages/vehicle-zmq-control/src/index.js";
import { camera, request, rig, testScope } from "./helpers.js";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});
const supported = {
  status: "supported" as const,
  description: "isolated test support",
  evidenceRef: "SIMULATED:test-case",
};
const unsupported = {
  status: "unsupported" as const,
  description: "当前仿真镜头没有光学停止反馈",
  reasonCode: "ZMQ_OPTICAL_ZOOM_UNSUPPORTED",
};
const zoom = { name: "camera.zoom" as const, params: { zoom_ratio: 2, zoom_timeout_ms: 1000 } };
async function setup() {
  const r = await rig();
  cleanup.push(() => r.engine.close());
  return r;
}

describe("operation-specific admission", () => {
  it("treats missing site support as unverified and requires evidence for configured support", () => {
    const settings = ControlSettings.parse({ ...testScope().settings, mode: "site_control" });
    expect(operationSupport(settings, "camera.zoom")).toMatchObject({
      status: "unverified",
      available: false,
      reasonCode: "ZMQ_OPERATION_UNVERIFIED",
    });
    expect(() =>
      ControlSettings.parse({
        ...settings,
        operationSupport: {
          "camera.zoom": { status: "supported", description: "unsupported assertion" },
        },
      }),
    ).toThrow("SUPPORT_EVIDENCE_REQUIRED");
    expect(() =>
      ControlSettings.parse({ ...settings, operationSupport: { "unknown.method": supported } }),
    ).toThrow();
  });
  it("rejects only the unsupported zoom at availability and direct call, retaining position support", async () => {
    const r = await setup();
    r.scope.settings.operationSupport = {
      "camera.zoom": unsupported,
      "camera.position": supported,
    };
    expect(r.engine.availability(zoom)).toMatchObject({
      available: false,
      reasonCode: "ZMQ_OPTICAL_ZOOM_UNSUPPORTED",
    });
    expect(r.engine.availability(camera).available).toBe(true);
    await expect(r.engine.start(request(r.clock, zoom))).rejects.toThrow(
      "ZMQ_OPTICAL_ZOOM_UNSUPPORTED",
    );
    expect(r.transport.commands).toHaveLength(0);
  });
  it("separates sector/full-circle and observed/manual effect support", () => {
    const settings = {
      ...testScope().settings,
      operationSupport: {
        "recon.sector": supported,
        "recon.circular": { ...unsupported, reasonCode: "ZMQ_FULL_CIRCLE_UNSUPPORTED" },
        "simulation.applyEffect.manual": supported,
        "simulation.applyEffect.observation": {
          status: "unverified" as const,
          description: "缺少定位观测",
        },
      },
    };
    const scan = Operation.parse({
      name: "recon.circular",
      params: {
        scan_mode: "sector",
        yaw_center_rad: 0,
        yaw_span_rad: 1,
        pitch_rad: 0,
        yaw_speed_rad_s: 0.1,
        cycle_count: 1,
        task_timeout_ms: 1000,
        search_strategy: "recognize",
      },
    });
    expect(operationAdmissionKey(scan)).toBe("recon.sector");
    expect(operationSupport(settings, "recon.sector").available).toBe(true);
    expect(operationSupport(settings, "recon.circular").available).toBe(false);
    expect(operationSupport(settings, "simulation.applyEffect.manual").available).toBe(true);
    expect(operationSupport(settings, "simulation.applyEffect.observation").available).toBe(false);
  });
  it("rechecks revoked support at delayed start and sends no command", async () => {
    const r = await setup();
    r.scope.settings.operationSupport = { "camera.position": supported };
    const input = request(r.clock);
    input.timing.startAt = new Date(r.clock.utc + 1000).toISOString();
    const created = await r.engine.start(input);
    r.scope.settings.operationSupport["camera.position"] = {
      ...unsupported,
      reasonCode: "ZMQ_OPERATION_REVOKED",
    };
    r.clock.advance(1001);
    await r.pulse();
    const saved = await r.repository.get(created.taskId);
    expect(saved).toMatchObject({
      reasonCode: "ZMQ_OPERATION_REVOKED",
      zmqControl: { occupancy: "released" },
    });
    expect(r.transport.commands).toHaveLength(0);
  });
  it("persists timeout stage facts without retrying the attempted command", async () => {
    const r = await setup();
    r.transport.dispatch = async (command, permit) => {
      permit();
      r.transport.commands.push(structuredClone(command));
      return {
        outcome: "uncertain",
        response: null,
        diagnostic: {
          schemaVersion: "ugv.zmq-command-diagnostic/1",
          stage: "receive",
          code: "ZMQ_RECEIVE_TIMEOUT",
          elapsedMs: 2001,
          sendTimeoutMs: 1000,
          receiveTimeoutMs: 2000,
          sendAttempted: true,
          sendCompleted: true,
          sendCompletedAfterMs: 3,
          receiveCompletedAfterMs: null,
          nativeErrorCode: "EAGAIN",
          validationCode: null,
          response: null,
        },
      };
    };
    const e = await r.engine.start(request(r.clock));
    await r.pulse();
    await r.pulse();
    const saved = await r.repository.store.getExecution(e.taskId);
    if (!isZmqExecution(saved)) throw Error("EXPECTED_ZMQ_EXECUTION");
    expect(saved.zmqControl.commands[0]?.diagnostic).toMatchObject({
      stage: "receive",
      code: "ZMQ_RECEIVE_TIMEOUT",
      sendCompleted: true,
    });
    expect(r.transport.commands.filter((c) => c.action === "camera")).toHaveLength(1);
  });
  it("keeps unknown send facts when a transport wrapper fails, without leaking exception text or replay", async () => {
    const r = await setup();
    let attempts = 0;
    r.transport.dispatch = async () => {
      attempts++;
      throw Error("PRIVATE_TRANSPORT_EXCEPTION");
    };
    const e = await r.engine.start(request(r.clock));
    await r.pulse();
    await r.pulse();
    const saved = await r.repository.get(e.taskId);
    expect(saved?.zmqControl.commands[0]?.diagnostic).toMatchObject({
      stage: "dispatch",
      code: "ZMQ_DISPATCH_FAILED",
      sendAttempted: null,
      sendCompleted: null,
    });
    expect(attempts).toBe(1);
    expect(JSON.stringify(saved)).not.toContain("PRIVATE_TRANSPORT_EXCEPTION");
  });
  it("finishes a proven pre-send guard revocation without an unaddressed stop", async () => {
    const r = await setup();
    r.transport.dispatch = async () => ({
      outcome: "uncertain",
      response: null,
      diagnostic: {
        schemaVersion: "ugv.zmq-command-diagnostic/1",
        stage: "guard",
        code: "ZMQ_DISPATCH_REVOKED",
        elapsedMs: 1,
        sendTimeoutMs: 1000,
        receiveTimeoutMs: 2000,
        sendAttempted: false,
        sendCompleted: false,
        sendCompletedAfterMs: null,
        receiveCompletedAfterMs: null,
        nativeErrorCode: "ZMQ_OPERATION_REVOKED",
        validationCode: null,
        response: null,
      },
    });
    const e = await r.engine.start(request(r.clock));
    await r.pulse();
    const saved = await r.repository.get(e.taskId);
    expect(saved).toMatchObject({
      state: "BUSINESS_FAILED",
      reasonCode: "ZMQ_OPERATION_REVOKED",
      zmqControl: { occupancy: "released" },
    });
    expect(saved?.zmqControl.commands.map((c) => [c.action, c.status])).toEqual([
      ["camera", "superseded"],
    ]);
  });
});

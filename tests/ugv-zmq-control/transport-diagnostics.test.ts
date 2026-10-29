import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Reply } from "zeromq";
import { afterEach, describe, expect, it } from "vitest";
import {
  ControlSettings,
  NativeControlTransport,
  controlScope,
  exchangeTimeouts,
  type WireCommand,
} from "../../packages/vehicle-zmq-control/src/index.js";
import { testScope } from "./helpers.js";

const close: (() => void)[] = [];
afterEach(() => {
  for (const fn of close.splice(0).reverse()) fn();
});
function command(): WireCommand {
  const requestId = "test-" + randomUUID();
  return {
    stepId: randomUUID(),
    generation: 1,
    component: "eo",
    action: "camera",
    requestId,
    method: "TeleControl",
    status: "intent",
    createdAt: new Date().toISOString(),
    dispatchAt: null,
    completedAt: null,
    response: null,
    frames: [
      Buffer.from(
        JSON.stringify({
          protocol: "2.2",
          kind: "request",
          device_id: "SIMULATED-EO",
          request_id: requestId,
          method: "TeleControl",
          params: { action: "position", yaw_rad: 0, pitch_rad: 0, move_timeout_ms: 1000 },
        }),
      ).toString("base64"),
    ],
  };
}
function response(c: WireCommand) {
  return {
    protocol: "2.2",
    kind: "response",
    device_id: "SIMULATED-EO",
    response_id: c.requestId,
    method: "TeleControl",
    ok: true,
    error: null,
    command: {
      request_id: c.requestId,
      method: "TeleControl",
      state: "accepted",
      task_id: null,
      reason: null,
    },
  };
}
async function setup(sendMs = 500, receiveMs = 2000) {
  const rep = new Reply({ linger: 0, sendTimeout: 1000, receiveTimeout: 3000 });
  await rep.bind("tcp://127.0.0.1:*");
  close.push(() => rep.close());
  const base = testScope();
  base.profile.components.eo.deviceId = "SIMULATED-EO";
  base.profile.components.eo.commandEndpoint = rep.lastEndpoint ?? "";
  const scope = controlScope(base.profile, {
    ...base.settings,
    transportSendTimeoutMs: sendMs,
    transportReceiveTimeoutMs: receiveMs,
  });
  const transport = new NativeControlTransport(scope);
  close.push(() => transport.close());
  return { rep, transport, scope };
}
describe("native bounded exchanges and safe diagnostics", () => {
  it("defaults site send/receive separately and preserves explicit legacy and split overrides", () => {
    const settings = ControlSettings.parse({ ...testScope().settings, mode: "site_control" });
    expect(exchangeTimeouts(settings)).toEqual({ sendMs: 1000, receiveMs: 2000 });
    expect(exchangeTimeouts({ ...settings, mode: "isolated_simulator" })).toEqual({
      sendMs: 250,
      receiveMs: 250,
    });
    expect(exchangeTimeouts({ ...settings, transportTimeoutMs: 100 })).toEqual({
      sendMs: 100,
      receiveMs: 100,
    });
    expect(
      exchangeTimeouts({
        ...settings,
        transportTimeoutMs: 100,
        transportSendTimeoutMs: 500,
        transportReceiveTimeoutMs: 2000,
      }),
    ).toEqual({ sendMs: 500, receiveMs: 2000 });
  });
  it("accepts a real reply later than 1 second within the explicit 2-second receive bound, once", async () => {
    const { rep, transport } = await setup();
    const c = command();
    let requests = 0;
    const server = (async () => {
      await rep.receive();
      requests++;
      await delay(1300);
      await rep.send(JSON.stringify(response(c)));
    })();
    const result = await transport.dispatch(c, () => undefined);
    await server;
    expect(result.outcome).toBe("accepted");
    expect(requests).toBe(1);
    expect(result.diagnostic).toMatchObject({
      stage: "complete",
      code: "ZMQ_REQUEST_ACCEPTED",
      sendAttempted: true,
      sendCompleted: true,
      receiveTimeoutMs: 2000,
    });
    expect(result.diagnostic?.elapsedMs).toBeGreaterThanOrEqual(1200);
  });
  it("records receive timeout and recovers a new socket for a distinct command without replay", async () => {
    const { rep, transport, scope } = await setup(500, 100);
    const first = command(),
      second = command();
    const ids: string[] = [];
    const server = (async () => {
      for (const [c, wait] of [
        [first, 220],
        [second, 0],
      ] as const) {
        const [frame] = await rep.receive();
        const value = JSON.parse(frame?.toString() ?? "null") as { request_id: string };
        ids.push(value.request_id);
        await delay(wait);
        await rep.send(JSON.stringify(response(c)));
      }
    })();
    const firstResult = await transport.dispatch(first, () => undefined);
    expect(firstResult).toMatchObject({
      outcome: "uncertain",
      response: null,
      diagnostic: {
        stage: "receive",
        code: "ZMQ_RECEIVE_TIMEOUT",
        nativeErrorCode: "EAGAIN",
        sendCompleted: true,
        response: null,
      },
    });
    scope.settings.transportReceiveTimeoutMs = 1000;
    // Transport copies its validated scope; this test explicitly adjusts that instance's bound.
    transport.scope.settings.transportReceiveTimeoutMs = 1000;
    const secondResult = await transport.dispatch(second, () => undefined);
    await server;
    expect(secondResult.outcome).toBe("accepted");
    expect(ids).toEqual([first.requestId, second.requestId]);
  });
  it("distinguishes a disconnected sender from a receive timeout", async () => {
    const { rep, transport } = await setup(100, 1000);
    rep.close();
    const result = await transport.dispatch(command(), () => undefined);
    expect(result).toMatchObject({
      outcome: "uncertain",
      diagnostic: {
        stage: "send",
        code: "ZMQ_SEND_TIMEOUT",
        sendCompleted: false,
        receiveCompletedAfterMs: null,
      },
    });
  });
  it.each(["malformed", "wrong_request", "wrong_device", "multipart"] as const)(
    "retains bounded response hashes and the validation stage for %s",
    async (kind) => {
      const { rep, transport } = await setup();
      const c = command();
      const reply = response(c);
      const server = (async () => {
        await rep.receive();
        if (kind === "malformed") await rep.send('{"password":"PRIVATE_REJECTION_BODY"');
        else if (kind === "multipart")
          await rep.send([JSON.stringify(reply), "PRIVATE_REJECTION_BODY"]);
        else
          await rep.send(
            JSON.stringify({
              ...reply,
              ...(kind === "wrong_request" ? { response_id: "OTHER" } : { device_id: "OTHER" }),
            }),
          );
      })();
      const result = await transport.dispatch(c, () => undefined);
      await server;
      expect(result).toMatchObject({
        outcome: "uncertain",
        response: null,
        diagnostic: { stage: "validate", code: "ZMQ_RESPONSE_INVALID", sendCompleted: true },
      });
      expect(result.diagnostic?.response?.bytes).toBeGreaterThan(0);
      expect(result.diagnostic?.response?.frameSha256[0]).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(result)).not.toContain("PRIVATE_REJECTION_BODY");
      expect(result.diagnostic?.validationCode).toMatch(/^ZMQ_/);
    },
  );
  it("preserves explicit rejection and its native cause", async () => {
    const { rep, transport } = await setup();
    const c = command();
    const server = (async () => {
      await rep.receive();
      await rep.send(
        JSON.stringify({
          ...response(c),
          ok: false,
          command: null,
          error: { code: "UNSUPPORTED", message: "simulated lens has no stop feedback" },
        }),
      );
    })();
    const result = await transport.dispatch(c, () => undefined);
    await server;
    expect(result).toMatchObject({
      outcome: "rejected",
      response: { error: { code: "UNSUPPORTED" } },
      diagnostic: { stage: "complete", code: "ZMQ_REQUEST_REJECTED" },
    });
  });
  it("records guard revocation before socket.send and sends no request", async () => {
    const { rep, transport } = await setup();
    rep.receiveTimeout = 50;
    const result = await transport.dispatch(command(), () => {
      throw Error("ZMQ_OPERATION_UNSUPPORTED");
    });
    expect(result).toMatchObject({
      outcome: "uncertain",
      diagnostic: {
        stage: "guard",
        code: "ZMQ_DISPATCH_REVOKED",
        nativeErrorCode: "ZMQ_OPERATION_UNSUPPORTED",
        sendAttempted: false,
        sendCompleted: false,
      },
    });
    await expect(rep.receive()).rejects.toMatchObject({ code: "EAGAIN" });
  });
});

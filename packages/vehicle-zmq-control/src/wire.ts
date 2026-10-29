import { randomUUID } from "node:crypto";
import {
  EoRequest,
  SimulationEffectRequest,
  encodeChassisFrame,
} from "../../vehicle-zmq-contract/src/index.js";
import type { ControlScope, Operation, WireCommand, ZmqExecution } from "./model.js";
import { ViewRequest, VIEW_PROTOCOL } from "./simulation-view-contract.js";

const integer = (value: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32LE(value);
  return b;
};
const modeFor = (operation: Operation["name"]) =>
  operation === "navigation.point" ? 3 : operation === "navigation.route" ? 1 : 4;
export { modeFor };
export function commandFor(
  execution: ZmqExecution,
  action: WireCommand["action"],
  scope: ControlScope,
  at: string,
): WireCommand {
  const operation = execution.arguments.operation as Operation,
    state = execution.zmqControl;
  let frames: Buffer[],
    method: string,
    requestId: string | null = null;
  const remaining = Math.max(0, Date.parse(state.deadlineAt ?? at) - Date.parse(at));
  if (operation.name === "camera.simulationView") {
    const backend = scope.settings.simulationView;
    if (action !== "camera" || !backend) throw Error("ZMQ_VIEW_COMMAND_UNSUPPORTED");
    method = "SimulationView";
    requestId = `req-${randomUUID()}`;
    const request = ViewRequest.parse({
      protocol: VIEW_PROTOCOL,
      requestId,
      resourceId: execution.resourceId,
      ownershipId: backend.ownershipId,
      expectedApiVersion: backend.apiVersion,
      expectedWorldId: backend.worldId,
      parentActorId: backend.parentActorId,
      parentRoleName: backend.parentRoleName,
      deadlineAt: state.deadlineAt,
      parameters: operation.params,
    });
    frames = [Buffer.from(JSON.stringify(request))];
  } else if (state.component === "chassis") {
    const binding = scope.profile.components.chassis;
    if (binding.controllerSystemId === null) throw Error("ZMQ_CHASSIS_CONTROL_SENDER_UNSPECIFIED");
    if (binding.systemId === null) throw Error("ZMQ_CHASSIS_SYSTEM_ID_UNBOUND");
    let messageId: number,
      payload: Buffer,
      topic: "ad_remote_command" | "call_task" = "ad_remote_command";
    if (action === "mode") {
      messageId = 1;
      payload = integer(modeFor(operation.name));
    } else if (action === "speed" && "speedLimitMps" in operation.params) {
      messageId = 3;
      payload = Buffer.alloc(4);
      payload.writeFloatLE(operation.params.speedLimitMps);
    } else if (action === "obstacle" && "obstacleAvoidance" in operation.params) {
      messageId = 4;
      payload = Buffer.from([operation.params.obstacleAvoidance ? 1 : 0]);
    } else if (action === "configure" && operation.name.startsWith("navigation.")) {
      topic = "call_task";
      const points =
        operation.name === "navigation.point"
          ? [operation.params.destination]
          : "waypoints" in operation.params
            ? operation.params.waypoints
            : [];
      messageId =
        operation.name === "navigation.point"
          ? 0x0a
          : operation.name === "navigation.route"
            ? 0x0b
            : 0x0d;
      const prefix = messageId === 0x0d ? 9 : 8;
      payload = Buffer.alloc(prefix + points.length * 29);
      payload.writeUInt32LE(Number(state.nativeTaskId), 0);
      if (operation.name === "navigation.returnHome")
        payload.writeUInt8(operation.params.returnType, 4);
      payload.writeUInt32LE(points.length, prefix - 4);
      points.forEach((p, i) => {
        const offset = prefix + i * 29;
        payload.writeDoubleLE(p.latitude, offset);
        payload.writeDoubleLE(p.longitude, offset + 8);
        payload.writeDoubleLE(0, offset + 16);
        payload.writeUInt8(2, offset + 24);
        payload.writeUInt32LE(0, offset + 25);
      });
    } else {
      const value = { start: 1, pause: 2, resume: 3, stop: 4 }[
        action as "start" | "pause" | "resume" | "stop"
      ];
      if (!value) throw Error("ZMQ_CONTROL_COMMAND_INVALID");
      messageId = 2;
      payload = integer(value);
    }
    frames = [
      encodeChassisFrame({
        topic,
        messageId,
        systemId: binding.controllerSystemId,
        targetSystemId: binding.systemId,
        payload,
      }),
    ];
    method = `chassis.${action}`;
  } else if (
    state.component === "simulationEffect" &&
    operation.name === "simulation.applyEffect" &&
    action === "effect"
  ) {
    requestId = `req-${randomUUID()}`;
    method = "AttackTarget";
    const request = SimulationEffectRequest.parse({
      protocol: "1.0",
      kind: "request",
      device_id: scope.profile.components.simulationEffect.deviceId,
      request_id: requestId,
      method,
      params: { target_id: operation.params.targetId, position: operation.params.position },
    });
    frames = [Buffer.from(JSON.stringify(request))];
  } else {
    requestId = `req-${randomUUID()}`;
    let params: unknown;
    if (
      action === "configure" &&
      (operation.name === "recon.area" ||
        operation.name === "inspection.area" ||
        operation.name === "recon.circular")
    ) {
      if (remaining < 1000) throw Error("ZMQ_EXECUTION_BUDGET_EXHAUSTED");
      method = operation.name === "recon.circular" ? "CircularSearch" : "AreaSearch";
      params = {
        ...operation.params,
        task_timeout_ms: Math.min(
          Number((operation.params as Record<string, unknown>).task_timeout_ms),
          remaining,
        ),
      };
    } else if (action === "camera" && operation.name.startsWith("camera.")) {
      method = "TeleControl";
      const cameraAction = operation.name.slice("camera.".length);
      const timeoutField =
        cameraAction === "position"
          ? "move_timeout_ms"
          : cameraAction === "zoom"
            ? "zoom_timeout_ms"
            : "hold_ms";
      const requested = Number((operation.params as Record<string, unknown>)[timeoutField]);
      if (remaining < 100) throw Error("ZMQ_EXECUTION_BUDGET_EXHAUSTED");
      params = {
        ...operation.params,
        action: cameraAction,
        [timeoutField]: Math.min(requested, remaining),
      };
    } else if (action === "stop" && operation.name.startsWith("camera.")) {
      method = "TeleControl";
      params = { action: "stop" };
    } else if (
      ["start", "pause", "resume", "stop"].includes(action) &&
      state.nativeTaskId !== null
    ) {
      method = "TaskControl";
      params = { task_id: state.nativeTaskId, action };
    } else throw Error("ZMQ_CONTROL_NATIVE_TASK_UNKNOWN");
    const request = EoRequest.parse({
      protocol: "2.2",
      kind: "request",
      device_id: scope.profile.components.eo.deviceId,
      request_id: requestId,
      method,
      params,
    });
    frames = [Buffer.from(JSON.stringify(request))];
  }
  return {
    stepId: `zmq-${action}-${randomUUID()}`,
    generation: state.generation,
    component: state.component,
    action,
    requestId,
    method,
    frames: frames.map((f) => f.toString("base64")),
    status: "intent",
    createdAt: at,
    dispatchAt: null,
    completedAt: null,
    response: null,
  };
}

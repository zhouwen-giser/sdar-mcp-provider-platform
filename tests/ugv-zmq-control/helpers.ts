import { randomUUID } from "node:crypto";
import { MemoryProviderStore } from "../../packages/provider-adapter-kit/src/memory-store.js";
import {
  DeploymentProfile,
  encodeChassisFrame,
  EoRequest,
} from "../../packages/vehicle-zmq-contract/src/index.js";
import {
  ObservationNormalizer,
  canonical,
  sha256,
} from "../../packages/vehicle-zmq-observer/src/index.js";
import {
  ZmqControlEngine,
  controlScope,
  type ControlRepository,
  type ControlScope,
  type ControlClock,
  type DispatchResult,
  type CommandTransport,
  type WireCommand,
  type ZmqExecution,
  type StartControl,
  type Operation,
} from "../../packages/vehicle-zmq-control/src/index.js";
import { profile, settings, eoFrames, localization } from "../ugv-zmq-observer/helpers.js";

export class TestClock implements ControlClock {
  utc = 1792800000000;
  mono = 1000;
  utcMs() {
    return this.utc;
  }
  monotonicMs() {
    return this.mono;
  }
  advance(ms: number) {
    this.utc += ms;
    this.mono += ms;
  }
}
export function testScope() {
  const p = profile();
  p.providerBinding = {
    providerId: "SIMULATED-provider",
    resourceId: "vehicle:SIMULATED",
    sourceSessionKey: "SIMULATED-source",
  };
  p.executionDomain.simulationId = "SIMULATED-run";
  p.components.chassis.controllerSystemId = "18446744073709551614";
  let port = 20001;
  for (const c of Object.values(p.components)) {
    c.commandEndpoint = `tcp://127.0.0.1:${port++}`;
    c.publicationEndpoint = `tcp://127.0.0.1:${port++}`;
  }
  return controlScope(DeploymentProfile.parse(p), {
    mode: "isolated_simulator",
    contractSha256: "c".repeat(64),
    observerPartitionHash: "a".repeat(64),
    observerSessionId: randomUUID(),
    maxSpeedMps: 3,
    maxYawRateRadS: 1,
    maxPitchRateRadS: 1,
    minYawRad: -2,
    maxYawRad: 2,
    minPitchRad: -1,
    maxPitchRad: 1,
    minZoom: 1,
    maxZoom: 10,
  });
}
export class TestRepository implements ControlRepository {
  store = new MemoryProviderStore();
  records = new Map<string, ZmqExecution>();
  writer = true;
  constructor(readonly scope: ControlScope) {}
  async start() {
    await this.assertWriter();
  }
  async assertWriter() {
    if (!this.writer) throw Error("ZMQ_CONTROL_WRITER_LOST");
  }
  async get(taskId: string) {
    return structuredClone(this.records.get(taskId));
  }
  async findCommand(commandId: string) {
    return structuredClone(
      [...this.records.values()].find(
        (e) =>
          e.zmqControl.commandId === commandId ||
          e.zmqControl.controls.some((c) => c.commandId === commandId),
      ),
    );
  }
  async pending() {
    return structuredClone(
      [...this.records.values()].filter((e) => e.zmqControl.occupancy === "held"),
    );
  }
  async nativeTaskUsed(component: string, nativeTaskId: string, exceptTaskId: string) {
    return [...this.records.values()].some(
      (e) =>
        e.taskId !== exceptTaskId &&
        e.zmqControl.component === component &&
        e.zmqControl.nativeTaskId === nativeTaskId,
    );
  }
  async save(e: ZmqExecution) {
    await this.assertWriter();
    this.records.set(e.taskId, structuredClone(e));
    await this.store.putExecution(e);
  }
  close() {
    return Promise.resolve();
  }
}
export class TestTransport implements CommandTransport {
  commands: WireCommand[] = [];
  outcome: DispatchResult["outcome"] | null = null;
  taskNumber = 0;
  before: ((command: WireCommand) => Promise<void>) | undefined;
  async dispatch(command: WireCommand, permit: () => void): Promise<DispatchResult> {
    await this.before?.(command);
    permit();
    this.commands.push(structuredClone(command));
    if (this.outcome) return { outcome: this.outcome, response: null };
    if (command.component === "chassis") return { outcome: "sent_unconfirmed", response: null };
    const request = EoRequest.parse(
      JSON.parse(Buffer.from(command.frames[0] ?? "", "base64").toString()) as unknown,
    );
    const taskId =
      request.method === "TeleControl"
        ? null
        : request.method === "TaskControl"
          ? request.params.task_id
          : `native-${++this.taskNumber}`;
    return {
      outcome: "accepted",
      response: {
        protocol: "2.2",
        kind: "response",
        device_id: request.device_id,
        response_id: request.request_id,
        method: request.method,
        ok: true,
        command: {
          request_id: request.request_id,
          method: request.method,
          task_id: taskId,
          state: "accepted",
          reason: null,
        },
        error: null,
      },
    };
  }
  close() {
    this.outcome = "uncertain";
  }
}
export const navigation = {
  name: "navigation.point",
  params: {
    destination: { longitude: 106.81307318, latitude: 29.71952521 },
    speedLimitMps: 1,
    obstacleAvoidance: true,
  },
} satisfies Operation;
export const camera = {
  name: "camera.position",
  params: { yaw_rad: 0.5, pitch_rad: 0, move_timeout_ms: 2000 },
} satisfies Operation;
export const area = {
  name: "recon.area",
  params: {
    region_wgs84: [
      { longitude_deg: 106, latitude_deg: 29, ellipsoid_height_m: 10 },
      { longitude_deg: 106.001, latitude_deg: 29, ellipsoid_height_m: 10 },
      { longitude_deg: 106.001, latitude_deg: 29.001, ellipsoid_height_m: 10 },
      { longitude_deg: 106, latitude_deg: 29.001, ellipsoid_height_m: 10 },
    ],
    task_timeout_ms: 300000,
    search_strategy: "recognize",
  },
} satisfies Operation;
export function request(
  clock: TestClock,
  operation: Operation = camera,
  extra: Partial<StartControl> = {},
): StartControl {
  return {
    taskId: randomUUID(),
    commandId: randomUUID(),
    resourceId: "vehicle:SIMULATED",
    operation,
    executionContext: {
      authorizationContextHash: "d".repeat(64),
      executionMode: "simulation",
      simulationId: "SIMULATED-run",
      correlationId: randomUUID(),
    },
    timing: {
      startAt: new Date(clock.utc).toISOString(),
      startToleranceMs: 60000,
      maxElapsedMs: 300000,
      parentDeadlineAt: null,
    },
    ...extra,
  };
}
export function systemFrame(mode = 0) {
  const payload = Buffer.alloc(16);
  payload.writeUInt8(1);
  payload.writeUInt8(mode, 1);
  payload.writeFloatLE(1, 2);
  return [
    encodeChassisFrame({
      topic: "ipc_message",
      messageId: 0x10000001,
      systemId: "1",
      targetSystemId: "0",
      payload,
    }),
  ];
}
export function missionFrame(id: string, state: number, type = 1) {
  const payload = Buffer.alloc(7);
  payload.writeUInt32LE(Number(id));
  payload.writeUInt8(type, 4);
  payload.writeUInt8(state, 5);
  return [
    encodeChassisFrame({
      topic: "ipc_message",
      messageId: 0x10000000,
      systemId: "1",
      targetSystemId: "0",
      payload,
    }),
  ];
}
export function feedbackFrame(status = 0) {
  const payload = Buffer.alloc(5);
  payload.writeUInt8(status);
  return [
    encodeChassisFrame({
      topic: "ipc_message",
      messageId: 0x10000028,
      systemId: "1",
      targetSystemId: "0",
      payload,
    }),
  ];
}
export const device = (extra: Record<string, unknown> = {}) => ({
  mode: "idle",
  ready: true,
  data_origin: "simulated",
  camera_online: true,
  gimbal_online: true,
  navigation_valid: true,
  gimbal_yaw_rad: 0,
  gimbal_pitch_rad: 0,
  zoom_ratio: 1,
  active_task_id: null,
  telecontrol: null,
  fault_code: null,
  fault_message: null,
  ...extra,
});
export const task = (id: string, state: string, command: WireCommand | null = null) => ({
  task: {
    task_id: id,
    task_type: "AreaSearch",
    state,
    remaining_ms: ["completed", "failed", "canceled"].includes(state) ? 0 : 50000,
    progress_ratio: state === "completed" ? 1 : 0.2,
    coverage_ratio: null,
    coverage_complete: null,
    completed_cycles: null,
    total_cycles: null,
    reason: null,
  },
  command: command
    ? {
        request_id: command.requestId,
        method: command.method,
        task_id: id,
        state: "accepted",
        reason: null,
      }
    : null,
});
export async function rig() {
  const scope = testScope(),
    clock = new TestClock(),
    repository = new TestRepository(scope),
    transport = new TestTransport();
  const engine = new ZmqControlEngine(scope, repository, transport, clock);
  await engine.initialize();
  const normalizer = new ObservationNormalizer(scope.profile, settings()),
    sessionId = scope.settings.observerSessionId;
  let ordinal = 0;
  const receive = async (component: "eo" | "chassis", frames: Buffer[]) => {
    const receipt = normalizer.receive(component, frames, {
      receivedAt: new Date(clock.utc).toISOString(),
      monotonicNs: String(clock.mono * 1000000),
      clockId: "SIMULATED-clock",
    });
    if (!receipt.valid || !receipt.projectable)
      throw Error(`BAD_TEST_FRAME:${receipt.validationCode}:${receipt.diagnostics.join(",")}`);
    engine.observe(receipt, {
      partitionHash: scope.settings.observerPartitionHash,
      sessionId,
      ordinal: String(++ordinal),
      entryHash: sha256(canonical(receipt)),
    });
    await engine.idle();
  };
  const eo = async (topic: string, data: unknown) => {
    clock.advance(1);
    await receive("eo", eoFrames(topic, data, clock.utc));
  };
  const seed = async () => {
    await receive("chassis", systemFrame());
    await eo("device_status", device());
  };
  const pulse = async () => {
    engine.pulse();
    await engine.idle();
  };
  await seed();
  return {
    scope,
    clock,
    repository,
    transport,
    engine,
    normalizer,
    receive,
    eo,
    seed,
    pulse,
    localization,
  };
}
export const identity = (e: ZmqExecution, commandId: string = randomUUID()) => ({
  taskId: e.taskId,
  externalExecutionId: e.externalExecutionId,
  commandId,
  executionContext: e.executionContext,
});

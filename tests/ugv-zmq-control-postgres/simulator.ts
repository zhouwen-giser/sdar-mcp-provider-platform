import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Publisher, Reply, Subscriber } from "zeromq";
import {
  decodeChassisFrame,
  encodeChassisFrame,
  EoRequest,
  type DeploymentProfile,
} from "../../packages/vehicle-zmq-contract/src/index.js";
import {
  device,
  feedbackFrame,
  missionFrame,
  systemFrame,
  task,
  testScope,
} from "../ugv-zmq-control/helpers.js";
import { eoFrames, localization } from "../ugv-zmq-observer/helpers.js";
const reservedSockets: (Subscriber | Publisher | Reply)[] = [];
export function releaseSimulatorEndpoints() {
  for (const socket of reservedSockets.splice(0)) socket.close();
}

/** Loopback wire simulator. Accelerated 20Hz snapshots are test inputs, not provider qualification. */
export class SimulatedZmqDevices {
  readonly chassisCommands = new Subscriber({
    receiveTimeout: 100,
    linger: 0,
    receiveHighWaterMark: 128,
  });
  readonly chassisPub = new Publisher({ linger: 0 });
  readonly eoRep = new Reply({ receiveTimeout: 100, sendTimeout: 100, linger: 0 });
  readonly eoPub = new Publisher({ linger: 0 });
  readonly effectRep = new Reply({ linger: 0 });
  readonly effectPub = new Publisher({ linger: 0 });
  readonly commands: { component: string; at: number; request: Record<string, unknown> }[] = [];
  readonly seen = new Map<string, Record<string, unknown>>();
  readonly errors: unknown[] = [];
  mode = 0;
  missionId: string | null = null;
  missionType = 1;
  missionState = 0;
  moving = false;
  taskId: string | null = null;
  taskState = "ready";
  taskType = "AreaSearch";
  cycles = 1;
  eoDevice: Record<string, unknown> = device();
  eoCommand: Record<string, unknown> | null = null;
  emitMode = true;
  emitFeedback = true;
  stopConfirmed = true;
  completeCamera = true;
  replyDelayMs = 0;
  #stopped = false;
  #timers: ReturnType<typeof setInterval>[] = [];
  #tasks: Promise<void>[] = [];
  #lastUtc = 0;
  #positionSequence = 0n;
  async start(): Promise<DeploymentProfile> {
    const sockets = [
      this.chassisCommands,
      this.chassisPub,
      this.eoRep,
      this.eoPub,
      this.effectRep,
      this.effectPub,
    ];
    for (const socket of sockets) await socket.bind("tcp://127.0.0.1:*");
    this.chassisCommands.subscribe();
    const profile = testScope().profile;
    profile.components.chassis.commandEndpoint = this.chassisCommands.lastEndpoint ?? "";
    profile.components.chassis.publicationEndpoint = this.chassisPub.lastEndpoint ?? "";
    profile.components.eo.commandEndpoint = this.eoRep.lastEndpoint ?? "";
    profile.components.eo.publicationEndpoint = this.eoPub.lastEndpoint ?? "";
    profile.components.simulationEffect.commandEndpoint = this.effectRep.lastEndpoint ?? "";
    profile.components.simulationEffect.publicationEndpoint = this.effectPub.lastEndpoint ?? "";
    this.#tasks.push(this.chassisLoop(), this.eoLoop());
    this.#timers.push(
      setInterval(() => {
        void this.publish().catch((e: unknown) => this.errors.push(e));
      }, 50),
    );
    this.#timers.push(
      setInterval(() => {
        void this.position().catch((e: unknown) => this.errors.push(e));
      }, 10),
    );
    return profile;
  }
  private async chassisLoop() {
    while (!this.#stopped) {
      try {
        const frames = await this.chassisCommands.receive();
        if (!frames[0]) continue;
        const parsed = decodeChassisFrame(frames[0], {
          systemId: "18446744073709551614",
          targetSystemId: "1",
        });
        const r = parsed.body;
        this.commands.push({ component: "chassis", at: Date.now(), request: r });
        if (r.type === "mode") {
          if (this.emitMode) this.mode = Number(r.value);
        } else if (["targetPoint", "pathFollow", "returnHome"].includes(String(r.type))) {
          this.missionId = String(r.missionId);
          this.missionType = r.type === "targetPoint" ? 1 : r.type === "pathFollow" ? 2 : 4;
          this.missionState = 0;
          if (this.emitFeedback) {
            await delay(30);
            await this.chassisPub.send(feedbackFrame());
          }
        } else if (r.type === "motionControl") {
          const control = Number(r.value);
          if (control === 1 || control === 3) {
            this.missionState = 1;
            this.moving = true;
          } else if (control === 2) {
            this.missionState = 2;
            this.moving = false;
          } else if (control === 4) {
            this.missionState = 3;
            this.moving = !this.stopConfirmed;
          }
        }
        await this.publish();
      } catch (error) {
        if (!this.#stopped && !again(error)) this.errors.push(error);
      }
    }
  }
  private async eoLoop() {
    while (!this.#stopped) {
      try {
        const frames = await this.eoRep.receive();
        if (!frames[0]) continue;
        const r = EoRequest.parse(JSON.parse(frames[0].toString()) as unknown);
        this.commands.push({ component: "eo", at: Date.now(), request: r });
        let response = this.seen.get(r.request_id);
        if (!response) {
          const t =
            r.method === "TeleControl"
              ? null
              : r.method === "TaskControl"
                ? r.params.task_id
                : `native-${randomUUID()}`;
          const command = {
            request_id: r.request_id,
            method: r.method,
            task_id: t,
            state: "accepted",
            reason: null,
          };
          response = {
            protocol: "2.2",
            kind: "response",
            device_id: r.device_id,
            response_id: r.request_id,
            method: r.method,
            ok: true,
            command,
            error: null,
          };
          this.seen.set(r.request_id, response);
          if (r.method === "AreaSearch" || r.method === "CircularSearch") {
            this.taskId = t;
            this.taskType = r.method;
            this.cycles = r.method === "CircularSearch" ? r.params.cycle_count : 1;
            this.taskState = "ready";
            this.eoCommand = command;
            this.eoDevice = device({ mode: "task", ready: false, active_task_id: t });
          } else if (r.method === "TaskControl") {
            this.eoCommand = command;
            this.taskState =
              r.params.action === "pause"
                ? "paused"
                : r.params.action === "stop"
                  ? "canceled"
                  : "searching";
            this.eoDevice =
              r.params.action === "stop"
                ? device({
                    mode: this.stopConfirmed ? "idle" : "stopping",
                    ready: this.stopConfirmed,
                  })
                : device({ mode: "task", ready: false, active_task_id: this.taskId });
          } else {
            const telecontrol = {
              action: r.params.action,
              state: r.params.action === "stop" && this.stopConfirmed ? "succeeded" : "running",
              remaining_ms: r.params.action === "stop" ? 0 : 100,
              command,
            };
            this.eoDevice = device({
              mode: r.params.action === "stop" && this.stopConfirmed ? "idle" : "telecontrol",
              ready: r.params.action === "stop" && this.stopConfirmed,
              telecontrol,
            });
            if (this.completeCamera && r.params.action !== "stop") {
              const taskPromise = (async () => {
                await delay(r.params.action === "velocity" ? r.params.hold_ms : 200);
                if (this.#stopped || this.eoDevice.telecontrol !== telecontrol) return;
                telecontrol.state = "succeeded";
                telecontrol.remaining_ms = 0;
                this.eoDevice = device({
                  telecontrol,
                  ...(r.params.action === "position"
                    ? { gimbal_yaw_rad: r.params.yaw_rad, gimbal_pitch_rad: r.params.pitch_rad }
                    : r.params.action === "zoom"
                      ? { zoom_ratio: r.params.zoom_ratio }
                      : {}),
                });
                await this.publish();
              })();
              this.#tasks.push(taskPromise);
            }
          }
          await this.publish();
        }
        if (this.replyDelayMs) await delay(this.replyDelayMs);
        await this.eoRep.send(JSON.stringify(response));
      } catch (error) {
        if (!this.#stopped && !again(error)) this.errors.push(error);
      }
    }
  }
  async publish() {
    if (this.#stopped) return;
    await this.chassisPub.send(systemFrame(this.mode));
    if (this.missionId)
      await this.chassisPub.send(missionFrame(this.missionId, this.missionState, this.missionType));
    const utc = Math.max(Date.now(), this.#lastUtc + 2);
    this.#lastUtc = utc;
    await this.eoPub.send(eoFrames("device_status", this.eoDevice, utc));
    const data: Record<string, unknown> = this.taskId
      ? task(this.taskId, this.taskState)
      : { task: null, command: null };
    if (this.taskId && data.task) {
      const currentTask = data.task as Record<string, unknown>;
      currentTask.task_type = this.taskType;
      data.command = this.eoCommand;
      if (this.taskType === "CircularSearch") {
        currentTask.completed_cycles = 0;
        currentTask.total_cycles = this.cycles;
      }
    }
    await this.eoPub.send(eoFrames("task_status", data, utc + 1));
  }
  async position() {
    if (this.#stopped) return;
    const frames = localization(++this.#positionSequence),
      original = frames[0] ?? Buffer.alloc(0),
      offset = original.indexOf(0x3a) + 1;
    const payload = Buffer.from(original.subarray(offset + 24));
    payload.writeDoubleLE(this.moving ? 0.5 : 0, 49);
    payload.writeDoubleLE(0, 57);
    payload.writeDoubleLE(0, 65);
    await this.chassisPub.send(
      encodeChassisFrame({
        topic: "ipc_message",
        messageId: 0x10000002,
        systemId: "1",
        targetSystemId: "0",
        payload,
      }),
    );
  }
  completeNavigation() {
    this.missionState = 4;
    this.moving = false;
  }
  completeRecon() {
    this.taskState = "completed";
    this.eoDevice = device();
  }
  async close() {
    this.#stopped = true;
    this.#timers.forEach(clearInterval);
    // Keep each test's endpoint reserved until the suite ends. Reusing a port
    // would correctly look like taking over a previous unresolved execution.
    reservedSockets.push(
      ...[
        this.chassisCommands,
        this.chassisPub,
        this.eoRep,
        this.eoPub,
        this.effectRep,
        this.effectPub,
      ],
    );
    await Promise.allSettled(this.#tasks);
  }
}
const again = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "EAGAIN";

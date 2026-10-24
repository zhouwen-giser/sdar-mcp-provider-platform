import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Publisher, Reply, Subscriber } from "zeromq";
import {
  decodeChassisFrame,
  encodeChassisFrame,
  EoRequest,
  SimulationEffectRequest,
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
  readonly effectRep = new Reply({ receiveTimeout: 100, sendTimeout: 100, linger: 0 });
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
  effectReplyDelayMs = 0;
  effectDelayMs = 100;
  effectPolicy: "geometry" | "fail" | "unknown" = "geometry";
  effectTask: Record<string, unknown> | null = null;
  effectDevice: Record<string, unknown> = {
    mode: "idle",
    ready: true,
    active_task_id: null,
    fault_code: null,
    fault_message: null,
  };
  readonly simulatedWorld = new Map([
    ["object-1", { longitude: 106.001, latitude: 29, health: 1, radiusM: 10 }],
  ]);
  #effectUtc = 0;
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
    this.#tasks.push(this.chassisLoop(), this.eoLoop(), this.effectLoop());
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
  private async effectLoop() {
    while (!this.#stopped) {
      try {
        const frames = await this.effectRep.receive();
        const r = SimulationEffectRequest.parse(
          JSON.parse(frames[0]?.toString() ?? "{}") as unknown,
        );
        this.commands.push({ component: "simulationEffect", at: Date.now(), request: r });
        let response = this.seen.get(r.request_id);
        if (!response) {
          const id = `effect-${randomUUID()}`;
          response = {
            protocol: "1.0",
            kind: "response",
            device_id: r.device_id,
            response_id: r.request_id,
            method: r.method,
            ok: true,
            error: null,
            command: {
              request_id: r.request_id,
              task_id: id,
              method: r.method,
              state: "accepted",
              reason: null,
            },
          };
          this.seen.set(r.request_id, response);
          const task = {
            task_id: id,
            request_id: r.request_id,
            ...r.params,
            state: "accepted",
            execution_finished: false,
            effect: "unknown",
            reason: null as string | null,
          };
          this.effectTask = task;
          this.effectDevice = {
            mode: "busy",
            ready: false,
            active_task_id: id,
            fault_code: null,
            fault_message: null,
          };
          const work = (async () => {
            task.state = "executing";
            await this.publishEffect();
            await delay(this.effectDelayMs);
            if (this.#stopped) return;
            if (this.effectPolicy === "unknown") {
              task.state = "unknown";
              task.reason = "SIMULATED_RESULT_PENDING";
            } else if (this.effectPolicy === "fail") {
              task.state = "failed";
              task.execution_finished = true;
              task.reason = "SIMULATED_REFEREE_FAILURE";
            } else {
              const entity = this.simulatedWorld.get(r.params.target_id);
              if (!entity || entity.health <= 0) {
                task.state = "failed";
                task.execution_finished = true;
                task.reason = "SIMULATED_ENTITY_UNAVAILABLE";
              } else {
                const radians = Math.PI / 180,
                  latA = entity.latitude * radians,
                  latB = r.params.position.latitude_deg * radians;
                const h =
                  Math.sin((latA - latB) / 2) ** 2 +
                  Math.cos(latA) *
                    Math.cos(latB) *
                    Math.sin(
                      ((entity.longitude - r.params.position.longitude_deg) * radians) / 2,
                    ) **
                      2;
                const distance = 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
                if (distance <= entity.radiusM) {
                  entity.health -= 0.6;
                  task.effect = entity.health <= 0 ? "destroyed" : "hit";
                } else task.effect = "miss";
                task.state = "succeeded";
                task.execution_finished = true;
              }
            }
            if (task.execution_finished)
              this.effectDevice = {
                mode: "idle",
                ready: true,
                active_task_id: null,
                fault_code: null,
                fault_message: null,
              };
            await this.publishEffect();
          })();
          this.#tasks.push(work);
        }
        if (this.effectReplyDelayMs) await delay(this.effectReplyDelayMs);
        await this.effectRep.send(JSON.stringify(response));
      } catch (error) {
        if (!this.#stopped && !again(error)) this.errors.push(error);
      }
    }
  }
  async publishEffect() {
    if (this.#stopped) return;
    const utc = Math.max(Date.now(), this.#effectUtc + 2);
    this.#effectUtc = utc;
    for (const [topic, data] of [
      ["device_status", this.effectDevice],
      ["task_status", { task: this.effectTask }],
    ] as const)
      await this.effectPub.send([
        Buffer.from(`artillery/artillery-01/${topic}`),
        Buffer.from(
          JSON.stringify({
            protocol: "1.0",
            kind: "event",
            device_id: "artillery-01",
            topic,
            published_at_utc_ms: utc + (topic === "task_status" ? 1 : 0),
            data,
          }),
        ),
      ]);
  }
  async publishReport(topic: "targetlist" | "tracklist", data: unknown) {
    this.#lastUtc = Math.max(Date.now(), this.#lastUtc + 2);
    await this.eoPub.send(eoFrames(topic, data, this.#lastUtc));
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
    await this.publishEffect();
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

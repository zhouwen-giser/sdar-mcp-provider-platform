import { EventEmitter } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import { canonical, sha256 } from "../../vehicle-zmq-observer/src/config.js";
import {
  Reception,
  type ObservationEvent,
  type ArchiveEntry,
} from "../../vehicle-zmq-observer/src/model.js";
import type { ZmqObservationObserver } from "../../vehicle-zmq-observer/src/observer.js";
import type { ExecutionContextRecord } from "../../provider-adapter-kit/src/types.js";
import {
  assertIdentity,
  componentFor,
  controlScope,
  StartControl,
  terminal,
  type ControlComponent,
  type ControlScope,
  type Operation,
  type SourceRef,
  type WireCommand,
  type ZmqExecution,
} from "./model.js";
import { commandFor, modeFor } from "./wire.js";
import { ControlLane } from "./queue.js";
import { journalAdvance, journalFor, type ControlRepository } from "./repository.js";
import type { CommandTransport } from "./transport.js";
import { emptyInspection, foldInspection, inspectionReport } from "./inspection.js";
import { ResultIdentity, resultIdentity } from "./results.js";

export interface ControlClock {
  utcMs(): number;
  monotonicMs(): number;
}
const systemClock: ControlClock = {
  utcMs: () => Date.now(),
  monotonicMs: () => Number(process.hrtime.bigint() / 1000000n),
};
interface Observed {
  receipt: Reception;
  ref: SourceRef;
  sequence: number;
}
export interface ControlIdentity {
  taskId: string;
  externalExecutionId: string;
  commandId: string;
  executionContext: ExecutionContextRecord;
}

/** Isolated orchestration; runtime/catalog admission stays closed until the later publication gate. */
export class ZmqControlEngine {
  readonly events = new EventEmitter();
  readonly #lanes = {
    chassis: new ControlLane(),
    eo: new ControlLane(),
    simulationEffect: new ControlLane(),
  };
  readonly #admission = new ControlLane();
  readonly #active = new Map<ControlComponent, ZmqExecution>();
  readonly #observations = new Map<string, Observed>();
  readonly #blocked = new Set<ControlComponent>();
  readonly #invalidated = new Map<string, number>();
  readonly #wakePending = new Set<ControlComponent>();
  readonly #monoDeadlines = new Map<string, number>();
  readonly #stopIssued = new Set<string>();
  readonly #fallbackReceipts = new Set<string>();
  readonly #recoveryFreshness = new Set<string>();
  readonly #dirty = new Set<string>();
  readonly #commandReservations = new Map<string, string>();
  readonly #sourceInterrupted = new Map<string, SourceRef>();
  readonly #inspectionSources = new Map<string, ZmqExecution>();
  readonly #watchedEffects = new Map<string, ZmqExecution>();
  readonly #coverageSignatures = new Map<string, string>();
  readonly #pendingReports = new Map<string, number>();
  readonly #stopMonoDeadlines = new Map<string, number>();
  readonly #stationary = new Map<
    string,
    { firstMs: number; lastSequence: number; count: number }
  >();
  readonly #positionWindow: Observed[] = [];
  #sequence = 0;
  #started = false;
  #closed = false;
  #timer: ReturnType<typeof setInterval> | undefined;
  #detach: (() => void) | undefined;
  #lastUtc: number;
  #lastMono: number;
  #healthy = true;
  #observer: ZmqObservationObserver | undefined;
  constructor(
    readonly scope: ControlScope,
    readonly repository: ControlRepository,
    readonly transport: CommandTransport,
    readonly clock: ControlClock = systemClock,
    readonly hooks?: { persisted(execution: ZmqExecution): Promise<void> },
  ) {
    if (
      controlScope(scope.profile, scope.settings).hash !== scope.hash ||
      canonical(controlScope(scope.profile, scope.settings).writerKeys) !==
        canonical(scope.writerKeys)
    )
      throw Error("ZMQ_CONTROL_SCOPE_INVALID");
    this.#lastUtc = clock.utcMs();
    this.#lastMono = clock.monotonicMs();
  }
  async initialize(observer?: ZmqObservationObserver): Promise<void> {
    if (this.#started) throw Error("ZMQ_CONTROL_ALREADY_STARTED");
    this.#started = true;
    await this.repository.start();
    this.transport.prepare?.();
    for (const execution of await this.repository.pending()) {
      const s = execution.zmqControl;
      if (this.#active.has(s.component)) throw Error("ZMQ_CONTROL_OCCUPANCY_CONFLICT");
      const journal = await this.repository.store.listMutationJournal(execution.taskId);
      const attempted =
        s.fallbackStop !== null ||
        journal.some((j) => j.state !== "INTENT_PERSISTED") ||
        s.commands.some((c) => !["intent", "superseded"].includes(c.status));
      if (attempted) {
        s.stage = "uncertain";
        s.occupancy = "held";
        s.missingEvidence = [
          ...new Set([...s.missingEvidence, "SOURCE_RESTART_RECONCILIATION_UNAVAILABLE"]),
        ];
        if (!execution.terminalAt) {
          execution.state = "TECHNICAL_FAILED";
          execution.reasonCode = "ZMQ_RESTART_OUTCOME_UNKNOWN";
          execution.terminalAt = this.at();
        }
        if (s.nativeTaskId === null) {
          const receipt = journal.find(
            (j) => j.state === "ACCEPTED" && j.phase === "PRIMARY" && j.externalMissionId,
          );
          if (receipt?.externalMissionId) {
            s.nativeTaskId = receipt.externalMissionId;
            execution.downstreamMissionIds = [receipt.externalMissionId];
          }
        }
        execution.result ??= this.result(execution);
      } else {
        this.#recoveryFreshness.add(execution.taskId);
      }
      this.#active.set(s.component, execution);
      if (execution.zmqInspection) this.#inspectionSources.set(execution.taskId, execution);
      if (s.component === "simulationEffect") this.#watchedEffects.set(execution.taskId, execution);
      await this.save(execution);
    }
    if (observer) {
      if (
        observer.sessionId !== this.scope.settings.observerSessionId ||
        observer.scope.partitionHash !== this.scope.settings.observerPartitionHash ||
        observer.health.status !== "running"
      )
        throw Error("ZMQ_CONTROL_OBSERVER_BINDING_MISMATCH");
      this.#detach = observer.subscribeCommitted((entry) =>
        this.observe(entry.payload, {
          partitionHash: observer.scope.partitionHash,
          sessionId: observer.sessionId ?? "",
          ordinal: entry.ordinal,
          entryHash: entry.entryHash,
        }),
      );
      this.#observer = observer;
    }
  }
  run(): void {
    if (!this.#started || this.#closed || this.#timer) throw Error("ZMQ_CONTROL_NOT_READY");
    this.#timer = setInterval(() => this.pulse(), 25);
    this.pulse();
  }
  private at() {
    return new Date(this.clock.utcMs()).toISOString();
  }
  private clockHealthy(): boolean {
    const utc = this.clock.utcMs(),
      mono = this.clock.monotonicMs();
    const valid =
      mono >= this.#lastMono &&
      Math.abs(utc - this.#lastUtc - (mono - this.#lastMono)) <= this.scope.settings.clockSkewMs;
    this.#lastUtc = utc;
    this.#lastMono = mono;
    if (!valid) {
      this.#healthy = false;
      this.#blocked.add("chassis");
      this.#blocked.add("eo");
      this.#blocked.add("simulationEffect");
    }
    return valid && this.#healthy;
  }
  observe(event: ObservationEvent, ref: SourceRef): void {
    if (
      this.#closed ||
      ref.partitionHash !== this.scope.settings.observerPartitionHash ||
      ref.sessionId !== this.scope.settings.observerSessionId
    )
      return;
    if (event.type !== "reception") {
      const components = event.component
        ? [event.component]
        : ["chassis", "eo", "simulationEffect"];
      for (const component of components) {
        if (event.type === "gap" || event.state !== "connected") {
          this.#blocked.add(component as ControlComponent);
          const active = this.#active.get(component as ControlComponent);
          if (
            active &&
            (active.zmqControl.fallbackStop ||
              active.zmqControl.commands.some(
                (c) => !["intent", "superseded", "rejected"].includes(c.status),
              ))
          )
            this.#sourceInterrupted.set(active.taskId, ref);
          if (component === "simulationEffect")
            for (const watched of this.#watchedEffects.values())
              this.#sourceInterrupted.set(watched.taskId, ref);
          if (component === "chassis") this.#positionWindow.length = 0;
          // Clear pre-disconnect snapshots; reconnect must collect every required source anew.
          for (const key of this.#observations.keys())
            if (key.startsWith(component + "/")) this.#observations.delete(key);
        } else this.#blocked.delete(component as ControlComponent);
      }
      return;
    }
    const receipt = Reception.parse(event);
    if (!receipt.valid || !receipt.projectable || !receipt.observation) return;
    const expectedDevice =
      receipt.component === "chassis"
        ? this.scope.profile.components.chassis.systemId
        : this.scope.profile.components[receipt.component].deviceId;
    if (
      this.scope.settings.mode === "isolated_simulator" &&
      receipt.component === "eo" &&
      receipt.observation.key !== "task_status" &&
      receipt.observation.reportedOrigin !== "simulated"
    ) {
      this.#blocked.add("eo");
      return;
    }
    if (
      receipt.observation.deviceId !== expectedDevice ||
      receipt.endpoint !== this.scope.profile.components[receipt.component].publicationEndpoint
    )
      return;
    const age = this.clock.monotonicMs() - Number(BigInt(receipt.monotonicNs) / 1000000n);
    if (age < 0 || age > this.scope.settings.stateFreshForMs) return;
    const observed = {
      receipt,
      ref,
      sequence: ++this.#sequence,
    };
    this.#observations.set(receipt.component + "/" + receipt.observation.key, observed);
    if (receipt.component === "chassis" && receipt.observation.key === "localization") {
      this.#positionWindow.push(observed);
      if (this.#positionWindow.length > 256) this.#positionWindow.shift();
    }
    this.queueReport(observed);
    this.wake(receipt.component);
  }
  private latest(component: ControlComponent, key: string, after = -1): Observed | undefined {
    const value = this.#observations.get(component + "/" + key);
    if (!value || value.sequence <= after || this.#blocked.has(component)) return undefined;
    const age = this.clock.monotonicMs() - Number(BigInt(value.receipt.monotonicNs) / 1000000n);
    return age >= 0 && age <= this.scope.settings.stateFreshForMs ? value : undefined;
  }
  private data(value: Observed | undefined): Record<string, unknown> {
    return value?.receipt.observation?.data ?? {};
  }
  availability(operation: Operation): { available: boolean; reasonCode: string } {
    const component = componentFor(operation.name);
    if (!this.#started || this.#closed || !this.#healthy)
      return { available: false, reasonCode: "ZMQ_CONTROL_NOT_READY" };
    if (this.#active.has(component))
      return { available: false, reasonCode: "ZMQ_COMPONENT_OCCUPIED" };
    if (
      component === "chassis" &&
      this.scope.profile.components.chassis.controllerSystemId === null
    )
      return { available: false, reasonCode: "ZMQ_CHASSIS_CONTROL_SENDER_UNSPECIFIED" };
    const state = this.data(
      this.latest(component, component === "chassis" ? "systemState" : "device_status"),
    );
    if (!Object.keys(state).length)
      return { available: false, reasonCode: "ZMQ_STATE_STALE_OR_DISCONNECTED" };
    if (
      component === "eo" &&
      (state.ready !== true ||
        state.mode !== "idle" ||
        object(state.telecontrol).state === "running" ||
        state.camera_online !== true ||
        state.gimbal_online !== true ||
        state.active_task_id !== null ||
        (["recon.area", "inspection.area"].includes(operation.name) &&
          state.navigation_valid !== true))
    )
      return { available: false, reasonCode: "ZMQ_EO_NOT_READY" };
    if (
      component === "simulationEffect" &&
      (state.ready !== true || state.mode !== "idle" || state.active_task_id !== null)
    )
      return { available: false, reasonCode: "ZMQ_SIMULATION_EFFECT_NOT_READY" };
    if (
      component === "chassis" &&
      (state.runState !== 1 || !Array.isArray(state.errorCodes) || state.errorCodes.length > 0)
    )
      return { available: false, reasonCode: "ZMQ_CHASSIS_FAULT" };
    try {
      this.validateLimits(operation);
    } catch {
      return { available: false, reasonCode: "ZMQ_DEPLOYMENT_LIMIT_EXCEEDED" };
    }
    if (component === "chassis" && this.scope.settings.mode === "site_control") {
      const mission = this.latest("chassis", "missionState"),
        position = this.latest("chassis", "localization");
      if (!position) return { available: false, reasonCode: "ZMQ_STATE_STALE_OR_DISCONNECTED" };
      const velocity = this.data(position).velocityEnu;
      if (
        [1, 2].includes(Number(this.data(mission).state)) ||
        !Array.isArray(velocity) ||
        velocity.some(
          (v) => typeof v !== "number" || Math.abs(v) > this.scope.settings.stationarySpeedMps,
        )
      )
        return { available: false, reasonCode: "ZMQ_CHASSIS_EXTERNAL_MISSION_ACTIVE" };
    }
    return {
      available: true,
      reasonCode:
        this.scope.settings.mode === "site_control"
          ? "ZMQ_SITE_OPERATION_READY"
          : "SIMULATED_ONLY_NOT_QUALIFIED",
    };
  }
  /** Full-parameter candidate admission; the synchronous method above is component health only. */
  async checkAvailability(operation: Operation, context: ExecutionContextRecord) {
    const current = this.availability(operation);
    if (!current.available || operation.name !== "simulation.applyEffect") return current;
    try {
      await this.validateEffectObservation(operation, context);
      return current;
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      return {
        available: false,
        reasonCode: /^ZMQ_[A-Z0-9_]+$/.test(code) ? code : "ZMQ_SOURCE_EVIDENCE_QUERY_UNAVAILABLE",
      };
    }
  }
  private validateLimits(operation: Operation): void {
    const p = operation.params,
      s = this.scope.settings;
    if (
      ("speedLimitMps" in p && p.speedLimitMps > s.maxSpeedMps) ||
      ("yaw_rad" in p && (p.yaw_rad < s.minYawRad || p.yaw_rad > s.maxYawRad)) ||
      ("pitch_rad" in p && (p.pitch_rad < s.minPitchRad || p.pitch_rad > s.maxPitchRad)) ||
      ("yaw_speed_rad_s" in p && p.yaw_speed_rad_s > s.maxYawRateRadS) ||
      ("yaw_center_rad" in p &&
        p.yaw_center_rad !== null &&
        (p.yaw_center_rad < s.minYawRad || p.yaw_center_rad > s.maxYawRad)) ||
      ("zoom_ratio" in p && (p.zoom_ratio < s.minZoom || p.zoom_ratio > s.maxZoom)) ||
      ("yaw_rate_rad_s" in p &&
        (Math.abs(p.yaw_rate_rad_s) > s.maxYawRateRadS ||
          Math.abs(p.pitch_rate_rad_s) > s.maxPitchRateRadS))
    )
      throw Error("ZMQ_DEPLOYMENT_LIMIT_EXCEEDED");
  }
  async start(input: unknown, signal?: AbortSignal): Promise<ZmqExecution> {
    const request = StartControl.parse(input),
      hash = sha256(canonical(request));
    return this.#admission.enqueue(async () => {
      if (signal?.aborted) throw Error("ZMQ_ADMISSION_CANCELLED");
      const previous =
        (await this.repository.findCommand(request.commandId)) ??
        (await this.repository.get(request.taskId));
      if (previous) {
        assertIdentity(previous, request.executionContext);
        if (previous.zmqControl.requestHash !== hash) throw Error("ZMQ_COMMAND_ID_CONFLICT");
        return previous;
      }
      if (this.#commandReservations.has(request.commandId)) throw Error("ZMQ_COMMAND_ID_CONFLICT");
      if (!this.clockHealthy()) throw Error("ZMQ_CLOCK_DISCONTINUITY");
      if (
        request.resourceId !== this.scope.profile.providerBinding.resourceId ||
        (request.executionContext.simulationId || null) !==
          this.scope.profile.executionDomain.simulationId ||
        request.executionContext.executionMode !== this.scope.profile.executionDomain.mode
      )
        throw Error("ZMQ_EXECUTION_IDENTITY_MISMATCH");
      const available = this.availability(request.operation);
      if (!available.available) throw Error(available.reasonCode);
      if (request.operation.name === "simulation.applyEffect")
        await this.validateEffectObservation(request.operation, request.executionContext);
      const component = componentFor(request.operation.name),
        at = this.at();
      let nativeTaskId: string | null = null;
      if (component === "chassis") {
        do {
          nativeTaskId = String(randomBytes(4).readUInt32LE());
        } while (
          nativeTaskId === "0" ||
          (await this.repository.nativeTaskUsed(component, nativeTaskId, request.taskId))
        );
      }
      const e: ZmqExecution = {
        taskId: request.taskId,
        externalExecutionId: randomUUID(),
        operationName: request.admission?.operationName ?? request.operation.name,
        argumentHash: request.admission?.argumentHash ?? hash,
        ...(request.admission
          ? { zmqAdmission: request.admission, taskBusinessContextExpected: true }
          : {}),
        providerId: this.scope.profile.providerBinding.providerId ?? "",
        resourceId: request.resourceId,
        tracks: [component],
        arguments: { operation: request.operation },
        executionContext: request.executionContext,
        downstreamMissionIds: nativeTaskId ? [nativeTaskId] : [],
        state: "ACCEPTED",
        revision: 0,
        reasonCode: "ZMQ_SCHEDULED",
        createdAt: at,
        updatedAt: at,
        evidence: [],
        ...(request.operation.name === "inspection.area"
          ? { zmqInspection: emptyInspection() }
          : {}),
        ...(component === "simulationEffect"
          ? {
              zmqEffect: {
                lastRevision: 0,
                taskSignature: null,
                executionFinished: null,
                latest: null,
              },
            }
          : {}),
        zmqControl: {
          version: 1,
          scopeHash: this.scope.hash,
          writerKeys: this.scope.writerKeys,
          commandId: request.commandId,
          requestHash: hash,
          component,
          stage: "scheduled",
          generation: 0,
          occupancy: "held",
          timing: request.timing,
          startedAt: null,
          deadlineAt: null,
          nativeTaskId,
          modeAttempt: 0,
          modeSentAt: null,
          baseline: this.#sequence,
          modeBaseline: this.#sequence,
          taskBaseline: this.#sequence,
          stopBaseline: this.#sequence,
          lastCommand: null,
          commands: [],
          fallbackStop: null,
          controls: [],
          stopRequestedAt: null,
          stopSentAt: null,
          stopDeadlineAt: null,
          stopReason: null,
          stopConfirmed: false,
          nativeOutcome: null,
          nativeReason: null,
          latestEvidence: [],
          missingEvidence: [
            "SOURCE_PRODUCER_EPOCH_UNATTESTED",
            ...(component === "chassis" &&
            this.scope.settings.mode === "site_control" &&
            !this.latest("chassis", "missionState")
              ? ["CHASSIS_INITIAL_MISSION_STATE_NOT_OBSERVED"]
              : []),
            ...(component === "chassis"
              ? ["CHASSIS_FEEDBACK_UNCORRELATED", "MODE_PUBLICATION_ORDER_UNVERIFIED"]
              : []),
          ],
        },
      };
      if (signal?.aborted) throw Error("ZMQ_ADMISSION_CANCELLED");
      this.#commandReservations.set(request.commandId, hash);
      try {
        await this.repository.save(e);
        await this.hooks?.persisted(structuredClone(e));
      } catch (error) {
        this.#healthy = false;
        throw error;
      } finally {
        this.#commandReservations.delete(request.commandId);
      }
      if (signal?.aborted) {
        await this.finish(e, "BUSINESS_FAILED", "ZMQ_ADMISSION_CANCELLED", true);
        return structuredClone(e);
      }
      const accepted = structuredClone(e);
      this.#active.set(component, e);
      if (e.zmqInspection) {
        this.#inspectionSources.set(e.taskId, e);
        if (this.#inspectionSources.size > 8) {
          const oldest = this.#inspectionSources.keys().next().value;
          if (oldest) this.#inspectionSources.delete(oldest);
        }
      }
      if (component === "simulationEffect") {
        this.#watchedEffects.set(e.taskId, e);
        if (this.#watchedEffects.size > 128) {
          const old = [...this.#watchedEffects.values()].find(
            (v) => v.zmqControl.occupancy === "released",
          );
          if (old) this.#watchedEffects.delete(old.taskId);
        }
      }
      this.wake(component);
      return accepted;
    });
  }
  async get(taskId: string, context: ExecutionContextRecord): Promise<ZmqExecution | undefined> {
    const execution = await this.repository.get(taskId);
    if (execution) assertIdentity(execution, context);
    return execution;
  }
  async results(
    identityInput: ResultIdentity,
    context: ExecutionContextRecord,
    afterRevision = 0,
    limit = 8,
  ) {
    const identity = ResultIdentity.parse(identityInput),
      e = await this.get(identity.taskId, context);
    if (!e || canonical(resultIdentity(e)) !== canonical(identity))
      throw Error("ZMQ_EXECUTION_IDENTITY_MISMATCH");
    return this.repository.resultPage(identity, afterRevision, limit);
  }
  async inspectionResults(
    identity: ResultIdentity,
    context: ExecutionContextRecord,
    afterRevision = 0,
    limit = 8,
  ) {
    const page = await this.results(identity, context, afterRevision, limit),
      e = await this.get(identity.taskId, context);
    if (!e?.zmqInspection) throw Error("ZMQ_INSPECTION_TASK_REQUIRED");
    await this.reloadResultHead(e);
    return {
      ...inspectionReport(e.zmqInspection, (this.#pendingReports.get(e.taskId) ?? 0) > 0),
      ...(this.scope.settings.mode === "site_control"
        ? { schemaVersion: "ugv.zmq-inspection-result/2" }
        : {}),
      identity,
      page,
    };
  }
  async effectResults(
    identity: ResultIdentity,
    context: ExecutionContextRecord,
    afterRevision = 0,
    limit = 8,
  ) {
    const page = await this.results(identity, context, afterRevision, limit),
      e = await this.get(identity.taskId, context);
    if (!e?.zmqEffect) throw Error("ZMQ_SIMULATION_EFFECT_TASK_REQUIRED");
    await this.reloadResultHead(e);
    const missing = new Set(e.zmqControl.missingEvidence);
    if (e.zmqEffect.executionFinished === true) {
      missing.delete("SIMULATION_EXECUTION_NOT_CONFIRMED_FINISHED");
      if (e.zmqControl.occupancy === "held") missing.add("SIMULATION_IDLE_STATE_UNCONFIRMED");
    }
    if (!e.zmqEffect.latest) missing.add("NATIVE_EFFECT_TASK_REPORT_MISSING");
    if (object(e.zmqEffect.latest?.nativeTask).effect === "unknown")
      missing.add("SIMULATION_EFFECT_UNKNOWN");
    return {
      schemaVersion:
        this.scope.settings.mode === "site_control"
          ? "ugv.zmq-effect-query/2"
          : "ugv.zmq-effect-query/1",
      identity,
      originalTask: {
        state: e.state,
        reasonCode: e.reasonCode,
        terminalAt: e.terminalAt ?? null,
        result: e.result ?? null,
      },
      latestRevision: e.zmqEffect.lastRevision,
      latest: e.zmqEffect.latest,
      occupancy: e.zmqControl.occupancy,
      executionFinished: e.zmqEffect.executionFinished,
      missingEvidence: [...missing],
      page,
    };
  }
  private async reloadResultHead(e: ZmqExecution) {
    let after = e.zmqInspection?.lastRevision ?? e.zmqEffect?.lastRevision ?? 0;
    for (let n = 0; n < 32; n++) {
      const page = await this.repository.resultPage(resultIdentity(e), after);
      for (const record of page.records) {
        if (e.zmqInspection) foldInspection(e.zmqInspection, record);
        if (e.zmqEffect && record.kind === "effect") {
          e.zmqEffect.lastRevision = record.revision;
          e.zmqEffect.latest = record.content;
          e.zmqEffect.executionFinished =
            object(record.content.nativeTask).execution_finished === true;
        }
      }
      if (!page.hasMore) return;
      after = page.nextRevision;
    }
    e.zmqInspection?.missingEvidence.push("LOCAL_SUMMARY_REBUILD_LIMIT_USE_PAGES");
    if (e.zmqEffect) throw Error("ZMQ_RESULT_SUMMARY_REBUILD_LIMIT_USE_PAGES");
  }
  async currentEffectCandidates(context: ExecutionContextRecord) {
    const values = [];
    for (const e of this.#inspectionSources.values()) {
      if (
        e.executionContext.authorizationContextHash !== context.authorizationContextHash ||
        e.executionContext.executionMode !== context.executionMode ||
        e.executionContext.simulationId !== context.simulationId
      )
        continue;
      values.push(...(await this.effectCandidates(resultIdentity(e), context)));
    }
    return values.slice(0, 256);
  }
  async effectCandidates(identity: ResultIdentity, context: ExecutionContextRecord) {
    const source = await this.get(identity.taskId, context);
    if (!source?.zmqInspection) throw Error("ZMQ_INSPECTION_TASK_REQUIRED");
    const page = await this.results(
      identity,
      context,
      Math.max(0, source.zmqInspection.lastRevision - 8),
    );
    const candidates = [];
    for (const record of page.records.reverse()) {
      const d = object(record.content.data),
        targets = d.targets,
        t = Array.isArray(targets) ? object(targets[0]) : {};
      if (
        record.kind !== "inspection_frame" ||
        record.content.key !== "tracklist" ||
        t.position === null ||
        !t.position ||
        typeof d.target_id !== "string"
      )
        continue;
      const operation = {
        name: "simulation.applyEffect" as const,
        params: {
          targetId: d.target_id,
          position: t.position as Extract<
            Operation,
            { name: "simulation.applyEffect" }
          >["params"]["position"],
          observation: {
            taskId: source.taskId,
            externalExecutionId: source.externalExecutionId,
            revision: record.revision,
          },
        },
      };
      try {
        await this.validateEffectObservation(operation, context);
      } catch {
        continue;
      }
      candidates.push({
        ...operation.params,
        observedAt: new Date(Number(d.observed_at_utc_ms)).toISOString(),
      });
    }
    return candidates;
  }
  private queueReport(value: Observed) {
    const o = value.receipt.observation;
    if (!o) return;
    const component = value.receipt.component;
    let e = this.#active.get(component);
    if (component === "simulationEffect" && o.key === "task_status") {
      const task = object(o.data.task);
      e = [...this.#watchedEffects.values()].find((candidate) =>
        candidate.zmqControl.commands.some(
          (c) => c.action === "effect" && c.requestId === task.request_id,
        ),
      );
    }
    if (
      !e ||
      !(
        (e.zmqInspection && ["targetlist", "tracklist", "task_status"].includes(o.key)) ||
        (e.zmqEffect && o.key === "task_status")
      )
    )
      return;
    const execution = e,
      pending = this.#pendingReports.get(e.taskId) ?? 0;
    if (pending >= 32) {
      if (
        e.zmqInspection &&
        !e.zmqInspection.missingEvidence.includes("LOCAL_REPORT_PROJECTION_GAP")
      )
        e.zmqInspection.missingEvidence.push("LOCAL_REPORT_PROJECTION_GAP");
      this.events.emit("fault", "ZMQ_RESULT_PROJECTION_BACKPRESSURE");
      return;
    }
    this.#pendingReports.set(e.taskId, pending + 1);
    void this.#lanes[component]
      .enqueue(async () => {
        if (execution.zmqInspection) await this.collectInspection(execution, value);
        if (execution.zmqEffect) await this.collectEffect(execution, value);
      })
      .catch(() => {
        this.#healthy = false;
        execution.zmqInspection?.missingEvidence.push("LOCAL_REPORT_PERSISTENCE_UNCONFIRMED");
        this.events.emit("fault", "ZMQ_RESULT_PERSISTENCE_UNCONFIRMED");
      })
      .finally(() =>
        this.#pendingReports.set(
          execution.taskId,
          Math.max(0, (this.#pendingReports.get(execution.taskId) ?? 1) - 1),
        ),
      );
  }
  private async collectInspection(e: ZmqExecution, value: Observed) {
    const s = e.zmqControl,
      o = value.receipt.observation,
      summary = e.zmqInspection;
    if (!o || !summary || !s.startedAt || !s.nativeTaskId || this.#sourceInterrupted.has(e.taskId))
      return;
    const d = o.data,
      isCoverage = o.key === "task_status",
      task = object(d.task);
    const nativeId = isCoverage ? task.task_id : d.task_id;
    if (nativeId !== s.nativeTaskId || (isCoverage && task.task_type !== "AreaSearch")) return;
    if (
      Date.parse(value.receipt.receivedAt) < Date.parse(s.startedAt) ||
      (e.terminalAt && Date.parse(value.receipt.receivedAt) > Date.parse(e.terminalAt))
    )
      return;
    const published = Number(o.sourceTime.value),
      acquired = o.acquisitionUtcMs;
    if (
      published < Date.parse(s.startedAt) ||
      (acquired !== null &&
        (acquired < Date.parse(s.startedAt) ||
          acquired > this.clock.utcMs() + this.scope.settings.clockSkewMs))
    )
      return;
    if (!isCoverage && d.data_origin !== "simulated") return;
    if (isCoverage) {
      const signature = canonical({
        task_id: task.task_id,
        task_type: task.task_type,
        state: task.state,
        coverage_ratio: task.coverage_ratio,
        coverage_complete: task.coverage_complete,
      });
      if (this.#coverageSignatures.get(e.taskId) === signature) return;
      this.#coverageSignatures.set(e.taskId, signature);
    }
    const record = await this.repository.appendResult({
      identity: resultIdentity(e),
      kind: isCoverage ? "coverage" : "inspection_frame",
      sourceRef: value.ref,
      receivedAt: value.receipt.receivedAt,
      content: {
        key: o.key,
        data: d,
        nativeTaskId: s.nativeTaskId,
        publishedAt: new Date(published).toISOString(),
        acquisitionUtcMs: acquired,
        sourceProducerEpoch: null,
        reportedOrigin: o.reportedOrigin,
      },
    });
    foldInspection(summary, record);
    await this.save(e);
  }
  private async validateEffectObservation(
    operation: Extract<Operation, { name: "simulation.applyEffect" }>,
    context: ExecutionContextRecord,
  ) {
    const p = operation.params;
    if (p.targetSource === "manual") {
      if (this.scope.settings.mode !== "site_control" || !p.sourceNote || p.observation)
        throw Error("ZMQ_MANUAL_TARGET_NOT_AUTHORIZED");
      return;
    }
    if (!p.observation) throw Error("ZMQ_EFFECT_GEO_OBSERVATION_REQUIRED");
    const source = await this.get(p.observation.taskId, context);
    if (
      !source?.zmqInspection ||
      source.externalExecutionId !== p.observation.externalExecutionId ||
      source.resourceId !== this.scope.profile.providerBinding.resourceId ||
      source.providerId !== this.scope.profile.providerBinding.providerId
    )
      throw Error("ZMQ_EFFECT_SOURCE_IDENTITY_MISMATCH");
    const page = await this.repository.resultPage(
        resultIdentity(source),
        p.observation.revision - 1,
        1,
      ),
      record = page.records[0];
    if (
      record?.revision !== p.observation.revision ||
      record.kind !== "inspection_frame" ||
      record.content.key !== "tracklist" ||
      record.sourceRef.sessionId !== this.scope.settings.observerSessionId ||
      record.sourceRef.partitionHash !== this.scope.settings.observerPartitionHash ||
      this.#sourceInterrupted.has(source.taskId)
    )
      throw Error("ZMQ_EFFECT_GEO_OBSERVATION_REQUIRED");
    const d = object(record.content.data),
      targets = d.targets,
      t = Array.isArray(targets) ? object(targets[0]) : {},
      observed = d.observed_at_utc_ms;
    if (
      d.data_origin !== "simulated" ||
      d.track_state !== "tracking" ||
      d.target_id !== p.targetId ||
      typeof observed !== "number" ||
      observed > this.clock.utcMs() ||
      this.clock.utcMs() - observed > this.scope.settings.stateFreshForMs ||
      canonical(t.position) !== canonical(p.position)
    )
      throw Error("ZMQ_EFFECT_SOURCE_STALE_OR_POSITION_MISMATCH");
  }
  private async collectEffect(e: ZmqExecution, value: Observed) {
    const s = e.zmqControl,
      facts = e.zmqEffect,
      operation = e.arguments.operation as Operation;
    if (
      !facts ||
      operation.name !== "simulation.applyEffect" ||
      this.#sourceInterrupted.has(e.taskId) ||
      [
        "SOURCE_RESTART_RECONCILIATION_UNAVAILABLE",
        "EFFECT_CORRELATION_CONFLICT",
        "EFFECT_RESULT_CONFLICT",
      ].some((code) => s.missingEvidence.includes(code))
    )
      return;
    const task = this.task(value),
      command = s.commands.find((c) => c.action === "effect");
    if (
      !command?.dispatchAt ||
      task.request_id !== command.requestId ||
      typeof task.task_id !== "string" ||
      Date.parse(value.receipt.receivedAt) < Date.parse(command.dispatchAt)
    )
      return;
    if (
      task.target_id !== operation.params.targetId ||
      canonical(task.position) !== canonical(operation.params.position) ||
      (s.nativeTaskId !== null && task.task_id !== s.nativeTaskId)
    ) {
      s.missingEvidence.push("EFFECT_CORRELATION_CONFLICT");
      if (!e.terminalAt) {
        e.state = "TECHNICAL_FAILED";
        e.reasonCode = "ZMQ_EFFECT_IDENTITY_CONFLICT";
        e.terminalAt = this.at();
        e.result = this.effectResult(e);
      }
      s.stage = "uncertain";
      await this.save(e);
      return;
    }
    if (s.nativeTaskId === null) {
      if (await this.repository.nativeTaskUsed("simulationEffect", task.task_id, e.taskId)) return;
      s.nativeTaskId = task.task_id;
      e.downstreamMissionIds = [task.task_id];
    }
    const previous = object(facts.latest?.nativeTask);
    if (
      facts.executionFinished === true &&
      (task.execution_finished !== true ||
        (previous.effect !== "unknown" && task.effect !== previous.effect))
    ) {
      if (!s.missingEvidence.includes("EFFECT_RESULT_CONFLICT")) {
        s.missingEvidence.push("EFFECT_RESULT_CONFLICT");
        await this.save(e);
      }
      return;
    }
    const signature = canonical(task);
    if (signature === facts.taskSignature) {
      const held = s.occupancy;
      this.effectProgress(e);
      if (held !== s.occupancy) await this.save(e);
      return;
    }
    if (signature !== facts.taskSignature) {
      const record = await this.repository.appendResult({
        identity: resultIdentity(e),
        kind: "effect",
        sourceRef: value.ref,
        receivedAt: value.receipt.receivedAt,
        content: {
          nativeTask: task,
          nativeRequestId: command.requestId,
          sourceBinding:
            this.scope.settings.mode === "site_control"
              ? "configured_site_simulation_referee"
              : "isolated_simulation_referee",
          sourceProducerEpoch: null,
          publishedAt: new Date(Number(value.receipt.observation?.sourceTime.value)).toISOString(),
          late: !!e.terminalAt,
          originalTerminalAt: e.terminalAt ?? null,
        },
      });
      facts.lastRevision = record.revision;
      facts.taskSignature = signature;
      facts.executionFinished = task.execution_finished === true;
      facts.latest = record.content;
      this.evidence(e, value);
    }
    if (task.execution_finished === true) {
      s.nativeOutcome = String(task.state);
      s.nativeReason = typeof task.reason === "string" ? task.reason : null;
      if (!e.terminalAt) {
        e.state =
          task.state === "succeeded"
            ? "SUCCEEDED"
            : task.state === "failed"
              ? "BUSINESS_FAILED"
              : "TECHNICAL_FAILED";
        e.reasonCode = `ZMQ_EFFECT_${String(task.state).toUpperCase()}`;
        e.terminalAt = this.at();
        e.result = this.effectResult(e);
      }
    } else if (!e.terminalAt) {
      e.state = "RUNNING";
      e.reasonCode = "ZMQ_EFFECT_EXECUTING";
      s.stage = "running";
    }
    this.effectProgress(e);
    await this.save(e);
  }
  private effectResult(e: ZmqExecution): Record<string, unknown> {
    const latest = e.zmqEffect?.latest,
      task = object(latest?.nativeTask);
    return structuredClone({
      schemaVersion:
        this.scope.settings.mode === "site_control"
          ? "ugv.zmq-effect-result/2"
          : "ugv.zmq-effect-result/1",
      qualification:
        this.scope.settings.mode === "site_control" ? "site_control" : "isolated_simulator_only",
      runtimeAdmission:
        this.scope.settings.mode === "site_control"
          ? "site_runtime"
          : e.zmqAdmission
            ? "isolated_runtime"
            : "not_published",
      ...(this.scope.settings.mode === "site_control"
        ? {
            targetProvenance: {
              kind: object(object(e.arguments.operation).params).targetSource ?? "observation",
              sourceNote: object(object(e.arguments.operation).params).sourceNote ?? null,
              authorizationContextHash: e.executionContext.authorizationContextHash,
              correlationId: e.executionContext.correlationId,
            },
          }
        : {}),
      requestAccepted: e.zmqControl.commands.some(
        (c) => c.action === "effect" && c.status === "accepted",
      ),
      nativeTaskId: e.zmqControl.nativeTaskId,
      executionState: task.state ?? "unknown",
      executionFinished: task.execution_finished ?? null,
      effect: task.effect ?? "unknown",
      outcome:
        task.state === "succeeded"
          ? `execution_succeeded_effect_${String(task.effect)}`
          : "incomplete",
      missingEvidence: [
        ...e.zmqControl.missingEvidence,
        ...(task.effect === undefined || task.effect === "unknown"
          ? ["SIMULATION_EFFECT_UNKNOWN"]
          : []),
      ],
      sourceRefs: e.zmqControl.latestEvidence,
      supplementalResultRevision: e.zmqEffect?.lastRevision ?? 0,
      resultQuery: "simulation_get_effect_result",
      historySource: "platform_retained_only",
    });
  }
  private effectProgress(e: ZmqExecution) {
    const s = e.zmqControl,
      device = this.data(this.latest("simulationEffect", "device_status", s.baseline));
    if (
      e.zmqEffect?.executionFinished === true &&
      device.ready === true &&
      device.mode === "idle" &&
      device.active_task_id === null &&
      !s.missingEvidence.includes("EFFECT_CORRELATION_CONFLICT") &&
      !s.missingEvidence.includes("EFFECT_RESULT_CONFLICT")
    ) {
      s.occupancy = "released";
      s.stage = "terminal";
      if (this.#active.get("simulationEffect")?.taskId === e.taskId)
        this.#active.delete("simulationEffect");
      this.#monoDeadlines.delete(e.taskId);
    }
  }
  async control(
    action: "pause" | "resume" | "cancel",
    identity: ControlIdentity,
  ): Promise<ZmqExecution> {
    StartControl.shape.taskId.parse(identity.taskId);
    StartControl.shape.commandId.parse(identity.commandId);
    StartControl.shape.executionContext.parse(identity.executionContext);
    if (!["pause", "resume", "cancel"].includes(action)) throw Error("ZMQ_CONTROL_ACTION_INVALID");
    const existing =
      [...this.#active.values()].find((e) => e.taskId === identity.taskId) ??
      (await this.repository.get(identity.taskId));
    if (!existing) throw Error("ZMQ_TASK_NOT_FOUND");
    assertIdentity(existing, identity.executionContext);
    if (existing.externalExecutionId !== identity.externalExecutionId)
      throw Error("ZMQ_EXECUTION_IDENTITY_MISMATCH");
    if (existing.zmqControl.component === "simulationEffect")
      throw Error("ZMQ_SIMULATION_EFFECT_CONTROL_UNSUPPORTED");
    if (this.#sourceInterrupted.has(existing.taskId))
      throw Error("ZMQ_RESTART_RECONCILIATION_REQUIRED");
    if (this.nativeTypeConflict(existing)) throw Error("ZMQ_EXECUTION_IDENTITY_UNCONFIRMED");
    const hash = sha256(canonical({ action, ...identity }));
    const claimed = await this.repository.findCommand(identity.commandId);
    if (claimed) {
      const original = claimed.zmqControl.controls.find((c) => c.commandId === identity.commandId);
      if (original?.hash !== hash) throw Error("ZMQ_COMMAND_ID_CONFLICT");
      return claimed;
    }
    const reservation = this.#commandReservations.get(identity.commandId);
    if (reservation && reservation !== hash) throw Error("ZMQ_COMMAND_ID_CONFLICT");
    if (!reservation && this.#commandReservations.size >= 128)
      throw Error("ZMQ_CONTROL_QUEUE_EXHAUSTED");
    this.#commandReservations.set(identity.commandId, hash);
    // Volatile revocation is immediate, including while a store or REQ operation is awaiting.
    if (action === "cancel")
      this.#invalidated.set(
        existing.taskId,
        (this.#invalidated.get(existing.taskId) ?? existing.zmqControl.generation) + 1,
      );
    return this.#lanes[existing.zmqControl.component]
      .enqueue(async () => {
        const e =
          this.#active.get(existing.zmqControl.component) ??
          (await this.repository.get(identity.taskId));
        if (e?.taskId !== identity.taskId) throw Error("ZMQ_TASK_NOT_ACTIVE");
        const used = await this.repository.findCommand(identity.commandId);
        if (used) {
          const old = used.zmqControl.controls.find((c) => c.commandId === identity.commandId);
          if (old?.hash !== hash) throw Error("ZMQ_COMMAND_ID_CONFLICT");
          return structuredClone(used);
        }
        if (e.zmqControl.controls.length >= this.scope.settings.commandLimit)
          throw Error("ZMQ_CONTROL_COMMAND_LIMIT");
        const s = e.zmqControl;
        if (s.missingEvidence.includes("SOURCE_RESTART_RECONCILIATION_UNAVAILABLE"))
          throw Error("ZMQ_RESTART_RECONCILIATION_REQUIRED");
        if (terminal(e)) return structuredClone(e);
        if (action === "cancel") {
          s.controls.push({ commandId: identity.commandId, action, hash });
          try {
            await this.requestStop(e, "CLIENT_REQUESTED");
          } catch (error) {
            this.#healthy = false;
            await this.fallbackStop(e);
            throw error;
          }
        } else {
          if ((e.arguments.operation as Operation).name.startsWith("camera."))
            throw Error("ZMQ_PAUSE_RESUME_UNSUPPORTED");
          if (
            (action === "pause" && s.stage !== "running") ||
            (action === "resume" && s.stage !== "paused")
          )
            throw Error("ZMQ_CONTROL_INVALID_STATE");
          if (this.expired(e)) {
            await this.requestStop(e, "DEADLINE_EXCEEDED");
            return structuredClone(e);
          }
          s.controls.push({ commandId: identity.commandId, action, hash });
          s.stage = action === "pause" ? "pause_wait" : "resume_wait";
          e.state = action === "pause" ? "RUNNING" : "RESUMING";
          await this.send(e, action);
        }
        return structuredClone(e);
      }, action === "cancel")
      .finally(() => this.#commandReservations.delete(identity.commandId));
  }
  async reconcileComponent(
    input: { component: ControlComponent; taskId: string; commandId: string; reason: string },
    context: ExecutionContextRecord,
  ) {
    if (this.scope.settings.mode !== "site_control" || !input.reason.trim())
      throw Error("ZMQ_RECONCILIATION_INVALID");
    return this.#lanes[input.component].enqueue(async () => {
      await this.repository.assertWriter();
      const e = await this.get(input.taskId, context);
      if (e?.zmqControl.component !== input.component || !e.terminalAt)
        throw Error("ZMQ_RECONCILIATION_TASK_NOT_TERMINAL");
      const active = this.#active.get(input.component);
      if (active && active.taskId !== e.taskId) throw Error("ZMQ_COMPONENT_BUSY");
      const s = e.zmqControl;
      const prior = (s as unknown as { reconciliation?: { commandId: string; reason: string } })
        .reconciliation;
      if (prior) {
        if (prior.commandId !== input.commandId || prior.reason !== input.reason)
          throw Error("ZMQ_RECONCILIATION_CONFLICT");
        return structuredClone(e);
      }
      if (s.occupancy !== "held") throw Error("ZMQ_RECONCILIATION_NOT_REQUIRED");
      const state = this.latest(
        input.component,
        input.component === "chassis" ? "systemState" : "device_status",
      );
      if (!state) throw Error("ZMQ_STATE_STALE_OR_DISCONNECTED");
      const d = this.data(state);
      const refs = [state.ref];
      if (input.component === "chassis") {
        const position = this.latest("chassis", "localization"),
          mission = this.latest("chassis", "missionState");
        const velocity = this.data(position).velocityEnu;
        if (
          d.runState !== 1 ||
          !Array.isArray(d.errorCodes) ||
          d.errorCodes.length ||
          !position ||
          !mission ||
          ![0, 3, 4, 5].includes(Number(this.data(mission).state)) ||
          !Array.isArray(velocity) ||
          velocity.some(
            (v) => typeof v !== "number" || Math.abs(v) > this.scope.settings.stationarySpeedMps,
          )
        )
          throw Error("ZMQ_RECONCILIATION_IDLE_UNCONFIRMED");
        const stationary = this.#positionWindow.filter((v) => {
          const age = this.clock.monotonicMs() - Number(BigInt(v.receipt.monotonicNs) / 1000000n),
            speed = this.data(v).velocityEnu;
          return (
            age >= 0 &&
            age <= this.scope.settings.stateFreshForMs &&
            Array.isArray(speed) &&
            speed.every(
              (n) => typeof n === "number" && Math.abs(n) <= this.scope.settings.stationarySpeedMps,
            )
          );
        });
        if (
          stationary.length < 2 ||
          Number(
            BigInt(stationary.at(-1)?.receipt.monotonicNs ?? "0") -
              BigInt(stationary[0]?.receipt.monotonicNs ?? "0"),
          ) < 100000000
        )
          throw Error("ZMQ_RECONCILIATION_IDLE_UNCONFIRMED");
        refs.push(position.ref, mission.ref, ...stationary.slice(0, 1).map((v) => v.ref));
      } else if (
        d.ready !== true ||
        d.mode !== "idle" ||
        d.active_task_id !== null ||
        object(d.telecontrol).state === "running"
      ) {
        throw Error("ZMQ_RECONCILIATION_IDLE_UNCONFIRMED");
      }
      Object.assign(s, {
        reconciliation: {
          ...input,
          at: this.at(),
          sourceRefs: refs,
          authorizationContextHash: context.authorizationContextHash,
        },
      });
      s.occupancy = "released";
      s.stage = "terminal";
      await this.save(e);
      this.#active.delete(input.component);
      this.#watchedEffects.delete(e.taskId);
      this.#healthy = true;
      this.#sourceInterrupted.delete(e.taskId);
      this.#blocked.delete(input.component);
      return structuredClone(e);
    }, true);
  }
  pulse(): void {
    if (this.#observer && this.#observer.health.status !== "running") {
      this.#blocked.add("chassis");
      this.#blocked.add("eo");
      this.#blocked.add("simulationEffect");
    }
    if (!this.clockHealthy())
      for (const e of this.#active.values())
        this.#invalidated.set(e.taskId, e.zmqControl.generation + 1);
    for (const component of this.#active.keys()) this.wake(component);
  }
  private wake(component: ControlComponent) {
    if (this.#closed || this.#wakePending.has(component)) return;
    this.#wakePending.add(component);
    void this.#lanes[component]
      .enqueue(async () => {
        this.#wakePending.delete(component);
        const e = this.#active.get(component);
        if (!e) return;
        try {
          await this.advance(e);
        } catch {
          this.#healthy = false;
          this.#invalidated.set(e.taskId, e.zmqControl.generation + 1);
          await this.fallbackStop(e);
          this.events.emit("fault", "ZMQ_CONTROL_PERSISTENCE_OR_DISPATCH_UNCONFIRMED");
        }
      })
      .catch(() => {
        this.#healthy = false;
      });
  }
  private expired(e: ZmqExecution): boolean {
    const s = e.zmqControl;
    if (s.deadlineAt === null) return false;
    const mono = this.#monoDeadlines.get(e.taskId);
    return (
      this.clock.utcMs() >= Date.parse(s.deadlineAt) ||
      (mono !== undefined && this.clock.monotonicMs() >= mono)
    );
  }
  private async advance(e: ZmqExecution): Promise<void> {
    const s = e.zmqControl,
      operation = e.arguments.operation as Operation;
    if (this.#sourceInterrupted.has(e.taskId)) {
      if (!s.missingEvidence.includes("SOURCE_RESTART_RECONCILIATION_UNAVAILABLE")) {
        s.stage = "uncertain";
        s.occupancy = "held";
        s.generation++;
        s.missingEvidence.push(
          "SOURCE_RESTART_RECONCILIATION_UNAVAILABLE",
          "SOURCE_CONNECTION_INTERRUPTED",
        );
        const interrupted = this.#sourceInterrupted.get(e.taskId);
        if (interrupted) {
          s.latestEvidence.push(interrupted);
          if (s.latestEvidence.length > 8) s.latestEvidence.shift();
        }
        if (!e.terminalAt) {
          e.state = "TECHNICAL_FAILED";
          e.reasonCode = "ZMQ_SOURCE_RESTART_UNVERIFIABLE";
          e.terminalAt = this.at();
          e.result = this.result(e);
        }
        await this.save(e);
      } else if (this.#dirty.has(e.taskId)) {
        await this.save(e);
      }
      return;
    }
    if (terminal(e)) {
      if (this.#dirty.has(e.taskId)) {
        await this.save(e);
        if (s.occupancy === "released") this.#active.delete(s.component);
      }
      return;
    }
    if (s.missingEvidence.includes("SOURCE_RESTART_RECONCILIATION_UNAVAILABLE")) return;
    const identityConflict = this.nativeTypeConflict(e);
    if (identityConflict) {
      s.stage = "uncertain";
      s.occupancy = "held";
      s.generation++;
      s.missingEvidence.push(
        "NATIVE_TASK_TYPE_MISMATCH",
        "SOURCE_RESTART_RECONCILIATION_UNAVAILABLE",
      );
      this.evidence(e, identityConflict);
      if (!e.terminalAt) {
        e.state = "TECHNICAL_FAILED";
        e.reasonCode = "ZMQ_NATIVE_TASK_IDENTITY_CONFLICT";
        e.terminalAt = this.at();
        e.result = this.result(e);
      }
      await this.save(e);
      return;
    }
    if (this.#recoveryFreshness.has(e.taskId)) {
      if (
        this.expired(e) ||
        (s.stage === "scheduled" &&
          this.clock.utcMs() > Date.parse(s.timing.startAt) + s.timing.startToleranceMs)
      ) {
        await this.finish(e, "BUSINESS_FAILED", "ZMQ_RECOVERY_START_OR_DEADLINE_EXPIRED", true);
        return;
      }
      if (this.channelProblem(e)) return;
      this.#recoveryFreshness.delete(e.taskId);
    }
    if (!this.#healthy && s.stage !== "stopping") {
      await this.requestStop(e, "CLOCK_OR_PERSISTENCE_UNCONFIRMED");
      return;
    }
    if (
      (this.#invalidated.get(e.taskId) ?? s.generation) > s.generation &&
      s.stage !== "stopping"
    ) {
      await this.requestStop(e, "CLIENT_REQUESTED");
      return;
    }
    if (s.stage === "scheduled") {
      const target = Date.parse(s.timing.startAt),
        now = this.clock.utcMs();
      if (s.timing.parentDeadlineAt && now >= Date.parse(s.timing.parentDeadlineAt)) {
        await this.finish(e, "BUSINESS_FAILED", "DEADLINE_EXCEEDED", true);
        return;
      }
      if (now < target) return;
      if (now > target + s.timing.startToleranceMs) {
        await this.finish(e, "BUSINESS_FAILED", "START_WINDOW_MISSED", true);
        return;
      }
      const check = this.availabilityForOwned(e);
      if (check !== null) {
        await this.finish(e, "BUSINESS_FAILED", check, true);
        return;
      }
      s.startedAt = this.at();
      const deadline = Math.min(
        now + s.timing.maxElapsedMs,
        s.timing.parentDeadlineAt ? Date.parse(s.timing.parentDeadlineAt) : Infinity,
      );
      s.deadlineAt = new Date(deadline).toISOString();
      this.#monoDeadlines.set(e.taskId, this.clock.monotonicMs() + deadline - now);
      s.stage =
        s.component === "chassis"
          ? "mode_send"
          : operation.name.startsWith("camera.")
            ? "active_wait"
            : s.component === "simulationEffect"
              ? "active_wait"
              : "configure";
      e.state = "STARTING";
      e.reasonCode = "ZMQ_PREPARING";
      await this.save(e);
    }
    if (this.expired(e) && s.stage !== "stopping") {
      await this.requestStop(e, "DEADLINE_EXCEEDED");
      return;
    }
    if (s.component === "simulationEffect") {
      const problem = this.channelProblem(e);
      if (problem && !e.terminalAt) {
        await this.requestStop(e, problem);
        return;
      }
      if (s.stage === "active_wait" && !s.commands.some((c) => c.action === "effect")) {
        try {
          await this.validateEffectObservation(
            operation as Extract<Operation, { name: "simulation.applyEffect" }>,
            e.executionContext,
          );
        } catch {
          await this.finish(
            e,
            "BUSINESS_FAILED",
            "ZMQ_EFFECT_SOURCE_EXPIRED_BEFORE_DISPATCH",
            true,
          );
          return;
        }
        await this.send(e, "effect");
      } else {
        const held = s.occupancy;
        this.effectProgress(e);
        if (held !== s.occupancy || this.#dirty.has(e.taskId)) await this.save(e);
      }
      return;
    }
    const channelProblem = this.channelProblem(e);
    if (s.stage !== "stopping" && s.stage !== "uncertain" && channelProblem) {
      await this.requestStop(e, channelProblem);
      return;
    }
    const undispatched = s.commands.find(
      (c) => c.status === "intent" && c.generation === s.generation,
    );
    if (undispatched && s.stage !== "stopping") {
      await this.send(e, undispatched.action);
      return;
    }
    if (s.stage === "mode_send") {
      await this.sendMode(e);
      return;
    }
    if (s.stage === "mode_wait") {
      const mode = this.latest("chassis", "systemState", s.modeBaseline);
      if (mode && this.data(mode).mode === modeFor(operation.name)) {
        this.evidence(e, mode);
        s.stage = "configure";
        await this.save(e);
      } else if (this.clock.utcMs() - Date.parse(s.modeSentAt ?? this.at()) >= 3000) {
        if (s.modeAttempt < 3) await this.sendMode(e);
        else await this.finish(e, "BUSINESS_FAILED", "ZMQ_MODE_ECHO_TIMEOUT", true);
        return;
      } else return;
    }
    if (s.stage === "configure") {
      if (s.component === "chassis") {
        if (!s.commands.some((c) => c.action === "speed")) {
          await this.send(e, "speed");
          return;
        }
        if (!s.commands.some((c) => c.action === "obstacle")) {
          await this.send(e, "obstacle");
          return;
        }
        s.stage = "planning_wait";
      } else s.stage = "ready_wait";
      await this.send(e, "configure");
      return;
    }
    if (s.stage === "planning_wait") {
      const feedback = this.latest("chassis", "missionFeedback", s.taskBaseline);
      if (!feedback) return;
      this.evidence(e, feedback);
      if (this.data(feedback).status === 2) {
        await this.requestStop(e, "ZMQ_PLANNING_REJECTED");
        return;
      }
      if (![0, 1].includes(Number(this.data(feedback).status))) return;
      // This association is deliberately restricted to the declared loopback single-writer test.
      s.stage = "start_send";
      await this.save(e);
    }
    if (s.stage === "ready_wait") {
      const current = this.latest("eo", "task_status", s.taskBaseline),
        task = this.task(current);
      if (!current || task.task_id !== s.nativeTaskId) return;
      if (task.state === "ready") {
        this.evidence(e, current);
        s.stage = "start_send";
        await this.save(e);
      } else if (task.state === "failed") {
        s.nativeOutcome = "failed";
        s.nativeReason = typeof task.reason === "string" ? task.reason : "ZMQ_PREPARATION_FAILED";
        await this.requestStop(e, "ZMQ_PREPARATION_FAILED");
        return;
      } else return;
    }
    if (s.stage === "start_send") {
      s.stage = "active_wait";
      await this.send(e, "start");
      return;
    }
    if (s.stage === "uncertain") await this.reconcileInSession(e);
    if (operation.name.startsWith("camera.")) {
      if (!s.commands.some((c) => c.action === "camera") && s.stage === "active_wait") {
        await this.send(e, "camera");
        return;
      }
      await this.cameraProgress(e);
      return;
    }
    if (["active_wait", "running", "pause_wait", "paused", "resume_wait"].includes(s.stage))
      await this.taskProgress(e);
    if (s.stage === "stopping") await this.stopping(e);
  }
  private availabilityForOwned(e: ZmqExecution): string | null {
    this.#active.delete(e.zmqControl.component);
    try {
      const a = this.availability(e.arguments.operation as Operation);
      return a.available ? null : a.reasonCode;
    } finally {
      this.#active.set(e.zmqControl.component, e);
    }
  }
  private async sendMode(e: ZmqExecution) {
    e.zmqControl.modeAttempt++;
    e.zmqControl.stage = "mode_wait";
    e.zmqControl.modeBaseline = this.#sequence;
    e.zmqControl.modeSentAt = this.at();
    await this.send(e, "mode");
  }
  private async send(e: ZmqExecution, action: WireCommand["action"]): Promise<void> {
    const s = e.zmqControl;
    if (s.commands.length >= this.scope.settings.commandLimit - (action === "stop" ? 0 : 1)) {
      if (action !== "stop") await this.requestStop(e, "COMMAND_LIMIT_EXCEEDED");
      return;
    }
    let command = s.commands.find(
      (c) => c.action === action && c.status === "intent" && c.generation === s.generation,
    );
    if (!command) {
      command =
        action === "stop" && s.fallbackStop
          ? { ...structuredClone(s.fallbackStop), generation: s.generation }
          : commandFor(e, action, this.scope, this.at());
      s.commands.push(command);
    }
    s.lastCommand = command.stepId;
    s.baseline = this.#sequence;
    if (action === "configure") s.taskBaseline = this.#sequence;
    if (action === "stop") s.stopBaseline = this.#sequence;
    await this.save(e);
    const intent = journalFor(e, command, sha256(canonical(command.frames)));
    const claim = await this.repository.store.claimMutationJournal(intent);
    if (claim.record.state !== "INTENT_PERSISTED") {
      s.stage = "uncertain";
      await this.save(e);
      return;
    }
    const permit = () => {
      if (
        this.#closed ||
        this.#sourceInterrupted.has(e.taskId) ||
        this.nativeTypeConflict(e) !== undefined ||
        (action !== "stop" &&
          ((this.#invalidated.get(e.taskId) ?? s.generation) !== command.generation ||
            this.expired(e) ||
            !this.#healthy ||
            this.channelProblem(e) !== null))
      )
        throw Error("ZMQ_DISPATCH_SUPERSEDED");
    };
    await this.repository.assertWriter();
    try {
      permit();
    } catch {
      command.status = "superseded";
      await this.save(e);
      if (action !== "stop")
        await this.requestStop(
          e,
          this.expired(e)
            ? "DEADLINE_EXCEEDED"
            : (this.#invalidated.get(e.taskId) ?? s.generation) !== s.generation
              ? "CLIENT_REQUESTED"
              : "DISPATCH_REVOKED_OR_STATE_UNCONFIRMED",
        );
      return;
    }
    // Reserve a stable stop request before the first operation that can move hardware.
    // A later table-write failure can use it while the independently checked writer lease lives.
    if (
      ["camera", "configure", "start", "resume"].includes(action) &&
      !s.fallbackStop &&
      (s.component === "chassis" || s.nativeTaskId !== null || action === "camera")
    ) {
      s.fallbackStop = commandFor(e, "stop", this.scope, this.at());
      await this.save(e);
      await this.repository.store.claimMutationJournal(
        journalFor(e, s.fallbackStop, sha256(canonical(s.fallbackStop.frames))),
      );
    }
    command.status = "dispatching";
    command.dispatchAt = this.at();
    const dispatch = journalAdvance(claim.record, "DISPATCHING", command.dispatchAt);
    if (!(await this.repository.store.advanceMutationJournal(dispatch, "INTENT_PERSISTED")))
      throw Error("ZMQ_DISPATCH_FENCE_CONFLICT");
    await this.save(e);
    // The final lease check is followed by a synchronous revocation/deadline check inside transport.
    await this.repository.assertWriter();
    if (action === "stop") {
      this.#stopIssued.add(e.taskId);
      s.stopSentAt ??= this.at();
      s.stopDeadlineAt ??= new Date(this.clock.utcMs() + 3000).toISOString();
      this.#stopMonoDeadlines.set(
        e.taskId,
        this.clock.monotonicMs() + Math.max(0, Date.parse(s.stopDeadlineAt) - this.clock.utcMs()),
      );
    }
    let result;
    try {
      result = await this.transport.dispatch(command, permit);
    } catch {
      result = { outcome: "uncertain" as const, response: null };
    }
    command.status = result.outcome;
    command.response = result.response;
    command.completedAt = this.at();
    const nativeId =
      result.response?.command && typeof result.response.command === "object"
        ? (result.response.command as Record<string, unknown>).task_id
        : null;
    const completed = {
      ...journalAdvance(
        dispatch,
        result.outcome === "accepted"
          ? "ACCEPTED"
          : result.outcome === "rejected"
            ? "REJECTED"
            : "UNCERTAIN",
        command.completedAt,
      ),
      ...(typeof nativeId === "string" ? { externalMissionId: nativeId } : {}),
      resultHash: sha256(canonical(result)),
    };
    if (!(await this.repository.store.advanceMutationJournal(completed, "DISPATCHING")))
      throw Error("ZMQ_DISPATCH_RECEIPT_UNCONFIRMED");
    if (
      (action === "configure" || action === "effect") &&
      result.outcome === "accepted" &&
      typeof nativeId === "string"
    ) {
      if (await this.repository.nativeTaskUsed(s.component, nativeId, e.taskId)) {
        s.stage = "uncertain";
        s.missingEvidence.push("NATIVE_TASK_ID_REUSED");
      } else {
        s.nativeTaskId = nativeId;
        e.downstreamMissionIds = [nativeId];
      }
    }
    if (result.outcome === "rejected") {
      const error = result.response?.error as Record<string, unknown> | undefined;
      s.nativeReason = typeof error?.code === "string" ? error.code : "ZMQ_COMMAND_REJECTED";
      if (
        (action === "configure" || action === "camera" || action === "effect") &&
        s.nativeTaskId === null
      ) {
        await this.finish(e, "BUSINESS_FAILED", s.nativeReason, true);
        return;
      }
      await this.requestStop(e, s.nativeReason);
      return;
    }
    if (result.outcome === "uncertain") {
      s.stage = action === "stop" ? "stopping" : "uncertain";
      e.reasonCode = "ZMQ_COMMAND_OUTCOME_UNKNOWN";
    } else if (action === "stop") {
      s.stage = "stopping";
      e.reasonCode = "ZMQ_STOP_ACCEPTED_UNCONFIRMED";
    }
    await this.save(e);
  }
  private task(value: Observed | undefined): Record<string, unknown> {
    const data = this.data(value);
    return data.task && typeof data.task === "object" ? (data.task as Record<string, unknown>) : {};
  }
  private nativeTypeConflict(e: ZmqExecution): Observed | undefined {
    const s = e.zmqControl,
      operation = e.arguments.operation as Operation;
    if (
      s.component === "simulationEffect" ||
      s.nativeTaskId === null ||
      operation.name.startsWith("camera.")
    )
      return undefined;
    const current = this.latest(
      s.component,
      s.component === "chassis" ? "missionState" : "task_status",
    );
    const task = s.component === "chassis" ? this.data(current) : this.task(current);
    if (
      !current ||
      String(s.component === "chassis" ? task.missionId : task.task_id) !== s.nativeTaskId
    )
      return undefined;
    const expected =
      s.component === "chassis"
        ? operation.name === "navigation.point"
          ? 1
          : operation.name === "navigation.route"
            ? 2
            : 4
        : ["recon.area", "inspection.area"].includes(operation.name)
          ? "AreaSearch"
          : "CircularSearch";
    return (s.component === "chassis" ? task.missionType : task.task_type) === expected
      ? undefined
      : current;
  }
  private channelProblem(e: ZmqExecution): string | null {
    const component = e.zmqControl.component;
    const value = this.latest(component, component === "chassis" ? "systemState" : "device_status"),
      d = this.data(value);
    if (!value) return "ZMQ_STATE_STALE_OR_DISCONNECTED";
    if (component === "chassis") {
      if (["RUNNING", "PAUSED", "RESUMING", "STOPPING"].includes(e.state)) {
        const mission = this.data(this.latest("chassis", "missionState"));
        if (
          typeof mission.missionId === "number" &&
          String(mission.missionId) !== e.zmqControl.nativeTaskId
        )
          return "ZMQ_EXTERNAL_CHASSIS_OWNER";
      }
      return d.runState === 1 && Array.isArray(d.errorCodes) && d.errorCodes.length === 0
        ? null
        : "ZMQ_CHASSIS_FAULT";
    }
    if (component === "simulationEffect") {
      if (d.mode === "fault") return "ZMQ_SIMULATION_EFFECT_FAULT";
      if (d.active_task_id !== null && d.active_task_id !== e.zmqControl.nativeTaskId)
        return "ZMQ_EXTERNAL_EFFECT_OWNER";
      return null;
    }
    if (d.mode === "fault" || d.gimbal_online !== true || d.camera_online !== true)
      return "ZMQ_EO_FAULT";
    if (d.active_task_id !== null && d.active_task_id !== e.zmqControl.nativeTaskId)
      return "ZMQ_EXTERNAL_EO_OWNER";
    return null;
  }
  private async reconcileInSession(e: ZmqExecution): Promise<void> {
    const s = e.zmqControl;
    if (s.component !== "eo") return;
    const current = this.latest("eo", "task_status", s.taskBaseline),
      data = this.data(current),
      task = this.task(current),
      command = object(data.command);
    const uncertain = s.commands.find(
      (c) => c.status === "uncertain" && c.requestId === command.request_id,
    );
    if (!current || !uncertain || typeof task.task_id !== "string") return;
    if (s.nativeTaskId === null && uncertain.action === "configure") {
      if (await this.repository.nativeTaskUsed("eo", task.task_id, e.taskId)) return;
      s.nativeTaskId = task.task_id;
      e.downstreamMissionIds = [task.task_id];
      // Configuration ACK was lost: learn the identity for an explicit cancel, never auto-START.
      this.evidence(e, current);
      await this.save(e);
      return;
    }
    if (task.task_id !== s.nativeTaskId) return;
    if (["start", "resume"].includes(uncertain.action) && task.state === "searching") {
      s.stage = "running";
      e.state = "RUNNING";
      e.reasonCode = "ZMQ_RECONCILED_FROM_CORRELATED_SNAPSHOT";
      this.evidence(e, current);
      await this.save(e);
    } else if (uncertain.action === "pause" && task.state === "paused") {
      s.stage = "pause_wait";
      await this.taskProgress(e);
    }
  }
  private stationary(e: ZmqExecution, position: Observed | undefined): boolean {
    if (!position) {
      this.#stationary.delete(e.taskId);
      return false;
    }
    const velocity = this.data(position).velocityEnu;
    if (
      !Array.isArray(velocity) ||
      velocity.length !== 3 ||
      Math.hypot(...velocity.map(Number)) > this.scope.settings.stationarySpeedMps
    ) {
      this.#stationary.delete(e.taskId);
      return false;
    }
    const now = Number(BigInt(position.receipt.monotonicNs) / 1000000n),
      prior = this.#stationary.get(e.taskId);
    if (!prior)
      this.#stationary.set(e.taskId, { firstMs: now, lastSequence: position.sequence, count: 1 });
    else if (position.sequence > prior.lastSequence) {
      prior.lastSequence = position.sequence;
      prior.count++;
    }
    const window = this.#stationary.get(e.taskId);
    return !!window && window.count >= 2 && now - window.firstMs >= 100;
  }
  private evidence(e: ZmqExecution, value: Observed) {
    const refs = e.zmqControl.latestEvidence;
    if (!refs.some((r) => r.entryHash === value.ref.entryHash)) {
      refs.push(value.ref);
      if (refs.length > 8) refs.shift();
    }
  }
  private async taskProgress(e: ZmqExecution): Promise<void> {
    const s = e.zmqControl,
      current = this.latest(
        s.component,
        s.component === "chassis" ? "missionState" : "task_status",
        s.baseline,
      );
    if (!current) return;
    const task = s.component === "chassis" ? this.data(current) : this.task(current);
    if (String(s.component === "chassis" ? task.missionId : task.task_id) !== s.nativeTaskId)
      return;
    const state =
      s.component === "chassis"
        ? ({ 0: "ready", 1: "searching", 2: "paused", 3: "canceled", 4: "completed", 5: "failed" }[
            Number(task.state)
          ] ?? "unknown")
        : String(task.state);
    if (state === "searching" && ["active_wait", "resume_wait"].includes(s.stage)) {
      s.stage = "running";
      e.state = "RUNNING";
      e.reasonCode = "ZMQ_RUNNING";
    } else if (state === "paused" && s.stage === "pause_wait") {
      const device = this.data(this.latest("eo", "device_status", s.baseline));
      const stopped =
        s.component === "chassis"
          ? this.stationary(e, this.latest("chassis", "localization", s.baseline))
          : device.mode === "task" &&
            device.active_task_id === s.nativeTaskId &&
            device.fault_code === null;
      if (!stopped) return;
      s.stage = "paused";
      e.state = "PAUSED";
      e.reasonCode = "ZMQ_PAUSED";
    } else if (["completed", "canceled", "failed"].includes(state)) {
      s.nativeOutcome = state;
      s.nativeReason = typeof task.reason === "string" ? task.reason : null;
      s.stage = "stopping";
      e.state = "STOPPING";
      s.stopReason ??=
        state === "completed"
          ? "NATIVE_COMPLETED"
          : state === "canceled"
            ? "NATIVE_CANCELED"
            : "NATIVE_FAILED";
      s.stopBaseline = current.sequence - 1;
      s.stopSentAt ??= this.at();
      s.stopDeadlineAt ??= new Date(this.clock.utcMs() + 3000).toISOString();
    } else return;
    this.evidence(e, current);
    await this.save(e);
  }
  private async cameraProgress(e: ZmqExecution): Promise<void> {
    if (e.zmqControl.stage === "stopping") {
      await this.stopping(e);
      return;
    }
    const s = e.zmqControl,
      current = this.latest("eo", "device_status", s.baseline),
      data = this.data(current),
      tele = object(data.telecontrol),
      command = object(tele.command);
    const sent = s.commands.find((c) => c.action === "camera");
    if (!current || !sent || command.request_id !== sent.requestId) return;
    this.evidence(e, current);
    if (tele.state === "running") {
      s.stage = "running";
      e.state = "RUNNING";
      e.reasonCode = "ZMQ_RUNNING";
      await this.save(e);
    } else if (
      tele.state === "succeeded" &&
      data.ready === true &&
      data.mode === "idle" &&
      data.active_task_id === null
    ) {
      const operation = e.arguments.operation as Operation,
        settings = this.scope.settings;
      const physicalMatches =
        operation.name === "camera.position"
          ? typeof data.gimbal_yaw_rad === "number" &&
            typeof data.gimbal_pitch_rad === "number" &&
            Math.abs(data.gimbal_yaw_rad - operation.params.yaw_rad) <=
              settings.positionToleranceRad &&
            Math.abs(data.gimbal_pitch_rad - operation.params.pitch_rad) <=
              settings.positionToleranceRad
          : operation.name === "camera.zoom"
            ? typeof data.zoom_ratio === "number" &&
              Math.abs(data.zoom_ratio - operation.params.zoom_ratio) <= settings.zoomTolerance
            : true;
      if (!physicalMatches) {
        s.missingEvidence.push("PHYSICAL_COMPLETION_FEEDBACK_CONFLICT");
        await this.requestStop(e, "ZMQ_COMPLETION_FEEDBACK_CONFLICT");
        return;
      }
      s.stopConfirmed = true;
      await this.finish(e, "SUCCEEDED", "ZMQ_CAMERA_COMPLETED", true);
    } else if (tele.state === "failed") {
      s.nativeOutcome = "failed";
      s.nativeReason = typeof command.reason === "string" ? command.reason : "ZMQ_CAMERA_FAILED";
      await this.requestStop(e, s.nativeReason);
    }
  }
  private async requestStop(e: ZmqExecution, reason: string): Promise<void> {
    const s = e.zmqControl;
    if (s.component === "simulationEffect") {
      const attempted = s.commands.some(
        (c) => c.action === "effect" && !["intent", "superseded", "rejected"].includes(c.status),
      );
      if (!attempted) {
        await this.finish(e, "BUSINESS_FAILED", reason, true);
        return;
      }
      if (!e.terminalAt) {
        s.stage = "uncertain";
        s.occupancy = "held";
        e.state = "TECHNICAL_FAILED";
        e.reasonCode = reason;
        e.terminalAt = this.at();
        s.missingEvidence.push("SIMULATION_EXECUTION_NOT_CONFIRMED_FINISHED");
        e.result = this.effectResult(e);
        await this.save(e);
      } else {
        const held = s.occupancy;
        this.effectProgress(e);
        if (held !== s.occupancy || this.#dirty.has(e.taskId)) await this.save(e);
      }
      return;
    }
    if (s.stage === "stopping") return;
    s.generation = Math.max(s.generation + 1, this.#invalidated.get(e.taskId) ?? 0);
    this.#invalidated.set(e.taskId, s.generation);
    s.stopRequestedAt ??= this.at();
    s.stopReason ??= reason;
    if (this.channelProblem(e) === "ZMQ_EXTERNAL_CHASSIS_OWNER") {
      s.stage = "uncertain";
      e.state = "TECHNICAL_FAILED";
      e.reasonCode = "ZMQ_CONTROL_OWNERSHIP_UNCONFIRMED";
      e.terminalAt ??= this.at();
      s.missingEvidence = [...new Set([...s.missingEvidence, "CONTROL_OWNERSHIP_UNCONFIRMED"])];
      e.result ??= this.result(e);
      await this.save(e);
      return;
    }
    for (const command of s.commands)
      if (command.status === "intent") command.status = "superseded";
    const moving = s.commands.some(
      (c) =>
        ["configure", "start", "resume", "camera"].includes(c.action) &&
        !["intent", "superseded", "rejected"].includes(c.status),
    );
    if (!moving) {
      await this.finish(
        e,
        reason === "CLIENT_REQUESTED" ? "CANCELLED" : "BUSINESS_FAILED",
        reason,
        true,
      );
      return;
    }
    s.stage = "stopping";
    e.state = "STOPPING";
    e.reasonCode = "ZMQ_STOPPING";
    await this.save(e);
    if (
      s.component === "eo" &&
      !s.nativeTaskId &&
      !(e.arguments.operation as Operation).name.startsWith("camera.")
    ) {
      s.stage = "uncertain";
      e.reasonCode = "ZMQ_NATIVE_TASK_UNKNOWN_STOP_UNAVAILABLE";
      await this.save(e);
      return;
    }
    await this.send(e, "stop");
  }
  private async stopping(e: ZmqExecution): Promise<void> {
    const s = e.zmqControl;
    if (this.#fallbackReceipts.has(e.taskId)) {
      const stop = s.commands.find((c) => c.action === "stop");
      if (stop?.dispatchAt && stop.completedAt) {
        const intent =
          (await this.repository.store.getMutationJournalEntry(e.taskId, stop.stepId)) ??
          (
            await this.repository.store.claimMutationJournal(
              journalFor(e, stop, sha256(canonical(stop.frames))),
            )
          ).record;
        if (intent.state === "INTENT_PERSISTED") {
          const dispatched = journalAdvance(intent, "DISPATCHING", stop.dispatchAt);
          if (await this.repository.store.advanceMutationJournal(dispatched, "INTENT_PERSISTED"))
            await this.repository.store.advanceMutationJournal(
              journalAdvance(
                dispatched,
                stop.status === "accepted" ? "ACCEPTED" : "UNCERTAIN",
                stop.completedAt,
              ),
              "DISPATCHING",
            );
        }
        this.#fallbackReceipts.delete(e.taskId);
      }
    }
    let confirmed: boolean;
    if (s.component === "eo") {
      const status = this.latest("eo", "device_status", s.stopBaseline),
        d = this.data(status),
        taskStatus = this.latest("eo", "task_status", s.stopBaseline),
        task = this.task(taskStatus);
      const stop = s.commands.find((c) => c.action === "stop"),
        camera = (e.arguments.operation as Operation).name.startsWith("camera.");
      const tele = object(d.telecontrol),
        command = object(tele.command);
      const taskStopped =
        s.nativeTaskId === task.task_id &&
        ["completed", "canceled", "failed"].includes(String(task.state));
      const cameraStopped =
        !!stop &&
        command.request_id === stop.requestId &&
        tele.action === "stop" &&
        tele.state === "succeeded";
      confirmed =
        !!status &&
        d.ready === true &&
        d.mode === "idle" &&
        d.active_task_id === null &&
        (camera ? cameraStopped : taskStopped);
      if (confirmed && status) {
        this.evidence(e, status);
        if (taskStatus) this.evidence(e, taskStatus);
        if (!camera) {
          s.nativeOutcome = String(task.state);
          s.nativeReason = typeof task.reason === "string" ? task.reason : null;
        }
      }
    } else {
      const mission = this.latest("chassis", "missionState", s.stopBaseline),
        m = this.data(mission),
        position = this.latest("chassis", "localization", s.stopBaseline);
      confirmed =
        !!mission &&
        !!position &&
        String(m.missionId) === s.nativeTaskId &&
        [3, 4, 5].includes(Number(m.state)) &&
        this.stationary(e, position);
      if (confirmed && mission && position) {
        this.evidence(e, mission);
        this.evidence(e, position);
        s.nativeOutcome =
          ({ 3: "canceled", 4: "completed", 5: "failed" } as Record<number, string>)[
            Number(m.state)
          ] ?? null;
      }
    }
    if (confirmed) {
      s.stopConfirmed = true;
      const success = s.stopReason === "NATIVE_COMPLETED" && s.nativeOutcome === "completed";
      const canceled = ["CLIENT_REQUESTED", "NATIVE_CANCELED"].includes(s.stopReason ?? "");
      await this.finish(
        e,
        success ? "SUCCEEDED" : canceled ? "CANCELLED" : "BUSINESS_FAILED",
        success ? "ZMQ_TASK_COMPLETED" : (s.stopReason ?? "ZMQ_STOPPED"),
        true,
      );
    } else if (
      s.stopDeadlineAt &&
      (this.clock.utcMs() >= Date.parse(s.stopDeadlineAt) ||
        this.clock.monotonicMs() >= (this.#stopMonoDeadlines.get(e.taskId) ?? Infinity)) &&
      e.reasonCode !== "ZMQ_STOP_UNCONFIRMED"
    ) {
      e.state = "TECHNICAL_FAILED";
      e.reasonCode = "ZMQ_STOP_UNCONFIRMED";
      e.terminalAt ??= this.at();
      s.missingEvidence = [...new Set([...s.missingEvidence, "PHYSICAL_STOP_UNCONFIRMED"])];
      e.result ??= this.result(e);
      // Continue supervision and retain occupancy. Never resend stop or rewrite this terminal result.
      await this.save(e);
    }
  }
  private async finish(
    e: ZmqExecution,
    state: ZmqExecution["state"],
    reason: string,
    release: boolean,
  ) {
    const s = e.zmqControl;
    s.stage = "terminal";
    if (release) s.occupancy = "released";
    if (!e.terminalAt) {
      e.state = state;
      e.reasonCode = reason;
      e.terminalAt = this.at();
      e.result = this.result(e);
    }
    await this.save(e);
    if (release) {
      this.#active.delete(s.component);
      this.#monoDeadlines.delete(e.taskId);
      this.#stopMonoDeadlines.delete(e.taskId);
      this.#stationary.delete(e.taskId);
    }
  }
  private result(e: ZmqExecution): Record<string, unknown> {
    const s = e.zmqControl;
    if (e.zmqEffect) return this.effectResult(e);
    return structuredClone({
      schemaVersion:
        this.scope.settings.mode === "site_control"
          ? "ugv.zmq-control-result/2"
          : "ugv.zmq-control-result/1",
      qualification:
        this.scope.settings.mode === "site_control" ? "site_control" : "isolated_simulator_only",
      runtimeAdmission:
        this.scope.settings.mode === "site_control"
          ? "site_runtime"
          : e.zmqAdmission
            ? "isolated_runtime"
            : "not_published",
      nativeTaskId: s.nativeTaskId,
      nativeOutcome: s.nativeOutcome,
      nativeReason: s.nativeReason,
      stopConfirmed: s.stopConfirmed,
      occupancy: s.occupancy,
      missingEvidence: s.missingEvidence,
      sourceRefs: s.latestEvidence,
      ...(e.zmqInspection
        ? inspectionReport(
            {
              ...e.zmqInspection,
              missingEvidence: [...s.missingEvidence, ...e.zmqInspection.missingEvidence],
            },
            (this.#pendingReports.get(e.taskId) ?? 0) > 0,
          )
        : {}),
      ...(this.scope.settings.mode === "site_control" && e.zmqInspection
        ? { schemaVersion: "ugv.zmq-inspection-result/2" }
        : {}),
    });
  }
  private async fallbackStop(e: ZmqExecution): Promise<void> {
    const s = e.zmqControl;
    if (
      !s.fallbackStop ||
      this.#sourceInterrupted.has(e.taskId) ||
      this.nativeTypeConflict(e) !== undefined ||
      this.#stopIssued.has(e.taskId) ||
      this.#closed ||
      s.occupancy !== "held" ||
      this.channelProblem(e) === "ZMQ_EXTERNAL_CHASSIS_OWNER"
    )
      return;
    // Losing the writer lease disables every send, including this path. No automatic takeover.
    try {
      await this.repository.assertWriter();
    } catch {
      return;
    }
    this.#stopIssued.add(e.taskId);
    this.#fallbackReceipts.add(e.taskId);
    s.generation++;
    this.#invalidated.set(e.taskId, s.generation);
    const command = { ...structuredClone(s.fallbackStop), generation: s.generation };
    command.dispatchAt = this.at();
    command.status = "dispatching";
    if (!s.commands.some((c) => c.stepId === command.stepId)) s.commands.push(command);
    s.stage = "stopping";
    e.state = "STOPPING";
    s.stopReason ??= "PERSISTENCE_UNCONFIRMED";
    s.stopRequestedAt ??= this.at();
    s.stopSentAt ??= this.at();
    s.stopDeadlineAt ??= new Date(this.clock.utcMs() + 3000).toISOString();
    s.stopBaseline = this.#sequence;
    s.missingEvidence = [
      ...new Set([...s.missingEvidence, "STOP_DISPATCH_RECEIPT_PERSISTENCE_UNCONFIRMED"]),
    ];
    try {
      const result = await this.transport.dispatch(command, () => {
        if (this.#closed) throw Error("ZMQ_CONTROL_CLOSED");
      });
      command.status = result.outcome;
      command.response = result.response;
    } catch {
      command.status = "uncertain";
    }
    command.completedAt = this.at();
    this.events.emit("fault", "ZMQ_PREARMED_STOP_DISPATCHED_PERSISTENCE_UNCONFIRMED");
  }
  private async save(e: ZmqExecution) {
    e.revision++;
    e.updatedAt = this.at();
    try {
      await this.repository.save(e);
      await this.hooks?.persisted(structuredClone(e));
      this.#dirty.delete(e.taskId);
    } catch (error) {
      this.#dirty.add(e.taskId);
      throw error;
    }
    this.events.emit("execution", structuredClone(e));
  }
  async idle() {
    await this.#admission.idle();
    await Promise.all(Object.values(this.#lanes).map((lane) => lane.idle()));
  }
  async close(): Promise<void> {
    this.#closed = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#detach?.();
    this.transport.close();
    await this.idle();
    await this.repository.close();
  }
}
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
export type CommittedObservation = ArchiveEntry;

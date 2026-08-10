import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  jsonToProtoStruct,
  protoStructToJson,
} from "../../../packages/adapter-protocol/src/index.js";
import type {
  CommandAckRecord,
  ExecutionContextRecord,
  ProviderExecution,
  ProviderExecutionState,
  ProviderStore,
} from "../../../packages/provider-adapter-kit/src/index.js";
import type {
  UgvDeviceMcpClient,
  UgvDeviceToolName,
} from "../../../packages/vehicle-device-mcp-client/src/index.js";
import {
  controlDeviceCalls,
  canonicalUgvMissionId,
  DeviceToolRejectedError,
  executeUgvStartFlow,
  fireConfirmationCalls,
  missionIdFromUgvResult,
  parseUgvMissionId,
  requiredUgvDeviceTools,
  UncertainMutatingDeviceCallError,
} from "../../../packages/vehicle-device-mcp-client/src/index.js";
import {
  normalizeMqttObservation,
  type VehicleMqttIngress,
} from "../../../packages/vehicle-mqtt-ingress/src/index.js";
import {
  assertNoRefereeData,
  checkVehicleAvailability,
  freshnessState,
  mapReconMotionStatus,
  mapVehicleTaskState,
  monotonicProgress,
  OPERATION_TRACKS,
  sanitizeFireResult,
  TrackArbiter,
  vehicleEvidence,
  type AvailabilityDecision,
  type FreshnessPolicy,
  type UgvSnapshot,
  type VehicleReconnaissanceState,
  type VehicleTaskTrack,
  type VehicleTrack,
} from "../../../packages/vehicle-provider-core/src/index.js";
import type { UgvBusinessEventHub } from "./business-events.js";
import type { UgvTelemetry } from "./telemetry.js";
import { normalizeUgvCapabilities } from "./capabilities.js";
import { deduplicateTargets, normalizeDeviceTargets } from "./targets.js";

const OPERATIONS = new Set(Object.keys(OPERATION_TRACKS));
const SYNC_OPERATIONS = new Set([
  "vehicle_get_state",
  "vehicle_get_capabilities",
  "vehicle_get_payload_status",
  "vehicle_get_targets",
  "vehicle_laser_range",
]);
const FIRE_DISPATCH_COMMAND = "fire_dispatch";
const FIRE_DISPATCH_SEQUENCE = "0";
const FIRE_DISPATCH_NOT_ARMED = "UGV_FIRE_DISPATCH_NOT_ARMED";
const FIRE_DISPATCH_ABORTED = "UGV_FIRE_DISPATCH_ABORTED";
const FIRE_LOCAL_CANCELLATION_REASONS = new Set([
  "UGV_FIRE_CONFIRMATION_REJECTED",
  "UGV_FIRE_CANCELLED_BEFORE_DISPATCH",
]);

export interface StartUgvOperation {
  taskId: string;
  operationName: string;
  arguments: Record<string, unknown>;
  argumentHash: string;
  executionContext: ExecutionContextRecord;
}
export interface CommandIdentity {
  taskId: string;
  externalExecutionId: string;
  operationName: string;
  argumentHash: string;
  executionContext: ExecutionContextRecord;
  commandSequence: string;
}

export class UgvProviderRuntime {
  readonly arbiter: TrackArbiter;
  readonly events = new EventEmitter();
  #unsubscribeSnapshot: (() => void) | undefined;
  #poller: NodeJS.Timeout | undefined;
  #deviceReconnect: Promise<void> | undefined;
  #mutationTail: Promise<void> = Promise.resolve();
  #pollPromise: Promise<void> | undefined;
  #lastObservedSnapshot: UgvSnapshot | undefined;
  readonly #freshnessStates = new Map<string, "fresh" | "stale" | "unknown">();
  constructor(
    readonly options: {
      providerId: string;
      freshness: FreshnessPolicy;
      allowNavigationWithRecon: boolean;
      fireRequiresChassisStopped: boolean;
      pollIntervalMs: number;
    },
    readonly store: ProviderStore,
    readonly ingress: VehicleMqttIngress,
    readonly device: UgvDeviceMcpClient,
    readonly businessEvents: UgvBusinessEventHub,
    readonly telemetry: UgvTelemetry,
  ) {
    this.arbiter = new TrackArbiter(options.allowNavigationWithRecon);
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
    await this.device.connect();
    this.ingress.setDeviceConnected(this.device.connected());
    this.#unsubscribeSnapshot = this.ingress.onSnapshot((snapshot, topic) => {
      void this.#observe(snapshot, topic);
    });
    await this.recover();
    this.#poller = setInterval(() => void this.pollActive(), this.options.pollIntervalMs);
  }
  async close(): Promise<void> {
    if (this.#poller !== undefined) clearInterval(this.#poller);
    this.#unsubscribeSnapshot?.();
    await this.#mutationTail.catch(() => undefined);
    await this.device.close();
    await this.store.close();
  }
  snapshot(): UgvSnapshot {
    return this.ingress.snapshot();
  }
  executionSnapshot(execution: ProviderExecution): Record<string, unknown> {
    return executionSnapshot(execution);
  }
  start(
    input: StartUgvOperation,
  ): Promise<{ externalExecutionId: string; initialSnapshot: Record<string, unknown> }> {
    return this.#serializeMutation(() => this.#start(input));
  }

  async #start(
    input: StartUgvOperation,
  ): Promise<{ externalExecutionId: string; initialSnapshot: Record<string, unknown> }> {
    validateStart(input);
    if (SYNC_OPERATIONS.has(input.operationName)) return this.#synchronous(input);
    const existing = await this.store.getExecution(input.taskId);
    if (existing !== undefined) {
      assertIdentity(existing, input);
      return {
        externalExecutionId: existing.externalExecutionId,
        initialSnapshot: executionSnapshot(existing),
      };
    }
    const decision = this.availability(input.operationName, input.arguments);
    if (decision.availability !== "AVAILABLE") throw new Error(decision.reasonCode);
    const acquired = this.arbiter.acquire(input.taskId, input.operationName);
    if (!acquired.accepted) throw new Error(acquired.reasonCode);
    const now = new Date().toISOString();
    const tracks = OPERATION_TRACKS[input.operationName] ?? [];
    const observationCursors = initialObservationCursors(input.operationName, this.ingress);
    let execution: ProviderExecution = {
      taskId: input.taskId,
      externalExecutionId: `ugv1:${tracks[0] ?? "query"}:${randomUUID()}`,
      operationName: input.operationName,
      argumentHash: input.argumentHash,
      resourceId: "vehicle:ugv1",
      tracks,
      arguments: structuredClone(input.arguments),
      executionContext: structuredClone(input.executionContext),
      downstreamMissionIds: [],
      ...(observationCursors === undefined ? {} : { observationCursors }),
      state: input.operationName === "vehicle_fire_weapon" ? "WAITING_INPUT" : "ACCEPTED",
      revision: 1,
      reasonCode:
        input.operationName === "vehicle_fire_weapon"
          ? "UGV_FIRE_CONFIRMATION_REQUIRED"
          : "UGV_OPERATION_ACCEPTED",
      createdAt: now,
      updatedAt: now,
      evidence: [],
    };
    try {
      await this.store.putExecution(execution);
    } catch (error) {
      this.arbiter.release(input.taskId);
      throw error;
    }
    try {
      if (input.operationName !== "vehicle_fire_weapon") {
        const dispatchCursors = initialObservationCursors(input.operationName, this.ingress);
        const dispatchExecution = withObservationBaselines(execution, dispatchCursors);
        if (dispatchExecution.revision !== execution.revision) {
          execution = dispatchExecution;
          await this.store.putExecution(execution);
        }
        const deviceArguments =
          input.operationName === "vehicle_emergency_stop"
            ? await this.#emergencyStopArguments(input.arguments)
            : input.arguments;
        await executeUgvStartFlow(
          input.operationName,
          deviceArguments,
          (name, argumentsValue) => this.#callDevice(name, argumentsValue, input.taskId),
          {
            onMissionId: async (missionId) => {
              if (execution.downstreamMissionIds.includes(missionId)) return;
              execution = withMissionId(execution, missionId);
              await this.store.putExecution(execution);
            },
          },
        );
        execution = transition(execution, "STARTING", "UGV_WAITING_DEVICE_CONFIRMATION");
        await this.store.putExecution(execution);
        await this.#startedEvent(execution);
      }
      await this.telemetry.emit(
        "EXECUTION_PROGRESS",
        { transition: execution.state, reasonCode: execution.reasonCode },
        identityTelemetry(execution),
      );
      return {
        externalExecutionId: execution.externalExecutionId,
        initialSnapshot: executionSnapshot(execution),
      };
    } catch (error) {
      if (error instanceof UncertainMutatingDeviceCallError) {
        execution = transition(execution, "STARTING", "UNCERTAIN_EXECUTION_STATE");
        await this.store.putExecution(execution);
        return {
          externalExecutionId: execution.externalExecutionId,
          initialSnapshot: executionSnapshot(execution),
        };
      }
      this.arbiter.release(input.taskId);
      const failed = terminal(
        execution,
        error instanceof DeviceToolRejectedError ? "BUSINESS_FAILED" : "TECHNICAL_FAILED",
        reason(error),
        {
          resourceId: "vehicle:ugv1",
          status: "failed",
          observedAt: new Date().toISOString(),
        },
      );
      await this.store.putExecution(failed);
      throw error;
    }
  }

  availability(
    operationName: string,
    argumentsValue: Record<string, unknown>,
    ignoreOwnedByTaskId?: string,
  ): AvailabilityDecision {
    if (!OPERATIONS.has(operationName))
      return {
        availability: "DISABLED",
        riskLevel: "LOW",
        reasonCode: "UGV_OPERATION_UNSUPPORTED",
        description: "UGV_OPERATION_UNSUPPORTED",
      };
    const requiredTools = requiredUgvDeviceTools(operationName, argumentsValue);
    return checkVehicleAvailability({
      operationName,
      snapshot: this.ingress.snapshot(),
      freshness: this.options.freshness,
      occupiedTracks: new Set(
        [...this.arbiter.occupied()].filter(
          (track) => this.arbiter.owner(track) !== ignoreOwnedByTaskId,
        ),
      ),
      requiredToolsPresent: requiredTools.every((tool) => this.device.toolAvailable(tool)),
      ...(typeof argumentsValue.targetId === "string" ? { targetId: argumentsValue.targetId } : {}),
      allowNavigationWithRecon: this.options.allowNavigationWithRecon,
      fireRequiresChassisStopped: this.options.fireRequiresChassisStopped,
      circularScanSupported: true,
      ...(typeof argumentsValue.scanMode === "string" ? { scanMode: argumentsValue.scanMode } : {}),
    });
  }

  get(taskId: string): Promise<ProviderExecution | undefined> {
    return this.#serializeMutation(async () => {
      const execution = await this.store.getExecution(taskId);
      if (execution === undefined) return undefined;
      return this.#refresh(execution);
    });
  }

  command(
    command: "pause" | "resume" | "cancel",
    identity: CommandIdentity,
  ): Promise<Record<string, unknown>> {
    return this.#serializeMutation(() => this.#command(command, identity));
  }

  async #command(
    command: "pause" | "resume" | "cancel",
    identity: CommandIdentity,
  ): Promise<Record<string, unknown>> {
    const old = await this.store.getCommandAck(identity.taskId, command, identity.commandSequence);
    if (old !== undefined) return old.response;
    const execution = await this.store.getExecution(identity.taskId);
    if (execution === undefined) return this.#ack(identity, command, false, "EXECUTION_NOT_FOUND");
    if (!sameIdentity(execution, identity))
      return this.#ack(identity, command, false, "TASK_IDENTITY_CONFLICT");
    if (execution.operationName === "vehicle_fire_weapon" && command === "cancel") {
      if (execution.state === "WAITING_INPUT")
        return this.#cancelUndispatchedFire(
          execution,
          identity,
          command,
          true,
          "UGV_FIRE_CANCELLED_BEFORE_DISPATCH",
        );
      return this.#ack(identity, command, false, "UGV_FIRE_CANCEL_UNSUPPORTED_AFTER_DISPATCH");
    }
    if (!commandSupported(execution.operationName, command))
      return this.#ack(identity, command, false, `${command.toUpperCase()}_NOT_SUPPORTED`);
    try {
      const persistedMissionId = execution.downstreamMissionIds.at(-1);
      if (
        persistedMissionId === undefined &&
        (execution.operationName === "vehicle_navigate" ||
          execution.operationName === "vehicle_area_recon")
      )
        throw new Error("UGV_PERSISTED_MISSION_ID_REQUIRED");
      for (const call of controlDeviceCalls(
        execution.operationName,
        command,
        persistedMissionId ?? 0,
      ))
        await this.#callDevice(call.name, call.arguments, execution.taskId);
      const targetState =
        command === "pause" ? "RUNNING" : command === "resume" ? "RESUMING" : "STOPPING";
      const reasonCode =
        command === "pause"
          ? "UGV_PAUSE_REQUEST_ACCEPTED"
          : command === "resume"
            ? "UGV_RESUME_REQUEST_ACCEPTED"
            : "UGV_CANCEL_REQUEST_ACCEPTED";
      await this.store.putExecution(transition(execution, targetState, reasonCode));
      return await this.#ack(identity, command, true, reasonCode);
    } catch (error) {
      if (error instanceof UncertainMutatingDeviceCallError) {
        const uncertainState = command === "cancel" ? "STOPPING" : execution.state;
        await this.store.putExecution(
          transition(execution, uncertainState, "UNCERTAIN_EXECUTION_STATE"),
        );
      }
      return this.#ack(identity, command, false, reason(error));
    }
  }

  updateFire(identity: CommandIdentity, responses: unknown): Promise<Record<string, unknown>> {
    return this.#serializeMutation(() => this.#updateFire(identity, responses));
  }

  async #updateFire(
    identity: CommandIdentity,
    responses: unknown,
  ): Promise<Record<string, unknown>> {
    const command = "update";
    const old = await this.store.getCommandAck(identity.taskId, command, identity.commandSequence);
    if (old !== undefined) return old.response;
    let execution = await this.store.getExecution(identity.taskId);
    if (execution === undefined) return this.#ack(identity, command, false, "EXECUTION_NOT_FOUND");
    if (!sameIdentity(execution, identity))
      return this.#ack(identity, command, false, "TASK_IDENTITY_CONFLICT");
    const existingDispatch = await this.store.getCommandAck(
      identity.taskId,
      FIRE_DISPATCH_COMMAND,
      FIRE_DISPATCH_SEQUENCE,
    );
    const existingCancellation = fireCancellationReason(existingDispatch);
    if (
      existingCancellation !== undefined &&
      execution.operationName === "vehicle_fire_weapon" &&
      execution.state === "WAITING_INPUT"
    ) {
      try {
        await this.#persistLocalFireCancellation(execution, existingCancellation);
      } catch {
        return replayCommandResponse(
          this.#fireDispatchRecord(identity, true, "UNCERTAIN_EXECUTION_STATE").response,
          identity,
        );
      }
    }
    if (existingDispatch !== undefined)
      return replayCommandResponse(existingDispatch.response, identity);
    if (execution.operationName !== "vehicle_fire_weapon" || execution.state !== "WAITING_INPUT")
      return this.#ack(identity, command, false, "UGV_FIRE_CONFIRMATION_NOT_EXPECTED");
    const confirmation = fireConfirmationDecision(responses);
    if (confirmation === "declined")
      return this.#cancelUndispatchedFire(
        execution,
        identity,
        command,
        true,
        "UGV_FIRE_CONFIRMATION_REJECTED",
      );
    if (confirmation !== "accepted")
      return this.#ack(identity, command, false, "UGV_FIRE_CONFIRMATION_INVALID");
    const decision = this.availability(
      execution.operationName,
      execution.arguments,
      execution.taskId,
    );
    if (decision.availability !== "AVAILABLE")
      return this.#ack(identity, command, false, decision.reasonCode);
    const targetId = text(execution.arguments.targetId);
    const unarmed = this.#fireDispatchRecord(identity, true, FIRE_DISPATCH_NOT_ARMED);
    const claim = await this.store.claimCommandAck(unarmed);
    if (!claim.claimed) return replayCommandResponse(claim.record.response, identity);
    const dispatchCursor = operationObservationCursor(execution.operationName, this.ingress);
    execution = transition(
      withObservationBaselines(
        execution,
        dispatchCursor === undefined ? {} : { track: dispatchCursor },
      ),
      "STARTING",
      "UGV_FIRE_DISPATCH_PREPARED",
    );
    const armed = this.#fireDispatchRecord(identity, true, "UNCERTAIN_EXECUTION_STATE");
    try {
      await this.store.putExecution(execution);
      await this.#emitExecutionTransition(execution, execution);
    } catch {
      return await this.#abortFireBeforeDispatch(execution, identity, unarmed);
    }
    try {
      const armedClaimed = await this.store.completeCommandAck(armed, FIRE_DISPATCH_NOT_ARMED);
      if (!armedClaimed) return await this.#abortFireBeforeDispatch(execution, identity, unarmed);
    } catch {
      return await this.#abortFireBeforeDispatch(execution, identity, unarmed);
    }
    try {
      let stripped = 0;
      for (const call of fireConfirmationCalls(
        targetId,
        execution.downstreamMissionIds.at(-1) ?? 0,
      )) {
        const downstream = await this.device.call(call.name, call.arguments, execution.taskId);
        const missionId = missionIdFromUgvResult(call.name, downstream);
        if (missionId === undefined) throw new Error("UGV_DEVICE_MISSION_ID_REQUIRED");
        const canonicalMissionId = canonicalUgvMissionId(missionId);
        if (!execution.downstreamMissionIds.includes(canonicalMissionId)) {
          execution = withMissionId(execution, canonicalMissionId);
          await this.store.putExecution(execution);
        }
        const sanitized = sanitizeFireResult(downstream);
        stripped += sanitized.strippedFields;
        sanitizeObject(sanitized.value);
      }
      const next = transition(execution, "STARTING", "UGV_FIRE_COMMAND_ACCEPTED");
      next.result = {
        resourceId: "vehicle:ugv1",
        status: "fire_command_accepted",
        observedAt: next.updatedAt,
      };
      next.evidence.push(vehicleEvidence("vehicle.weapon.local_result", next.updatedAt, "/status"));
      await this.store.putExecution(next);
      await this.#emitExecutionTransition(execution, next);
      await this.businessEvents.publish({
        sourceId: "vehicle.execution",
        scope: "task",
        occurredAt: next.updatedAt,
        eventType: "vehicle.weapon.fire_started",
        description: "Local UGV fire-control cycle started.",
        reasonCode: "UGV_FIRE_COMMAND_ACCEPTED",
        externalExecutionId: next.externalExecutionId,
        resourceRef: "vehicle:ugv1",
        severityHint: "warning",
        rawPayload: { taskId: next.taskId, status: "fire_command_accepted" },
      });
      if (stripped > 0)
        await this.telemetry.emit(
          "PROVIDER_DIAGNOSTIC",
          {
            diagnostic: "fire_verdict_fields_stripped",
            countBucket: stripped > 4 ? "many" : "few",
          },
          identityTelemetry(next),
        );
      return await this.#completeFireClaim(identity, true, "UGV_FIRE_CONFIRMATION_ACCEPTED");
    } catch (error) {
      if (error instanceof DeviceToolRejectedError) {
        const failed = terminal(execution, "BUSINESS_FAILED", reason(error), {
          resourceId: "vehicle:ugv1",
          status: "fire_command_rejected",
          observedAt: new Date().toISOString(),
        });
        try {
          await this.store.putExecution(failed);
          this.arbiter.release(failed.taskId);
          await this.#emitExecutionTransition(execution, failed);
          return await this.#completeFireClaim(identity, true, reason(error));
        } catch {
          return replayCommandResponse(armed.response, identity);
        }
      }
      const uncertain = transition(execution, "STARTING", "UNCERTAIN_EXECUTION_STATE");
      await this.store.putExecution(uncertain).catch(() => undefined);
      await this.#emitExecutionTransition(execution, uncertain).catch(() => undefined);
      // Keep the durable claim pending. A retry must reconcile observations and
      // must never dispatch a second fire command after an ambiguous outcome.
      return replayCommandResponse(armed.response, identity);
    }
  }

  reconcile(
    input: StartUgvOperation & { externalExecutionId?: string },
  ): Promise<Record<string, unknown>> {
    return this.#serializeMutation(() => this.#reconcile(input));
  }

  async #reconcile(
    input: StartUgvOperation & { externalExecutionId?: string },
  ): Promise<Record<string, unknown>> {
    const execution = await this.store.getExecution(input.taskId);
    if (execution === undefined)
      return {
        status: "NOT_FOUND",
        reasonCode: "EXECUTION_NOT_FOUND",
        message: "Execution does not exist.",
        retryable: false,
      };
    if (
      !sameIdentity(execution, {
        ...input,
        externalExecutionId: input.externalExecutionId ?? execution.externalExecutionId,
        commandSequence: "0",
      })
    )
      return {
        status: "CONFLICT",
        reasonCode: "TASK_IDENTITY_CONFLICT",
        message: "Execution identity conflicts.",
        retryable: false,
      };
    if (!this.device.connected() || !this.ingress.snapshot().connectivity.mqttConnected)
      return {
        status: "TRANSIENT_UNAVAILABLE",
        externalExecutionId: execution.externalExecutionId,
        reasonCode: "UNCERTAIN_EXECUTION_STATE",
        message: "MQTT and Device MCP cannot jointly confirm the execution.",
        retryable: true,
      };
    const refreshed = await this.#refresh(execution);
    return {
      status: "FOUND",
      snapshot: executionSnapshot(refreshed),
      externalExecutionId: refreshed.externalExecutionId,
      reasonCode: "EXECUTION_FOUND",
      message: "Execution reconciled from local UGV observations.",
      retryable: false,
    };
  }

  recover(): Promise<void> {
    return this.#serializeMutation(() => this.#recover());
  }

  async #recover(): Promise<void> {
    for (const execution of await this.store.listActiveExecutions()) {
      if (execution.operationName === "vehicle_fire_weapon") {
        const dispatch = await this.store.getCommandAck(
          execution.taskId,
          FIRE_DISPATCH_COMMAND,
          FIRE_DISPATCH_SEQUENCE,
        );
        if (await this.#recoverPreDispatchFireFence(execution, dispatch)) continue;
      }
      this.arbiter.restore(execution.taskId, vehicleTracks(execution.tracks));
      if (!this.device.connected() || !this.ingress.snapshot().connectivity.mqttConnected) {
        execution.reasonCode = "UNCERTAIN_EXECUTION_STATE";
        execution.updatedAt = new Date().toISOString();
        execution.revision++;
        await this.store.putExecution(execution);
      } else await this.#refresh(execution);
    }
  }
  pollActive(): Promise<void> {
    if (this.#pollPromise !== undefined) return this.#pollPromise;
    const poll = this.#serializeMutation(() => this.#pollActive());
    this.#pollPromise = poll;
    void poll.then(
      () => {
        if (this.#pollPromise === poll) this.#pollPromise = undefined;
      },
      () => {
        if (this.#pollPromise === poll) this.#pollPromise = undefined;
      },
    );
    return poll;
  }

  async #pollActive(): Promise<void> {
    await this.#ensureDeviceConnection();
    await this.#emitResourceTransitions(this.ingress.snapshot());
    for (const execution of await this.store.listActiveExecutions()) await this.#refresh(execution);
  }

  async #ensureDeviceConnection(): Promise<void> {
    if (this.device.connected()) {
      if (!this.ingress.snapshot().connectivity.deviceMcpConnected)
        this.ingress.setDeviceConnected(true);
      return;
    }
    this.ingress.setDeviceConnected(false);
    if (this.#deviceReconnect !== undefined) return this.#deviceReconnect;
    this.#deviceReconnect = this.device
      .connect()
      .then(() => this.ingress.setDeviceConnected(this.device.connected()))
      .catch(() => this.ingress.setDeviceConnected(false))
      .finally(() => {
        this.#deviceReconnect = undefined;
      });
    return this.#deviceReconnect;
  }

  async #synchronous(input: StartUgvOperation) {
    const observedAt = new Date().toISOString();
    let result: Record<string, unknown>;
    if (input.operationName === "vehicle_get_state") {
      let deviceStatus: Record<string, unknown> | undefined;
      if (this.device.hasTool("get_status")) {
        deviceStatus = await this.#callDevice("get_status", {}, input.taskId);
        const observation = normalizeMqttObservation("status/ugv", deviceStatus);
        this.ingress.applyDeviceObservation(
          observation.patch,
          [],
          observation.sourceObservedAt ?? observedAt,
        );
      }
      result = {
        ...selectSnapshot(this.ingress.snapshot(), input.arguments.include),
        mqttIngressSequence: this.ingress.ingestSequence(),
        ...(deviceStatus === undefined ? {} : { deviceStatus }),
      };
    } else if (input.operationName === "vehicle_get_capabilities") {
      const capabilities = await this.#callDevice("get_capabilities", {}, input.taskId);
      result = normalizeUgvCapabilities(capabilities, this.device.contracts(), observedAt);
    } else if (input.operationName === "vehicle_get_payload_status") {
      const status = await this.#callDevice("ugv_area_recon_get_status", {}, input.taskId);
      const observation = normalizeMqttObservation("/ugv/area_recon/status", status);
      this.ingress.applyDeviceObservation(
        observation.patch,
        [],
        observation.sourceObservedAt ?? observedAt,
      );
      const payload = this.ingress.snapshot().payload;
      result = {
        resourceId: "vehicle:ugv1",
        online: payload.online ?? false,
        ...(payload.gimbal === undefined ? {} : { gimbal: payload.gimbal }),
        ...(payload.laser === undefined ? {} : { laser: payload.laser }),
        reconnaissance: payload.reconnaissance,
        eoTask: payload.eoTask,
        weapon: payload.weapon,
        ...(payload.lockedTargetId === undefined ? {} : { lockedTargetId: payload.lockedTargetId }),
        attackReady: payload.attackReady === true,
        payloadErrorCodes: this.ingress.snapshot().health.payloadErrorCodes,
        observedAt,
      };
    } else if (input.operationName === "vehicle_get_targets") {
      let deviceTargets: unknown[] = [];
      if (this.device.hasTool("ugv_area_recon_get_targets")) {
        const response = await this.#callDevice("ugv_area_recon_get_targets", {}, input.taskId);
        deviceTargets = Array.isArray(response.targets) ? response.targets : [];
      }
      const mqttTargets = this.ingress.snapshot().payload.targets;
      const normalizedDeviceTargets = normalizeDeviceTargets(deviceTargets, observedAt);
      result = {
        resourceId: "vehicle:ugv1",
        targets: deduplicateTargets(
          mqttTargets as unknown as Record<string, unknown>[],
          normalizedDeviceTargets,
        ),
        freshness: { targetObservedAt: this.ingress.snapshot().freshness.targetObservedAt ?? null },
        observedAt,
      };
    } else {
      const response = await this.#callDevice("ugv_laser_range", {}, input.taskId);
      const distanceM = finite(response.distance_m ?? response.distance);
      result = {
        resourceId: "vehicle:ugv1",
        distanceM,
        valid: response.valid !== false,
        observedAt,
      };
    }
    const sanitized = sanitizeFireResult(result).value;
    assertNoRefereeData(sanitized);
    const externalExecutionId = `ugv1:sync:${input.taskId || randomUUID()}`;
    return {
      externalExecutionId,
      initialSnapshot: {
        taskId: input.taskId,
        externalExecutionId,
        operationName: input.operationName,
        argumentHash: input.argumentHash,
        executionContext: input.executionContext,
        state: "SUCCEEDED",
        revision: "1",
        reasonCode: "UGV_QUERY_COMPLETED",
        message: "UGV query completed.",
        result: jsonToProtoStruct(sanitizeObject(sanitized)),
        retryable: false,
        observedAt: timestamp(observedAt),
        evidence: [synchronousEvidence(input.operationName, observedAt)],
      },
    };
  }

  async #refresh(execution: ProviderExecution): Promise<ProviderExecution> {
    if (isTerminal(execution.state)) return execution;
    if (execution.operationName === "vehicle_fire_weapon") {
      const dispatch = await this.store.getCommandAck(
        execution.taskId,
        FIRE_DISPATCH_COMMAND,
        FIRE_DISPATCH_SEQUENCE,
      );
      if (await this.#recoverPreDispatchFireFence(execution, dispatch)) {
        return (await this.store.getExecution(execution.taskId)) ?? execution;
      }
    }
    if (execution.state === "WAITING_INPUT") return execution;
    const snapshot = this.ingress.snapshot();
    let next = execution;
    if (execution.operationName === "vehicle_navigate")
      next = applyTrack(
        execution,
        snapshot.chassis.mission,
        "completed",
        operationObservationCursor(execution.operationName, this.ingress),
      );
    else if (execution.operationName === "vehicle_area_recon")
      next = applyReconTrack(
        execution,
        snapshot.payload.reconnaissance,
        this.ingress.observationCursor("/ugv/area_recon/status"),
      );
    else if (execution.operationName === "vehicle_control_gimbal")
      next = applyTrack(
        execution,
        snapshot.payload.eoTask,
        "completed",
        operationObservationCursor(execution.operationName, this.ingress),
      );
    else if (execution.operationName === "vehicle_fire_weapon") {
      // A fire call with an ambiguous outcome and no returned mission ID cannot
      // be correlated to weapon telemetry. Keep it uncertain instead of
      // accepting an unrelated post-dispatch weapon track.
      if (execution.downstreamMissionIds.length === 0) return execution;
      next = applyTrack(
        execution,
        snapshot.payload.weapon,
        "fire_cycle_completed",
        operationObservationCursor(execution.operationName, this.ingress),
      );
    } else if (execution.operationName === "vehicle_track_target") {
      if (
        !isNewOperationObservation(
          execution,
          operationObservationCursor(execution.operationName, this.ingress),
        )
      )
        return execution;
      const targetId = text(execution.arguments.targetId);
      const observedLockedTarget =
        snapshot.payload.reconnaissance.lock?.stage === 3
          ? snapshot.payload.reconnaissance.lock.targetId
          : snapshot.payload.lockedTargetId;
      if (observedLockedTarget === targetId) {
        if (execution.state !== "RUNNING")
          next = transition(execution, "RUNNING", "UGV_TARGET_LOCK_CONFIRMED");
      } else if (execution.state === "RUNNING")
        next = terminal(execution, "BUSINESS_FAILED", "UGV_TARGET_LOST", {
          resourceId: "vehicle:ugv1",
          status: "target_lost",
          observedAt: new Date().toISOString(),
        });
    } else if (execution.operationName === "vehicle_emergency_stop") {
      if (
        isNewOperationObservation(
          execution,
          operationObservationCursor(execution.operationName, this.ingress),
        ) &&
        (snapshot.chassis.speedKmh ?? 0) <= 0.1 &&
        snapshot.chassis.mission.state !== 1 &&
        !reconMotionActive(snapshot.payload.reconnaissance.motionStatus) &&
        snapshot.payload.eoTask.state !== 1 &&
        snapshot.payload.weapon.state !== 1 &&
        (snapshot.payload.reconnaissance.lock?.stage ?? 1) === 1
      )
        next = terminal(execution, "SUCCEEDED", "UGV_LOCAL_STOP_CONFIRMED", {
          resourceId: "vehicle:ugv1",
          status: "stopped",
          observedAt: new Date().toISOString(),
        });
    }
    if (next.revision !== execution.revision) {
      await this.store.putExecution(next);
      this.events.emit(execution.taskId, executionSnapshot(next));
      await this.telemetry.emit(
        "EXECUTION_PROGRESS",
        {
          transition: next.state,
          reasonCode: next.reasonCode,
          progressBucket: progressBucket(next.progress),
        },
        identityTelemetry(next),
      );
      await this.#transitionEvent(execution, next);
      if (isTerminal(next.state)) this.arbiter.release(next.taskId);
    }
    return next;
  }

  async #observe(snapshot: UgvSnapshot, topic: string): Promise<void> {
    await this.store.putSnapshot({
      revision: snapshot.revision,
      observedAt: snapshot.observedAt,
      snapshot: snapshot as unknown as Record<string, unknown>,
    });
    await this.telemetry.emit("RESOURCE_STATE", {
      source: topicCategory(topic),
      revisionChanged: true,
    });
    await this.pollActive();
  }

  async #emitResourceTransitions(snapshot: UgvSnapshot): Promise<void> {
    const previous = this.#lastObservedSnapshot;
    this.#lastObservedSnapshot = structuredClone(snapshot);
    if (previous !== undefined) {
      await this.#connectivityEvent(
        "mqtt",
        previous.connectivity.mqttConnected,
        snapshot.connectivity.mqttConnected,
        snapshot.observedAt,
      );
      await this.#connectivityEvent(
        "device_mcp",
        previous.connectivity.deviceMcpConnected,
        snapshot.connectivity.deviceMcpConnected,
        snapshot.observedAt,
      );
      if (
        previous.payload.reconnaissance.cameraFault !== true &&
        snapshot.payload.reconnaissance.cameraFault === true
      )
        await this.#resourceEvent(
          "vehicle.payload.camera_fault",
          "UGV_CAMERA_FAULT",
          "UGV electro-optical camera pose is not trustworthy.",
          snapshot.observedAt,
          "warning",
          { cameraFault: true },
        );
      if (
        previous.payload.reconnaissance.cameraFault === true &&
        snapshot.payload.reconnaissance.cameraFault === false
      )
        await this.#resourceEvent(
          "vehicle.payload.camera_recovered",
          "UGV_CAMERA_RECOVERED",
          "UGV electro-optical camera observation recovered.",
          snapshot.observedAt,
          "info",
          { cameraFault: false },
        );
      const previousTargets = new Set(previous.payload.targets.map((target) => target.targetId));
      const currentTargets = new Set(snapshot.payload.targets.map((target) => target.targetId));
      const detected = [...currentTargets].filter((targetId) => !previousTargets.has(targetId));
      const lost = [...previousTargets].filter((targetId) => !currentTargets.has(targetId));
      if (detected.length > 0)
        await this.#targetEvent(
          "vehicle.target.detected",
          "UGV_TARGET_DETECTED",
          detected.length,
          snapshot.observedAt,
        );
      if (lost.length > 0)
        await this.#targetEvent(
          "vehicle.target.lost",
          "UGV_TARGET_LOST",
          lost.length,
          snapshot.observedAt,
        );
    }
    for (const domain of ["chassis", "health", "mission", "target", "payload"] as const) {
      const current = freshnessState(snapshot, domain, this.options.freshness);
      const old = this.#freshnessStates.get(domain);
      this.#freshnessStates.set(domain, current);
      if (old === "fresh" && current === "stale")
        await this.#resourceEvent(
          "vehicle.telemetry.stale",
          "UGV_TELEMETRY_STALE",
          `UGV ${domain} telemetry became stale.`,
          snapshot.observedAt,
          "warning",
          { domain },
        );
      if (old === "stale" && current === "fresh")
        await this.#resourceEvent(
          "vehicle.telemetry.recovered",
          "UGV_TELEMETRY_RECOVERED",
          `UGV ${domain} telemetry recovered.`,
          snapshot.observedAt,
          "info",
          { domain },
        );
    }
  }

  async #connectivityEvent(
    channel: "mqtt" | "device_mcp",
    previous: boolean,
    current: boolean,
    observedAt: string,
  ): Promise<void> {
    if (previous === current) return;
    const restored = current;
    await this.#resourceEvent(
      `vehicle.connectivity.${channel}_${restored ? "restored" : "disconnected"}`,
      `UGV_${channel.toUpperCase()}_${restored ? "RESTORED" : "DISCONNECTED"}`,
      `UGV ${channel} connectivity ${restored ? "restored" : "disconnected"}.`,
      observedAt,
      restored ? "info" : "warning",
      { channel, connected: current },
    );
  }

  async #targetEvent(
    eventType: "vehicle.target.detected" | "vehicle.target.lost",
    reasonCode: string,
    count: number,
    observedAt: string,
  ): Promise<void> {
    await this.businessEvents.publish({
      sourceId: "vehicle.target",
      scope: "resource",
      occurredAt: observedAt,
      eventType,
      description: reasonCode,
      reasonCode,
      resourceRef: "vehicle:ugv1",
      severityHint: "info",
      rawPayload: { targetCountBucket: bucket(count) },
    });
  }

  async #resourceEvent(
    eventType: string,
    reasonCode: string,
    description: string,
    occurredAt: string,
    severityHint: "info" | "warning",
    rawPayload: Record<string, unknown>,
  ): Promise<void> {
    await this.businessEvents.publish({
      sourceId: "vehicle.health",
      scope: "resource",
      occurredAt,
      eventType,
      description,
      reasonCode,
      resourceRef: "vehicle:ugv1",
      severityHint,
      rawPayload,
    });
  }

  #serializeMutation<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#mutationTail.then(work, work);
    this.#mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #emergencyStopArguments(
    argumentsValue: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const active = await this.store.listActiveExecutions();
    const chassis = active.find((execution) => execution.operationName === "vehicle_navigate");
    const recon = active.find((execution) =>
      ["vehicle_area_recon", "vehicle_track_target"].includes(execution.operationName),
    );
    return {
      ...argumentsValue,
      ...(chassis?.downstreamMissionIds.at(-1) === undefined
        ? {}
        : { chassisMissionId: chassis.downstreamMissionIds.at(-1) }),
      ...(recon?.downstreamMissionIds.at(-1) === undefined
        ? {}
        : { reconMissionId: recon.downstreamMissionIds.at(-1) }),
    };
  }

  async #callDevice(
    name: UgvDeviceToolName,
    argumentsValue: Record<string, unknown>,
    taskId: string,
  ) {
    try {
      const result = await this.device.call(name, argumentsValue, taskId);
      this.ingress.setDeviceConnected(this.device.connected());
      return sanitizeObject(sanitizeFireResult(result).value);
    } catch (error) {
      this.ingress.setDeviceConnected(this.device.connected());
      throw error;
    }
  }
  async #ack(identity: CommandIdentity, command: string, accepted: boolean, reasonCode: string) {
    const record = this.#ackRecord(identity, command, accepted, reasonCode);
    await this.store.putCommandAck(record);
    return record.response;
  }
  async #completeFireClaim(identity: CommandIdentity, accepted: boolean, reasonCode: string) {
    const record = this.#fireDispatchRecord(identity, accepted, reasonCode);
    if (await this.store.completeCommandAck(record, "UNCERTAIN_EXECUTION_STATE"))
      return replayCommandResponse(record.response, identity);
    const winner = await this.store.getCommandAck(
      identity.taskId,
      FIRE_DISPATCH_COMMAND,
      FIRE_DISPATCH_SEQUENCE,
    );
    if (winner === undefined) throw new Error("COMMAND_ACK_CLAIM_LOST");
    return replayCommandResponse(winner.response, identity);
  }
  async #cancelUndispatchedFire(
    execution: ProviderExecution,
    identity: CommandIdentity,
    command: "cancel" | "update",
    accepted: boolean,
    reasonCode: string,
  ): Promise<Record<string, unknown>> {
    const fence = this.#fireDispatchRecord(identity, accepted, reasonCode);
    const claim = await this.store.claimCommandAck(fence);
    if (!claim.claimed) {
      const existingCancellation = fireCancellationReason(claim.record);
      if (existingCancellation !== undefined) {
        const current = (await this.store.getExecution(execution.taskId)) ?? execution;
        if (!isTerminal(current.state))
          await this.#persistLocalFireCancellation(current, existingCancellation);
        if (command === "update") return replayCommandResponse(claim.record.response, identity);
        return this.#ack(identity, command, true, existingCancellation);
      }
      if (fireDispatchReason(claim.record) === FIRE_DISPATCH_NOT_ARMED) {
        let cancelled: boolean;
        try {
          cancelled = await this.store.completeCommandAck(fence, FIRE_DISPATCH_NOT_ARMED);
        } catch {
          return this.#ack(identity, command, true, "UNCERTAIN_EXECUTION_STATE");
        }
        if (cancelled) {
          const current = (await this.store.getExecution(execution.taskId)) ?? execution;
          if (!isTerminal(current.state))
            await this.#persistLocalFireCancellation(current, reasonCode);
          return this.#ack(identity, command, true, reasonCode);
        }
        const winner = await this.store.getCommandAck(
          execution.taskId,
          FIRE_DISPATCH_COMMAND,
          FIRE_DISPATCH_SEQUENCE,
        );
        const winnerCancellation = fireCancellationReason(winner);
        if (winnerCancellation !== undefined) {
          const current = (await this.store.getExecution(execution.taskId)) ?? execution;
          if (!isTerminal(current.state))
            await this.#persistLocalFireCancellation(current, winnerCancellation);
          if (command === "update" && winner !== undefined)
            return replayCommandResponse(winner.response, identity);
          return this.#ack(identity, command, true, winnerCancellation);
        }
        if (command === "update" && winner !== undefined)
          return replayCommandResponse(winner.response, identity);
        return this.#ack(identity, command, false, "UGV_FIRE_CANCEL_UNSUPPORTED_AFTER_DISPATCH");
      }
      if (command === "update") return replayCommandResponse(claim.record.response, identity);
      return this.#ack(identity, command, false, "UGV_FIRE_CANCEL_UNSUPPORTED_AFTER_DISPATCH");
    }
    try {
      await this.#persistLocalFireCancellation(execution, reasonCode);
      return await this.#ack(identity, command, accepted, reasonCode);
    } catch {
      return this.#ack(identity, command, true, "UNCERTAIN_EXECUTION_STATE");
    }
  }
  async #persistLocalFireCancellation(
    execution: ProviderExecution,
    reasonCode: string,
  ): Promise<void> {
    const cancelled = terminal(execution, "CANCELLED", reasonCode, {
      resourceId: "vehicle:ugv1",
      status: "cancelled",
      observedAt: new Date().toISOString(),
    });
    await this.store.putExecution(cancelled);
    this.arbiter.release(cancelled.taskId);
    await this.#emitExecutionTransition(execution, cancelled);
  }
  async #persistFireTechnicalFailure(
    execution: ProviderExecution,
    reasonCode: string,
  ): Promise<void> {
    const failed = terminal(execution, "TECHNICAL_FAILED", reasonCode, {
      resourceId: "vehicle:ugv1",
      status: "fire_command_rejected",
      observedAt: new Date().toISOString(),
    });
    await this.store.putExecution(failed);
    this.arbiter.release(failed.taskId);
    await this.#emitExecutionTransition(execution, failed);
  }
  async #abortFireBeforeDispatch(
    execution: ProviderExecution,
    identity: CommandIdentity,
    unarmed: CommandAckRecord,
  ): Promise<Record<string, unknown>> {
    const aborted = this.#fireDispatchRecord(identity, true, FIRE_DISPATCH_ABORTED);
    let winner: CommandAckRecord | undefined;
    try {
      if (await this.store.completeCommandAck(aborted, FIRE_DISPATCH_NOT_ARMED)) winner = aborted;
      else {
        winner = await this.store.getCommandAck(
          identity.taskId,
          FIRE_DISPATCH_COMMAND,
          FIRE_DISPATCH_SEQUENCE,
        );
        if (
          fireDispatchReason(winner) === "UNCERTAIN_EXECUTION_STATE" &&
          (await this.store.completeCommandAck(aborted, "UNCERTAIN_EXECUTION_STATE"))
        )
          winner = aborted;
        else
          winner = await this.store.getCommandAck(
            identity.taskId,
            FIRE_DISPATCH_COMMAND,
            FIRE_DISPATCH_SEQUENCE,
          );
      }
    } catch {
      winner = await this.store
        .getCommandAck(identity.taskId, FIRE_DISPATCH_COMMAND, FIRE_DISPATCH_SEQUENCE)
        .catch(() => undefined);
    }
    const current =
      (await this.store.getExecution(execution.taskId).catch(() => undefined)) ?? execution;
    const cancellationReason = fireCancellationReason(winner);
    if (cancellationReason !== undefined) {
      if (!isTerminal(current.state))
        await this.#persistLocalFireCancellation(current, cancellationReason).catch(
          () => undefined,
        );
    } else if (
      fireDispatchReason(winner) === FIRE_DISPATCH_ABORTED ||
      fireDispatchReason(winner) === FIRE_DISPATCH_NOT_ARMED ||
      fireDispatchReason(winner) === "UNCERTAIN_EXECUTION_STATE"
    ) {
      if (!isTerminal(current.state))
        await this.#persistFireTechnicalFailure(current, FIRE_DISPATCH_ABORTED).catch(
          () => undefined,
        );
    }
    return replayCommandResponse((winner ?? unarmed).response, identity);
  }
  async #recoverPreDispatchFireFence(
    execution: ProviderExecution,
    dispatch: CommandAckRecord | undefined,
  ): Promise<boolean> {
    const cancellationReason = fireCancellationReason(dispatch);
    if (cancellationReason !== undefined) {
      await this.#persistLocalFireCancellation(execution, cancellationReason);
      return true;
    }
    const dispatchReason = fireDispatchReason(dispatch);
    if (dispatchReason === FIRE_DISPATCH_ABORTED) {
      await this.#persistFireTechnicalFailure(execution, FIRE_DISPATCH_ABORTED);
      return true;
    }
    if (dispatchReason !== FIRE_DISPATCH_NOT_ARMED || dispatch === undefined) return false;
    const aborted = structuredClone(dispatch);
    aborted.response = {
      ...aborted.response,
      accepted: true,
      reasonCode: FIRE_DISPATCH_ABORTED,
      message: FIRE_DISPATCH_ABORTED,
    };
    aborted.createdAt = new Date().toISOString();
    if (await this.store.completeCommandAck(aborted, FIRE_DISPATCH_NOT_ARMED)) {
      await this.#persistFireTechnicalFailure(execution, FIRE_DISPATCH_ABORTED);
      return true;
    }
    const winner = await this.store.getCommandAck(
      execution.taskId,
      FIRE_DISPATCH_COMMAND,
      FIRE_DISPATCH_SEQUENCE,
    );
    const winnerCancellation = fireCancellationReason(winner);
    if (winnerCancellation !== undefined) {
      await this.#persistLocalFireCancellation(execution, winnerCancellation);
      return true;
    }
    if (fireDispatchReason(winner) === FIRE_DISPATCH_ABORTED) {
      await this.#persistFireTechnicalFailure(execution, FIRE_DISPATCH_ABORTED);
      return true;
    }
    return false;
  }
  async #emitExecutionTransition(
    previous: ProviderExecution,
    next: ProviderExecution,
  ): Promise<void> {
    this.events.emit(next.taskId, executionSnapshot(next));
    await this.telemetry
      .emit(
        "EXECUTION_PROGRESS",
        { transition: next.state, reasonCode: next.reasonCode },
        identityTelemetry(next),
      )
      .catch(() => undefined);
    await this.#transitionEvent(previous, next).catch(() => undefined);
  }
  #fireDispatchRecord(
    identity: CommandIdentity,
    accepted: boolean,
    reasonCode: string,
  ): CommandAckRecord {
    const record = this.#ackRecord(identity, FIRE_DISPATCH_COMMAND, accepted, reasonCode);
    record.commandSequence = FIRE_DISPATCH_SEQUENCE;
    return record;
  }
  #ackRecord(
    identity: CommandIdentity,
    command: string,
    accepted: boolean,
    reasonCode: string,
  ): CommandAckRecord {
    return {
      taskId: identity.taskId,
      command,
      commandSequence: identity.commandSequence,
      response: {
        accepted,
        reasonCode,
        message: reasonCode,
        commandSequence: identity.commandSequence,
        identity,
      },
      createdAt: new Date().toISOString(),
    };
  }
  async #startedEvent(execution: ProviderExecution): Promise<void> {
    const eventType =
      execution.operationName === "vehicle_area_recon"
        ? "vehicle.payload.recon_started"
        : execution.operationName === "vehicle_navigate"
          ? "vehicle.mission.started"
          : execution.operationName === "vehicle_control_gimbal"
            ? "vehicle.gimbal.control_started"
            : undefined;
    if (eventType !== undefined)
      await this.businessEvents.publish(taskEvent(execution, eventType, execution.reasonCode));
  }
  async #transitionEvent(previous: ProviderExecution, next: ProviderExecution): Promise<void> {
    let eventType: string | undefined;
    if (next.state === "PAUSED") eventType = "vehicle.mission.paused";
    else if (previous.state === "RESUMING" && next.state === "RUNNING")
      eventType = "vehicle.mission.resumed";
    else if (next.operationName === "vehicle_area_recon" && next.state === "SUCCEEDED")
      eventType = "vehicle.payload.recon_completed";
    else if (next.operationName === "vehicle_area_recon" && next.state === "BUSINESS_FAILED")
      eventType = "vehicle.payload.recon_failed";
    else if (next.operationName === "vehicle_control_gimbal" && next.state === "SUCCEEDED")
      eventType = "vehicle.gimbal.control_completed";
    else if (next.operationName === "vehicle_control_gimbal" && isFailure(next.state))
      eventType = "vehicle.gimbal.control_failed";
    else if (
      next.operationName === "vehicle_track_target" &&
      next.reasonCode === "UGV_TARGET_LOCK_CONFIRMED"
    )
      eventType = "vehicle.payload.target_locked";
    else if (next.operationName === "vehicle_track_target" && next.reasonCode === "UGV_TARGET_LOST")
      eventType = "vehicle.payload.target_lost";
    else if (next.operationName === "vehicle_fire_weapon" && next.state === "SUCCEEDED")
      eventType = "vehicle.weapon.fire_completed";
    else if (next.operationName === "vehicle_fire_weapon" && isFailure(next.state))
      eventType = "vehicle.weapon.fire_failed";
    else if (next.operationName === "vehicle_navigate" && next.state === "SUCCEEDED")
      eventType = "vehicle.mission.completed";
    else if (next.operationName === "vehicle_navigate" && next.state === "BUSINESS_FAILED")
      eventType = "vehicle.mission.failed";
    else if (next.operationName === "vehicle_navigate" && next.state === "CANCELLED")
      eventType = "vehicle.mission.cancelled";
    if (eventType !== undefined)
      await this.businessEvents.publish(taskEvent(next, eventType, next.reasonCode));
  }
}

export function executionSnapshot(execution: ProviderExecution): Record<string, unknown> {
  const result =
    execution.result === undefined ? undefined : sanitizeFireResult(execution.result).value;
  if (result !== undefined) assertNoRefereeData(result);
  return {
    taskId: execution.taskId,
    externalExecutionId: execution.externalExecutionId,
    operationName: execution.operationName,
    argumentHash: execution.argumentHash,
    executionContext: execution.executionContext,
    state: execution.state === "STARTING" ? "ACCEPTED" : execution.state,
    revision: String(execution.revision),
    reasonCode: execution.reasonCode,
    message: execution.reasonCode,
    ...(execution.progress === undefined
      ? {}
      : {
          progress: {
            percentage: execution.progress,
            current: execution.progress,
            total: 100,
            unit: "percent",
          },
        }),
    ...(result === undefined ? {} : { result: jsonToProtoStruct(sanitizeObject(result)) }),
    retryable: execution.state === "TECHNICAL_FAILED",
    observedAt: timestamp(execution.updatedAt),
    evidence: execution.evidence,
    ...(execution.state === "WAITING_INPUT"
      ? {
          mcpInputRequests: [
            {
              key: "fire_confirmation",
              method: "elicitation/create",
              params: jsonToProtoStruct({
                message:
                  "Confirm one local UGV fire-control cycle. This does not assert hit or destruction.",
                requestedSchema: {
                  type: "object",
                  properties: { confirmed: { type: "boolean", const: true } },
                  required: ["confirmed"],
                  additionalProperties: false,
                },
              }),
            },
          ],
        }
      : {}),
  };
}

function applyTrack(
  execution: ProviderExecution,
  track: VehicleTaskTrack,
  successStatus: string,
  observationCursor?: string,
): ProviderExecution {
  if (!isNewOperationObservation(execution, observationCursor)) return execution;
  if (!trackBelongsToExecution(execution, track))
    return execution.reasonCode === "UGV_DOWNSTREAM_MISSION_ID_MISMATCH"
      ? execution
      : transition(execution, execution.state, "UGV_DOWNSTREAM_MISSION_ID_MISMATCH");
  const mapped = mapVehicleTaskState(track.state, true);
  const armed = execution.observationCursors?.trackActive !== undefined;
  if (!armed && isMappedTerminal(mapped.state)) {
    if (execution.reasonCode === "UGV_TASK_TERMINAL_UNCONFIRMED") return execution;
    return transition(execution, execution.state, "UGV_TASK_TERMINAL_UNCONFIRMED");
  }
  const current =
    armed || !isObservedActiveState(mapped.state)
      ? execution
      : withObservationCursor(execution, "trackActive", observationCursor);
  if (mapped.state === "RECONCILE") {
    if (current.reasonCode === mapped.reasonCode) return current;
    return transition(current, current.state, mapped.reasonCode);
  }
  const progress = monotonicProgress(current.progress, track.progress);
  if (mapped.state === "SUCCEEDED")
    return terminal(current, "SUCCEEDED", mapped.reasonCode, {
      resourceId: "vehicle:ugv1",
      status: successStatus,
      observedAt: track.observedAt ?? new Date().toISOString(),
    });
  if (mapped.state === "BUSINESS_FAILED")
    return terminal(current, "BUSINESS_FAILED", mapped.reasonCode, {
      resourceId: "vehicle:ugv1",
      status: "failed",
      observedAt: track.observedAt ?? new Date().toISOString(),
    });
  if (mapped.state === "CANCELLED")
    return terminal(current, "CANCELLED", mapped.reasonCode, {
      resourceId: "vehicle:ugv1",
      status: "cancelled",
      observedAt: track.observedAt ?? new Date().toISOString(),
    });
  if (
    current.state === "STOPPING" &&
    (mapped.state === "STARTING" || mapped.state === "RUNNING" || mapped.state === "PAUSED")
  )
    return current;
  if (current.state === "RESUMING" && mapped.state === "PAUSED") return current;
  if (mapped.state === current.state && progress === current.progress) return current;
  const next = transition(current, mapped.state, mapped.reasonCode);
  if (progress !== undefined) next.progress = progress;
  return next;
}

function isObservedActiveState(state: ProviderExecutionState | "RECONCILE"): boolean {
  return state === "RUNNING" || state === "PAUSED" || state === "RESUMING" || state === "STOPPING";
}

function isMappedTerminal(state: ProviderExecutionState | "RECONCILE"): boolean {
  return (
    state === "SUCCEEDED" ||
    state === "BUSINESS_FAILED" ||
    state === "CANCELLED" ||
    state === "TECHNICAL_FAILED"
  );
}

function applyReconTrack(
  execution: ProviderExecution,
  reconnaissance: UgvSnapshot["payload"]["reconnaissance"],
  observationCursor: string | undefined,
): ProviderExecution {
  if (execution.state === "ACCEPTED" || !isNewReconObservation(execution, observationCursor))
    return execution;
  const observedAt = observationCursorTimestamp(observationCursor);
  if (!trackBelongsToExecution(execution, reconnaissance, true))
    return execution.reasonCode === "UGV_DOWNSTREAM_MISSION_ID_MISMATCH"
      ? execution
      : transition(execution, execution.state, "UGV_DOWNSTREAM_MISSION_ID_MISMATCH");
  if (reconnaissance.cameraFault === true) {
    if (execution.reasonCode === "UGV_RECON_CAMERA_FAULT") return execution;
    return transition(execution, execution.state, "UGV_RECON_CAMERA_FAULT");
  }
  const mapped = mapReconMotionStatus(reconnaissance.motionStatus, true);
  const armed = execution.observationCursors?.reconnaissanceActive !== undefined;
  if (!armed && isMappedTerminal(mapped.state)) {
    if (execution.reasonCode === "UGV_RECON_TERMINAL_UNCONFIRMED") return execution;
    return transition(execution, execution.state, "UGV_RECON_TERMINAL_UNCONFIRMED");
  }
  const current =
    armed || !isReconActiveState(mapped.state)
      ? execution
      : withObservationCursor(execution, "reconnaissanceActive", observationCursor);
  const progress =
    reconnaissance.progressAuthoritative === false
      ? current.progress
      : monotonicProgress(current.progress, reconnaissance.progress);
  if (mapped.state === "RECONCILE") {
    if (current.reasonCode === mapped.reasonCode) return current;
    return transition(current, current.state, mapped.reasonCode);
  }
  if (mapped.state === "SUCCEEDED")
    return terminal(current, "SUCCEEDED", mapped.reasonCode, {
      resourceId: "vehicle:ugv1",
      status: "completed",
      observedAt,
      ...(reconnaissance.coverability === undefined
        ? {}
        : { coverability: reconnaissance.coverability }),
    });
  if (mapped.state === "BUSINESS_FAILED")
    return terminal(current, "BUSINESS_FAILED", mapped.reasonCode, {
      resourceId: "vehicle:ugv1",
      status: "failed",
      observedAt,
      outOfRange: reconnaissance.outOfRange === true,
    });
  if (mapped.state === "CANCELLED")
    return terminal(current, "CANCELLED", mapped.reasonCode, {
      resourceId: "vehicle:ugv1",
      status: "cancelled",
      observedAt,
    });
  if (
    current.state === "STOPPING" &&
    (mapped.state === "STARTING" || mapped.state === "RUNNING" || mapped.state === "PAUSED")
  )
    return current;
  if (mapped.state === current.state && progress === current.progress) return current;
  const next = transition(current, mapped.state, mapped.reasonCode);
  if (progress !== undefined) next.progress = progress;
  return next;
}

function isReconActiveState(state: ProviderExecutionState | "RECONCILE"): boolean {
  return (
    state === "STARTING" ||
    state === "RUNNING" ||
    state === "PAUSED" ||
    state === "RESUMING" ||
    state === "STOPPING"
  );
}

function trackBelongsToExecution(
  execution: ProviderExecution,
  track: Pick<VehicleTaskTrack, "id">,
  allowMissingObservedId = false,
): boolean {
  if (execution.downstreamMissionIds.length === 0) return true;
  if (track.id === undefined) return allowMissingObservedId;
  try {
    return execution.downstreamMissionIds.includes(String(parseUgvMissionId(track.id)));
  } catch {
    return false;
  }
}

function initialObservationCursors(
  operationName: string,
  ingress: VehicleMqttIngress,
): Record<string, string> | undefined {
  if (operationName === "vehicle_area_recon") {
    const cursor = ingress.observationCursor("/ugv/area_recon/status");
    return cursor === undefined ? {} : { reconnaissance: cursor };
  }
  const cursor = operationObservationCursor(operationName, ingress);
  return cursor === undefined ? undefined : { track: cursor };
}

function operationObservationCursor(
  operationName: string,
  ingress: VehicleMqttIngress,
): string | undefined {
  const topics =
    operationName === "vehicle_navigate"
      ? ["/ugv/mission_state", "status/ugv", "/ugv/status"]
      : operationName === "vehicle_area_recon"
        ? ["/ugv/area_recon/status"]
        : operationName === "vehicle_track_target"
          ? ["/ugv/area_recon/status", "status/ugv", "/ugv/status"]
          : operationName === "vehicle_control_gimbal" || operationName === "vehicle_fire_weapon"
            ? ["status/ugv", "/ugv/status"]
            : operationName === "vehicle_emergency_stop"
              ? ["/ugv/mission_state", "/ugv/area_recon/status", "status/ugv", "/ugv/status"]
              : [];
  const observations = topics.flatMap((topic) => {
    const cursor = ingress.observationCursor(topic);
    return cursor === undefined ? [] : [[topic, cursor]];
  });
  return observations.length === 0 ? undefined : JSON.stringify(observations);
}

function isNewReconObservation(
  execution: ProviderExecution,
  observationCursor: string | undefined,
): boolean {
  return (
    observationCursor !== undefined &&
    observationCursor !== execution.observationCursors?.reconnaissance
  );
}

function isNewOperationObservation(
  execution: ProviderExecution,
  observationCursor: string | undefined,
): boolean {
  return (
    observationCursor !== undefined && observationCursor !== execution.observationCursors?.track
  );
}

function observationCursorTimestamp(cursor: string | undefined): string {
  const separator = cursor?.indexOf("\0") ?? -1;
  const observedAt = separator < 1 ? undefined : cursor?.slice(0, separator);
  if (observedAt === undefined || Number.isNaN(Date.parse(observedAt)))
    throw new Error("UGV_RECON_OBSERVATION_CURSOR_INVALID");
  return observedAt;
}

function reconMotionActive(status: VehicleReconnaissanceState["motionStatus"]): boolean {
  return new Set([2, 4, 5, 6, 7, 8, 12]).has(status as number);
}

function withMissionId(execution: ProviderExecution, missionId: string): ProviderExecution {
  const next = structuredClone(execution);
  next.downstreamMissionIds.push(missionId);
  next.revision++;
  next.updatedAt = new Date().toISOString();
  return next;
}
function withObservationCursor(
  execution: ProviderExecution,
  name: string,
  cursor: string | undefined,
): ProviderExecution {
  if (cursor === undefined) return execution;
  const next = structuredClone(execution);
  next.observationCursors = { ...next.observationCursors, [name]: cursor };
  next.revision++;
  next.updatedAt = new Date().toISOString();
  return next;
}
function withObservationBaselines(
  execution: ProviderExecution,
  cursors: Record<string, string> | undefined,
): ProviderExecution {
  const normalized = cursors ?? {};
  if (JSON.stringify(execution.observationCursors ?? {}) === JSON.stringify(normalized))
    return execution;
  const next = structuredClone(execution);
  next.observationCursors = structuredClone(normalized);
  next.revision++;
  next.updatedAt = new Date().toISOString();
  return next;
}
function transition(
  execution: ProviderExecution,
  state: ProviderExecutionState,
  reasonCode: string,
): ProviderExecution {
  const next = structuredClone(execution);
  next.state = state;
  next.reasonCode = reasonCode;
  next.revision++;
  next.updatedAt = new Date().toISOString();
  return next;
}
function terminal(
  execution: ProviderExecution,
  state: ProviderExecutionState,
  reasonCode: string,
  result: Record<string, unknown>,
): ProviderExecution {
  const next = transition(execution, state, reasonCode);
  const sanitized = sanitizeFireResult(result).value;
  assertNoRefereeData(sanitized);
  next.result = sanitized as Record<string, unknown>;
  next.terminalAt = next.updatedAt;
  if (state === "SUCCEEDED") next.progress = 100;
  next.evidence.push(
    vehicleEvidence(
      execution.operationName === "vehicle_fire_weapon"
        ? "vehicle.weapon.local_result"
        : "vehicle.mission.state",
      next.updatedAt,
      "/status",
    ),
  );
  return next;
}
function taskEvent(execution: ProviderExecution, eventType: string, reasonCode: string) {
  return {
    sourceId: "vehicle.execution" as const,
    scope: "task" as const,
    occurredAt: execution.updatedAt,
    eventType,
    description: reasonCode,
    reasonCode,
    externalExecutionId: execution.externalExecutionId,
    resourceRef: "vehicle:ugv1",
    severityHint: isFailure(execution.state) ? ("warning" as const) : ("info" as const),
    rawPayload: {
      taskId: execution.taskId,
      operation: execution.operationName,
      state: execution.state,
    },
  };
}
function selectSnapshot(snapshot: UgvSnapshot, include: unknown): Record<string, unknown> {
  const requested = Array.isArray(include)
    ? new Set(include.filter((x): x is string => typeof x === "string"))
    : new Set(["chassis", "payload", "health", "targets"]);
  const result: Record<string, unknown> = {
    identity: snapshot.identity,
    connectivity: snapshot.connectivity,
    freshness: snapshot.freshness,
    revision: snapshot.revision,
    observedAt: snapshot.observedAt,
  };
  if (requested.has("chassis")) result.chassis = snapshot.chassis;
  if (requested.has("payload")) result.payload = { ...snapshot.payload, targets: undefined };
  if (requested.has("health")) result.health = snapshot.health;
  if (requested.has("targets")) result.targets = snapshot.payload.targets;
  return JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
}
function synchronousEvidence(operationName: string, observedAt: string) {
  const evidenceType =
    operationName === "vehicle_get_targets"
      ? "vehicle.target.observation"
      : operationName === "vehicle_get_payload_status" || operationName === "vehicle_laser_range"
        ? "vehicle.payload.status"
        : "vehicle.state.observation";
  return vehicleEvidence(evidenceType, observedAt, "/observedAt");
}
function fireConfirmationDecision(value: unknown): "accepted" | "declined" | "invalid" {
  if (!Array.isArray(value)) return "invalid";
  for (const item of value) {
    if (!record(item) || item.key !== "fire_confirmation") continue;
    const result = protoStructToJson(item.result);
    const content = record(result.content) ? result.content : undefined;
    if (result.action === "accept" && (content?.confirmed === true || result.confirmed === true))
      return "accepted";
    if (result.action === "decline" || result.action === "cancel" || result.action === "reject")
      return "declined";
    return "invalid";
  }
  return "invalid";
}
function fireCancellationReason(recordValue: CommandAckRecord | undefined): string | undefined {
  const reasonCode = fireDispatchReason(recordValue);
  return typeof reasonCode === "string" && FIRE_LOCAL_CANCELLATION_REASONS.has(reasonCode)
    ? reasonCode
    : undefined;
}
function fireDispatchReason(recordValue: CommandAckRecord | undefined): string | undefined {
  const reasonCode = recordValue?.response.reasonCode;
  return typeof reasonCode === "string" ? reasonCode : undefined;
}
function validateStart(input: StartUgvOperation): void {
  if (!OPERATIONS.has(input.operationName)) throw new Error("UGV_OPERATION_UNSUPPORTED");
  if (!input.taskId || !input.argumentHash) throw new Error("UGV_START_IDENTITY_INVALID");
  if (input.arguments.resourceId !== "vehicle:ugv1") throw new Error("UGV_RESOURCE_NOT_FOUND");
  if (
    input.executionContext.executionMode !== "SIMULATION" &&
    input.executionContext.executionMode !== "2"
  )
    throw new Error("UGV_EXECUTION_MODE_UNSUPPORTED");
}
function assertIdentity(existing: ProviderExecution, input: StartUgvOperation): void {
  if (
    existing.operationName !== input.operationName ||
    existing.argumentHash !== input.argumentHash ||
    !sameContext(existing.executionContext, input.executionContext)
  )
    throw new Error("TASK_IDENTITY_CONFLICT");
}
function sameIdentity(execution: ProviderExecution, identity: CommandIdentity): boolean {
  return (
    execution.taskId === identity.taskId &&
    execution.externalExecutionId === identity.externalExecutionId &&
    execution.operationName === identity.operationName &&
    execution.argumentHash === identity.argumentHash &&
    sameContext(execution.executionContext, identity.executionContext)
  );
}
function replayCommandResponse(
  response: Record<string, unknown>,
  identity: CommandIdentity,
): Record<string, unknown> {
  return {
    ...structuredClone(response),
    commandSequence: identity.commandSequence,
    identity: structuredClone(identity),
  };
}
function sameContext(left: ExecutionContextRecord, right: ExecutionContextRecord): boolean {
  return (
    left.authorizationContextHash === right.authorizationContextHash &&
    left.executionMode === right.executionMode &&
    left.simulationId === right.simulationId
  );
}
function commandSupported(operationName: string, command: string): boolean {
  if (command === "pause" || command === "resume")
    return operationName === "vehicle_navigate" || operationName === "vehicle_area_recon";
  return [
    "vehicle_navigate",
    "vehicle_area_recon",
    "vehicle_track_target",
    "vehicle_control_gimbal",
  ].includes(operationName);
}
function identityTelemetry(execution: ProviderExecution) {
  return {
    taskId: execution.taskId,
    externalExecutionId: execution.externalExecutionId,
    operationName: execution.operationName,
  };
}
function isTerminal(state: ProviderExecutionState): boolean {
  return (
    state === "SUCCEEDED" ||
    state === "BUSINESS_FAILED" ||
    state === "CANCELLED" ||
    state === "TECHNICAL_FAILED"
  );
}
function isFailure(state: ProviderExecutionState): boolean {
  return state === "BUSINESS_FAILED" || state === "TECHNICAL_FAILED";
}
function reason(error: unknown): string {
  return error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
    ? error.message
    : "UGV_ADAPTER_INTERNAL_ERROR";
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function sanitizeObject(value: unknown): Record<string, unknown> {
  if (!record(value)) throw new Error("UGV_DEVICE_MCP_STRUCTURED_RESULT_REQUIRED");
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("UGV_TEXT_INVALID");
  return value;
}
function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error("UGV_LASER_RANGE_INVALID");
  return value;
}
function vehicleTracks(values: string[]): VehicleTrack[] {
  const tracks = values.filter(
    (value): value is VehicleTrack => value === "chassis" || value === "eo" || value === "weapon",
  );
  if (tracks.length !== values.length) throw new Error("UGV_PERSISTED_TRACK_INVALID");
  return tracks;
}
function timestamp(value: string): { seconds: string; nanos: number } {
  const milliseconds = Date.parse(value);
  return {
    seconds: String(Math.floor(milliseconds / 1000)),
    nanos: (milliseconds % 1000) * 1_000_000,
  };
}
function topicCategory(topic: string): string {
  if (topic.includes("mission") || topic === "/ugv/status") return "mission";
  if (topic.includes("detected") || topic.includes("target")) return "target";
  if (topic.includes("system") || topic.includes("component")) return "health";
  return "chassis";
}
function progressBucket(value: number | undefined): string {
  if (value === undefined) return "unknown";
  if (value === 100) return "complete";
  if (value >= 75) return "75_99";
  if (value >= 50) return "50_74";
  if (value >= 25) return "25_49";
  return "0_24";
}
function bucket(value: number): string {
  return value === 0 ? "zero" : value === 1 ? "one" : value <= 5 ? "few" : "many";
}

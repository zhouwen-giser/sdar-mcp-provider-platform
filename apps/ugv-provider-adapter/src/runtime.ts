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
  fireConfirmationCalls,
  OPERATION_REQUIRED_TOOLS,
  startDeviceCalls,
} from "../../../packages/vehicle-device-mcp-client/src/index.js";
import type { VehicleMqttIngress } from "../../../packages/vehicle-mqtt-ingress/src/index.js";
import {
  assertNoRefereeData,
  checkVehicleAvailability,
  mapVehicleTaskState,
  monotonicProgress,
  OPERATION_TRACKS,
  sanitizeFireResult,
  TrackArbiter,
  vehicleEvidence,
  type AvailabilityDecision,
  type FreshnessPolicy,
  type UgvSnapshot,
  type VehicleTaskTrack,
  type VehicleTrack,
} from "../../../packages/vehicle-provider-core/src/index.js";
import type { UgvBusinessEventHub } from "./business-events.js";
import type { UgvTelemetry } from "./telemetry.js";

const OPERATIONS = new Set(Object.keys(OPERATION_TRACKS));
const SYNC_OPERATIONS = new Set([
  "vehicle_get_state",
  "vehicle_get_payload_status",
  "vehicle_get_targets",
  "vehicle_laser_range",
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
    await this.device.close();
    await this.store.close();
  }
  snapshot(): UgvSnapshot {
    return this.ingress.snapshot();
  }
  executionSnapshot(execution: ProviderExecution): Record<string, unknown> {
    return executionSnapshot(execution);
  }
  async start(
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
    await this.store.putExecution(execution);
    try {
      if (input.operationName !== "vehicle_fire_weapon") {
        for (const call of startDeviceCalls(input.operationName, input.arguments)) {
          const result = await this.#callDevice(call.name, call.arguments, input.taskId);
          const missionId = missionIdOf(result);
          if (missionId !== undefined && !execution.downstreamMissionIds.includes(missionId))
            execution.downstreamMissionIds.push(missionId);
        }
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
      this.arbiter.release(input.taskId);
      const failed = terminal(execution, "TECHNICAL_FAILED", reason(error), {
        resourceId: "vehicle:ugv1",
        status: "failed",
        observedAt: new Date().toISOString(),
      });
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
    const requiredTools = OPERATION_REQUIRED_TOOLS[operationName] ?? [];
    return checkVehicleAvailability({
      operationName,
      snapshot: this.ingress.snapshot(),
      freshness: this.options.freshness,
      occupiedTracks: new Set(
        [...this.arbiter.occupied()].filter(
          (track) => this.arbiter.owner(track) !== ignoreOwnedByTaskId,
        ),
      ),
      requiredToolsPresent: requiredTools.every((tool) => this.device.hasTool(tool)),
      ...(typeof argumentsValue.targetId === "string" ? { targetId: argumentsValue.targetId } : {}),
      allowNavigationWithRecon: this.options.allowNavigationWithRecon,
      fireRequiresChassisStopped: this.options.fireRequiresChassisStopped,
    });
  }

  async get(taskId: string): Promise<ProviderExecution | undefined> {
    const execution = await this.store.getExecution(taskId);
    if (execution === undefined) return undefined;
    return this.#refresh(execution);
  }

  async command(
    command: "pause" | "resume" | "cancel",
    identity: CommandIdentity,
  ): Promise<Record<string, unknown>> {
    const old = await this.store.getCommandAck(identity.taskId, command, identity.commandSequence);
    if (old !== undefined) return old.response;
    const execution = await this.store.getExecution(identity.taskId);
    if (execution === undefined) return this.#ack(identity, command, false, "EXECUTION_NOT_FOUND");
    if (!sameIdentity(execution, identity))
      return this.#ack(identity, command, false, "TASK_IDENTITY_CONFLICT");
    if (!commandSupported(execution.operationName, command))
      return this.#ack(identity, command, false, `${command.toUpperCase()}_NOT_SUPPORTED`);
    try {
      for (const call of controlDeviceCalls(execution.operationName, command))
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
      return this.#ack(identity, command, false, reason(error));
    }
  }

  async updateFire(
    identity: CommandIdentity,
    responses: unknown,
  ): Promise<Record<string, unknown>> {
    const command = "update";
    const old = await this.store.getCommandAck(identity.taskId, command, identity.commandSequence);
    if (old !== undefined) return old.response;
    const execution = await this.store.getExecution(identity.taskId);
    if (execution === undefined) return this.#ack(identity, command, false, "EXECUTION_NOT_FOUND");
    if (!sameIdentity(execution, identity))
      return this.#ack(identity, command, false, "TASK_IDENTITY_CONFLICT");
    if (execution.operationName !== "vehicle_fire_weapon" || execution.state !== "WAITING_INPUT")
      return this.#ack(identity, command, false, "UGV_FIRE_CONFIRMATION_NOT_EXPECTED");
    if (!acceptedConfirmation(responses))
      return this.#ack(identity, command, false, "UGV_FIRE_CONFIRMATION_REJECTED");
    const decision = this.availability(
      execution.operationName,
      execution.arguments,
      execution.taskId,
    );
    if (decision.availability !== "AVAILABLE")
      return this.#ack(identity, command, false, decision.reasonCode);
    const targetId = text(execution.arguments.targetId);
    try {
      let stripped = 0;
      for (const call of fireConfirmationCalls(targetId)) {
        const downstream = await this.device.call(call.name, call.arguments, execution.taskId);
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
      return await this.#ack(identity, command, true, "UGV_FIRE_CONFIRMATION_ACCEPTED");
    } catch (error) {
      return this.#ack(identity, command, false, reason(error));
    }
  }

  async reconcile(
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

  async recover(): Promise<void> {
    for (const execution of await this.store.listActiveExecutions()) {
      this.arbiter.restore(execution.taskId, vehicleTracks(execution.tracks));
      if (!this.device.connected() || !this.ingress.snapshot().connectivity.mqttConnected) {
        execution.reasonCode = "UNCERTAIN_EXECUTION_STATE";
        execution.updatedAt = new Date().toISOString();
        execution.revision++;
        await this.store.putExecution(execution);
      } else await this.#refresh(execution);
    }
  }
  async pollActive(): Promise<void> {
    for (const execution of await this.store.listActiveExecutions()) await this.#refresh(execution);
  }

  async #synchronous(input: StartUgvOperation) {
    const observedAt = new Date().toISOString();
    let result: Record<string, unknown>;
    if (input.operationName === "vehicle_get_state") {
      result = selectSnapshot(this.ingress.snapshot(), input.arguments.include);
    } else if (input.operationName === "vehicle_get_payload_status") {
      const [status, exceptions] = await Promise.all([
        this.#callDevice("ugv_area_recon_get_status", {}, input.taskId),
        this.#callDevice("ugv_area_recon_get_exceptions", {}, input.taskId),
      ]);
      const payloadErrorCodes = Array.isArray(exceptions.exceptions)
        ? exceptions.exceptions.map(String)
        : [];
      const reconnaissance = deviceTrack(status.reconnaissance ?? status);
      const weapon = deviceTrack(status.weapon);
      this.ingress.applyDeviceObservation(
        {
          payload: {
            online: status.online === true || status.load_status === true,
            ...(record(status.gimbal) ? { gimbal: status.gimbal } : {}),
            ...(record(status.laser) ? { laser: status.laser } : {}),
            ...(reconnaissance === undefined ? {} : { reconnaissance }),
            ...(weapon === undefined ? {} : { weapon }),
            ...(typeof status.locked_target_id === "string"
              ? { lockedTargetId: status.locked_target_id }
              : {}),
            attackReady: status.attack_ready === true,
          },
          health: { payloadErrorCodes },
        },
        ["payload"],
        observedAt,
      );
      result = {
        resourceId: "vehicle:ugv1",
        online: status.online ?? status.load_status ?? false,
        ...(record(status.gimbal) ? { gimbal: status.gimbal } : {}),
        ...(record(status.laser) ? { laser: status.laser } : {}),
        reconnaissance: record(status.reconnaissance) ? status.reconnaissance : status,
        weapon: record(status.weapon) ? status.weapon : {},
        ...(typeof status.locked_target_id === "string"
          ? { lockedTargetId: status.locked_target_id }
          : {}),
        attackReady: status.attack_ready === true,
        payloadErrorCodes,
        observedAt,
      };
    } else if (input.operationName === "vehicle_get_targets") {
      let deviceTargets: unknown[] = [];
      if (this.device.hasTool("ugv_area_recon_get_targets")) {
        const response = await this.#callDevice("ugv_area_recon_get_targets", {}, input.taskId);
        deviceTargets = Array.isArray(response.targets) ? response.targets : [];
      }
      const mqttTargets = this.ingress.snapshot().payload.targets;
      result = {
        resourceId: "vehicle:ugv1",
        targets: [
          ...mqttTargets,
          ...deviceTargets.map((value) => ({
            ...sanitizeObject(value),
            source: "device_mcp",
            observedAt,
          })),
        ],
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
        evidence: [vehicleEvidence("vehicle.state.observation", observedAt, "/revision")],
      },
    };
  }

  async #refresh(execution: ProviderExecution): Promise<ProviderExecution> {
    if (isTerminal(execution.state) || execution.state === "WAITING_INPUT") return execution;
    const snapshot = this.ingress.snapshot();
    let next = execution;
    if (execution.operationName === "vehicle_navigate")
      next = applyTrack(execution, snapshot.chassis.mission, "completed");
    else if (execution.operationName === "vehicle_area_recon")
      next = applyTrack(execution, snapshot.payload.reconnaissance, "completed");
    else if (execution.operationName === "vehicle_fire_weapon")
      next = applyTrack(execution, snapshot.payload.weapon, "fire_cycle_completed");
    else if (execution.operationName === "vehicle_track_target") {
      const targetId = text(execution.arguments.targetId);
      if (snapshot.payload.lockedTargetId === targetId) {
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
        (snapshot.chassis.speedKmh ?? 0) <= 0.1 &&
        snapshot.chassis.mission.state !== 1 &&
        snapshot.payload.reconnaissance.state !== 1 &&
        snapshot.payload.weapon.state !== 1
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
    if (topic === "/ugv/detected_objects" && snapshot.payload.targets.length > 0)
      await this.businessEvents.publish({
        sourceId: "vehicle.target",
        scope: "resource",
        occurredAt: snapshot.freshness.targetObservedAt ?? snapshot.observedAt,
        eventType: "vehicle.target.detected",
        description: "UGV local sensors detected one or more targets.",
        reasonCode: "UGV_TARGET_DETECTED",
        resourceRef: "vehicle:ugv1",
        severityHint: "info",
        rawPayload: { targetCountBucket: bucket(snapshot.payload.targets.length) },
      });
    await this.pollActive();
  }

  async #callDevice(
    name: UgvDeviceToolName,
    argumentsValue: Record<string, unknown>,
    taskId: string,
  ) {
    const result = await this.device.call(name, argumentsValue, taskId);
    return sanitizeObject(sanitizeFireResult(result).value);
  }
  async #ack(identity: CommandIdentity, command: string, accepted: boolean, reasonCode: string) {
    const response = {
      accepted,
      reasonCode,
      message: reasonCode,
      commandSequence: identity.commandSequence,
      identity,
    };
    const record: CommandAckRecord = {
      taskId: identity.taskId,
      command,
      commandSequence: identity.commandSequence,
      response,
      createdAt: new Date().toISOString(),
    };
    await this.store.putCommandAck(record);
    return response;
  }
  async #startedEvent(execution: ProviderExecution): Promise<void> {
    const eventType =
      execution.operationName === "vehicle_area_recon"
        ? "vehicle.payload.recon_started"
        : execution.operationName === "vehicle_navigate"
          ? "vehicle.mission.started"
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
): ProviderExecution {
  const mapped = mapVehicleTaskState(track.state, true);
  if (mapped.state === "RECONCILE") {
    if (execution.reasonCode === mapped.reasonCode) return execution;
    return transition(execution, execution.state, mapped.reasonCode);
  }
  const progress = monotonicProgress(execution.progress, track.progress);
  if (mapped.state === "SUCCEEDED")
    return terminal(execution, "SUCCEEDED", mapped.reasonCode, {
      resourceId: "vehicle:ugv1",
      status: successStatus,
      observedAt: track.observedAt ?? new Date().toISOString(),
    });
  if (mapped.state === "BUSINESS_FAILED")
    return terminal(execution, "BUSINESS_FAILED", mapped.reasonCode, {
      resourceId: "vehicle:ugv1",
      status: "failed",
      observedAt: track.observedAt ?? new Date().toISOString(),
    });
  if (mapped.state === "CANCELLED")
    return terminal(execution, "CANCELLED", mapped.reasonCode, {
      resourceId: "vehicle:ugv1",
      status: "cancelled",
      observedAt: track.observedAt ?? new Date().toISOString(),
    });
  if (
    execution.state === "STOPPING" &&
    (mapped.state === "STARTING" || mapped.state === "RUNNING" || mapped.state === "PAUSED")
  )
    return execution;
  if (execution.state === "RESUMING" && mapped.state === "PAUSED") return execution;
  if (mapped.state === execution.state && progress === execution.progress) return execution;
  const next = transition(execution, mapped.state, mapped.reasonCode);
  if (progress !== undefined) next.progress = progress;
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
function acceptedConfirmation(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((item) => {
    if (!record(item) || item.key !== "fire_confirmation") return false;
    const result = protoStructToJson(item.result);
    const content = record(result.content) ? result.content : undefined;
    return result.action === "accept" && (content?.confirmed === true || result.confirmed === true);
  });
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
    "vehicle_fire_weapon",
  ].includes(operationName);
}
function missionIdOf(result: Record<string, unknown>): string | undefined {
  const value = result.mission_id ?? result.missionId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
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
function deviceTrack(value: unknown): VehicleTaskTrack | undefined {
  if (!record(value) || !new Set([-1, 0, 1, 2, 3, 4, 5]).has(value.state as number))
    return undefined;
  const id = scalarText(value.id);
  return {
    state: value.state as -1 | 0 | 1 | 2 | 3 | 4 | 5,
    ...(id === undefined ? {} : { id }),
    ...(typeof value.progress === "number" && value.progress >= 0 && value.progress <= 100
      ? { progress: value.progress }
      : {}),
    observedAt: new Date().toISOString(),
  };
}
function scalarText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
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

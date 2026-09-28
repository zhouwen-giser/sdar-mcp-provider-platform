import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  canonicalJson,
  jsonToProtoStruct,
  protoStructToJson,
  protoValueToJson,
  type ProtoValue,
} from "../../../packages/adapter-protocol/src/index.js";
import type {
  CommandAckRecord,
  ExecutionContextRecord,
  MutationJournalEntry,
  MutationJournalPhase,
  ProviderExecution,
  ProviderExecutionState,
  ProviderStore,
} from "../../../packages/provider-adapter-kit/src/index.js";
import {
  assertDiagnosticControlSignature,
  BoundExecutionScope,
  diagnosticCapabilityContract,
  diagnosticRequestHash,
  diagnosticStableOperationKey,
  parseSmppDiagnosticControlRequest,
  SMPP_DIAGNOSTIC_CONTRACT,
  SMPP_DIAGNOSTIC_CONTROL_OPERATION,
  SMPP_PROVIDER_BUSINESS_SUCCESS_CAPABILITY,
  SMPP_RESPONSE_LOSS_CAPABILITY,
  SmppDiagnosticResponseLossError,
  type SmppDiagnosticCapabilityId,
  type SmppDiagnosticControlResult,
} from "../../../packages/provider-adapter-kit/src/index.js";
import type {
  UgvDeviceMcpClient,
  UgvDeviceToolName,
  UgvOperationQualification,
  UgvQualificationReasonCode,
  UgvQualificationMatrixInput,
  VehicleOperationPhase,
} from "../../../packages/vehicle-device-mcp-client/src/index.js";
import {
  buildUgvEmergencyStopCleanupCalls,
  buildUgvEmergencyStopPrimaryCall,
  buildUgvTargetLockCall,
  controlDeviceCalls,
  canonicalUgvMissionId,
  DeviceToolRejectedError,
  type DeviceToolCall,
  executeUgvStartFlow,
  type ExecuteUgvStartFlowOptions,
  fireConfirmationCalls,
  missionIdFromUgvResult,
  parseUgvMissionId,
  UGV_DEVICE_TOOL_ALLOWLIST,
  UgvOperationQualificationService,
  UncertainMutatingDeviceCallError,
} from "../../../packages/vehicle-device-mcp-client/src/index.js";
import {
  normalizeMqttObservation,
  type AppliedMqttObservation,
  type VehicleMqttIngress,
} from "../../../packages/vehicle-mqtt-ingress/src/index.js";
import {
  assertNoRefereeData,
  checkVehicleAvailability,
  compareIsoTimestamps,
  millisecondsBetweenIsoTimestamps,
  freshnessState,
  isNewAuthority,
  mapReconMotionStatus,
  mapVehicleTaskState,
  monotonicProgress,
  capturePhysicalDispatchBaseline,
  navigationPhysicalConfirmation,
  navigationTerminalFacts,
  reconCorrelationStrength,
  reconTerminalFacts,
  stationaryPhysicalConfirmation,
  UGV_OPERATION_TRACKS,
  sanitizeFireResult,
  TrackArbiter,
  vehicleEvidence,
  type AvailabilityDecision,
  type CorrelationStrength,
  type FreshnessPolicy,
  type PhysicalDispatchBaseline,
  type PhysicalObservationAuthority,
  type UgvSnapshot,
  type VehicleManifestProfile,
  type VehicleObservationField,
  type VehicleReconnaissanceState,
  type VehicleTaskTrack,
  type VehicleTrack,
} from "../../../packages/vehicle-provider-core/src/index.js";
import type { UgvBusinessEventHub } from "./business-events.js";
import type { UgvTaskBusinessContextService } from "./task-business-service.js";
import {
  RequiredInputSchema,
  RuntimeInterventionCommandSchema,
  TrustedResponderSchema,
  type RequiredInput,
} from "../../../packages/vehicle-provider-core/src/task-business-interaction.js";
import { ReconBusinessProcessor } from "./recon-business-processor.js";
import { TargetBusinessProcessor } from "./target-business-processor.js";
import { NativeLockBusinessProcessor } from "./native-lock-business-processor.js";
import { UgvManualInputBusinessHandler } from "./manual-input-business-handler.js";
import { NavigationTrajectoryProcessor } from "./navigation-trajectory-processor.js";
import type { VehicleBusinessReadIdentity } from "../../../packages/provider-adapter-kit/src/vehicle-grpc-server.js";
import type { BusinessSnapshotPartSelector } from "../../../packages/adapter-protocol/src/index.js";
import type { UgvTelemetry } from "./telemetry.js";
import { normalizeUgvCapabilities } from "./capabilities.js";
import { UgvOperationHealthTracker } from "./operation-health.js";
import { deduplicateTargets, normalizeDeviceTargets } from "./targets.js";

const OPERATIONS = new Set(Object.keys(UGV_OPERATION_TRACKS));
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
const RESOURCE_TELEMETRY_INTERVAL_MS = 1_000;
const FRESHNESS_TELEMETRY_INTERVAL_MS = 10_000;
const FIRE_LOCAL_CANCELLATION_REASONS = new Set([
  "UGV_FIRE_CONFIRMATION_REJECTED",
  "UGV_FIRE_CANCELLED_BEFORE_DISPATCH",
]);
const TARGET_PROJECTION_CONFLICT_REASONS = new Set([
  "TARGET_SOURCE_VERSION_CONFLICT",
  "TARGET_SAME_TIME_POSITION_CONFLICT",
]);

const BLOCKING_QUALIFICATION_REASONS: ReadonlySet<UgvQualificationReasonCode> = new Set([
  "UGV_TOOL_MISSING",
  "UGV_TOOL_INPUT_SCHEMA_MISMATCH",
  "UGV_TOOL_OUTPUT_SCHEMA_MISMATCH",
  "UGV_TOOL_EXTERNAL_VERIFICATION_REQUIRED",
  "UGV_TOOL_CIRCUIT_OPEN",
  "UGV_TOOL_UNAVAILABLE",
  "UGV_TOOL_RECOVERING",
  "UGV_TOOL_RESULT_POLICY_UNVERIFIED",
]);

export interface StartUgvOperation {
  taskId: string;
  operationName: string;
  arguments: Record<string, unknown>;
  argumentHash: string;
  executionContext: ExecutionContextRecord;
}

function qualificationFailureReason(
  qualification: UgvOperationQualification,
): UgvQualificationReasonCode {
  return (
    qualification.reasonCodes.find((reasonCode) =>
      BLOCKING_QUALIFICATION_REASONS.has(reasonCode),
    ) ?? "UGV_TOOL_UNAVAILABLE"
  );
}

function qualificationFailureDescription(
  qualification: UgvOperationQualification,
  reasonCode: UgvQualificationReasonCode,
): string {
  const tool = qualification.tools.find((fact) => fact.reasonCodes.includes(reasonCode));
  return tool === undefined ? reasonCode : `${reasonCode}:${tool.toolName}`;
}
export interface CommandIdentity {
  taskId: string;
  externalExecutionId: string;
  operationName: string;
  argumentHash: string;
  executionContext: ExecutionContextRecord;
  commandSequence: string;
}

export type UgvProviderReadinessState = "NOT_READY" | "READY" | "DEGRADED" | "UNKNOWN";

export interface UgvProviderReadinessSnapshot {
  state: UgvProviderReadinessState;
  reasonCode: string;
  deviceMcpConnected: boolean;
  mqttConnected: boolean;
  initialObservationReceived: boolean;
  recoveryComplete: boolean;
  observedAt: string;
}

export class UgvProviderRuntime {
  readonly arbiter: TrackArbiter;
  readonly events = new EventEmitter();
  #unsubscribeSnapshot: (() => void) | undefined;
  #poller: NodeJS.Timeout | undefined;
  #deviceReconnect: Promise<void> | undefined;
  #unsubscribeToolHealth: (() => void) | undefined;
  #unsubscribeDeviceConnection: (() => void) | undefined;
  #unsubscribeCallObservation: (() => void) | undefined;
  #mutationTail: Promise<void> = Promise.resolve();
  #pollPromise: Promise<void> | undefined;
  #lastObservedSnapshot: UgvSnapshot | undefined;
  #localInitialization: Promise<void> | undefined;
  #dependencyInitialization: Promise<void> | undefined;
  #recoveryComplete = false;
  #closed = false;
  #lastResourceTelemetryAtMs = Number.NEGATIVE_INFINITY;
  #lastFreshnessTelemetryAtMs = Number.NEGATIVE_INFINITY;
  #readiness: UgvProviderReadinessSnapshot;
  readonly #freshnessStates = new Map<string, "fresh" | "stale" | "unknown">();
  readonly operationHealth: UgvOperationHealthTracker;
  readonly qualification = new UgvOperationQualificationService();
  constructor(
    readonly options: {
      providerId: string;
      resourceId?: string;
      entityId?: string;
      executionMode?: "simulation" | "live";
      freshness: FreshnessPolicy;
      allowNavigationWithRecon: boolean;
      fireEnabled?: boolean;
      fireRequiresChassisStopped: boolean;
      stationarySpeedThresholdKmh?: number;
      stationaryStabilityMs?: number;
      stationaryMinimumSamples?: number;
      startObservationTimeoutMs?: number;
      activeObservationTimeoutMs?: number;
      terminalObservationTimeoutMs?: number;
      physicalConfirmationTimeoutMs?: number;
      initialObservationWaitMs?: number;
      controlConfirmationTimeoutMs?: number;
      failureBudget?: {
        degradedThreshold: number;
        openThreshold: number;
        recoverySuccessThreshold: number;
      };
      pollIntervalMs: number;
      businessManualDecision?: {
        maxWaitMs: number;
        onExpire: RequiredInput["onExpire"];
        onDismiss: RequiredInput["onDismiss"];
      };
      diagnostics?: {
        enabled: boolean;
        controlToken: string;
        credentialFree?: boolean;
        maximumTtlMs: number;
      };
      now?: () => Date;
    },
    readonly store: ProviderStore,
    readonly ingress: VehicleMqttIngress,
    readonly device: UgvDeviceMcpClient,
    readonly businessEvents: UgvBusinessEventHub,
    readonly telemetry: UgvTelemetry,
    readonly taskBusiness?: UgvTaskBusinessContextService,
  ) {
    this.arbiter = new TrackArbiter(
      options.allowNavigationWithRecon,
      "UGV",
      UGV_OPERATION_TRACKS,
      true,
    );
    this.operationHealth = new UgvOperationHealthTracker(
      options.failureBudget ?? {
        degradedThreshold: 2,
        openThreshold: 3,
        recoverySuccessThreshold: 2,
      },
    );
    this.#readiness = {
      state: "NOT_READY",
      reasonCode: "UGV_PROVIDER_INITIALIZING",
      deviceMcpConnected: false,
      mqttConnected: false,
      initialObservationReceived: false,
      recoveryComplete: false,
      observedAt: this.#now().toISOString(),
    };
  }

  #now(): Date {
    return this.options.now?.() ?? new Date();
  }

  async initialize(): Promise<void> {
    await this.initializeLocal();
    await this.initializeDependencies();
  }

  initializeLocal(): Promise<void> {
    this.#localInitialization ??= this.#initializeLocal();
    return this.#localInitialization;
  }

  initializeDependencies(): Promise<void> {
    this.#dependencyInitialization ??= this.#initializeDependencies();
    return this.#dependencyInitialization;
  }

  async #initializeLocal(): Promise<void> {
    this.#closed = false;
    await this.store.initialize();
    this.#unsubscribeDeviceConnection = this.device.onConnectionState((state) => {
      this.ingress.setDeviceConnected(state === "connected");
      if (state === "connected") this.#synchronizeDeviceToolHealth();
      this.#refreshReadiness();
    });
    this.#synchronizeDeviceToolHealth();
    this.#unsubscribeToolHealth = this.device.onToolHealth((health) => {
      for (const transition of this.operationHealth.recordToolHealth(health))
        void this.#operationHealthTransition(transition.previous, transition.current);
    });
    this.#unsubscribeCallObservation = this.device.onCallObservation((observation) => {
      const quality = `${observation.toolName}:${observation.kind}:${observation.outcome}`;
      void this.telemetry.metric("device_mcp_call_total", 1, "call", quality);
      void this.telemetry.metric(
        "device_mcp_call_latency_ms",
        observation.durationMs,
        "ms",
        quality,
      );
      if (observation.retries > 0)
        void this.telemetry.metric(
          "device_mcp_retry_total",
          observation.retries,
          "retry",
          `${observation.toolName}:${observation.outcome}`,
        );
      if (observation.uncertain)
        void this.telemetry.metric("device_mcp_uncertain_total", 1, "call", observation.toolName);
    });
    this.ingress.setDeviceConnected(this.device.connected());
    this.#unsubscribeSnapshot = this.ingress.onSnapshot((snapshot, topic, applied) => {
      void this.#serializeMutation(() => this.#observe(snapshot, topic, applied));
    });
    this.#refreshReadiness();
    this.#poller = setInterval(() => void this.pollActive(), this.options.pollIntervalMs);
  }

  #synchronizeDeviceToolHealth(): void {
    for (const toolName of UGV_DEVICE_TOOL_ALLOWLIST)
      this.operationHealth.recordToolHealth(this.device.toolHealth(toolName));
  }

  async #initializeDependencies(): Promise<void> {
    await this.initializeLocal();
    await this.#ensureDeviceConnection();
    await this.#waitForInitialObservation();
    await this.recover();
    this.#recoveryComplete = true;
    this.#refreshReadiness();
  }

  async close(): Promise<void> {
    this.#closed = true;
    if (this.#poller !== undefined) clearInterval(this.#poller);
    this.#unsubscribeSnapshot?.();
    this.#unsubscribeToolHealth?.();
    this.#unsubscribeCallObservation?.();
    this.#unsubscribeDeviceConnection?.();
    await this.#dependencyInitialization?.catch(() => undefined);
    await this.#mutationTail.catch(() => undefined);
    await this.device.close();
    await this.store.close();
  }
  snapshot(): UgvSnapshot {
    return this.ingress.snapshot();
  }
  readiness(): UgvProviderReadinessSnapshot {
    return structuredClone(this.#readiness);
  }
  qualificationContext(): UgvQualificationMatrixInput {
    return {
      contracts: this.device.contracts(),
      toolHealth: UGV_DEVICE_TOOL_ALLOWLIST.map((toolName) => this.device.toolHealth(toolName)),
      executionMode: this.options.executionMode ?? "simulation",
    };
  }
  operationQualification(
    operationName: string,
    argumentsValue: Readonly<Record<string, unknown>> = {},
    phase?: VehicleOperationPhase,
  ): UgvOperationQualification {
    return this.qualification.qualify({
      ...this.qualificationContext(),
      operationName,
      arguments: argumentsValue,
      ...(phase === undefined ? {} : { phase }),
    });
  }
  async executionSnapshot(execution: ProviderExecution): Promise<Record<string, unknown>> {
    const request =
      execution.operationName === "vehicle_area_recon" && execution.state === "WAITING_INPUT"
        ? await this.taskBusiness?.activeRequiredInput(execution)
        : undefined;
    return executionSnapshot(execution, request);
  }
  getBusinessContext(
    identity: VehicleBusinessReadIdentity,
    maxPageBytes: number,
    pageCursor: string,
  ): Promise<Record<string, unknown>> {
    if (!this.taskBusiness) return Promise.reject(new Error("BUSINESS_METHOD_NOT_ENABLED"));
    return this.taskBusiness.getBusinessContext(identity, maxPageBytes, pageCursor);
  }
  getBusinessSnapshotPart(
    identity: VehicleBusinessReadIdentity,
    selector: BusinessSnapshotPartSelector,
  ): ReturnType<UgvTaskBusinessContextService["getBusinessSnapshotPart"]> {
    if (!this.taskBusiness) return Promise.reject(new Error("BUSINESS_METHOD_NOT_ENABLED"));
    return this.taskBusiness.getBusinessSnapshotPart(identity, selector);
  }
  businessFeedbackProfiles(): VehicleManifestProfile["businessFeedbackProfiles"] | undefined {
    if (
      !this.taskBusiness ||
      !this.store.businessEventSources().some((source) => source.sourceId === "vehicle.business")
    ) {
      return undefined;
    }
    return {
      vehicle_navigate: this.taskBusiness.readOnlyProfile("vehicle_navigate"),
      vehicle_area_recon: this.taskBusiness.readOnlyProfile("vehicle_area_recon"),
    };
  }
  getBusinessArtifact(
    identity: VehicleBusinessReadIdentity,
    artifactId: string,
    revision: number | undefined,
    representationName: string,
    includeContent: boolean,
  ): ReturnType<UgvTaskBusinessContextService["getBusinessArtifact"]> {
    if (!this.taskBusiness) return Promise.reject(new Error("BUSINESS_METHOD_NOT_ENABLED"));
    return this.taskBusiness.getBusinessArtifact(
      identity,
      artifactId,
      revision,
      representationName,
      includeContent,
    );
  }
  start(
    input: StartUgvOperation,
  ): Promise<{ externalExecutionId: string; initialSnapshot: Record<string, unknown> }> {
    return this.#serializeMutation(() => this.#start(input));
  }

  async #start(
    input: StartUgvOperation,
  ): Promise<{ externalExecutionId: string; initialSnapshot: Record<string, unknown> }> {
    if (input.operationName === SMPP_DIAGNOSTIC_CONTROL_OPERATION) {
      return this.#diagnosticControl(input);
    }
    validateStart(input, this.options);
    if (SYNC_OPERATIONS.has(input.operationName)) return this.#synchronous(input);
    const existing = await this.store.getExecution(input.taskId);
    if (existing !== undefined) {
      assertIdentity(existing, input);
      if (existing.taskBusinessContextExpected && this.taskBusiness) {
        await this.taskBusiness.ensureForCreatedExecution(existing.taskId);
      }
      return {
        externalExecutionId: existing.externalExecutionId,
        initialSnapshot: await this.executionSnapshot(existing),
      };
    }
    const decision = this.availability(input.operationName, input.arguments);
    if (decision.availability !== "AVAILABLE") throw new Error(decision.reasonCode);
    const preemptedExecutions =
      input.operationName === "vehicle_emergency_stop"
        ? await this.#preemptableExecutions(input.taskId)
        : [];
    const acquired = this.arbiter.acquire(
      input.taskId,
      input.operationName,
      typeof input.arguments.targetId === "string" ? input.arguments.targetId : undefined,
    );
    if (!acquired.accepted) throw new Error(acquired.reasonCode);
    const now = this.#now().toISOString();
    const tracks = UGV_OPERATION_TRACKS[input.operationName] ?? [];
    const observationCursors = initialObservationCursors(input.operationName, this.ingress);
    const dispatchBaseline = capturePhysicalDispatchBaseline(
      this.ingress.snapshot(),
      operationObservationAuthorities(input.operationName, this.ingress),
      now,
    );
    const baselineSpeedCursor = this.ingress.fieldObservationAuthority("chassis.speed")?.cursor;
    let execution: ProviderExecution = {
      taskId: input.taskId,
      externalExecutionId: `${this.options.resourceId ?? "vehicle:ugv1"}:${tracks[0] ?? "query"}:${randomUUID()}`,
      operationName: input.operationName,
      argumentHash: input.argumentHash,
      providerId: this.options.providerId,
      resourceId: this.options.resourceId ?? "vehicle:ugv1",
      tracks,
      arguments: structuredClone(input.arguments),
      executionContext: structuredClone(input.executionContext),
      ...(this.taskBusiness?.supports(input.operationName)
        ? { taskBusinessContextExpected: true }
        : {}),
      downstreamMissionIds: [],
      ...(observationCursors === undefined ? {} : { observationCursors }),
      dispatchBaseline: dispatchBaseline as unknown as Record<string, unknown>,
      state: input.operationName === "vehicle_fire_weapon" ? "WAITING_INPUT" : "ACCEPTED",
      revision: 1,
      reasonCode:
        input.operationName === "vehicle_fire_weapon"
          ? "UGV_FIRE_CONFIRMATION_REQUIRED"
          : "UGV_OPERATION_ACCEPTED",
      createdAt: now,
      updatedAt: now,
      evidence: [],
      ...(baselineSpeedCursor === undefined
        ? {}
        : { lastStationarySpeedCursor: baselineSpeedCursor }),
      ...(preemptedExecutions.length === 0
        ? {}
        : { preemptedTaskIds: preemptedExecutions.map(({ taskId }) => taskId).sort() }),
    };
    let executionPersisted = false;
    try {
      if (input.operationName === "vehicle_emergency_stop")
        await this.#persistPreemptionRelations(input.taskId, preemptedExecutions, now);
      await this.store.putExecution(execution);
      executionPersisted = true;
      if (execution.taskBusinessContextExpected) {
        await this.taskBusiness?.ensureForCreatedExecution(execution.taskId);
      }
    } catch (error) {
      this.arbiter.release(input.taskId);
      if (executionPersisted && execution.taskBusinessContextExpected) {
        const failed = transition(execution, "TECHNICAL_FAILED", "BUSINESS_CONTEXT_INIT_FAILED");
        failed.taskBusinessContextExpected = false;
        failed.terminalAt = failed.updatedAt;
        failed.result = {
          resourceId: execution.resourceId,
          status: "failed",
          observedAt: failed.updatedAt,
        };
        await this.store.putExecution(failed);
      }
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
        if (input.operationName === "vehicle_emergency_stop") {
          await this.#dispatchEmergencyStop(
            input.taskId,
            await this.#emergencyStopArguments(input.arguments),
          );
        } else
          await executeUgvStartFlow(
            input.operationName,
            input.arguments,
            (name, argumentsValue) => this.#callDevice(name, argumentsValue, input.taskId),
            {
              ...this.#journaledMultiStepStart(input.taskId),
              onMissionId: async (missionId) => {
                if (execution.downstreamMissionIds.includes(missionId)) return;
                execution = withMissionId(execution, missionId);
                await this.store.putExecution(execution);
              },
            },
          );
        const responseLoss = await this.#bindDiagnostic(execution, SMPP_RESPONSE_LOSS_CAPABILITY);
        const businessSuccess = await this.#bindDiagnostic(
          execution,
          SMPP_PROVIDER_BUSINESS_SUCCESS_CAPABILITY,
        );
        if (businessSuccess !== undefined) {
          execution = {
            ...execution,
            diagnosticBehavior: {
              capabilityId: businessSuccess.lease.capabilityId,
              leaseId: businessSuccess.lease.leaseId,
              fence: businessSuccess.lease.fence,
              expiresAt: businessSuccess.lease.expiresAt,
              caseExecutionId: businessSuccess.lease.scope.caseExecutionId,
              repetitionId: businessSuccess.lease.scope.repetitionId,
            },
            revision: execution.revision + 1,
            updatedAt: this.#now().toISOString(),
          };
          await this.store.putExecution(execution);
        }
        execution = await this.#armStartObservationDeadline(execution);
        execution = transition(
          execution,
          "STARTING",
          input.operationName === "vehicle_emergency_stop"
            ? "STOP_DISPATCHED_CONFIRMATION_PENDING"
            : "UGV_WAITING_DEVICE_CONFIRMATION",
        );
        await this.store.putExecution(execution);
        await this.#startedEvent(execution);
        if (responseLoss !== undefined) {
          const missionId = responseLoss.lease.deviceMissionId;
          if (missionId === undefined) throw new Error("SMPP_DIAGNOSTIC_MISSION_ID_REQUIRED");
          const observedAt = this.#now().toISOString();
          await this.telemetry.emit(
            "PROVIDER_DIAGNOSTIC",
            {
              state: "STARTING",
              reasonCode: "response_lost_after_adapter_success",
            },
            {
              taskId: execution.taskId,
              externalExecutionId: execution.externalExecutionId,
              operationName: execution.operationName,
              observedAt,
              attributes: diagnosticTelemetryAttributes(responseLoss, execution, {
                redispatchAllowed: false,
                continuationPolicy: "reconcile-original-once",
              }),
            },
          );
          await this.store.consumeDiagnosticLease(
            responseLoss.lease.leaseId,
            responseLoss.lease.canonicalRequestHash,
            randomUUID(),
            observedAt,
          );
          throw new SmppDiagnosticResponseLossError(
            responseLoss.lease.leaseId,
            execution.taskId,
            execution.externalExecutionId,
            missionId,
          );
        }
        await this.telemetry.metric(
          "provider_task_start_latency_ms",
          Math.max(0, Date.now() - Date.parse(execution.createdAt)),
          "ms",
          execution.operationName,
          identityTelemetry(execution),
        );
      }
      await this.telemetry.emit(
        "EXECUTION_PROGRESS",
        executionProgressPayload(execution),
        identityTelemetry(execution, executionProgressAttributes(execution)),
      );
      return {
        externalExecutionId: execution.externalExecutionId,
        initialSnapshot: await this.executionSnapshot(execution),
      };
    } catch (error) {
      if (error instanceof SmppDiagnosticResponseLossError) throw error;
      if (await this.#downstreamMissionReadyNotStarted(execution)) {
        execution = transition(execution, "STARTING", "DOWNSTREAM_MISSION_READY_NOT_STARTED");
        await this.store.putExecution(execution);
        return {
          externalExecutionId: execution.externalExecutionId,
          initialSnapshot: await this.executionSnapshot(execution),
        };
      }
      if (error instanceof UncertainMutatingDeviceCallError) {
        execution = await this.#armStartObservationDeadline(execution);
        execution = transition(execution, "STARTING", "UNCERTAIN_EXECUTION_STATE");
        await this.store.putExecution(execution);
        return {
          externalExecutionId: execution.externalExecutionId,
          initialSnapshot: await this.executionSnapshot(execution),
        };
      }
      this.arbiter.release(input.taskId);
      const failed = terminal(
        execution,
        error instanceof DeviceToolRejectedError ? "BUSINESS_FAILED" : "TECHNICAL_FAILED",
        input.operationName === "vehicle_emergency_stop" ? "STOP_DISPATCH_FAILED" : reason(error),
        {
          resourceId: this.options.resourceId ?? "vehicle:ugv1",
          status: "failed",
          observedAt: new Date().toISOString(),
        },
      );
      await this.store.putExecution(failed);
      await this.taskBusiness?.finalizeForTerminalExecution(failed);
      throw error;
    }
  }

  async #diagnosticControl(
    input: StartUgvOperation,
  ): Promise<{ externalExecutionId: string; initialSnapshot: Record<string, unknown> }> {
    const diagnostics = this.options.diagnostics;
    if (
      diagnostics?.enabled !== true ||
      (!diagnostics.credentialFree && diagnostics.controlToken.length === 0)
    ) {
      throw new Error("SMPP_DIAGNOSTICS_DISABLED");
    }
    const capabilityId = input.arguments.capabilityId;
    if (
      capabilityId !== SMPP_RESPONSE_LOSS_CAPABILITY &&
      capabilityId !== SMPP_PROVIDER_BUSINESS_SUCCESS_CAPABILITY
    ) {
      throw new Error("SMPP_DIAGNOSTIC_CAPABILITY_INVALID");
    }
    const request = parseSmppDiagnosticControlRequest(
      input.arguments.request,
      capabilityId,
      diagnostics.maximumTtlMs,
    );
    if (!diagnostics.credentialFree)
      assertDiagnosticControlSignature(
        diagnostics.controlToken,
        input.executionContext.authorizationContextHash,
        capabilityId,
        request,
      );
    await this.#expireDiagnosticLeases();
    const now = this.#now();
    let result: SmppDiagnosticControlResult | undefined;
    if (request.action === "arm") {
      const contract = diagnosticCapabilityContract(capabilityId);
      const requestHash = diagnosticRequestHash(capabilityId, request);
      const stableOperationKey = diagnosticStableOperationKey(capabilityId, request.scope);
      const leaseId = randomUUID();
      result = await this.store.armDiagnosticLease(
        {
          contract: SMPP_DIAGNOSTIC_CONTRACT,
          leaseId,
          capabilityId,
          faultType: contract.faultType,
          boundary: contract.boundary,
          injectionCount: 1,
          operationName: "vehicle_navigate",
          stableOperationKey,
          canonicalRequestHash: requestHash,
          idempotencyKey: request.idempotencyKey,
          state: "ARMED",
          scope: request.scope,
          armedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + request.ttlMs).toISOString(),
        },
        {
          contract: SMPP_DIAGNOSTIC_CONTRACT,
          receiptId: randomUUID(),
          leaseId,
          action: "armed",
          requestHash,
          occurredAt: now.toISOString(),
          reasonCode: "SMPP_DIAGNOSTIC_ARMED",
        },
      );
    } else if (request.action === "status") {
      result = await this.store.getDiagnosticStatus(request.leaseId);
      if (result?.lease.capabilityId !== capabilityId) {
        throw new Error("SMPP_DIAGNOSTIC_LEASE_NOT_FOUND");
      }
    } else {
      const existing = await this.store.getDiagnosticLease(request.leaseId);
      if (existing?.capabilityId !== capabilityId) {
        throw new Error("SMPP_DIAGNOSTIC_LEASE_NOT_FOUND");
      }
      result = await this.store.disarmDiagnosticLease(
        request.leaseId,
        diagnosticRequestHash(capabilityId, request),
        randomUUID(),
        now.toISOString(),
      );
      await this.#removeDiagnosticBehavior(result.lease.leaseId, result.lease.taskId);
    }
    return {
      externalExecutionId: `diagnostic:${result.lease.leaseId}`,
      initialSnapshot: {
        taskId: input.taskId,
        externalExecutionId: `diagnostic:${result.lease.leaseId}`,
        operationName: input.operationName,
        argumentHash: input.argumentHash,
        executionContext: input.executionContext,
        state: "SUCCEEDED",
        revision: 1,
        reasonCode: result.receipt.reasonCode,
        message: result.receipt.reasonCode,
        retryable: false,
        observedAt: timestamp(result.receipt.occurredAt),
        result: jsonToProtoStruct({
          contract: SMPP_DIAGNOSTIC_CONTRACT,
          capabilityId,
          ...result,
        }),
        evidence: [],
      },
    };
  }

  async #bindDiagnostic(
    execution: ProviderExecution,
    capabilityId: SmppDiagnosticCapabilityId,
  ): Promise<SmppDiagnosticControlResult | undefined> {
    if (
      this.options.diagnostics?.enabled !== true ||
      execution.operationName !== "vehicle_navigate"
    )
      return undefined;
    const missionId = execution.downstreamMissionIds.at(-1);
    if (missionId === undefined) return undefined;
    return this.store.bindDiagnosticLease({
      capabilityId,
      operationName: "vehicle_navigate",
      argumentHash: execution.argumentHash,
      logicalInvocationId: execution.executionContext.correlationId,
      taskId: execution.taskId,
      externalExecutionId: execution.externalExecutionId,
      deviceMissionId: missionId,
      observedAt: this.#now().toISOString(),
    });
  }

  async #expireDiagnosticLeases(): Promise<void> {
    if (this.options.diagnostics?.enabled !== true) return;
    for (const expired of await this.store.expireDiagnosticLeases(this.#now().toISOString())) {
      await this.#removeDiagnosticBehavior(expired.lease.leaseId, expired.lease.taskId);
    }
  }

  async #removeDiagnosticBehavior(leaseId: string, taskId?: string): Promise<void> {
    if (taskId === undefined) return;
    const execution = await this.store.getExecution(taskId);
    if (execution?.diagnosticBehavior?.leaseId !== leaseId || isTerminal(execution.state)) return;
    const withoutDiagnostic = { ...execution };
    delete withoutDiagnostic.diagnosticBehavior;
    const next = {
      ...withoutDiagnostic,
      revision: execution.revision + 1,
      updatedAt: this.#now().toISOString(),
    };
    await this.store.putExecution(next);
  }

  availability(
    operationName: string,
    argumentsValue: Record<string, unknown>,
    ignoreOwnedByTaskId?: string,
  ): AvailabilityDecision {
    if (this.#readiness.state === "NOT_READY")
      return {
        availability: "UNKNOWN",
        riskLevel: "LOW",
        reasonCode: "UGV_PROVIDER_NOT_READY",
        description: "UGV_PROVIDER_NOT_READY",
      };
    if (!OPERATIONS.has(operationName))
      return {
        availability: "DISABLED",
        riskLevel: "LOW",
        reasonCode: "UGV_OPERATION_UNSUPPORTED",
        description: "UGV_OPERATION_UNSUPPORTED",
      };
    const qualification = this.operationQualification(operationName, argumentsValue);
    const operationHealth = this.operationHealth.snapshot(
      operationName,
      argumentsValue,
      qualification.phase,
    );
    const snapshot = this.ingress.snapshot();
    const locallyOccupiedTracks = this.arbiter.occupiedFor(
      operationName,
      typeof argumentsValue.targetId === "string" ? argumentsValue.targetId : undefined,
      ignoreOwnedByTaskId,
    );
    const externallyOccupiedTracks = deviceObservedOccupiedTracks(snapshot, this.arbiter);
    if (operationName !== "vehicle_emergency_stop")
      for (const track of UGV_OPERATION_TRACKS[operationName] ?? [])
        if (externallyOccupiedTracks.has(track))
          return externalTrackBusyDecision(track, qualification.riskLevel ?? "MEDIUM");
    let decision = checkVehicleAvailability({
      operationName,
      operationTracks: UGV_OPERATION_TRACKS,
      snapshot,
      freshness: this.options.freshness,
      occupiedTracks: new Set([...locallyOccupiedTracks, ...externallyOccupiedTracks]),
      requiredToolsPresent: qualification.qualified,
      ...(typeof argumentsValue.targetId === "string" ? { targetId: argumentsValue.targetId } : {}),
      allowNavigationWithRecon: this.options.allowNavigationWithRecon,
      fireRequiresChassisStopped: this.options.fireRequiresChassisStopped,
      circularScanSupported: true,
      ...(typeof argumentsValue.scanMode === "string" ? { scanMode: argumentsValue.scanMode } : {}),
      now: this.#now().getTime(),
    });
    if (
      operationName === "vehicle_navigate" &&
      (decision.reasonCode === "UGV_STATE_STALE" ||
        (decision.availability === "AVAILABLE" &&
          this.ingress.fieldFreshnessState(
            "chassis.position.geodetic",
            this.options.freshness.chassis,
            this.#now().getTime(),
          ) !== "fresh"))
    )
      decision = {
        availability: "DISABLED",
        riskLevel: qualification.riskLevel ?? "MEDIUM",
        reasonCode: "UGV_STATE_STALE",
        description: "UGV_STATE_STALE",
      };
    if (decision.reasonCode === "UGV_TOOL_UNAVAILABLE") {
      const reasonCode = qualificationFailureReason(qualification);
      return {
        ...decision,
        riskLevel: qualification.riskLevel ?? decision.riskLevel,
        reasonCode,
        description: qualificationFailureDescription(qualification, reasonCode),
      };
    }
    if (
      operationHealth.state === "RECOVERING" &&
      decision.reasonCode !== "UGV_MQTT_UNAVAILABLE" &&
      decision.reasonCode !== "UGV_DEVICE_MCP_UNAVAILABLE"
    )
      return {
        availability: "UNKNOWN",
        riskLevel: qualification.riskLevel ?? decision.riskLevel,
        reasonCode: "UGV_TOOL_RECOVERING",
        description: "UGV_TOOL_RECOVERING",
      };
    return operationHealth.state === "DEGRADED" && decision.availability === "AVAILABLE"
      ? {
          ...decision,
          reasonCode: "PUBLIC_AVAILABILITY_DEGRADED_REPRESENTATION_GAP",
          description: "PUBLIC_AVAILABILITY_DEGRADED_REPRESENTATION_GAP",
        }
      : decision;
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
      const commandBaseline = capturePhysicalDispatchBaseline(
        this.ingress.snapshot(),
        operationObservationAuthorities(execution.operationName, this.ingress),
      );
      const fenced = transition(
        execution,
        execution.state,
        `UGV_${command.toUpperCase()}_DISPATCH_FENCED`,
      );
      const commandFencedAt = this.#now().toISOString();
      fenced.controlConfirmation = {
        command,
        fencedAt: commandFencedAt,
        baseline: commandBaseline,
      };
      fenced.controlConfirmationDeadline = deadlineFrom(
        commandFencedAt,
        this.options.controlConfirmationTimeoutMs ?? 30_000,
      );
      resetStationaryStability(
        fenced,
        this.ingress.fieldObservationAuthority("chassis.speed")?.cursor,
      );
      await this.store.putExecution(fenced);
      const calls = controlDeviceCalls(execution.operationName, command, persistedMissionId ?? 0);
      for (const [index, call] of calls.entries())
        await this.#callJournaledMutation(
          execution.taskId,
          controlStepId(command, identity.commandSequence, index),
          controlPhase(command),
          call,
        );
      const targetState =
        command === "pause" ? "RUNNING" : command === "resume" ? "RESUMING" : "STOPPING";
      const reasonCode =
        command === "pause"
          ? "UGV_PAUSE_REQUEST_ACCEPTED"
          : command === "resume"
            ? "UGV_RESUME_REQUEST_ACCEPTED"
            : "UGV_CANCEL_REQUEST_ACCEPTED";
      await this.store.putExecution(transition(fenced, targetState, reasonCode));
      return await this.#ack(identity, command, true, reasonCode);
    } catch (error) {
      if (error instanceof UncertainMutatingDeviceCallError) {
        const uncertainState = command === "cancel" ? "STOPPING" : execution.state;
        const fenced = (await this.store.getExecution(execution.taskId)) ?? execution;
        await this.store.putExecution(
          transition(fenced, uncertainState, "UNCERTAIN_EXECUTION_STATE"),
        );
      }
      return this.#ack(identity, command, false, reason(error));
    }
  }

  updateFire(identity: CommandIdentity, responses: unknown): Promise<Record<string, unknown>> {
    return this.#serializeMutation(() => this.#updateFire(identity, responses));
  }

  updateInput(
    identity: CommandIdentity,
    update: { inputs: readonly unknown[]; inputResponses: readonly unknown[] },
  ): Promise<Record<string, unknown>> {
    return this.#serializeMutation(() => this.#updateInput(identity, update));
  }

  /** A stale qualified Task must receive a terminal rejection while this UGV Profile is read-only. */
  applyIntervention(
    identity: CommandIdentity,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.#serializeMutation(async () => {
      const command = "intervention";
      const execution = await this.store.getExecution(identity.taskId);
      if (!execution)
        return this.#ackRecord(identity, command, false, "EXECUTION_NOT_FOUND").response;
      if (!sameIdentity(execution, identity)) {
        return this.#ackRecord(identity, command, false, "TASK_IDENTITY_CONFLICT").response;
      }
      const existing = await this.store.getCommandAck(
        identity.taskId,
        command,
        identity.commandSequence,
      );
      if (existing) return replayCommandResponse(existing.response, identity);
      const intervention = RuntimeInterventionCommandSchema.safeParse(payload.command);
      if (!intervention.success) {
        return this.#ackRecord(identity, command, false, "UGV_INTERVENTION_COMMAND_INVALID")
          .response;
      }
      if (
        intervention.data.taskId !== identity.taskId ||
        intervention.data.executionId !== identity.externalExecutionId
      ) {
        return this.#ackRecord(identity, command, false, "UGV_INTERVENTION_COMMAND_BINDING_INVALID")
          .response;
      }
      if (!TrustedResponderSchema.safeParse(payload.responder).success) {
        return this.#ackRecord(identity, command, false, "UGV_INTERVENTION_RESPONDER_INVALID")
          .response;
      }
      const reasonCode =
        execution.state === "RUNNING"
          ? "UGV_INTERVENTION_NOT_SUPPORTED"
          : "UGV_INTERVENTION_TASK_NOT_RUNNING";
      const rejected = this.#ackRecord(identity, command, false, reasonCode);
      const claim = await this.store.claimCommandAck(rejected);
      return replayCommandResponse(claim.record.response, identity);
    });
  }

  async #updateInput(
    identity: CommandIdentity,
    update: { inputs: readonly unknown[]; inputResponses: readonly unknown[] },
  ): Promise<Record<string, unknown>> {
    const command = "update";
    const execution = await this.store.getExecution(identity.taskId);
    if (execution === undefined)
      return this.#ackRecord(identity, command, false, "EXECUTION_NOT_FOUND").response;
    if (!sameIdentity(execution, identity))
      return this.#ackRecord(identity, command, false, "TASK_IDENTITY_CONFLICT").response;
    const existing = await this.store.getCommandAck(
      identity.taskId,
      command,
      identity.commandSequence,
    );
    if (existing) return replayCommandResponse(existing.response, identity);
    if (update.inputs.length > 0 && update.inputResponses.length > 0)
      return this.#ackRecord(identity, command, false, "INPUT_RESPONSE_WIRE_AMBIGUOUS").response;
    if (execution.operationName === "vehicle_fire_weapon") {
      const responses =
        update.inputs.length > 0 ? legacyFireInputResponses(update.inputs) : update.inputResponses;
      return this.#updateFire(identity, responses);
    }
    if (update.inputs.length === 0 && update.inputResponses.length === 0)
      return this.#ackRecord(identity, command, false, "INPUT_RESPONSE_REQUIRED").response;
    if (!validUnsupportedInputEnvelope(update))
      return this.#ackRecord(identity, command, false, "INPUT_RESPONSE_WIRE_INVALID").response;
    if (
      this.options.businessManualDecision &&
      this.taskBusiness &&
      execution.operationName === "vehicle_area_recon"
    ) {
      return this.#applyManualReconInput(identity, execution, update);
    }
    const denied = this.#ackRecord(identity, command, false, "UGV_INPUT_HANDLER_NOT_AVAILABLE");
    const claimed = await this.store.claimCommandAck(denied);
    return replayCommandResponse(claimed.record.response, identity);
  }

  async #applyManualReconInput(
    identity: CommandIdentity,
    execution: ProviderExecution,
    update: { inputs: readonly unknown[]; inputResponses: readonly unknown[] },
  ): Promise<Record<string, unknown>> {
    const command = "update";
    const taskBusiness = this.taskBusiness;
    if (!taskBusiness) return this.#ack(identity, command, false, "BUSINESS_METHOD_NOT_ENABLED");
    if (update.inputs.length !== 0 || update.inputResponses.length !== 1)
      return this.#ack(identity, command, false, "UGV_INPUT_RESPONSE_COUNT_INVALID");
    const item = update.inputResponses[0];
    if (!record(item) || typeof item.key !== "string" || !record(item.result))
      return this.#ack(identity, command, false, "UGV_INPUT_RESPONSE_WIRE_INVALID");
    const response = protoStructToJson(item.result);
    if (
      response.action !== "accept" ||
      !record(response.content) ||
      !record(item.verifiedResponder)
    )
      return this.#ack(identity, command, false, "UGV_INPUT_RELEASE_NOT_QUALIFIED");
    const verified = protoStructToJson(item.verifiedResponder);
    if (verified.actorType !== "user")
      return this.#ack(identity, command, false, "UGV_INPUT_RESPONDER_NOT_AUTHORIZED");
    const request = await this.#manualReconRequestForKey(execution, item.key);
    if (!request) return this.#ack(identity, command, false, "UGV_INPUT_REQUEST_NOT_CURRENT");
    const commandId = `ugv-input-${createHash("sha256")
      .update(
        JSON.stringify([identity.taskId, identity.externalExecutionId, identity.commandSequence]),
      )
      .digest("hex")
      .slice(0, 40)}`;
    const latest = (await this.store.getExecution(identity.taskId)) ?? execution;
    try {
      await new UgvManualInputBusinessHandler(
        taskBusiness.business,
        taskBusiness.notifyCommitted,
        () => this.#now(),
      ).continueObservation({
        execution:
          latest.state === "RUNNING" ? await this.#reconcileReconRequiredInput(latest) : latest,
        command: {
          schemaVersion: "sdar.required-input-response/1.0-rc2",
          commandId,
          taskId: identity.taskId,
          executionId: identity.externalExecutionId,
          requestId: request.requestId,
          requestKey: request.requestKey,
          guard: { mode: "semantic", expectedRequestRevision: request.revision },
          result: { action: "accept", value: response.content },
        },
        responder: {
          source: "runtime_authorization_context",
          actorType: "user",
          verified: true,
        },
        runtimeCommandSequence: identity.commandSequence,
      });
      const after = await this.store.getExecution(identity.taskId);
      if (after?.state === "WAITING_INPUT") await this.#reconcileReconRequiredInput(after);
      return await this.#ack(identity, command, true, "TARGET_OBSERVATION_CONTINUES");
    } catch (error) {
      // A claimed or applied business command must remain retryable after an
      // uncertain commit/ACK boundary. Do not persist a negative Runtime ACK.
      const recorded = await taskBusiness.business.getCommand(
        BoundExecutionScope.fromExecution(execution),
        commandId,
      );
      if (recorded) throw error;
      return await this.#ack(identity, command, false, reason(error));
    }
  }

  async #manualReconRequestForKey(
    execution: ProviderExecution,
    key: string,
  ): Promise<RequiredInput | undefined> {
    if (!this.taskBusiness) return undefined;
    const active = await this.taskBusiness.activeRequiredInput(execution);
    if (active?.requestKey === key) return active;
    const scope = BoundExecutionScope.fromExecution(execution);
    const context = await this.taskBusiness.business.getContext(scope);
    for (const ref of [...(context?.requiredInputRefs ?? [])].reverse()) {
      const version = await this.taskBusiness.business.getObjectVersion(scope, ref);
      if (version?.kind !== "input_request" || version.value.requestKey !== key) continue;
      if (version.value.revision === 1) return version.value;
      const original = await this.taskBusiness.business.getObjectVersion(scope, {
        kind: "input_request",
        id: ref.id,
        revision: 1,
      });
      return original?.kind === "input_request" ? original.value : undefined;
    }
    return undefined;
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
        resourceId: this.options.resourceId ?? "vehicle:ugv1",
        status: "fire_command_accepted",
        observedAt: next.updatedAt,
      };
      next.evidence.push(
        vehicleEvidence(
          "vehicle.weapon.local_result",
          next.updatedAt,
          "/status",
          `execution:${next.externalExecutionId}`,
          [this.options.providerId, "ugv-adapter"],
        ),
      );
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
        resourceRef: this.options.resourceId ?? "vehicle:ugv1",
        severityHint: "warning",
        rawPayload: { taskId: next.taskId, status: "fire_command_accepted" },
      });
      if (stripped > 0)
        await this.telemetry.metric(
          "fire_verdict_fields_stripped_total",
          stripped,
          "field",
          "sanitized",
          identityTelemetry(next, {
            diagnostic: "fire_verdict_fields_stripped",
            countBucket: stripped > 4 ? "many" : "few",
          }),
        );
      return await this.#completeFireClaim(identity, true, "UGV_FIRE_CONFIRMATION_ACCEPTED");
    } catch (error) {
      if (error instanceof DeviceToolRejectedError) {
        const failed = terminal(execution, "BUSINESS_FAILED", reason(error), {
          resourceId: this.options.resourceId ?? "vehicle:ugv1",
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
      snapshot: await this.executionSnapshot(refreshed),
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
    const active = await this.store.listActiveExecutions();
    for (const execution of [...active].sort(recoveryOwnershipOrder))
      if (execution.preemptedByTaskId === undefined)
        this.arbiter.restore(
          execution.taskId,
          vehicleTracks(execution.tracks),
          execution.operationName,
          typeof execution.arguments.targetId === "string"
            ? execution.arguments.targetId
            : undefined,
        );
    for (const execution of active) {
      if (execution.operationName === "vehicle_fire_weapon") {
        const dispatch = await this.store.getCommandAck(
          execution.taskId,
          FIRE_DISPATCH_COMMAND,
          FIRE_DISPATCH_SEQUENCE,
        );
        if (await this.#recoverPreDispatchFireFence(execution, dispatch)) continue;
      }
      if (execution.preemptedByTaskId !== undefined) {
        await this.#refreshPreemptedExecution(execution);
        continue;
      }
      if (!this.device.connected() || !this.ingress.snapshot().connectivity.mqttConnected) {
        execution.reasonCode = "UNCERTAIN_EXECUTION_STATE";
        execution.updatedAt = this.#now().toISOString();
        execution.revision++;
        await this.store.putExecution(execution);
        continue;
      }
      if (await this.#recoverMultiStepExecution(execution)) continue;
      const unsafeControl = (await this.store.listMutationJournal(execution.taskId)).find(
        (entry) =>
          (entry.phase === "PAUSE" || entry.phase === "RESUME" || entry.phase === "CANCEL") &&
          (entry.state === "DISPATCHING" || entry.state === "UNCERTAIN"),
      );
      if (unsafeControl !== undefined) {
        const uncertain = transition(execution, execution.state, "UNCERTAIN_EXECUTION_STATE");
        await this.store.putExecution(uncertain);
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
    await this.#expireDiagnosticLeases();
    await this.#ensureDeviceConnection();
    this.#refreshReadiness();
    await this.#emitResourceTransitions(this.ingress.snapshot());
    const active = await this.store.listActiveExecutions();
    for (const execution of active) {
      await this.#projectReconBusinessStatus(execution, active);
      await this.#refresh(execution);
    }
  }

  async #projectReconBusinessStatus(
    execution: ProviderExecution,
    active: readonly ProviderExecution[],
  ): Promise<void> {
    if (
      this.taskBusiness === undefined ||
      execution.taskBusinessContextExpected !== true ||
      execution.operationName !== "vehicle_area_recon" ||
      execution.state === "ACCEPTED"
    )
      return;
    const missionId = execution.downstreamMissionIds.at(-1);
    if (
      missionId === undefined ||
      active.filter(
        (candidate) =>
          candidate.operationName === "vehicle_area_recon" &&
          candidate.downstreamMissionIds.at(-1) === missionId,
      ).length !== 1
    )
      return;
    const recon = this.ingress.snapshot().payload.reconnaissance;
    const cursor = this.ingress.observationCursor("/ugv/area_recon/status");
    const authority = this.ingress.observationAuthority("/ugv/area_recon/status");
    if (
      reconCorrelationStrength(recon, missionId) !== "STRICT_CORRELATED" ||
      typeof recon.motionStatus !== "number" ||
      cursor === undefined ||
      cursor === execution.observationCursors?.reconnaissance ||
      authority === undefined ||
      compareIsoTimestamps(authority.observedAt, execution.createdAt) < 0
    )
      return;
    const processor = new ReconBusinessProcessor(
      this.taskBusiness.business,
      this.taskBusiness.notifyCommitted,
    );
    await processor.applyStatus(execution, {
      schemaVersion: "ugv.recon-status-fact/1",
      missionId,
      sourceCursor: cursor,
      observedAt: authority.observedAt,
      motionStatus: recon.motionStatus,
      ...(recon.lock?.stage === undefined ? {} : { lockStage: recon.lock.stage }),
    });
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

  async #waitForInitialObservation(): Promise<void> {
    const timeoutMs = this.options.initialObservationWaitMs ?? 5_000;
    const deadline = Date.now() + timeoutMs;
    while (!this.#closed && !this.#initialObservationReceived() && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, Math.min(25, timeoutMs)));
  }

  #initialObservationReceived(): boolean {
    return this.ingress.ingestSequence() > 0;
  }

  #refreshReadiness(): void {
    const snapshot = this.ingress.snapshot();
    const deviceMcpConnected = this.device.connected();
    const mqttConnected = snapshot.connectivity.mqttConnected;
    const initialObservationReceived = this.#initialObservationReceived();
    let state: UgvProviderReadinessState = "NOT_READY";
    let reasonCode = "UGV_PROVIDER_INITIALIZING";
    if (this.#recoveryComplete) {
      if (deviceMcpConnected && mqttConnected && initialObservationReceived) {
        state = "READY";
        reasonCode = "UGV_PROVIDER_READY";
      } else if (deviceMcpConnected || mqttConnected || initialObservationReceived) {
        state = "DEGRADED";
        reasonCode = "UGV_PROVIDER_DEPENDENCY_DEGRADED";
      } else {
        state = "UNKNOWN";
        reasonCode = "UGV_PROVIDER_DEPENDENCIES_UNAVAILABLE";
      }
    }
    this.#readiness = {
      state,
      reasonCode,
      deviceMcpConnected,
      mqttConnected,
      initialObservationReceived,
      recoveryComplete: this.#recoveryComplete,
      observedAt: this.#now().toISOString(),
    };
  }

  async #synchronous(input: StartUgvOperation) {
    const observedAt = new Date().toISOString();
    let result: Record<string, unknown>;
    if (input.operationName === "vehicle_get_state") {
      if (this.device.hasTool("get_status")) {
        const deviceStatus = await this.#callDevice("get_status", {}, input.taskId);
        const observation = normalizeMqttObservation("status/ugv", deviceStatus);
        this.ingress.applyDeviceObservation(
          observation.patch,
          [],
          observation.sourceObservedAt ?? observedAt,
        );
      }
      const snapshot = this.ingress.snapshot();
      result = {
        ...selectSnapshot(
          snapshot,
          input.arguments.include,
          this.ingress.fieldObservationAuthority("chassis.position.geodetic")?.observedAt,
        ),
        mqttIngressSequence: this.ingress.ingestSequence(),
      };
    } else if (input.operationName === "vehicle_get_capabilities") {
      const capabilities = await this.#callDevice("get_capabilities", {}, input.taskId);
      result = normalizeUgvCapabilities(
        capabilities,
        this.device.contracts(),
        observedAt,
        this.options.resourceId ?? "vehicle:ugv1",
        {
          toolHealth: UGV_DEVICE_TOOL_ALLOWLIST.map((toolName) => this.device.toolHealth(toolName)),
          executionMode: this.options.executionMode ?? "simulation",
        },
      );
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
        resourceId: this.options.resourceId ?? "vehicle:ugv1",
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
        resourceId: this.options.resourceId ?? "vehicle:ugv1",
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
        resourceId: this.options.resourceId ?? "vehicle:ugv1",
        distanceM,
        valid: response.valid !== false,
        observedAt,
      };
    }
    const sanitized = sanitizeFireResult(result).value;
    assertNoRefereeData(sanitized);
    const externalExecutionId = `${this.options.resourceId ?? "vehicle:ugv1"}:sync:${input.taskId || randomUUID()}`;
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
        evidence: [
          synchronousEvidence(
            input.operationName,
            observedAt,
            this.options.providerId,
            externalExecutionId,
          ),
        ],
      },
    };
  }

  async #refresh(execution: ProviderExecution): Promise<ProviderExecution> {
    if (isTerminal(execution.state)) {
      await this.taskBusiness?.finalizeForTerminalExecution(execution);
      return execution;
    }
    if (execution.preemptedByTaskId !== undefined)
      return this.#refreshPreemptedExecution(execution);
    if (execution.controlConfirmation?.command === "input_release")
      return this.#confirmExpiredInputRelease(execution);
    if (
      this.options.businessManualDecision &&
      execution.operationName === "vehicle_area_recon" &&
      (execution.state === "RUNNING" || execution.state === "WAITING_INPUT")
    ) {
      const pending = await this.taskBusiness?.activeRequiredInput(execution);
      if (
        pending?.deadlineAt &&
        compareIsoTimestamps(this.#now().toISOString(), pending.deadlineAt) >= 0
      )
        return this.#expireManualReconInput(execution, pending);
      const reconciled = await this.#reconcileReconRequiredInput(execution);
      if (reconciled.revision !== execution.revision) return reconciled;
    }
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
    const phaseObservation = taskPhaseObservation(execution, snapshot, this.ingress);
    let next = execution;
    if (execution.operationName === "vehicle_navigate") {
      const stationaryExecution = this.#advanceStationaryStability(execution, snapshot);
      const baseline = executionPhysicalBaseline(execution);
      const currentAuthorities = operationObservationAuthorities(
        execution.operationName,
        this.ingress,
      );
      const missionId = execution.downstreamMissionIds.at(-1);
      const confirmation = navigationPhysicalConfirmation({
        snapshot,
        baseline,
        ...(missionId === undefined ? {} : { missionId }),
        currentAuthorities,
        freshness: this.options.freshness,
        stationarySpeedThresholdKmh: this.options.stationarySpeedThresholdKmh ?? 0.1,
        now: this.#now().getTime(),
      });
      const requestedDistanceM = requestedDistance(execution.arguments);
      next = this.ingress.stateConflict()
        ? reconcileTaskStateConflict(stationaryExecution)
        : applyTrack(
            stationaryExecution,
            snapshot.chassis.mission,
            "completed",
            operationObservationCursor(execution.operationName, this.ingress),
            {
              confirmation,
              observationChanged: stationaryExecution.revision !== execution.revision,
              stabilitySatisfied: stationaryStabilitySatisfied(
                stationaryExecution,
                this.ingress.fieldObservationAuthority("chassis.speed"),
                this.options.stationaryStabilityMs ?? 0,
                this.options.stationaryMinimumSamples ?? 2,
              ),
              facts: navigationTerminalFacts({
                snapshot,
                baseline,
                currentAuthorities,
                ...(missionId === undefined ? {} : { missionId }),
                ...(requestedDistanceM === undefined ? {} : { requestedDistanceM }),
                confirmation,
              }),
              controlObservationIsNew: controlObservationIsNew(execution, this.ingress),
            },
          );
    } else if (execution.operationName === "vehicle_area_recon") {
      const baseline = executionPhysicalBaseline(execution);
      const authority = this.ingress.fieldObservationAuthority("payload.recon");
      const reconMissionId = execution.downstreamMissionIds.at(-1);
      next = applyReconTrack(
        execution,
        snapshot.payload.reconnaissance,
        this.ingress.observationCursor("/ugv/area_recon/status"),
        authority?.observedAt,
        reconCorrelationStrength(snapshot.payload.reconnaissance, reconMissionId),
        reconTerminalFacts({
          snapshot,
          ...(reconMissionId === undefined ? {} : { expectedMissionId: reconMissionId }),
          ...(authority === undefined ? {} : { currentAuthority: authority }),
          baseline,
        }),
      );
    } else if (execution.operationName === "vehicle_control_gimbal")
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
          resourceId: this.options.resourceId ?? "vehicle:ugv1",
          status: "target_lost",
          observedAt: new Date().toISOString(),
        });
    } else if (execution.operationName === "vehicle_emergency_stop") {
      const stationaryExecution = this.#advanceStationaryStability(execution, snapshot);
      const baseline = executionPhysicalBaseline(execution);
      const authorities = operationObservationAuthorities(execution.operationName, this.ingress);
      const stopConfirmation = stationaryPhysicalConfirmation({
        snapshot,
        baseline,
        currentAuthorities: authorities,
        freshness: this.options.freshness,
        stationarySpeedThresholdKmh: this.options.stationarySpeedThresholdKmh ?? 0.1,
        now: this.#now().getTime(),
      });
      if (
        !this.ingress.stateConflict() &&
        stopConfirmation.confirmed &&
        stationaryStabilitySatisfied(
          stationaryExecution,
          this.ingress.fieldObservationAuthority("chassis.speed"),
          this.options.stationaryStabilityMs ?? 0,
          this.options.stationaryMinimumSamples ?? 2,
        ) &&
        snapshot.chassis.mission.state !== 1 &&
        !reconMotionActive(snapshot.payload.reconnaissance.motionStatus) &&
        snapshot.payload.eoTask.state !== 1 &&
        snapshot.payload.weapon.state !== 1 &&
        (snapshot.payload.reconnaissance.lock?.stage ?? 1) === 1
      )
        next = terminal(stationaryExecution, "SUCCEEDED", "STOP_CONFIRMED", {
          resourceId: this.options.resourceId ?? "vehicle:ugv1",
          status: "stopped",
          finalSpeedKmh: snapshot.chassis.speedKmh,
          missionState: snapshot.chassis.mission.state,
          reconMotionStatus: snapshot.payload.reconnaissance.motionStatus,
          eoTaskState: snapshot.payload.eoTask.state,
          weaponTaskState: snapshot.payload.weapon.state,
          targetUnlocked: (snapshot.payload.reconnaissance.lock?.stage ?? 1) === 1,
          observationAuthority: "post_dispatch",
          snapshotRevision: snapshot.revision,
          observedAt: snapshot.observedAt,
        });
      else if (this.ingress.stateConflict()) next = reconcileTaskStateConflict(stationaryExecution);
      else if (
        !stopConfirmation.confirmed &&
        stationaryExecution.reasonCode !== stopConfirmation.reasonCode
      )
        next = transition(
          stationaryExecution,
          stationaryExecution.state,
          stopConfirmation.reasonCode,
        );
      else if (
        stopConfirmation.confirmed &&
        !stationaryStabilitySatisfied(
          stationaryExecution,
          this.ingress.fieldObservationAuthority("chassis.speed"),
          this.options.stationaryStabilityMs ?? 0,
          this.options.stationaryMinimumSamples ?? 2,
        )
      )
        next = transition(
          stationaryExecution,
          stationaryExecution.state,
          "UGV_STATIONARY_STABILITY_PENDING",
        );
      else next = stationaryExecution;
      if (
        !isTerminal(next.state) &&
        physicalConfirmationExpired(
          baseline,
          this.options.physicalConfirmationTimeoutMs ?? 30_000,
          this.#now().getTime(),
        )
      )
        next = terminal(next, "TECHNICAL_FAILED", "STOP_CONFIRMATION_TIMEOUT", {
          resourceId: execution.resourceId,
          status: "timeout",
          observedAt: snapshot.observedAt,
        });
    }
    next = this.#armObservationPhaseDeadlines(next, phaseObservation);
    next = this.#expirePhaseDeadline(next);
    if (next.revision !== execution.revision) {
      await this.#emitPhysicalEvidence(next, snapshot);
      await this.store.putExecution(next);
      if (isTerminal(next.state)) await this.taskBusiness?.finalizeForTerminalExecution(next);
      this.events.emit(execution.taskId, await this.executionSnapshot(next));
      await this.telemetry.emit(
        "EXECUTION_PROGRESS",
        executionProgressPayload(next),
        identityTelemetry(next, executionProgressAttributes(next)),
      );
      await this.#transitionEvent(execution, next);
      if (next.state === "PAUSED" && next.controlConfirmation?.command === "pause")
        await this.#confirmationLatencyMetric("pause_confirmation_latency_ms", next);
      if (isTerminal(next.state)) {
        if (
          next.diagnosticBehavior?.capabilityId === SMPP_PROVIDER_BUSINESS_SUCCESS_CAPABILITY &&
          next.reasonCode === "SMPP_DIAGNOSTIC_PROVIDER_BUSINESS_SUCCESS"
        ) {
          const diagnostic = await this.store.getDiagnosticStatus(next.diagnosticBehavior.leaseId);
          if (diagnostic !== undefined) {
            const observedAt =
              typeof next.result?.observedAt === "string"
                ? next.result.observedAt
                : this.#now().toISOString();
            await this.telemetry.emit(
              "PROVIDER_DIAGNOSTIC",
              {
                state: "SUCCEEDED",
                reasonCode: "SMPP_DIAGNOSTIC_PROVIDER_BUSINESS_SUCCESS",
              },
              {
                taskId: next.taskId,
                externalExecutionId: next.externalExecutionId,
                operationName: next.operationName,
                observedAt,
                attributes: diagnosticTelemetryAttributes(diagnostic, next, {
                  providerBusinessStatus: "succeeded",
                  claimsPhysicalArrival: false,
                  claimsGoalSuccess: false,
                }),
              },
            );
            await this.store.consumeDiagnosticLease(
              diagnostic.lease.leaseId,
              diagnostic.lease.canonicalRequestHash,
              randomUUID(),
              observedAt,
            );
          }
        }
        await this.telemetry.metric(
          "provider_task_terminal_latency_ms",
          Math.max(0, Date.now() - Date.parse(next.createdAt)),
          "ms",
          `${next.operationName}:${next.state}`,
          identityTelemetry(next),
        );
        if (next.operationName === "vehicle_emergency_stop")
          await this.#confirmationLatencyMetric("emergency_stop_confirmation_latency_ms", next);
        if (next.operationName === "vehicle_navigate")
          await this.telemetry.metric(
            "navigation_terminal_results",
            1,
            "result",
            next.state,
            identityTelemetry(next),
          );
        if (next.operationName === "vehicle_area_recon")
          await this.telemetry.metric(
            "recon_terminal_results",
            1,
            "result",
            next.state,
            identityTelemetry(next),
          );
        this.arbiter.release(next.taskId);
      }
    }
    return next;
  }

  async #emitPhysicalEvidence(execution: ProviderExecution, snapshot: UgvSnapshot): Promise<void> {
    const base = identityTelemetry(execution);
    const positionAuthority =
      this.ingress.fieldObservationAuthority("chassis.position.geodetic") ??
      this.ingress.fieldObservationAuthority("chassis.position.local");
    if (positionAuthority !== undefined && snapshot.chassis.position !== undefined) {
      await this.telemetry.emit(
        "RESOURCE_STATE",
        { state: "observed", reasonCode: "UGV_POSITION_OBSERVED" },
        {
          ...base,
          observedAt: positionAuthority.observedAt,
          attributes: {
            "sdar.evidence.kind": "position",
            "sdar.evidence.position": snapshot.chassis.position,
          },
        },
      );
    }
    const speedAuthority = this.ingress.fieldObservationAuthority("chassis.speed");
    if (speedAuthority !== undefined && snapshot.chassis.speedKmh !== undefined) {
      await this.telemetry.emit(
        "RESOURCE_METRIC",
        {
          metricName: "vehicle_speed_kmh",
          value: snapshot.chassis.speedKmh,
          unit: "km/h",
          quality: "provider_observed",
        },
        {
          ...base,
          observedAt: speedAuthority.observedAt,
          attributes: {
            "sdar.evidence.kind": "speed",
            "sdar.evidence.speed_kmh": snapshot.chassis.speedKmh,
          },
        },
      );
    }
    const missionAuthority = this.ingress.fieldObservationAuthority("chassis.mission");
    if (missionAuthority !== undefined) {
      const observedMissionId = snapshot.chassis.mission.id;
      const missionId =
        observedMissionId === undefined
          ? undefined
          : execution.downstreamMissionIds.find((candidate) => {
              try {
                return candidate === String(parseUgvMissionId(observedMissionId));
              } catch {
                return false;
              }
            });
      await this.telemetry.emit(
        "RESOURCE_STATE",
        { state: String(snapshot.chassis.mission.state), reasonCode: "UGV_MISSION_OBSERVED" },
        {
          ...base,
          observedAt: missionAuthority.observedAt,
          attributes: {
            "sdar.evidence.kind": "mission",
            "sdar.evidence.mission_state": String(snapshot.chassis.mission.state),
            ...(missionId === undefined ? {} : { "sdar.device.mission_id": missionId }),
          },
        },
      );
    }
  }

  #advanceStationaryStability(
    execution: ProviderExecution,
    snapshot: UgvSnapshot,
  ): ProviderExecution {
    const authority = this.ingress.fieldObservationAuthority("chassis.speed");
    const speedKmh = snapshot.chassis.speedKmh;
    const now = this.#now();
    const age =
      authority === undefined ? Number.NaN : now.getTime() - Date.parse(authority.observedAt);
    const fresh =
      authority !== undefined &&
      Number.isFinite(age) &&
      age >= -(this.options.freshness.maximumFutureSkewMs ?? 0) &&
      age <= this.options.freshness.chassis &&
      speedKmh !== undefined;
    if (!fresh)
      return resetStationaryStabilityRecord(execution, authority?.cursor, now.toISOString());
    if (authority.cursor === execution.lastStationarySpeedCursor) return execution;
    if (speedKmh > (this.options.stationarySpeedThresholdKmh ?? 0.1))
      return updateStationaryStabilityRecord(
        execution,
        {
          lastStationarySpeedCursor: authority.cursor,
          lastNonStationaryObservedAt: authority.observedAt,
          consecutiveStationaryObservations: 0,
        },
        now.toISOString(),
      );
    return updateStationaryStabilityRecord(
      execution,
      {
        lastStationarySpeedCursor: authority.cursor,
        stationaryCandidateSince: execution.stationaryCandidateSince ?? authority.observedAt,
        consecutiveStationaryObservations: (execution.consecutiveStationaryObservations ?? 0) + 1,
      },
      now.toISOString(),
    );
  }

  #armObservationPhaseDeadlines(
    execution: ProviderExecution,
    observation: TaskPhaseObservation | undefined,
  ): ProviderExecution {
    if (observation === undefined) return execution;
    let next = execution;
    if (observation.startObserved)
      next = withPhaseDeadline(
        next,
        "activeObservationDeadline",
        observation.observedAt,
        this.options.activeObservationTimeoutMs ?? 30_000,
        this.#now().toISOString(),
      );
    if (observation.activeObserved)
      next = withPhaseDeadline(
        next,
        "terminalObservationDeadline",
        observation.observedAt,
        this.options.terminalObservationTimeoutMs ?? 30 * 60_000,
        this.#now().toISOString(),
      );
    if (observation.terminalObserved && next.terminalObservationDeadline !== undefined)
      next = withPhaseDeadline(
        next,
        "physicalConfirmationDeadline",
        observation.observedAt,
        this.options.physicalConfirmationTimeoutMs ?? 30_000,
        this.#now().toISOString(),
      );
    return next;
  }

  #expirePhaseDeadline(execution: ProviderExecution): ProviderExecution {
    if (isTerminal(execution.state)) return execution;
    const now = this.#now().getTime();
    let reasonCode: string | undefined;
    if (
      controlConfirmationPending(execution) &&
      deadlineExpired(execution.controlConfirmationDeadline, now)
    )
      reasonCode = "UGV_CONTROL_CONFIRMATION_TIMEOUT";
    else if (
      execution.activeObservationDeadline === undefined &&
      deadlineExpired(execution.startObservationDeadline, now)
    )
      reasonCode = "UGV_START_OBSERVATION_TIMEOUT";
    else if (
      execution.activeObservationDeadline !== undefined &&
      execution.terminalObservationDeadline === undefined &&
      deadlineExpired(execution.activeObservationDeadline, now)
    )
      reasonCode = "UGV_ACTIVE_OBSERVATION_TIMEOUT";
    else if (
      execution.terminalObservationDeadline !== undefined &&
      execution.physicalConfirmationDeadline === undefined &&
      deadlineExpired(execution.terminalObservationDeadline, now)
    )
      reasonCode = "UGV_TERMINAL_OBSERVATION_TIMEOUT";
    else if (
      physicalConfirmationPending(execution.reasonCode) &&
      deadlineExpired(execution.physicalConfirmationDeadline, now)
    )
      reasonCode =
        execution.operationName === "vehicle_emergency_stop"
          ? "STOP_CONFIRMATION_TIMEOUT"
          : "UGV_PHYSICAL_CONFIRMATION_TIMEOUT";
    if (reasonCode === undefined) return execution;
    return terminal(execution, "TECHNICAL_FAILED", reasonCode, {
      resourceId: execution.resourceId,
      status: "timeout",
      observedAt: this.#now().toISOString(),
    });
  }

  async #observe(
    snapshot: UgvSnapshot,
    topic: string,
    applied?: AppliedMqttObservation,
  ): Promise<void> {
    this.#refreshReadiness();
    await this.store.putSnapshot({
      channel: topic,
      revision: snapshot.revision,
      observedAt: snapshot.observedAt,
      snapshot: snapshot as unknown as Record<string, unknown>,
    });
    if (applied !== undefined)
      await this.#projectNavigationBusinessTrajectory(snapshot, topic, applied);
    if (topic === "/ugv/area_recon/status" && applied !== undefined) {
      await this.#projectNativeLock(applied);
      await this.#projectReconBusinessCoverage(applied);
    }
    if (topic === "/ugv/area_recon/targets" && applied !== undefined)
      await this.#projectReconBusinessTargets(applied);
    const telemetryNowMs = this.#now().getTime();
    if (
      intervalDue(this.#lastResourceTelemetryAtMs, telemetryNowMs, RESOURCE_TELEMETRY_INTERVAL_MS)
    ) {
      this.#lastResourceTelemetryAtMs = telemetryNowMs;
      await this.telemetry.emit(
        "RESOURCE_STATE",
        { state: "observed", reasonCode: "UGV_RESOURCE_OBSERVATION_RECEIVED" },
        { attributes: { source: topicCategory(topic), revisionChanged: true } },
      );
    }
    if (
      intervalDue(this.#lastFreshnessTelemetryAtMs, telemetryNowMs, FRESHNESS_TELEMETRY_INTERVAL_MS)
    ) {
      this.#lastFreshnessTelemetryAtMs = telemetryNowMs;
      for (const [domain, observedAt] of Object.entries({
        chassis: snapshot.freshness.chassisObservedAt,
        mission: snapshot.freshness.missionObservedAt,
        health: snapshot.freshness.healthObservedAt,
        target: snapshot.freshness.targetObservedAt,
        payload: snapshot.freshness.payloadObservedAt,
      }))
        if (observedAt !== undefined)
          await this.telemetry.metric(
            "snapshot_freshness_seconds",
            Math.max(0, (telemetryNowMs - Date.parse(observedAt)) / 1_000),
            "s",
            domain,
          );
    }
    await this.#pollActive();
  }

  async #projectNavigationBusinessTrajectory(
    observedSnapshot: UgvSnapshot,
    topic: string,
    applied: AppliedMqttObservation,
  ): Promise<void> {
    if (this.taskBusiness === undefined || applied.retained) return;
    const position = applied.observation.patch.chassis?.position;
    if (position === undefined || !["/ugv/gnss", "status/ugv1"].includes(topic)) return;
    const mission = observedSnapshot.chassis.mission;
    const missionId = mission.id;
    const missionAuthority = this.ingress.fieldObservationAuthority("chassis.mission");
    if (
      missionId === undefined ||
      mission.state !== 1 ||
      missionAuthority === undefined ||
      this.ingress.snapshot().chassis.mission.id !== missionId ||
      compareIsoTimestamps(applied.observedAt, missionAuthority.observedAt) < 0 ||
      this.ingress.fieldFreshnessState(
        "chassis.mission",
        this.options.freshness.mission,
        this.#now().getTime(),
      ) !== "fresh"
    )
      return;
    const matches = (await this.store.listActiveExecutions()).filter(
      (execution) =>
        execution.operationName === "vehicle_navigate" &&
        execution.downstreamMissionIds.at(-1) === missionId,
    );
    const execution = matches.length === 1 ? matches[0] : undefined;
    if (
      execution?.taskBusinessContextExpected !== true ||
      execution.state === "ACCEPTED" ||
      compareIsoTimestamps(applied.observedAt, execution.createdAt) < 0 ||
      compareIsoTimestamps(missionAuthority.observedAt, execution.createdAt) < 0
    )
      return;
    await new NavigationTrajectoryProcessor(
      this.taskBusiness.business,
      this.taskBusiness.notifyCommitted,
      this.options.freshness.chassis,
    ).apply(execution, {
      schemaVersion: "ugv.navigation-position-fact/1",
      missionId,
      sourceCursor: applied.cursor,
      sourceTopic: topic,
      observedAt: applied.observedAt,
      position,
    });
  }

  async #projectReconBusinessCoverage(applied: AppliedMqttObservation): Promise<void> {
    if (this.taskBusiness === undefined || applied.retained) return;
    const recon = applied.observation.patch.payload?.reconnaissance;
    const missionId = recon?.id;
    const coverage = recon?.coverage;
    if (missionId === undefined || coverage === undefined) return;
    // The same EO sensor is occupied by native visual lock at stages 2/3.
    // An aggregate coverage counter in this status is not proof of scanning.
    if (recon?.lock?.stage === 2 || recon?.lock?.stage === 3) return;
    if (
      coverage.coveragePercent === undefined &&
      coverage.coveredCount === undefined &&
      coverage.coveredCells === undefined &&
      coverage.sectorsCovered === undefined
    )
      return;
    const matches = (await this.store.listActiveExecutions()).filter(
      (execution) =>
        execution.operationName === "vehicle_area_recon" &&
        execution.downstreamMissionIds.at(-1) === missionId,
    );
    const execution = matches.length === 1 ? matches[0] : undefined;
    if (
      execution?.taskBusinessContextExpected !== true ||
      execution.state === "ACCEPTED" ||
      compareIsoTimestamps(applied.observedAt, execution.createdAt) < 0 ||
      applied.cursor === execution.observationCursors?.reconnaissance
    )
      return;
    // This status topic has no area revision. After adoption its counters cannot
    // be attributed to the new area, although mission status remains usable.
    const context = await this.taskBusiness.business.getContext(
      BoundExecutionScope.fromExecution(execution),
    );
    if (context?.activeRefs.reconEffectiveArea !== undefined) return;
    const processor = new ReconBusinessProcessor(
      this.taskBusiness.business,
      this.taskBusiness.notifyCommitted,
    );
    await processor.applyCoverage(execution, {
      schemaVersion: "ugv.recon-coverage-fact/1",
      missionId,
      sourceCursor: applied.cursor,
      observedAt: applied.observedAt,
      coverage,
    });
  }

  async #projectNativeLock(applied: AppliedMqttObservation): Promise<void> {
    if (this.taskBusiness === undefined || applied.retained) return;
    const recon = applied.observation.patch.payload?.reconnaissance;
    const missionId = recon?.id;
    const stage = recon?.lock?.stage;
    if (
      recon === undefined ||
      missionId === undefined ||
      stage === undefined ||
      typeof recon.motionStatus !== "number"
    )
      return;
    const matches = (await this.store.listActiveExecutions()).filter(
      (execution) =>
        execution.operationName === "vehicle_area_recon" &&
        execution.downstreamMissionIds.at(-1) === missionId,
    );
    const execution = matches.length === 1 ? matches[0] : undefined;
    if (
      execution?.taskBusinessContextExpected !== true ||
      execution.state === "ACCEPTED" ||
      compareIsoTimestamps(applied.observedAt, execution.createdAt) < 0 ||
      applied.cursor === execution.observationCursors?.reconnaissance
    )
      return;
    const processor = new NativeLockBusinessProcessor(
      this.taskBusiness.business,
      this.taskBusiness.notifyCommitted,
      this.options.businessManualDecision && {
        ...this.options.businessManualDecision,
        now: () => this.#now(),
      },
    );
    await processor.apply(execution, {
      schemaVersion: "ugv.recon-native-lock-fact/1",
      missionId,
      sourceCursor: applied.cursor,
      observedAt: applied.observedAt,
      stage,
      ...(recon.lock?.targetId === undefined ? {} : { targetId: recon.lock.targetId }),
      motionStatus: recon.motionStatus,
    });
    if (this.options.businessManualDecision) {
      const latest = await this.store.getExecution(execution.taskId);
      if (
        latest?.externalExecutionId === execution.externalExecutionId &&
        latest.downstreamMissionIds.at(-1) === missionId
      )
        await this.#reconcileReconRequiredInput(latest);
    }
  }

  /** Recovers the Execution state after a Context commit or process restart. */
  async #reconcileReconRequiredInput(execution: ProviderExecution): Promise<ProviderExecution> {
    if (!this.taskBusiness || execution.operationName !== "vehicle_area_recon") return execution;
    const pending = await this.taskBusiness.activeRequiredInput(execution);
    const next =
      execution.state === "RUNNING" && pending
        ? transition(execution, "WAITING_INPUT", "TARGET_OBSERVATION_DECISION_REQUIRED")
        : execution.state === "WAITING_INPUT" && !pending
          ? transition(execution, "RUNNING", "UGV_RECON_INPUT_SESSION_ENDED")
          : execution;
    if (next === execution) return execution;
    await this.store.putExecution(next);
    this.events.emit(execution.taskId, await this.executionSnapshot(next));
    return next;
  }

  async #expireManualReconInput(
    execution: ProviderExecution,
    pending: RequiredInput,
  ): Promise<ProviderExecution> {
    if (!this.taskBusiness) return execution;
    const handler = new UgvManualInputBusinessHandler(
      this.taskBusiness.business,
      this.taskBusiness.notifyCommitted,
      () => this.#now(),
    );
    const missionId = execution.downstreamMissionIds.at(-1);
    const recon = this.ingress.snapshot().payload.reconnaissance;
    const authority = this.ingress.observationAuthority("/ugv/area_recon/status");
    const age =
      authority === undefined
        ? Number.NaN
        : this.#now().getTime() - Date.parse(authority.observedAt);
    const activeForMission = (await this.store.listActiveExecutions()).filter(
      (candidate) =>
        candidate.operationName === "vehicle_area_recon" &&
        candidate.downstreamMissionIds.at(-1) === missionId,
    );
    if (
      missionId !== undefined &&
      reconCorrelationStrength(recon, missionId) === "STRICT_CORRELATED" &&
      recon.lock?.stage === 1 &&
      typeof recon.motionStatus === "number" &&
      authority !== undefined &&
      compareIsoTimestamps(authority.observedAt, execution.createdAt) >= 0 &&
      Number.isFinite(age) &&
      age >= -(this.options.freshness.maximumFutureSkewMs ?? 0) &&
      age <= this.options.freshness.payload
    ) {
      await new NativeLockBusinessProcessor(
        this.taskBusiness.business,
        this.taskBusiness.notifyCommitted,
        this.options.businessManualDecision && {
          ...this.options.businessManualDecision,
          now: () => this.#now(),
        },
      ).apply(execution, {
        schemaVersion: "ugv.recon-native-lock-fact/1",
        missionId,
        sourceCursor: authority.cursor,
        observedAt: authority.observedAt,
        stage: 1,
        ...(recon.lock.targetId === undefined ? {} : { targetId: recon.lock.targetId }),
        motionStatus: recon.motionStatus,
      });
      return this.#reconcileReconRequiredInput(execution);
    }
    let releaseFailure: string | undefined;
    if (pending.onExpire !== "release_and_resume_scan")
      releaseFailure = "UGV_INPUT_EXPIRY_POLICY_UNSUPPORTED";
    else if (
      missionId === undefined ||
      pending.subjectBinding.kind !== "visual_lock" ||
      activeForMission.length !== 1 ||
      activeForMission[0]?.taskId !== execution.taskId ||
      reconCorrelationStrength(recon, missionId) !== "STRICT_CORRELATED" ||
      recon.lock?.stage !== 3 ||
      recon.lock.targetId !== pending.subjectBinding.targetId ||
      authority === undefined ||
      compareIsoTimestamps(authority.observedAt, execution.createdAt) < 0 ||
      !Number.isFinite(age) ||
      age < -(this.options.freshness.maximumFutureSkewMs ?? 0) ||
      age > this.options.freshness.payload ||
      execution.controlConfirmation?.command === "pause"
    )
      releaseFailure = "UGV_INPUT_EXPIRY_RELEASE_UNQUALIFIED";
    else {
      try {
        const current = await handler.assertPendingObservation(execution, pending.requestId);
        if (current.revision !== pending.revision) throw new Error("UGV_INPUT_REQUEST_NOT_CURRENT");
        await this.#callJournaledMutation(
          execution.taskId,
          `input-expire:${createHash("sha256").update(pending.requestId).digest("hex").slice(0, 40)}`,
          "CLEANUP",
          buildUgvTargetLockCall(false, 0, missionId),
        );
      } catch (error) {
        releaseFailure =
          error instanceof UncertainMutatingDeviceCallError
            ? "UGV_INPUT_EXPIRY_RELEASE_UNCERTAIN"
            : error instanceof DeviceToolRejectedError
              ? "UGV_INPUT_EXPIRY_RELEASE_REJECTED"
              : reason(error);
      }
    }
    const applied = await handler.expireObservation(execution, pending.requestId);
    if (applied === "none") {
      const current = (await this.store.getExecution(execution.taskId)) ?? execution;
      return this.#reconcileReconRequiredInput(current);
    }
    if (releaseFailure !== undefined) {
      const failed = terminal(execution, "TECHNICAL_FAILED", releaseFailure, {
        resourceId: execution.resourceId,
        status: "release_unconfirmed",
        requestId: pending.requestId,
        observedAt: this.#now().toISOString(),
      });
      return this.#commitManualReconTransition(execution, failed);
    }
    const next = transition(
      execution,
      "RUNNING",
      "UGV_INPUT_RELEASE_ACCEPTED_AWAITING_OBSERVATION",
    );
    next.controlConfirmation = {
      command: "input_release",
      requestId: pending.requestId,
      missionId,
      sourceCursor: authority?.cursor,
      dispatchedAt: this.#now().toISOString(),
      deadlineAt: deadlineFrom(
        this.#now().toISOString(),
        this.options.controlConfirmationTimeoutMs ?? 30_000,
      ),
    };
    return this.#commitManualReconTransition(execution, next);
  }

  async #confirmExpiredInputRelease(execution: ProviderExecution): Promise<ProviderExecution> {
    const marker = execution.controlConfirmation;
    if (marker?.command !== "input_release") return execution;
    const recon = this.ingress.snapshot().payload.reconnaissance;
    const authority = this.ingress.observationAuthority("/ugv/area_recon/status");
    const age =
      authority === undefined
        ? Number.NaN
        : this.#now().getTime() - Date.parse(authority.observedAt);
    const scope = BoundExecutionScope.fromExecution(execution);
    const context = await this.taskBusiness?.business.getContext(scope);
    if (
      typeof marker.missionId === "string" &&
      reconCorrelationStrength(recon, marker.missionId) === "STRICT_CORRELATED" &&
      recon.lock?.stage === 1 &&
      recon.motionStatus === 5 &&
      authority !== undefined &&
      authority.cursor !== marker.sourceCursor &&
      Number.isFinite(age) &&
      age >= -(this.options.freshness.maximumFutureSkewMs ?? 0) &&
      age <= this.options.freshness.payload &&
      typeof marker.dispatchedAt === "string" &&
      compareIsoTimestamps(authority.observedAt, marker.dispatchedAt) >= 0 &&
      context?.activeRefs[`visualLock:${marker.missionId}`] === undefined
    ) {
      const confirmed = transition(execution, "RUNNING", "UGV_INPUT_RELEASE_CONFIRMED");
      delete confirmed.controlConfirmation;
      return this.#commitManualReconTransition(execution, confirmed);
    }
    if (
      typeof marker.deadlineAt !== "string" ||
      !deadlineExpired(marker.deadlineAt, this.#now().getTime())
    )
      return execution;
    const failed = terminal(
      execution,
      "TECHNICAL_FAILED",
      "UGV_INPUT_RELEASE_CONFIRMATION_TIMEOUT",
      {
        resourceId: execution.resourceId,
        status: "release_unconfirmed",
        requestId: marker.requestId,
        observedAt: this.#now().toISOString(),
      },
    );
    return this.#commitManualReconTransition(execution, failed);
  }

  async #commitManualReconTransition(
    previous: ProviderExecution,
    next: ProviderExecution,
  ): Promise<ProviderExecution> {
    await this.store.putExecution(next);
    if (isTerminal(next.state)) await this.taskBusiness?.finalizeForTerminalExecution(next);
    this.events.emit(next.taskId, await this.executionSnapshot(next));
    await this.telemetry.emit(
      "EXECUTION_PROGRESS",
      executionProgressPayload(next),
      identityTelemetry(next, executionProgressAttributes(next)),
    );
    await this.#transitionEvent(previous, next);
    if (isTerminal(next.state)) this.arbiter.release(next.taskId);
    return next;
  }

  async #projectReconBusinessTargets(applied: AppliedMqttObservation): Promise<void> {
    if (this.taskBusiness === undefined || applied.retained) return;
    const targets = applied.observation.patch.payload?.targets;
    if (!targets) return;
    // A target list cannot borrow the mission ID from the latest status: it
    // may arrive after a mission switch. Require identity on this source too.
    const source = applied.observation.canonicalPayload;
    if (!record(source) || source.mission_id === undefined) return;
    const sourceMissionId =
      typeof source.mission_id === "string"
        ? source.mission_id
        : typeof source.mission_id === "number" && Number.isSafeInteger(source.mission_id)
          ? String(source.mission_id)
          : undefined;
    if (!sourceMissionId?.trim() || sourceMissionId.trim() !== sourceMissionId) return;
    const recon = this.ingress.snapshot().payload.reconnaissance;
    const missionId = recon.id;
    const statusAuthority = this.ingress.observationAuthority("/ugv/area_recon/status");
    if (missionId === undefined || missionId !== sourceMissionId || statusAuthority === undefined)
      return;
    const matches = (await this.store.listActiveExecutions()).filter(
      (execution) =>
        execution.operationName === "vehicle_area_recon" &&
        execution.downstreamMissionIds.at(-1) === missionId,
    );
    const execution = matches.length === 1 ? matches[0] : undefined;
    if (
      execution?.taskBusinessContextExpected !== true ||
      execution.state === "ACCEPTED" ||
      statusAuthority.cursor === execution.observationCursors?.reconnaissance ||
      compareIsoTimestamps(statusAuthority.observedAt, execution.createdAt) < 0
    )
      return;
    const processor = new TargetBusinessProcessor(
      this.taskBusiness.business,
      this.taskBusiness.notifyCommitted,
    );
    const sourceTimeEligible = (target: (typeof targets)[number]) =>
      target.source === "mqtt_area_recon" &&
      target.captureTimeUs !== undefined &&
      compareIsoTimestamps(target.observedAt, statusAuthority.observedAt) >= 0 &&
      compareIsoTimestamps(target.observedAt, execution.createdAt) >= 0;
    let completeList = targets.every(sourceTimeEligible);
    for (const target of targets) {
      if (!sourceTimeEligible(target)) continue;
      const location =
        target.position?.longitude === undefined || target.position.latitude === undefined
          ? undefined
          : {
              longitude: target.position.longitude,
              latitude: target.position.latitude,
              ...(target.position.altitude === undefined
                ? {}
                : { altitude: target.position.altitude }),
            };
      const pixel =
        target.pixelPosition?.x === undefined || target.pixelPosition.y === undefined
          ? undefined
          : {
              x: target.pixelPosition.x,
              y: target.pixelPosition.y,
              ...(target.pixelPosition.width === undefined ||
              target.pixelPosition.height === undefined
                ? {}
                : {
                    width: target.pixelPosition.width,
                    height: target.pixelPosition.height,
                  }),
            };
      try {
        await processor.apply(execution, {
          schemaVersion: "ugv.recon-target-fact/1",
          missionId,
          observationSessionId: missionId,
          sensorId: "ugv.area_recon.targets",
          sourceTargetId: target.targetId,
          sourceRevision: String(target.captureTimeUs),
          observedAt: target.observedAt,
          visibility: "visible",
          trackingState: "unknown",
          ...(target.objectType === undefined ? {} : { targetType: target.objectType }),
          ...(target.confidence === undefined || target.confidence < 0 || target.confidence > 1
            ? {}
            : { confidence: target.confidence }),
          ...(location === undefined ? {} : { location }),
          ...(pixel === undefined ? {} : { pixel }),
        });
      } catch (error) {
        if (!(error instanceof Error) || !TARGET_PROJECTION_CONFLICT_REASONS.has(error.message))
          throw error;
        completeList = false;
        await this.telemetry
          .metric("target_projection_conflict_total", 1, "target", error.message, {
            taskId: execution.taskId,
            externalExecutionId: execution.externalExecutionId,
            operationName: execution.operationName,
          })
          .catch(() => undefined);
      }
    }
    // The exact recon target topic carries a complete current list. Only a
    // fully qualified list in this mission may make an absent target lost.
    if (
      !completeList ||
      compareIsoTimestamps(applied.observedAt, statusAuthority.observedAt) < 0 ||
      compareIsoTimestamps(applied.observedAt, execution.createdAt) < 0
    )
      return;
    const scope = BoundExecutionScope.fromExecution(execution);
    const snapshot = await this.taskBusiness.business.getContextSnapshot(scope);
    if (snapshot === undefined) return;
    const latest = new Map<
      string,
      Extract<(typeof snapshot.objects)[number], { kind: "artifact" }>
    >();
    for (const item of snapshot.objects) {
      if (
        item.kind !== "artifact" ||
        item.value.artifactType !== "target.object" ||
        item.value.source.method !== "mqtt_area_recon_targets" ||
        item.value.source.sourceRecordRef === undefined ||
        item.value.properties === undefined ||
        !("observationSessionId" in item.value.properties) ||
        item.value.properties.observationSessionId !== missionId
      )
        continue;
      const old = latest.get(item.value.artifactId);
      if (old === undefined || old.value.revision < item.value.revision)
        latest.set(item.value.artifactId, item);
    }
    const observedIds = new Set(targets.map((target) => target.targetId));
    for (const item of latest.values()) {
      const sourceTargetId = item.value.source.sourceRecordRef;
      if (
        sourceTargetId === undefined ||
        observedIds.has(sourceTargetId) ||
        item.value.properties === undefined ||
        !("visibility" in item.value.properties) ||
        item.value.properties.visibility !== "visible" ||
        compareIsoTimestamps(applied.observedAt, item.value.updatedAt) <= 0
      )
        continue;
      await processor.apply(execution, {
        schemaVersion: "ugv.recon-target-fact/1",
        missionId,
        observationSessionId: missionId,
        sensorId: "ugv.area_recon.targets",
        sourceTargetId,
        sourceRevision: `lost-${createHash("sha256")
          .update(`${applied.cursor}\0${sourceTargetId}`)
          .digest("hex")
          .slice(0, 32)}`,
        observedAt: applied.observedAt,
        visibility: "lost",
        trackingState: "unknown",
      });
      if (this.options.businessManualDecision) {
        const lock = new NativeLockBusinessProcessor(
          this.taskBusiness.business,
          this.taskBusiness.notifyCommitted,
          { ...this.options.businessManualDecision, now: () => this.#now() },
        );
        if ((await lock.invalidateForTargetLoss(execution, sourceTargetId)) === "committed") {
          const latest = await this.store.getExecution(execution.taskId);
          if (latest?.externalExecutionId === execution.externalExecutionId)
            await this.#reconcileReconRequiredInput(latest);
        }
      }
    }
  }

  async #confirmationLatencyMetric(metricName: string, execution: ProviderExecution) {
    const baseline = execution.controlConfirmation?.baseline ?? execution.dispatchBaseline;
    if (!record(baseline) || typeof baseline.capturedAt !== "string") return;
    await this.telemetry.metric(
      metricName,
      Math.max(0, Date.now() - Date.parse(baseline.capturedAt)),
      "ms",
      execution.operationName,
      identityTelemetry(execution),
    );
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
      resourceRef: this.options.resourceId ?? "vehicle:ugv1",
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
      resourceRef: this.options.resourceId ?? "vehicle:ugv1",
      severityHint,
      rawPayload,
    });
  }

  async #operationHealthTransition(
    previous: ReturnType<UgvOperationHealthTracker["snapshot"]>,
    current: ReturnType<UgvOperationHealthTracker["snapshot"]>,
  ): Promise<void> {
    await this.telemetry.metric(
      "device_tool_health_transition_total",
      1,
      "transition",
      `${current.operationName}:${previous.state}:${current.state}`,
    );
    await this.telemetry.metric(
      "operation_availability_transition_total",
      1,
      "transition",
      `${current.operationName}:${previous.state}:${current.state}`,
    );
    await this.telemetry.emit(
      "RESOURCE_HEALTH",
      { health: current.state.toLowerCase(), reasonCode: current.reasonCode },
      {
        attributes: {
          diagnostic: "operation_health_transition",
          operation: current.operationName,
          phase: current.phase,
          variant: current.variant ?? null,
          from: previous.state,
          to: current.state,
        },
      },
    );
    await this.#resourceEvent(
      `vehicle.availability.${current.state.toLowerCase()}`,
      current.reasonCode,
      `${current.operationName} health changed from ${previous.state} to ${current.state}.`,
      new Date().toISOString(),
      current.state === "HEALTHY" ? "info" : "warning",
      {
        operationName: current.operationName,
        phase: current.phase,
        variant: current.variant ?? null,
        requiredTools: current.requiredTools,
        healthState: current.state,
      },
    );
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

  async #preemptableExecutions(emergencyTaskId: string): Promise<ProviderExecution[]> {
    return (await this.store.listActiveExecutions()).filter(
      (execution) =>
        execution.taskId !== emergencyTaskId &&
        vehicleTracks(execution.tracks).some((track) =>
          UGV_OPERATION_TRACKS.vehicle_emergency_stop?.includes(track),
        ),
    );
  }

  async #persistPreemptionRelations(
    emergencyTaskId: string,
    executions: readonly ProviderExecution[],
    preemptedAt: string,
  ): Promise<void> {
    for (const execution of executions) {
      if (execution.preemptedByTaskId === emergencyTaskId) continue;
      const preempted = transition(execution, "STOPPING", "UGV_PREEMPTED_BY_EMERGENCY_STOP");
      preempted.preemptedByTaskId = emergencyTaskId;
      preempted.preemptedAt = preemptedAt;
      preempted.preemptReason = "UGV_EMERGENCY_STOP";
      await this.store.putExecution(preempted);
    }
  }

  async #refreshPreemptedExecution(execution: ProviderExecution): Promise<ProviderExecution> {
    const ownerTaskId = execution.preemptedByTaskId;
    if (ownerTaskId === undefined) return execution;
    const owner = await this.store.getExecution(ownerTaskId);
    let next = execution;
    if (owner?.state === "SUCCEEDED" && owner.reasonCode === "STOP_CONFIRMED")
      next = terminal(execution, "CANCELLED", "UGV_PREEMPTED_BY_EMERGENCY_STOP", {
        resourceId: execution.resourceId,
        status: "preempted",
        preemptedByTaskId: ownerTaskId,
        preemptedAt: execution.preemptedAt ?? this.#now().toISOString(),
        observedAt: owner.terminalAt ?? owner.updatedAt,
      });
    else if (owner === undefined || isTerminal(owner.state))
      next =
        execution.state === "STOPPING" &&
        execution.reasonCode === "UGV_PREEMPTION_RECONCILE_REQUIRED"
          ? execution
          : transition(execution, "STOPPING", "UGV_PREEMPTION_RECONCILE_REQUIRED");
    else if (
      execution.state !== "STOPPING" ||
      execution.reasonCode !== "UGV_PREEMPTED_BY_EMERGENCY_STOP"
    )
      next = transition(execution, "STOPPING", "UGV_PREEMPTED_BY_EMERGENCY_STOP");
    if (next.revision === execution.revision) return execution;
    await this.store.putExecution(next);
    if (isTerminal(next.state)) this.arbiter.release(next.taskId);
    await this.#emitExecutionTransition(execution, next);
    return next;
  }

  async #dispatchEmergencyStop(
    taskId: string,
    argumentsValue: Record<string, unknown>,
  ): Promise<void> {
    await this.#callJournaledMutation(
      taskId,
      "emergency-stop:01:primary",
      "EMERGENCY_STOP",
      buildUgvEmergencyStopPrimaryCall(),
    );
    const chassisMissionId = optionalEmergencyMissionId(argumentsValue.chassisMissionId);
    const reconMissionId = optionalEmergencyMissionId(argumentsValue.reconMissionId);
    const cleanupCalls = buildUgvEmergencyStopCleanupCalls({
      ...(chassisMissionId === undefined ? {} : { chassisMissionId }),
      ...(reconMissionId === undefined ? {} : { reconMissionId }),
    });
    for (const [index, call] of cleanupCalls.entries())
      try {
        await this.#callJournaledMutation(
          taskId,
          `emergency-stop:cleanup:${String(index + 1).padStart(2, "0")}`,
          "CLEANUP",
          call,
        );
      } catch (error) {
        await this.telemetry.emit(
          "RESOURCE_HEALTH",
          { health: "degraded", reasonCode: reason(error) },
          {
            attributes: {
              diagnostic: "emergency_stop_cleanup_failed",
              toolName: call.name,
            },
          },
        );
      }
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

  #journaledMultiStepStart(
    taskId: string,
    resumePersistedIntents = false,
  ): ExecuteUgvStartFlowOptions {
    const activeSteps = new Map<"PRIMARY" | "FOLLOWUP", MutationJournalEntry>();
    return {
      beforeMutationDispatch: async ({ phase, call }) => {
        const stepId = startStepId(phase);
        const existing = await this.store.getMutationJournalEntry(taskId, stepId);
        let intent: MutationJournalEntry;
        if (existing !== undefined) {
          assertJournalCallIdentity(existing, phase, call);
          if (!resumePersistedIntents || existing.state !== "INTENT_PERSISTED")
            throw new Error("UGV_MUTATION_JOURNAL_STEP_ALREADY_CLAIMED");
          intent = existing;
        } else {
          intent = {
            taskId,
            stepId,
            phase,
            toolName: call.name,
            argumentHash: mutationHash(call.arguments),
            state: "INTENT_PERSISTED",
            intentPersistedAt: this.#now().toISOString(),
          };
          const claim = await this.store.claimMutationJournal(intent);
          if (!claim.claimed) throw new Error("UGV_MUTATION_JOURNAL_STEP_ALREADY_CLAIMED");
        }
        const dispatching: MutationJournalEntry = {
          ...intent,
          state: "DISPATCHING",
          dispatchedAt: this.#now().toISOString(),
        };
        if (!(await this.store.advanceMutationJournal(dispatching, "INTENT_PERSISTED")))
          throw new Error("UGV_MUTATION_JOURNAL_DISPATCH_CONFLICT");
        activeSteps.set(phase, dispatching);
      },
      afterMutationAccepted: async ({ phase, result, canonicalMissionId }) => {
        const dispatching = requiredJournalStep(activeSteps, phase);
        const accepted: MutationJournalEntry = {
          ...dispatching,
          state: "ACCEPTED",
          ...(canonicalMissionId === undefined ? {} : { externalMissionId: canonicalMissionId }),
          resultHash: mutationHash(result),
          completedAt: this.#now().toISOString(),
        };
        if (!(await this.store.advanceMutationJournal(accepted, "DISPATCHING")))
          throw new Error("UGV_MUTATION_JOURNAL_COMPLETION_CONFLICT");
        activeSteps.set(phase, accepted);
      },
      afterMutationFailed: async ({ phase, error, result, canonicalMissionId }) => {
        const dispatching = requiredJournalStep(activeSteps, phase);
        const returnedResult =
          result ?? (error instanceof DeviceToolRejectedError ? error.result : undefined);
        const missionId =
          canonicalMissionId ?? rejectedResultMissionId(dispatching.toolName, returnedResult);
        const completed: MutationJournalEntry = {
          ...dispatching,
          state: error instanceof UncertainMutatingDeviceCallError ? "UNCERTAIN" : "REJECTED",
          ...(missionId === undefined ? {} : { externalMissionId: missionId }),
          ...(returnedResult === undefined ? {} : { resultHash: mutationHash(returnedResult) }),
          completedAt: this.#now().toISOString(),
        };
        if (!(await this.store.advanceMutationJournal(completed, "DISPATCHING")))
          throw new Error("UGV_MUTATION_JOURNAL_COMPLETION_CONFLICT", { cause: error });
        activeSteps.set(phase, completed);
      },
    };
  }

  async #armStartObservationDeadline(execution: ProviderExecution): Promise<ProviderExecution> {
    const followup = await this.store.getMutationJournalEntry(
      execution.taskId,
      startStepId("FOLLOWUP"),
    );
    if (
      followup?.completedAt === undefined ||
      (followup.state !== "ACCEPTED" && followup.state !== "UNCERTAIN")
    )
      return execution;
    return withPhaseDeadline(
      execution,
      "startObservationDeadline",
      followup.completedAt,
      this.options.startObservationTimeoutMs ?? 30_000,
      this.#now().toISOString(),
    );
  }

  async #downstreamMissionReadyNotStarted(execution: ProviderExecution): Promise<boolean> {
    if (
      execution.operationName !== "vehicle_navigate" &&
      execution.operationName !== "vehicle_area_recon"
    )
      return false;
    const primary = await this.store.getMutationJournalEntry(
      execution.taskId,
      startStepId("PRIMARY"),
    );
    if (
      primary?.state !== "ACCEPTED" ||
      primary.externalMissionId === undefined ||
      !execution.downstreamMissionIds.includes(primary.externalMissionId)
    )
      return false;
    const followup = await this.store.getMutationJournalEntry(
      execution.taskId,
      startStepId("FOLLOWUP"),
    );
    return (
      followup === undefined ||
      followup.state === "INTENT_PERSISTED" ||
      followup.state === "REJECTED"
    );
  }

  async #recoverMultiStepExecution(execution: ProviderExecution): Promise<boolean> {
    if (
      execution.operationName !== "vehicle_navigate" &&
      execution.operationName !== "vehicle_area_recon"
    )
      return false;
    const primary = await this.store.getMutationJournalEntry(
      execution.taskId,
      startStepId("PRIMARY"),
    );
    if (primary === undefined) {
      if (execution.state !== "ACCEPTED") return false;
      await this.#resumeMultiStepExecution(execution);
      return true;
    }
    if (primary.state === "INTENT_PERSISTED") {
      await this.#resumeMultiStepExecution(execution);
      return true;
    }
    if (primary.state === "DISPATCHING" || primary.state === "UNCERTAIN") {
      await this.store.putExecution(transition(execution, "STARTING", "UNCERTAIN_EXECUTION_STATE"));
      return true;
    }
    if (primary.state === "REJECTED") {
      const failed = terminal(execution, "BUSINESS_FAILED", "UGV_DEVICE_TOOL_REJECTED", {
        resourceId: execution.resourceId,
        status: "failed",
        observedAt: this.#now().toISOString(),
      });
      await this.store.putExecution(failed);
      await this.taskBusiness?.finalizeForTerminalExecution(failed);
      this.arbiter.release(failed.taskId);
      return true;
    }
    const missionId = primary.externalMissionId;
    if (missionId === undefined || !execution.downstreamMissionIds.includes(missionId)) {
      await this.store.putExecution(transition(execution, "STARTING", "UNCERTAIN_EXECUTION_STATE"));
      return true;
    }
    const followup = await this.store.getMutationJournalEntry(
      execution.taskId,
      startStepId("FOLLOWUP"),
    );
    if (followup === undefined || followup.state === "INTENT_PERSISTED") {
      await this.#resumeMultiStepExecution(execution, missionId);
      return true;
    }
    if (followup.state === "REJECTED") {
      await this.store.putExecution(
        transition(execution, "STARTING", "DOWNSTREAM_MISSION_READY_NOT_STARTED"),
      );
      return true;
    }
    if (followup.state === "DISPATCHING" || followup.state === "UNCERTAIN") {
      const uncertain = await this.#armStartObservationDeadline(execution);
      await this.store.putExecution(transition(uncertain, "STARTING", "UNCERTAIN_EXECUTION_STATE"));
      return true;
    }
    let recovered = await this.#armStartObservationDeadline(execution);
    if (recovered.state === "ACCEPTED")
      recovered = transition(recovered, "STARTING", "UGV_WAITING_DEVICE_CONFIRMATION");
    if (recovered.revision !== execution.revision) await this.store.putExecution(recovered);
    await this.#refresh(recovered);
    return true;
  }

  async #resumeMultiStepExecution(
    execution: ProviderExecution,
    resumeFromMissionId?: string,
  ): Promise<void> {
    let current = execution;
    try {
      await executeUgvStartFlow(
        current.operationName,
        current.arguments,
        (name, argumentsValue) => this.#callDevice(name, argumentsValue, current.taskId),
        {
          ...this.#journaledMultiStepStart(current.taskId, true),
          ...(resumeFromMissionId === undefined ? {} : { resumeFromMissionId }),
          onMissionId: async (missionId) => {
            if (current.downstreamMissionIds.includes(missionId)) return;
            current = withMissionId(current, missionId);
            await this.store.putExecution(current);
          },
        },
      );
      current = await this.#armStartObservationDeadline(current);
      current = transition(current, "STARTING", "UGV_WAITING_DEVICE_CONFIRMATION");
      await this.store.putExecution(current);
      await this.#refresh(current);
    } catch (error) {
      if (await this.#downstreamMissionReadyNotStarted(current)) {
        await this.store.putExecution(
          transition(current, "STARTING", "DOWNSTREAM_MISSION_READY_NOT_STARTED"),
        );
        return;
      }
      if (error instanceof UncertainMutatingDeviceCallError) {
        current = await this.#armStartObservationDeadline(current);
        await this.store.putExecution(transition(current, "STARTING", "UNCERTAIN_EXECUTION_STATE"));
        return;
      }
      const failed = terminal(
        current,
        error instanceof DeviceToolRejectedError ? "BUSINESS_FAILED" : "TECHNICAL_FAILED",
        reason(error),
        {
          resourceId: current.resourceId,
          status: "failed",
          observedAt: this.#now().toISOString(),
        },
      );
      await this.store.putExecution(failed);
      await this.taskBusiness?.finalizeForTerminalExecution(failed);
      this.arbiter.release(failed.taskId);
    }
  }

  async #callJournaledMutation(
    taskId: string,
    stepId: string,
    phase: MutationJournalPhase,
    call: DeviceToolCall,
  ): Promise<void> {
    const existing = await this.store.getMutationJournalEntry(taskId, stepId);
    let intent: MutationJournalEntry;
    if (existing !== undefined) {
      assertJournalCallIdentity(existing, phase, call);
      if (existing.state === "ACCEPTED") return;
      if (existing.state === "REJECTED") throw new DeviceToolRejectedError("UGV", call.name);
      if (existing.state === "DISPATCHING" || existing.state === "UNCERTAIN")
        throw new UncertainMutatingDeviceCallError("UGV", call.name);
      intent = existing;
    } else {
      intent = {
        taskId,
        stepId,
        phase,
        toolName: call.name,
        argumentHash: mutationHash(call.arguments),
        state: "INTENT_PERSISTED",
        intentPersistedAt: this.#now().toISOString(),
      };
      const claim = await this.store.claimMutationJournal(intent);
      if (!claim.claimed) throw new Error("UGV_MUTATION_JOURNAL_STEP_ALREADY_CLAIMED");
    }
    const dispatching: MutationJournalEntry = {
      ...intent,
      state: "DISPATCHING",
      dispatchedAt: this.#now().toISOString(),
    };
    if (!(await this.store.advanceMutationJournal(dispatching, "INTENT_PERSISTED")))
      throw new Error("UGV_MUTATION_JOURNAL_DISPATCH_CONFLICT");
    let result: Record<string, unknown> | undefined;
    try {
      result = await this.#callDevice(call.name, call.arguments, taskId);
      const missionId = rejectedResultMissionId(call.name, result);
      const accepted: MutationJournalEntry = {
        ...dispatching,
        state: "ACCEPTED",
        ...(missionId === undefined ? {} : { externalMissionId: missionId }),
        resultHash: mutationHash(result),
        completedAt: this.#now().toISOString(),
      };
      if (!(await this.store.advanceMutationJournal(accepted, "DISPATCHING")))
        throw new Error("UGV_MUTATION_JOURNAL_COMPLETION_CONFLICT");
    } catch (error) {
      const classified =
        error instanceof DeviceToolRejectedError ||
        error instanceof UncertainMutatingDeviceCallError ||
        result === undefined
          ? error
          : new UncertainMutatingDeviceCallError("UGV", call.name, { cause: error });
      const returnedResult =
        result ?? (error instanceof DeviceToolRejectedError ? error.result : undefined);
      const missionId = rejectedResultMissionId(call.name, returnedResult);
      const completed: MutationJournalEntry = {
        ...dispatching,
        state: classified instanceof UncertainMutatingDeviceCallError ? "UNCERTAIN" : "REJECTED",
        ...(missionId === undefined ? {} : { externalMissionId: missionId }),
        ...(returnedResult === undefined ? {} : { resultHash: mutationHash(returnedResult) }),
        completedAt: this.#now().toISOString(),
      };
      try {
        if (!(await this.store.advanceMutationJournal(completed, "DISPATCHING")))
          throw new Error("UGV_MUTATION_JOURNAL_COMPLETION_CONFLICT", { cause: error });
      } catch (persistenceError) {
        throw new UncertainMutatingDeviceCallError("UGV", call.name, {
          cause: persistenceError,
        });
      }
      throw classified;
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
      resourceId: execution.resourceId,
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
      resourceId: execution.resourceId,
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
    if (isTerminal(next.state)) await this.taskBusiness?.finalizeForTerminalExecution(next);
    this.events.emit(next.taskId, await this.executionSnapshot(next));
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

export function executionSnapshot(
  execution: ProviderExecution,
  pendingInput?: RequiredInput,
): Record<string, unknown> {
  const result =
    execution.result === undefined ? undefined : sanitizeFireResult(execution.result).value;
  if (result !== undefined) assertNoRefereeData(result);
  let reconInput: RequiredInput | undefined;
  if (execution.state === "WAITING_INPUT" && execution.operationName === "vehicle_area_recon") {
    if (pendingInput === undefined) throw new Error("UGV_REQUIRED_INPUT_NOT_BOUND");
    const request = RequiredInputSchema.parse(pendingInput);
    if (
      !execution.taskBusinessContextExpected ||
      request.state !== "pending" ||
      request.identity.taskId !== execution.taskId ||
      request.identity.executionId !== execution.externalExecutionId ||
      request.identity.providerId !== execution.providerId ||
      request.identity.resourceId !== execution.resourceId ||
      request.identity.operationName !== execution.operationName
    )
      throw new Error("UGV_REQUIRED_INPUT_NOT_BOUND");
    reconInput = request;
  }
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
    ...(execution.state === "WAITING_INPUT" && execution.operationName === "vehicle_fire_weapon"
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
    ...(reconInput === undefined
      ? {}
      : {
          mcpInputRequests: [
            {
              key: reconInput.requestKey,
              method: "elicitation/create",
              params: jsonToProtoStruct({
                message: reconInput.description ?? reconInput.title,
                requestedSchema: reconInput.inputSchema,
                _meta: {
                  "io.sdar/taskBusiness": {
                    schemaVersion: reconInput.schemaVersion,
                    requestId: reconInput.requestId,
                    requestKey: reconInput.requestKey,
                    inputType: reconInput.inputType,
                    requiredResponder: reconInput.requiredResponder,
                    revision: reconInput.revision,
                    ...(reconInput.deadlineAt === undefined
                      ? {}
                      : { deadlineAt: reconInput.deadlineAt }),
                  },
                },
              }),
            },
          ],
        }),
  };
}

function applyTrack(
  execution: ProviderExecution,
  track: VehicleTaskTrack,
  successStatus: string,
  observationCursor?: string,
  physical?: {
    confirmation: ReturnType<typeof navigationPhysicalConfirmation>;
    observationChanged: boolean;
    stabilitySatisfied: boolean;
    facts: Record<string, unknown>;
    controlObservationIsNew: boolean;
  },
): ProviderExecution {
  if (
    !isNewOperationObservation(execution, observationCursor) &&
    physical?.observationChanged !== true
  )
    return execution;
  if (
    execution.operationName === "vehicle_navigate" &&
    isHistoricalMissionObservation(execution, track.id)
  )
    return execution;
  if (!trackBelongsToExecution(execution, track)) {
    const reasonCode =
      track.id === undefined
        ? "UGV_MISSION_CORRELATION_UNCONFIRMED"
        : "UGV_DOWNSTREAM_MISSION_ID_MISMATCH";
    return execution.reasonCode === reasonCode
      ? execution
      : transition(execution, execution.state, reasonCode);
  }
  const mapped = mapVehicleTaskState(track.state, true);
  const armed = execution.observationCursors?.trackActive !== undefined;
  const current =
    armed || !isObservedActiveState(mapped.state)
      ? execution
      : withObservationCursor(execution, "trackActive", observationCursor);
  const diagnosticBusinessSuccess =
    execution.diagnosticBehavior?.capabilityId === SMPP_PROVIDER_BUSINESS_SUCCESS_CAPABILITY &&
    Date.parse(execution.diagnosticBehavior.expiresAt) > Date.now();
  if (diagnosticBusinessSuccess && isMappedTerminal(mapped.state)) {
    return terminal(current, "SUCCEEDED", "SMPP_DIAGNOSTIC_PROVIDER_BUSINESS_SUCCESS", {
      resourceId: execution.resourceId,
      status: "succeeded",
      businessStatus: "succeeded",
      claimsPhysicalArrival: false,
      observedAt: track.observedAt ?? new Date().toISOString(),
    });
  }
  const immediateCompletionProven =
    mapped.state === "SUCCEEDED" &&
    physical?.confirmation.confirmed === true &&
    physical.stabilitySatisfied;
  if (!armed && isMappedTerminal(mapped.state) && !immediateCompletionProven) {
    if (execution.reasonCode === "UGV_TASK_TERMINAL_UNCONFIRMED") return execution;
    return transition(execution, execution.state, "UGV_TASK_TERMINAL_UNCONFIRMED");
  }
  if (mapped.state === "RECONCILE") {
    if (current.reasonCode === mapped.reasonCode) return current;
    return transition(current, current.state, mapped.reasonCode);
  }
  const progress = monotonicProgress(current.progress, track.progress);
  if (
    mapped.state === "PAUSED" &&
    execution.controlConfirmation?.command === "pause" &&
    (physical?.confirmation.stationary !== true ||
      !physical.confirmation.speedFresh ||
      !physical.controlObservationIsNew ||
      !physical.stabilitySatisfied)
  )
    return transition(current, current.state, "UGV_PAUSE_PHYSICAL_CONFIRMATION_PENDING");
  if (
    mapped.state === "RUNNING" &&
    execution.controlConfirmation?.command === "resume" &&
    physical?.controlObservationIsNew !== true
  )
    return transition(current, current.state, "UGV_RESUME_PHYSICAL_CONFIRMATION_PENDING");
  if (mapped.state === "SUCCEEDED") {
    if (physical !== undefined && !physical.confirmation.confirmed)
      return transition(current, current.state, physical.confirmation.reasonCode);
    if (physical !== undefined && !physical.stabilitySatisfied)
      return transition(current, current.state, "UGV_STATIONARY_STABILITY_PENDING");
    return terminal(current, "SUCCEEDED", mapped.reasonCode, {
      resourceId: execution.resourceId,
      status: successStatus,
      observedAt: track.observedAt ?? new Date().toISOString(),
      ...physical?.facts,
    });
  }
  if (mapped.state === "BUSINESS_FAILED")
    return terminal(current, "BUSINESS_FAILED", mapped.reasonCode, {
      resourceId: execution.resourceId,
      status: "failed",
      observedAt: track.observedAt ?? new Date().toISOString(),
    });
  if (mapped.state === "CANCELLED") {
    if (
      physical !== undefined &&
      execution.controlConfirmation?.command === "cancel" &&
      (!physical.confirmation.speedFresh ||
        physical.confirmation.stationary !== true ||
        !physical.controlObservationIsNew ||
        !physical.stabilitySatisfied)
    )
      return transition(current, current.state, "UGV_CANCEL_PHYSICAL_CONFIRMATION_PENDING");
    return terminal(current, "CANCELLED", mapped.reasonCode, {
      resourceId: execution.resourceId,
      status: "cancelled",
      observedAt: track.observedAt ?? new Date().toISOString(),
      ...physical?.facts,
    });
  }
  if (
    current.state === "STOPPING" &&
    (mapped.state === "STARTING" || mapped.state === "RUNNING" || mapped.state === "PAUSED")
  )
    return current;
  if (current.state === "RESUMING" && mapped.state === "PAUSED") return current;
  if (mapped.state === current.state && progress === current.progress)
    return current.reasonCode === "UGV_TASK_STATE_CONFLICT"
      ? transition(current, current.state, mapped.reasonCode)
      : current;
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
  observedAt: string | undefined,
  correlation: CorrelationStrength,
  terminalFacts: Record<string, unknown> = {},
): ProviderExecution {
  if (execution.state === "ACCEPTED" || !isNewReconObservation(execution, observationCursor))
    return execution;
  if (isHistoricalMissionObservation(execution, reconnaissance.id)) return execution;
  if (observedAt === undefined || Number.isNaN(Date.parse(observedAt)))
    return execution.reasonCode === "UGV_RECON_CORRELATION_UNKNOWN"
      ? execution
      : transition(execution, execution.state, "UGV_RECON_CORRELATION_UNKNOWN");
  if (correlation === "MISMATCH")
    return execution.reasonCode === "UGV_DOWNSTREAM_MISSION_ID_MISMATCH"
      ? execution
      : transition(execution, execution.state, "UGV_DOWNSTREAM_MISSION_ID_MISMATCH");
  if (correlation === "UNKNOWN")
    return execution.reasonCode === "UGV_RECON_CORRELATION_UNKNOWN"
      ? execution
      : transition(execution, execution.state, "UGV_RECON_CORRELATION_UNKNOWN");
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
  if (correlation === "WEAK_UNCORRELATED" && isMappedTerminal(mapped.state))
    return current.reasonCode === "UGV_RECON_WEAK_CORRELATION"
      ? current
      : transition(current, current.state, "UGV_RECON_WEAK_CORRELATION");
  if (mapped.state === "SUCCEEDED")
    return terminal(current, "SUCCEEDED", mapped.reasonCode, {
      resourceId: execution.resourceId,
      status: "completed",
      observedAt,
      ...(reconnaissance.coverability === undefined
        ? {}
        : { coverability: reconnaissance.coverability }),
      ...terminalFacts,
    });
  if (mapped.state === "BUSINESS_FAILED")
    return terminal(current, "BUSINESS_FAILED", mapped.reasonCode, {
      resourceId: execution.resourceId,
      status: "failed",
      observedAt,
      outOfRange: reconnaissance.outOfRange === true,
      ...terminalFacts,
    });
  if (mapped.state === "CANCELLED")
    return terminal(current, "CANCELLED", mapped.reasonCode, {
      resourceId: execution.resourceId,
      status: "cancelled",
      observedAt,
      ...terminalFacts,
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

function reconcileTaskStateConflict(execution: ProviderExecution): ProviderExecution {
  return execution.reasonCode === "UGV_TASK_STATE_CONFLICT"
    ? execution
    : transition(execution, execution.state, "UGV_TASK_STATE_CONFLICT");
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
  if (execution.downstreamMissionIds.length === 0) return false;
  if (track.id === undefined) return allowMissingObservedId;
  try {
    return execution.downstreamMissionIds.includes(String(parseUgvMissionId(track.id)));
  } catch {
    return false;
  }
}

/** A replacement mission owns current Task state; older IDs remain only for history. */
function isHistoricalMissionObservation(
  execution: ProviderExecution,
  observedMissionId: string | number | undefined,
): boolean {
  if (observedMissionId === undefined || execution.downstreamMissionIds.length < 2) return false;
  try {
    const observed = String(parseUgvMissionId(observedMissionId));
    return (
      observed !== execution.downstreamMissionIds.at(-1) &&
      execution.downstreamMissionIds.includes(observed)
    );
  } catch {
    return false;
  }
}

interface TaskPhaseObservation {
  observedAt: string;
  startObserved: boolean;
  activeObserved: boolean;
  terminalObserved: boolean;
}

function taskPhaseObservation(
  execution: ProviderExecution,
  snapshot: UgvSnapshot,
  ingress: VehicleMqttIngress,
): TaskPhaseObservation | undefined {
  if (execution.operationName === "vehicle_navigate") {
    const cursor = operationObservationCursor(execution.operationName, ingress);
    const track = snapshot.chassis.mission;
    if (
      !isNewOperationObservation(execution, cursor) ||
      isHistoricalMissionObservation(execution, track.id) ||
      !trackBelongsToExecution(execution, track)
    )
      return undefined;
    const mapped = mapVehicleTaskState(track.state, true).state;
    if (mapped === "RECONCILE") return undefined;
    return {
      observedAt: track.observedAt ?? snapshot.observedAt,
      startObserved: mapped === "STARTING" || isObservedActiveState(mapped),
      activeObserved: isObservedActiveState(mapped),
      terminalObserved: isMappedTerminal(mapped),
    };
  }
  if (execution.operationName === "vehicle_area_recon") {
    const cursor = ingress.observationCursor("/ugv/area_recon/status");
    const authority = ingress.observationAuthority("/ugv/area_recon/status");
    const track = snapshot.payload.reconnaissance;
    if (
      !isNewReconObservation(execution, cursor) ||
      authority === undefined ||
      isHistoricalMissionObservation(execution, track.id) ||
      !trackBelongsToExecution(execution, track, true)
    )
      return undefined;
    const mapped = mapReconMotionStatus(track.motionStatus, true).state;
    if (mapped === "RECONCILE") return undefined;
    return {
      observedAt: authority.observedAt,
      startObserved: mapped === "STARTING" || isObservedActiveState(mapped),
      activeObserved: isObservedActiveState(mapped),
      terminalObserved: isMappedTerminal(mapped),
    };
  }
  return undefined;
}

function executionPhysicalBaseline(execution: ProviderExecution): PhysicalDispatchBaseline {
  const value = execution.dispatchBaseline;
  if (
    record(value) &&
    typeof value.capturedAt === "string" &&
    typeof value.snapshotRevision === "string"
  )
    return value as unknown as PhysicalDispatchBaseline;
  return {
    capturedAt: execution.createdAt,
    snapshotRevision: execution.latestSnapshotRevision ?? "unknown",
    mission: { state: "unknown" },
    observationAuthorities: [],
  };
}

function operationObservationAuthorities(
  operationName: string,
  ingress: VehicleMqttIngress,
): PhysicalObservationAuthority[] {
  const fields: readonly VehicleObservationField[] =
    operationName === "vehicle_navigate"
      ? [
          "chassis.position.geodetic",
          "chassis.position.local",
          "chassis.speed",
          "chassis.heading",
          "chassis.mission",
        ]
      : operationName === "vehicle_area_recon"
        ? ["payload.recon", "payload.targets", "payload.gimbal"]
        : operationName === "vehicle_emergency_stop"
          ? ["chassis.speed", "chassis.mission", "payload.recon", "payload.gimbal"]
          : [];
  return ingress.fieldObservationAuthorities(fields);
}

function controlObservationIsNew(
  execution: ProviderExecution,
  ingress: VehicleMqttIngress,
): boolean {
  const baselineValue = execution.controlConfirmation?.baseline;
  if (!record(baselineValue)) return false;
  const baseline = baselineValue as unknown as PhysicalDispatchBaseline;
  const current = operationObservationAuthorities(execution.operationName, ingress);
  const newFields = new Set(
    current
      .filter((authority) => {
        const old = baseline.observationAuthorities.find(
          (candidate) => candidate.topic === authority.topic,
        );
        return old === undefined || isNewAuthority(baseline.observationAuthorities, authority);
      })
      .flatMap((authority) => (authority.field === undefined ? [] : [authority.field])),
  );
  const missionIsNew = newFields.has("chassis.mission");
  if (execution.controlConfirmation?.command === "resume") return missionIsNew;
  return missionIsNew && newFields.has("chassis.speed");
}

function stationaryStabilitySatisfied(
  execution: ProviderExecution,
  speedAuthority: PhysicalObservationAuthority | undefined,
  stabilityMs: number,
  minimumSamples: number,
): boolean {
  if (
    speedAuthority === undefined ||
    execution.stationaryCandidateSince === undefined ||
    speedAuthority.cursor !== execution.lastStationarySpeedCursor ||
    (execution.consecutiveStationaryObservations ?? 0) < minimumSamples
  )
    return false;
  return (
    millisecondsBetweenIsoTimestamps(
      speedAuthority.observedAt,
      execution.stationaryCandidateSince,
    ) >= stabilityMs
  );
}

function resetStationaryStability(execution: ProviderExecution, speedCursor?: string): void {
  delete execution.stationaryCandidateSince;
  execution.consecutiveStationaryObservations = 0;
  if (speedCursor === undefined) delete execution.lastStationarySpeedCursor;
  else execution.lastStationarySpeedCursor = speedCursor;
}

function resetStationaryStabilityRecord(
  execution: ProviderExecution,
  speedCursor: string | undefined,
  updatedAt: string,
): ProviderExecution {
  if (
    execution.stationaryCandidateSince === undefined &&
    (execution.consecutiveStationaryObservations ?? 0) === 0 &&
    execution.lastStationarySpeedCursor === speedCursor
  )
    return execution;
  const next = updateStationaryStabilityRecord(
    execution,
    {
      ...(speedCursor === undefined ? {} : { lastStationarySpeedCursor: speedCursor }),
      consecutiveStationaryObservations: 0,
    },
    updatedAt,
  );
  if (speedCursor === undefined) delete next.lastStationarySpeedCursor;
  return next;
}

function updateStationaryStabilityRecord(
  execution: ProviderExecution,
  updates: Pick<
    ProviderExecution,
    | "stationaryCandidateSince"
    | "lastNonStationaryObservedAt"
    | "consecutiveStationaryObservations"
    | "lastStationarySpeedCursor"
  >,
  updatedAt: string,
): ProviderExecution {
  const next = structuredClone(execution);
  delete next.stationaryCandidateSince;
  next.consecutiveStationaryObservations = 0;
  Object.assign(next, updates);
  next.revision++;
  next.updatedAt = updatedAt;
  return next;
}

function physicalConfirmationExpired(
  baseline: PhysicalDispatchBaseline,
  timeoutMs: number,
  now = Date.now(),
): boolean {
  const capturedAt = Date.parse(baseline.capturedAt);
  return Number.isFinite(capturedAt) && now - capturedAt >= timeoutMs;
}

type PhaseDeadlineField =
  | "startObservationDeadline"
  | "activeObservationDeadline"
  | "terminalObservationDeadline"
  | "physicalConfirmationDeadline"
  | "controlConfirmationDeadline";

function withPhaseDeadline(
  execution: ProviderExecution,
  field: PhaseDeadlineField,
  origin: string,
  timeoutMs: number,
  updatedAt: string,
): ProviderExecution {
  if (execution[field] !== undefined) return execution;
  const next = structuredClone(execution);
  next[field] = deadlineFrom(origin, timeoutMs);
  next.revision++;
  next.updatedAt = updatedAt;
  return next;
}

function deadlineFrom(origin: string, timeoutMs: number): string {
  const originMs = Date.parse(origin);
  if (!Number.isFinite(originMs)) throw new Error("UGV_PHASE_DEADLINE_ORIGIN_INVALID");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
    throw new Error("UGV_PHASE_DEADLINE_TIMEOUT_INVALID");
  return new Date(originMs + timeoutMs).toISOString();
}

function deadlineExpired(deadline: string | undefined, now: number): boolean {
  if (deadline === undefined) return false;
  const deadlineMs = Date.parse(deadline);
  return Number.isFinite(deadlineMs) && now >= deadlineMs;
}

function controlConfirmationPending(execution: ProviderExecution): boolean {
  const command = execution.controlConfirmation?.command;
  if (command === "pause") return execution.state !== "PAUSED";
  if (command === "resume") return execution.state !== "RUNNING";
  if (command === "cancel") return !isTerminal(execution.state);
  return false;
}

function physicalConfirmationPending(reasonCode: string): boolean {
  return new Set([
    "UGV_PHYSICAL_OBSERVATION_NOT_NEW",
    "UGV_TERMINAL_POSITION_UNCONFIRMED",
    "UGV_TERMINAL_SPEED_UNCONFIRMED",
    "UGV_TERMINAL_STATIONARY_UNCONFIRMED",
    "UGV_MISSION_CORRELATION_UNCONFIRMED",
    "UGV_STATIONARY_STABILITY_PENDING",
    "UGV_TASK_STATE_CONFLICT",
    "UGV_RECON_WEAK_CORRELATION",
    "UGV_RECON_CORRELATION_UNKNOWN",
    "UGV_DOWNSTREAM_MISSION_ID_MISMATCH",
    "UGV_CANCEL_PHYSICAL_CONFIRMATION_PENDING",
    "UGV_PAUSE_PHYSICAL_CONFIRMATION_PENDING",
    "UGV_RESUME_PHYSICAL_CONFIRMATION_PENDING",
  ]).has(reasonCode);
}

function requestedDistance(argumentsValue: Record<string, unknown>): number | undefined {
  const mission = record(argumentsValue.mission) ? argumentsValue.mission : undefined;
  const value = mission?.distanceM ?? mission?.distance;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
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

function reconMotionActive(status: VehicleReconnaissanceState["motionStatus"]): boolean {
  return new Set([2, 4, 5, 6, 7, 8, 12]).has(status as number);
}

function deviceObservedOccupiedTracks(
  snapshot: UgvSnapshot,
  arbiter: TrackArbiter,
): ReadonlySet<VehicleTrack> {
  const occupied = new Set<VehicleTrack>();
  if (arbiter.owner("chassis") === undefined && observedTaskActive(snapshot.chassis.mission))
    occupied.add("chassis");
  if (
    arbiter.owner("eo") === undefined &&
    (reconMotionActive(snapshot.payload.reconnaissance.motionStatus) ||
      observedTaskActive(snapshot.payload.eoTask))
  )
    occupied.add("eo");
  if (arbiter.owner("weapon") === undefined && observedTaskActive(snapshot.payload.weapon))
    occupied.add("weapon");
  return occupied;
}

function observedTaskActive(track: VehicleTaskTrack): boolean {
  return track.state === 1 || track.state === 2 || (track.state === 0 && track.id !== undefined);
}

function externalTrackBusyDecision(
  track: VehicleTrack,
  riskLevel: AvailabilityDecision["riskLevel"],
): AvailabilityDecision {
  const reasonCode = `UGV_EXTERNAL_${track.toUpperCase()}_TRACK_BUSY`;
  return { availability: "DISABLED", riskLevel, reasonCode, description: reasonCode };
}

function recoveryOwnershipOrder(left: ProviderExecution, right: ProviderExecution): number {
  const priority = (execution: ProviderExecution) =>
    execution.operationName === "vehicle_emergency_stop" &&
    execution.preemptedByTaskId === undefined
      ? 0
      : 1;
  return priority(left) - priority(right) || left.createdAt.localeCompare(right.createdAt);
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
      `execution:${execution.externalExecutionId}`,
      [execution.providerId ?? "ugv-provider", "ugv-adapter"],
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
    resourceRef: execution.resourceId,
    severityHint: isFailure(execution.state) ? ("warning" as const) : ("info" as const),
    rawPayload: {
      taskId: execution.taskId,
      operation: execution.operationName,
      state: execution.state,
    },
  };
}
function selectSnapshot(
  snapshot: UgvSnapshot,
  include: unknown,
  positionObservedAt?: string,
): Record<string, unknown> {
  const requested = Array.isArray(include)
    ? new Set(include.filter((x): x is string => typeof x === "string"))
    : new Set(["chassis", "payload", "health", "targets"]);
  const result: Record<string, unknown> = {
    identity: {
      providerId: snapshot.identity.providerId,
      resourceId: snapshot.identity.resourceId,
      vehicleType: snapshot.identity.vehicleType,
      executionMode: snapshot.identity.executionMode,
    },
    connectivity: snapshot.connectivity,
    freshness: {
      ...snapshot.freshness,
      ...(positionObservedAt === undefined ? {} : { positionObservedAt }),
    },
    revision: snapshot.revision,
    observedAt: snapshot.observedAt,
  };
  if (requested.has("chassis")) result.chassis = snapshot.chassis;
  if (requested.has("payload")) result.payload = { ...snapshot.payload, targets: undefined };
  if (requested.has("health")) result.health = snapshot.health;
  if (requested.has("targets")) result.targets = snapshot.payload.targets;
  return JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
}
function synchronousEvidence(
  operationName: string,
  observedAt: string,
  providerId: string,
  externalExecutionId: string,
) {
  const evidenceType =
    operationName === "vehicle_get_targets"
      ? "vehicle.target.observation"
      : operationName === "vehicle_get_payload_status" || operationName === "vehicle_laser_range"
        ? "vehicle.payload.status"
        : "vehicle.state.observation";
  return vehicleEvidence(
    evidenceType,
    observedAt,
    "/observedAt",
    `execution:${externalExecutionId}`,
    [providerId, "ugv-adapter"],
  );
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
function legacyFireInputResponses(inputs: readonly unknown[]): unknown[] {
  return inputs.map((item) => {
    if (!record(item) || typeof item.inputRequestKey !== "string" || !record(item.value))
      return { key: "", result: jsonToProtoStruct({ action: "invalid" }) };
    let value: unknown;
    try {
      value = protoValueToJson(item.value as ProtoValue);
    } catch {
      return { key: item.inputRequestKey, result: jsonToProtoStruct({ action: "invalid" }) };
    }
    const confirmed = value === true || (record(value) && value.confirmed === true);
    const declined = value === false || (record(value) && value.confirmed === false);
    return {
      key: item.inputRequestKey,
      result: jsonToProtoStruct(
        confirmed
          ? { action: "accept", content: { confirmed: true } }
          : { action: declined ? "decline" : "invalid" },
      ),
    };
  });
}
function validUnsupportedInputEnvelope(update: {
  inputs: readonly unknown[];
  inputResponses: readonly unknown[];
}): boolean {
  const keys = new Set<string>();
  for (const item of update.inputResponses) {
    if (!record(item) || typeof item.key !== "string" || item.key.length === 0) return false;
    if (keys.has(item.key) || !record(item.result) || !record(item.result.fields)) return false;
    keys.add(item.key);
    try {
      const result = protoStructToJson(item.result);
      if (result.action !== "accept" && result.action !== "decline" && result.action !== "cancel")
        return false;
      if (item.verifiedResponder != null) {
        if (!record(item.verifiedResponder) || !record(item.verifiedResponder.fields)) return false;
        const responder = protoStructToJson(item.verifiedResponder);
        if (
          !["user", "agent", "operator"].includes(String(responder.actorType)) ||
          typeof responder.actorId !== "string" ||
          responder.actorId.length === 0 ||
          !["jwt_hs256", "trusted_headers"].includes(String(responder.source))
        ) {
          return false;
        }
      }
    } catch {
      return false;
    }
  }
  for (const item of update.inputs) {
    if (
      !record(item) ||
      typeof item.inputRequestKey !== "string" ||
      item.inputRequestKey.length === 0 ||
      keys.has(item.inputRequestKey) ||
      !record(item.value) ||
      ["nullValue", "numberValue", "stringValue", "boolValue", "listValue", "structValue"].filter(
        (key) => Object.hasOwn(item.value as Record<string, unknown>, key),
      ).length !== 1 ||
      typeof item.answerHash !== "string" ||
      item.answerHash.length === 0
    ) {
      return false;
    }
    try {
      protoValueToJson(item.value as ProtoValue);
    } catch {
      return false;
    }
    keys.add(item.inputRequestKey);
  }
  return true;
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
function startStepId(phase: "PRIMARY" | "FOLLOWUP"): string {
  return phase === "PRIMARY" ? "start:01:primary" : "start:02:followup";
}
function controlPhase(command: "pause" | "resume" | "cancel"): MutationJournalPhase {
  return command === "pause" ? "PAUSE" : command === "resume" ? "RESUME" : "CANCEL";
}
function controlStepId(command: string, commandSequence: string, index: number): string {
  return `control:${command}:${commandSequence}:${String(index + 1).padStart(2, "0")}`;
}
function mutationHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
function assertJournalCallIdentity(
  entry: MutationJournalEntry,
  phase: MutationJournalPhase,
  call: DeviceToolCall,
): void {
  if (
    entry.phase !== phase ||
    entry.toolName !== call.name ||
    entry.argumentHash !== mutationHash(call.arguments)
  )
    throw new Error("UGV_MUTATION_JOURNAL_IDENTITY_CONFLICT");
}
function requiredJournalStep(
  entries: ReadonlyMap<"PRIMARY" | "FOLLOWUP", MutationJournalEntry>,
  phase: "PRIMARY" | "FOLLOWUP",
): MutationJournalEntry {
  const entry = entries.get(phase);
  if (entry === undefined) throw new Error("UGV_MUTATION_JOURNAL_DISPATCH_REQUIRED");
  return entry;
}
function rejectedResultMissionId(
  toolName: string,
  result: Record<string, unknown> | undefined,
): string | undefined {
  if (result === undefined) return undefined;
  const knownTool = UGV_DEVICE_TOOL_ALLOWLIST.find((candidate) => candidate === toolName);
  if (knownTool === undefined) return undefined;
  try {
    const missionId = missionIdFromUgvResult(knownTool, result);
    return missionId === undefined ? undefined : canonicalUgvMissionId(missionId);
  } catch {
    return undefined;
  }
}
function validateStart(
  input: StartUgvOperation,
  options: Pick<UgvProviderRuntime["options"], "resourceId" | "executionMode" | "fireEnabled">,
): void {
  if (!OPERATIONS.has(input.operationName)) throw new Error("UGV_OPERATION_UNSUPPORTED");
  if (!input.taskId || !input.argumentHash) throw new Error("UGV_START_IDENTITY_INVALID");
  if (input.arguments.resourceId !== (options.resourceId ?? "vehicle:ugv1"))
    throw new Error("UGV_RESOURCE_NOT_FOUND");
  const requestedMode = normalizeExecutionMode(input.executionContext.executionMode);
  if (requestedMode !== (options.executionMode ?? "simulation"))
    throw new Error("UGV_EXECUTION_MODE_MISMATCH");
}

function normalizeExecutionMode(value: string): "simulation" | "live" {
  if (value === "SIMULATION" || value === "2" || value === "simulation") return "simulation";
  if (value === "LIVE" || value === "1" || value === "live") return "live";
  throw new Error("UGV_EXECUTION_MODE_MISMATCH");
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
function identityTelemetry(execution: ProviderExecution, attributes?: Record<string, unknown>) {
  return {
    taskId: execution.taskId,
    externalExecutionId: execution.externalExecutionId,
    operationName: execution.operationName,
    ...(attributes === undefined ? {} : { attributes }),
  };
}

function executionProgressPayload(execution: ProviderExecution) {
  const percentage = Math.max(0, Math.min(100, execution.progress ?? 0));
  return { current: percentage, total: 100, percentage, unit: "percent" };
}

function executionProgressAttributes(execution: ProviderExecution) {
  return {
    transition: execution.state,
    reasonCode: execution.reasonCode,
    progressBucket: progressBucket(execution.progress),
    progressKnown: execution.progress !== undefined,
  };
}

function diagnosticTelemetryAttributes(
  diagnostic: SmppDiagnosticControlResult,
  execution: ProviderExecution,
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  return {
    "sdar.diagnostic.contract": SMPP_DIAGNOSTIC_CONTRACT,
    "sdar.diagnostic.capabilityId": diagnostic.lease.capabilityId,
    "sdar.diagnostic.faultType": diagnostic.lease.faultType,
    "sdar.diagnostic.boundary": diagnostic.lease.boundary,
    "sdar.diagnostic.injectionCount": diagnostic.lease.injectionCount,
    "sdar.diagnostic.leaseId": diagnostic.lease.leaseId,
    "sdar.diagnostic.fence": diagnostic.lease.fence,
    "sdar.diagnostic.runId": diagnostic.lease.scope.runId,
    "sdar.diagnostic.caseId": diagnostic.lease.scope.caseId,
    "sdar.diagnostic.caseExecutionId": diagnostic.lease.scope.caseExecutionId,
    "sdar.diagnostic.repetitionId": diagnostic.lease.scope.repetitionId,
    "sdar.diagnostic.logicalInvocationId": diagnostic.lease.logicalInvocationId ?? "",
    "sdar.diagnostic.argumentHash": diagnostic.lease.scope.selector.argumentHash,
    "sdar.diagnostic.taskId": execution.taskId,
    "sdar.diagnostic.externalExecutionId": execution.externalExecutionId,
    "sdar.diagnostic.deviceMissionId": diagnostic.lease.deviceMissionId ?? "",
    "sdar.device.mission_id": diagnostic.lease.deviceMissionId ?? "",
    "sdar.diagnostic.event":
      diagnostic.lease.capabilityId === SMPP_RESPONSE_LOSS_CAPABILITY
        ? "response_lost_after_adapter_success"
        : "provider_business_success",
    ...attributes,
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
function optionalEmergencyMissionId(value: unknown): number | string | undefined {
  return typeof value === "number" || typeof value === "string" ? value : undefined;
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
function intervalDue(previousMs: number, nowMs: number, intervalMs: number): boolean {
  return nowMs < previousMs || nowMs - previousMs >= intervalMs;
}
function bucket(value: number): string {
  return value === 0 ? "zero" : value === 1 ? "one" : value <= 5 ? "few" : "many";
}

import type {
  AdapterBusinessEvent,
  BusinessEventSourceCapability,
} from "../../adapter-protocol/src/index.js";
import type {
  SmppDiagnosticBinding,
  SmppDiagnosticCapabilityId,
  SmppDiagnosticControlResult,
  SmppDiagnosticLease,
  SmppDiagnosticReceipt,
} from "./diagnostics.js";

export type ProviderExecutionState =
  | "ACCEPTED"
  | "STARTING"
  | "RUNNING"
  | "PAUSED"
  | "RESUMING"
  | "WAITING_INPUT"
  | "STOPPING"
  | "SUCCEEDED"
  | "BUSINESS_FAILED"
  | "CANCELLED"
  | "TECHNICAL_FAILED";

export interface ExecutionContextRecord {
  authorizationContextHash: string;
  executionMode: string;
  simulationId: string;
  correlationId: string;
}

export interface ProviderExecution {
  taskId: string;
  externalExecutionId: string;
  operationName: string;
  argumentHash: string;
  /** Public Provider identity that owns the execution and its evidence. */
  providerId?: string;
  resourceId: string;
  tracks: string[];
  arguments: Record<string, unknown>;
  executionContext: ExecutionContextRecord;
  downstreamMissionIds: string[];
  diagnosticBehavior?: {
    capabilityId: SmppDiagnosticCapabilityId;
    leaseId: string;
    fence: string;
    expiresAt: string;
    caseExecutionId: string;
    repetitionId: string;
  };
  /** Source-observation cursors captured before dispatch, used to reject stale task telemetry. */
  observationCursors?: Record<string, string>;
  /** Objective vehicle facts and observation authority captured before physical dispatch. */
  dispatchBaseline?: Record<string, unknown>;
  /** Persisted post-command evidence fence used for pause/resume/cancel confirmation. */
  controlConfirmation?: Record<string, unknown>;
  /** Deadline for the first correlated post-dispatch task observation. */
  startObservationDeadline?: string;
  /** Deadline for the first correlated active task observation. */
  activeObservationDeadline?: string;
  /** Deadline for a correlated terminal task observation after activity begins. */
  terminalObservationDeadline?: string;
  /** Deadline for physical facts required after the first terminal observation. */
  physicalConfirmationDeadline?: string;
  /** Deadline for post-command physical confirmation. */
  controlConfirmationDeadline?: string;
  /** First fresh zero-speed observation in the current uninterrupted stationary window. */
  stationaryCandidateSince?: string;
  /** Latest fresh observation that exceeded the stationary threshold. */
  lastNonStationaryObservedAt?: string;
  /** Distinct fresh zero-speed observations in the current uninterrupted window. */
  consecutiveStationaryObservations?: number;
  /** Last processed field-level speed cursor; prevents polling from recounting one sample. */
  lastStationarySpeedCursor?: string;
  /** Tasks durably preempted by this execution, populated for emergency stop. */
  preemptedTaskIds?: string[];
  /** Emergency-stop task that owns this execution's durable preemption fence. */
  preemptedByTaskId?: string;
  preemptedAt?: string;
  preemptReason?: string;
  selectedDeviceTool?: string;
  providerRevision?: string;
  state: ProviderExecutionState;
  revision: number;
  reasonCode: string;
  progress?: number;
  result?: Record<string, unknown>;
  latestSnapshotRevision?: string;
  createdAt: string;
  updatedAt: string;
  terminalAt?: string;
  evidence: ProviderEvidence[];
}

export interface ProviderEvidence {
  evidenceId: string;
  evidenceType: string;
  observedAt: string;
  subjectRef: string;
  payloadRef: { kind: "structured_content"; jsonPointer: string };
  producer: string[];
}

export interface CommandAckRecord {
  taskId: string;
  command: string;
  commandSequence: string;
  response: Record<string, unknown>;
  createdAt: string;
}

export interface CommandAckClaim {
  claimed: boolean;
  record: CommandAckRecord;
}

export type MutationJournalPhase =
  "PRIMARY" | "FOLLOWUP" | "PAUSE" | "RESUME" | "CANCEL" | "EMERGENCY_STOP" | "CLEANUP";

export type MutationJournalState =
  "INTENT_PERSISTED" | "DISPATCHING" | "ACCEPTED" | "REJECTED" | "UNCERTAIN";

export interface MutationJournalEntry {
  taskId: string;
  stepId: string;
  phase: MutationJournalPhase;
  toolName: string;
  argumentHash: string;
  state: MutationJournalState;
  externalMissionId?: string;
  resultHash?: string;
  intentPersistedAt: string;
  dispatchedAt?: string;
  completedAt?: string;
}

export interface MutationJournalClaim {
  claimed: boolean;
  record: MutationJournalEntry;
}

export interface DeviceToolCallRecord {
  callId: string;
  taskId?: string;
  toolName: string;
  argumentHash: string;
  outcome: "accepted" | "rejected" | "timeout" | "protocol_error";
  durationMs: number;
  occurredAt: string;
}

export interface SnapshotRecord {
  revision: string;
  observedAt: string;
  snapshot: Record<string, unknown>;
}

export interface BusinessEventDraft {
  sourceId: "vehicle.execution" | "vehicle.health";
  scope: "task" | "resource";
  occurredAt: string;
  eventType: string;
  description: string;
  reasonCode: string;
  externalExecutionId?: string;
  resourceRef?: string;
  severityHint: "" | "info" | "warning" | "critical";
  rawPayload: Record<string, unknown>;
  retainUntil: string;
}

export interface ProviderStore {
  initialize(): Promise<void>;
  close(): Promise<void>;
  getExecution(taskId: string): Promise<ProviderExecution | undefined>;
  listActiveExecutions(): Promise<ProviderExecution[]>;
  putExecution(execution: ProviderExecution): Promise<void>;
  getCommandAck(
    taskId: string,
    command: string,
    commandSequence: string,
  ): Promise<CommandAckRecord | undefined>;
  /** Atomically reserve one command identity before dispatching a physical mutation. */
  claimCommandAck(ack: CommandAckRecord): Promise<CommandAckClaim>;
  /**
   * Atomically replace a previously claimed command. When expectedReasonCode is
   * supplied, false means another actor already advanced the durable fence.
   */
  completeCommandAck(ack: CommandAckRecord, expectedReasonCode?: string): Promise<boolean>;
  putCommandAck(ack: CommandAckRecord): Promise<void>;
  getMutationJournalEntry(
    taskId: string,
    stepId: string,
  ): Promise<MutationJournalEntry | undefined>;
  listMutationJournal(taskId: string): Promise<MutationJournalEntry[]>;
  /** Atomically persist one immutable physical-dispatch intent. */
  claimMutationJournal(entry: MutationJournalEntry): Promise<MutationJournalClaim>;
  /** Advance one journal step only while its durable state matches expectedState. */
  advanceMutationJournal(
    entry: MutationJournalEntry,
    expectedState: MutationJournalState,
  ): Promise<boolean>;
  appendDeviceToolCall(record: DeviceToolCallRecord): Promise<void>;
  putSnapshot(record: SnapshotRecord): Promise<void>;
  armDiagnosticLease(
    lease: Omit<SmppDiagnosticLease, "fence">,
    receipt: Omit<SmppDiagnosticReceipt, "state">,
  ): Promise<SmppDiagnosticControlResult>;
  getDiagnosticLease(leaseId: string): Promise<SmppDiagnosticLease | undefined>;
  getDiagnosticStatus(leaseId: string): Promise<SmppDiagnosticControlResult | undefined>;
  disarmDiagnosticLease(
    leaseId: string,
    requestHash: string,
    receiptId: string,
    occurredAt: string,
  ): Promise<SmppDiagnosticControlResult>;
  bindDiagnosticLease(
    binding: SmppDiagnosticBinding,
  ): Promise<SmppDiagnosticControlResult | undefined>;
  consumeDiagnosticLease(
    leaseId: string,
    requestHash: string,
    receiptId: string,
    occurredAt: string,
  ): Promise<SmppDiagnosticControlResult>;
  expireDiagnosticLeases(occurredAt: string): Promise<readonly SmppDiagnosticControlResult[]>;
  appendBusinessEvent(draft: BusinessEventDraft): Promise<AdapterBusinessEvent>;
  replayBusinessEvents(
    sourceId: string,
    sourceStreamId: string,
    afterSourceSequence: bigint,
  ): Promise<AdapterBusinessEvent[]>;
  businessEventSources(): BusinessEventSourceCapability[];
}

export const TERMINAL_EXECUTION_STATES = new Set<ProviderExecutionState>([
  "SUCCEEDED",
  "BUSINESS_FAILED",
  "CANCELLED",
  "TECHNICAL_FAILED",
]);

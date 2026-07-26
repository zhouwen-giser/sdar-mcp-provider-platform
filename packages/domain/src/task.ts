export type ExecutionMode = "live" | "simulation" | "historical-replay";
export type McpTaskStatus = "working" | "input_required" | "completed" | "failed" | "cancelled";
export type InternalTaskState =
  | "SCHEDULED"
  | "STARTING"
  | "WAITING_START_CONFIRMATION"
  | "QUEUED"
  | "RUNNING"
  | "PAUSED"
  | "RESUMING"
  | "INPUT_REQUIRED"
  | "STOPPING"
  | "TERMINAL_COMPLETED"
  | "TERMINAL_FAILED"
  | "TERMINAL_CANCELLED";

export interface AuthorizationContext {
  hash: string;
  executionMode: ExecutionMode;
  simulationId: string | null;
  correlationId?: string;
  traceId?: string;
  rootTraceparent?: string;
  rootTracestate?: string;
}

export interface TaskRecord {
  taskId: string;
  providerId: string;
  operationName: string;
  operationSnapshotId: string;
  authorizationContextHash: string;
  traceId?: string | null;
  rootTraceparent?: string | null;
  rootTracestate?: string | null;
  correlationId?: string | null;
  executionMode: ExecutionMode;
  simulationId: string | null;
  reservationRef: string | null;
  arguments: Record<string, unknown>;
  argumentHash: string;
  externalExecutionId: string | null;
  internalState: InternalTaskState;
  mcpStatus: McpTaskStatus;
  substate: string | null;
  statusMessage: string | null;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  adapterRevision: number;
  observationRevision: number;
  runtimeRevision: string;
  ttlMs: number | null;
  handleExpiresAt: Date | null;
  terminalAt: Date | null;
  expiredAt: Date | null;
  purgeAfter: Date | null;
  lastConfirmedAt: Date | null;
  pollIntervalMs: number;
  createdAt: Date;
  updatedAt: Date;
  runtimeUpdatedAt: Date;
  version: number;
  acceptedAt: Date;
  notBefore: Date | null;
  latestStartAt: Date | null;
  actualStartedAt: Date | null;
  startStopRequestedAt: Date | null;
  startConfirmationDeadline: Date | null;
  startConfirmationAttempts: number;
  invocationAttempt: number;
  nextStartAttemptAt: Date | null;
  scheduleClaimOwner: string | null;
  scheduleClaimUntil: Date | null;
  deadlineAt: Date | null;
  cancelRequested: boolean;
  stopReason: string | null;
  timing: Record<string, unknown>;
  recoveryAttempts: number;
  nextRecoveryAt: Date;
  recoveryFailureCount: number;
  lastReconciledAt: Date | null;
}

export const RESERVED_RESULT_FIELDS = [
  "outcome",
  "reasonCode",
  "retryable",
  "completedAt",
] as const;

export const STANDARD_RESULT_FIELDS = {
  outcome: true,
  reasonCode: true,
  retryable: true,
  completedAt: true,
};

export function sanitizeResultPayload(snapshot: AdapterSnapshotLike): Record<string, unknown> {
  const source = snapshot.result ?? {};
  if (typeof source !== "object" || Array.isArray(source)) {
    return { value: source };
  }
  const filtered: Record<string, unknown> = {};
  const payload = source;
  for (const [key, value] of Object.entries(payload)) {
    if (!STANDARD_RESULT_FIELDS[key as keyof typeof STANDARD_RESULT_FIELDS]) {
      filtered[key] = value;
    }
  }
  return filtered;
}

export interface SnapshotTransition {
  internalState: InternalTaskState;
  mcpStatus: McpTaskStatus;
  substate: string | null;
  statusMessage: string;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  terminal: boolean;
  observationType: string;
}

export interface AdapterSnapshotLike {
  state: string;
  reasonCode: string;
  message: string;
  retryable: boolean;
  result?: Record<string, unknown>;
}

function businessResult(
  snapshot: AdapterSnapshotLike,
  outcome: "success" | "business_failure" | "partial_completion",
  isError: boolean,
): Record<string, unknown> {
  const filtered = sanitizeResultPayload(snapshot);
  return {
    content: [{ type: "text", text: snapshot.message || outcome }],
    isError,
    structuredContent:
      outcome === "success"
        ? filtered
        : {
            outcome,
            reasonCode: snapshot.reasonCode || outcome.toUpperCase(),
            retryable: snapshot.retryable,
            completedAt: new Date().toISOString(),
            ...filtered,
          },
  };
}

export function mapAdapterSnapshot(snapshot: AdapterSnapshotLike): SnapshotTransition {
  switch (snapshot.state) {
    case "ACCEPTED":
      return working("QUEUED", "accepted", snapshot, "task.accepted");
    case "SCHEDULED":
      return working("QUEUED", "scheduled", snapshot, "task.accepted");
    case "QUEUED":
      return working("QUEUED", "queued", snapshot, "task.accepted");
    case "RUNNING":
      return working("RUNNING", "running", snapshot, "task.started");
    case "PAUSED":
      return working("PAUSED", "paused", snapshot, "task.paused");
    case "RESUMING":
      return working("RESUMING", "resuming", snapshot, "task.resumed");
    case "STOPPING":
      return working("STOPPING", "stopping", snapshot, "task.progress");
    case "WAITING_INPUT":
      return {
        internalState: "INPUT_REQUIRED",
        mcpStatus: "input_required",
        substate: null,
        statusMessage: snapshot.message,
        result: null,
        error: null,
        terminal: false,
        observationType: "task.progress",
      };
    case "SUCCEEDED":
      return terminal(
        "TERMINAL_COMPLETED",
        "completed",
        businessResult(snapshot, "success", false),
        null,
        snapshot,
      );
    case "BUSINESS_FAILED":
      return terminal(
        "TERMINAL_COMPLETED",
        "completed",
        businessResult(snapshot, "business_failure", true),
        null,
        snapshot,
      );
    case "PARTIALLY_COMPLETED":
      return terminal(
        "TERMINAL_COMPLETED",
        "completed",
        businessResult(snapshot, "partial_completion", true),
        null,
        snapshot,
      );
    case "CANCELLED":
      return terminal("TERMINAL_CANCELLED", "cancelled", null, null, snapshot);
    case "TECHNICAL_FAILED":
      return terminal(
        "TERMINAL_FAILED",
        "failed",
        null,
        {
          code: -32603,
          message: "Task execution failed.",
          data: {
            reasonCode: snapshot.reasonCode || "TECHNICAL_EXECUTION_FAILED",
            retryable: snapshot.retryable,
          },
        },
        snapshot,
      );
    default:
      throw new Error(`UNKNOWN_ADAPTER_STATE:${snapshot.state}`);
  }
}

function working(
  internalState: InternalTaskState,
  substate: string,
  snapshot: AdapterSnapshotLike,
  observationType: string,
): SnapshotTransition {
  return {
    internalState,
    mcpStatus: "working",
    substate,
    statusMessage: snapshot.message,
    result: null,
    error: null,
    terminal: false,
    observationType,
  };
}

function terminal(
  internalState: InternalTaskState,
  mcpStatus: McpTaskStatus,
  result: Record<string, unknown> | null,
  error: Record<string, unknown> | null,
  snapshot: AdapterSnapshotLike,
): SnapshotTransition {
  return {
    internalState,
    mcpStatus,
    substate: null,
    statusMessage: snapshot.message,
    result,
    error,
    terminal: true,
    observationType: "task.progress",
  };
}

export function isTerminalState(state: InternalTaskState): boolean {
  return state.startsWith("TERMINAL_");
}

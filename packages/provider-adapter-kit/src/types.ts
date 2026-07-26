import type {
  AdapterBusinessEvent,
  BusinessEventSourceCapability,
} from "../../adapter-protocol/src/index.js";

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
  resourceId: string;
  tracks: string[];
  arguments: Record<string, unknown>;
  executionContext: ExecutionContextRecord;
  downstreamMissionIds: string[];
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
  putCommandAck(ack: CommandAckRecord): Promise<void>;
  appendDeviceToolCall(record: DeviceToolCallRecord): Promise<void>;
  putSnapshot(record: SnapshotRecord): Promise<void>;
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

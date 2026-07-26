export const ADAPTER_PROTOCOL_VERSION = "1.0";

export interface RequestMetadata {
  adapterProtocolVersion: string;
  providerId: string;
  correlationId: string;
}

export interface OperationCapabilities {
  availability: boolean;
  scheduling: boolean;
  maxElapsed: boolean;
  cancel: boolean;
  pauseResume: boolean;
  inputRequired: boolean;
  idempotency: boolean;
  observations: boolean;
}

export type OperationExecution = "SYNCHRONOUS" | "TASK_CAPABLE" | "TASK_REQUIRED";

export interface OperationDefinition {
  name: string;
  description: string;
  execution: OperationExecution;
  inputSchema: unknown;
  outputSchema: unknown;
  capabilities: OperationCapabilities;
  resourceBinding?: {
    mode: "NONE" | "ARGUMENT_REFERENCE";
    resourceIdJsonPointer?: string;
  };
}

export interface ProviderManifest {
  adapterProtocolVersion: string;
  providerId: string;
  providerType: string;
  providerVersion: string;
  inventoryMode: "RUNTIME_VISIBLE" | "OPAQUE";
  operations: OperationDefinition[];
  businessEventSources?: BusinessEventSourceCapability[];
}

export type BusinessEventDeliverySemantics = "durable_at_least_once" | "best_effort_live";

export interface BusinessEventSourceCapability {
  sourceId: string;
  sourceStreamId: string;
  deliverySemantics: BusinessEventDeliverySemantics;
  replaySupported: boolean;
  sourceRetentionMs: string;
  maxEventBytes: string;
  maxPayloadDepth: number;
  maxPayloadNodes: number;
  maxPayloadStringBytes: string;
}

export interface StreamBusinessEventsRequest {
  sourceId: string;
  sourceStreamId: string;
  afterSourceSequence?: string;
}

export interface AdapterBusinessEvent {
  sourceEventId: string;
  sourceSequence: string;
  sourceStreamId: string;
  scope: "task" | "resource";
  occurredAt: { seconds?: string; nanos?: number };
  eventType: string;
  description: string;
  externalExecutionId?: string;
  resourceRef?: string;
  severityHint: "" | "info" | "warning" | "critical";
  reasonCode: string;
  rawPayload?: unknown;
}

export interface ExecutionSnapshot {
  taskId: string;
  externalExecutionId: string;
  state: string;
  revision: string | number;
  reasonCode: string;
  message: string;
  retryable: boolean;
  observedAt?: unknown;
  result?: unknown;
  inputRequests?: AdapterInputRequest[];
  mcpInputRequests?: McpTaskInputRequest[];
  evidence?: AdapterEvidenceItem[];
  operationName: string;
  argumentHash: string;
  executionContext?: AdapterExecutionContext;
}

export interface AdapterEvidenceItem {
  evidenceId: string;
  evidenceType: string;
  observedAt: string;
  subjectRef?: string;
  payloadRef?: {
    kind: string;
    jsonPointer?: string;
    uri?: string;
    mediaType?: string;
    sha256?: string;
  };
  producer?: string[];
}

export interface AdapterExecutionContext {
  authorizationContextHash: string;
  executionMode: string;
  simulationId: string;
  correlationId: string;
}

export interface AdapterInputRequest {
  key: string;
  description: string;
  inputSchema: unknown;
  required: boolean;
}

export interface McpTaskInputRequest {
  key: string;
  method: "elicitation/create";
  params: unknown;
}

export interface McpTaskInputResponse {
  key: string;
  result: {
    action: "accept" | "decline" | "cancel";
    content?: unknown;
  };
}

export interface StartOperationResponse {
  result: "accepted" | "rejected";
  accepted?: { externalExecutionId: string; initialSnapshot: ExecutionSnapshot };
  rejected?: { reasonCode: string; message: string; retryable: boolean };
}

export interface AvailabilityCheckInput {
  requestId: string;
  operationName: string;
  arguments?: Record<string, unknown>;
  unresolvedArguments?: {
    knownArguments: Record<string, unknown>;
    unresolvedPaths: string[];
  };
  timing?: Record<string, unknown>;
}

export interface AvailabilityResult {
  requestId: string;
  operationName: string;
  availability: string;
  riskLevel: string;
  reasonCode: string;
  description: string;
  validUntil?: unknown;
  earliestStartTime?: unknown;
  nextAvailableWindows: { startTime?: unknown; endTime?: unknown }[];
  estimatedDelayMs: string | number;
  reservationMode: string;
  reservationRef?: string;
  possibleEffects: string[];
}

export interface CheckAvailabilityResponse {
  profileVersion: string;
  checkedAt?: unknown;
  checks: AvailabilityResult[];
}

export interface ReconcileExecutionResponse {
  status: string;
  snapshot?: ExecutionSnapshot;
  externalExecutionId: string;
  reasonCode: string;
  message: string;
  retryable: boolean;
}

export interface CommandAck {
  accepted: boolean;
  reasonCode: string;
  message: string;
  commandSequence: string | number;
  identity?: {
    taskId: string;
    externalExecutionId: string;
    operationName: string;
    argumentHash: string;
    executionContext?: AdapterExecutionContext;
    commandSequence: string | number;
  };
}

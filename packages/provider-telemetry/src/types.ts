export type ProviderTelemetryEventType =
  "RESOURCE_STATE" | "RESOURCE_METRIC" | "RESOURCE_HEALTH" | "EXECUTION_PROGRESS";

export interface ProviderTimestamp {
  seconds: string | number;
  nanos: number;
}

export interface ProviderTelemetryEventInput {
  providerEventId: string;
  providerEventSequence: string | number;
  eventType: ProviderTelemetryEventType | "PROVIDER_TELEMETRY_EVENT_TYPE_UNSPECIFIED";
  resourceId: string;
  resourceType: string;
  taskId: string;
  externalExecutionId: string;
  operationName: string;
  occurredAt?: ProviderTimestamp | null;
  attributes: Record<string, unknown>;
  payload: Record<string, unknown>;
  traceparent: string;
  tracestate: string;
}

export interface ProviderTelemetryEventResult {
  providerEventId: string;
  accepted: boolean;
  duplicate: boolean;
  recordId: string;
  reasonCode: string;
  message: string;
}

export interface EmitProviderEventsRequest {
  providerId: string;
  events: ProviderTelemetryEventInput[];
}

export interface EmitProviderEventsResponse {
  results: ProviderTelemetryEventResult[];
}

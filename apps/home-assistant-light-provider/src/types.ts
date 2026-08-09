export interface HomeAssistantState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

export interface LightResourceConfig {
  resourceId: string;
  entityId: string;
  displayName: string;
  enabled: boolean;
}

export interface NormalizedLightState {
  resourceId: string;
  power: "on" | "off" | "unknown" | "unavailable";
  reachable: boolean;
  brightnessPercent: number | null;
  supportsBrightness: boolean;
  observedAt: string;
}

export type LightOperation = "light_get_state" | "light_set_power" | "light_set_brightness";

export interface ExecutionContextRecord {
  authorizationContextHash: string;
  executionMode: string;
  simulationId: string;
  correlationId: string;
}

export interface LightExecution {
  taskId: string;
  externalExecutionId: string;
  operationName: Exclude<LightOperation, "light_get_state">;
  resourceId: string;
  entityId: string;
  argumentHash: string;
  executionContext: ExecutionContextRecord;
  desiredState:
    { type: "power"; power: "on" | "off" } | { type: "brightness"; brightnessPercent: number };
  state: "PENDING_SIDE_EFFECT" | "CONFIRMING" | "SUCCEEDED" | "TECHNICAL_FAILED";
  sideEffectDispatched: boolean;
  /**
   * Durable dispatch protocol. Older state files do not contain this field and
   * are therefore reconciled conservatively during recovery.
   */
  dispatchState?: "NOT_STARTED" | "INTENT_PERSISTED" | "CALL_RETURNED";
  failureReasonCode?: string;
  failureRetryable?: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  confirmationDeadlineAt: string;
  confirmedState?: NormalizedLightState;
  lastSnapshot: Record<string, unknown>;
  commandAcks: Record<string, Record<string, unknown>>;
}

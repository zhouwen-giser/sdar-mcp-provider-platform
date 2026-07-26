export interface HomeAssistantState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

export interface ClimateResourceConfig {
  resourceId: string;
  entityId: string;
  displayName: string;
  enabled: boolean;
  temperatureRange: { minimum: number; maximum: number };
  allowedHvacModes: string[];
}

export interface NormalizedClimateState {
  resourceId: string;
  power: "on" | "off" | "unknown" | "unavailable";
  reachable: boolean;
  hvacMode: string | null;
  currentTemperature: number | null;
  targetTemperature: number | null;
  temperatureUnit: string;
  minTemperature: number | null;
  maxTemperature: number | null;
  supportedHvacModes: string[];
  observedAt: string;
}

export type ClimateOperation =
  "climate_get_state" | "climate_set_power" | "climate_set_hvac_mode" | "climate_set_temperature";

export interface ExecutionContextRecord {
  authorizationContextHash: string;
  executionMode: string;
  simulationId: string;
  correlationId: string;
}

export interface ClimateExecution {
  taskId: string;
  externalExecutionId: string;
  operationName: Exclude<ClimateOperation, "climate_get_state">;
  resourceId: string;
  entityId: string;
  argumentHash: string;
  executionContext: ExecutionContextRecord;
  desiredState:
    | { type: "power"; power: "on" | "off" }
    | { type: "hvac_mode"; hvacMode: string }
    | { type: "temperature"; temperature: number };
  state: "PENDING_SIDE_EFFECT" | "CONFIRMING" | "SUCCEEDED" | "TECHNICAL_FAILED";
  sideEffectDispatched: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  confirmationDeadlineAt: string;
  confirmedState?: NormalizedClimateState;
  lastSnapshot: Record<string, unknown>;
  commandAcks: Record<string, Record<string, unknown>>;
}

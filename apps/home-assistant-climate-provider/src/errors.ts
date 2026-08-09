export type ClimateReasonCode =
  | "HOME_ASSISTANT_UNAUTHORIZED"
  | "HOME_ASSISTANT_FORBIDDEN"
  | "HOME_ASSISTANT_NOT_FOUND"
  | "HOME_ASSISTANT_BAD_REQUEST"
  | "HOME_ASSISTANT_UNAVAILABLE"
  | "HOME_ASSISTANT_TIMEOUT"
  | "HOME_ASSISTANT_PROTOCOL_ERROR"
  | "HOME_ASSISTANT_STATE_CONFIRMATION_TIMEOUT"
  | "RESOURCE_NOT_CONFIGURED"
  | "RESOURCE_DISABLED"
  | "HVAC_MODE_NOT_ALLOWED"
  | "HVAC_MODE_NOT_SUPPORTED"
  | "TEMPERATURE_OUT_OF_RANGE"
  | "RESOURCE_UNAVAILABLE"
  | "REAL_DEVICE_SIDE_EFFECTS_GATE_CLOSED"
  | "CLIMATE_POWER_SIDE_EFFECTS_GATE_CLOSED"
  | "CLIMATE_OPPOSITE_POWER_INTERVAL_ACTIVE"
  | "EXECUTION_MODE_NOT_LIVE"
  | "RECOVERY_RESOURCE_NOT_ALLOWLISTED"
  | "SIDE_EFFECT_STATE_UNCERTAIN"
  | "TASK_IDENTITY_CONFLICT";

export class ClimateProviderError extends Error {
  override readonly name = "ClimateProviderError";
  constructor(
    readonly reasonCode: ClimateReasonCode,
    readonly retryable: boolean,
  ) {
    super(reasonCode);
  }
}

export function safeClimateError(error: unknown): ClimateProviderError {
  if (error instanceof ClimateProviderError) return error;
  if (error instanceof DOMException && error.name === "AbortError")
    return new ClimateProviderError("HOME_ASSISTANT_TIMEOUT", true);
  return new ClimateProviderError("HOME_ASSISTANT_UNAVAILABLE", true);
}

export type LightReasonCode =
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
  | "RESOURCE_UNAVAILABLE"
  | "BRIGHTNESS_NOT_SUPPORTED"
  | "BRIGHTNESS_OUT_OF_RANGE"
  | "REAL_DEVICE_SIDE_EFFECTS_GATE_CLOSED"
  | "EXECUTION_MODE_NOT_LIVE"
  | "RECOVERY_RESOURCE_NOT_ALLOWLISTED"
  | "SIDE_EFFECT_STATE_UNCERTAIN"
  | "TASK_IDENTITY_CONFLICT";

export class LightProviderError extends Error {
  override readonly name = "LightProviderError";
  constructor(
    readonly reasonCode: LightReasonCode,
    readonly retryable: boolean,
  ) {
    super(reasonCode);
  }
}

export function safeLightError(error: unknown): LightProviderError {
  if (error instanceof LightProviderError) return error;
  if (error instanceof DOMException && error.name === "AbortError")
    return new LightProviderError("HOME_ASSISTANT_TIMEOUT", true);
  return new LightProviderError("HOME_ASSISTANT_UNAVAILABLE", true);
}

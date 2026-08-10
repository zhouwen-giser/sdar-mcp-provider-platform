export class DeviceToolRejectedError extends Error {
  readonly code: string;
  constructor(
    readonly errorPrefix: string,
    readonly toolName: string,
    readonly deviceErrorCode?: number,
    readonly result?: Record<string, unknown>,
  ) {
    const code = `${errorPrefix}_DEVICE_TOOL_REJECTED`;
    super(code);
    this.name = "DeviceToolRejectedError";
    this.code = code;
  }
}

export class DeviceToolProtocolError extends Error {
  readonly code: string;
  constructor(
    readonly errorPrefix: string,
    readonly toolName: string,
    suffix = "DEVICE_TOOL_RESULT_INVALID",
    options?: ErrorOptions,
  ) {
    const code = `${errorPrefix}_${suffix}`;
    super(code, options);
    this.name = "DeviceToolProtocolError";
    this.code = code;
  }
}

/**
 * The request was dispatched, but a timeout/transport loss made acceptance
 * unknowable. Callers must persist uncertainty and reconcile observations;
 * they must not replay the mutation automatically.
 */
export class UncertainMutatingDeviceCallError extends Error {
  readonly code: string;
  constructor(
    readonly errorPrefix: string,
    readonly toolName: string,
    options?: ErrorOptions,
  ) {
    const code = `${errorPrefix}_DEVICE_MUTATING_CALL_UNCERTAIN`;
    super(code, options);
    this.name = "UncertainMutatingDeviceCallError";
    this.code = code;
  }
}

export class DeviceToolCircuitOpenError extends Error {
  readonly code: string;
  constructor(
    readonly errorPrefix: string,
    readonly toolName: string,
  ) {
    const code = `${errorPrefix}_DEVICE_TOOL_CIRCUIT_OPEN`;
    super(code);
    this.name = "DeviceToolCircuitOpenError";
    this.code = code;
  }
}

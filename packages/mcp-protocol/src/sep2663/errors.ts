export const FrozenErrorCode = {
  HeaderMismatch: -32001,
  MissingRequiredClientCapability: -32003,
  UnsupportedProtocolVersion: -32004,
  InvalidParams: -32602,
  MethodNotFound: -32601,
  InternalError: -32603,
} as const;

export class FrozenProtocolError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly httpStatus: number,
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "FrozenProtocolError";
  }
}

export function frozenErrorResponse(
  id: string | number | null,
  error: FrozenProtocolError,
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: error.code,
      message: error.message,
      ...(error.data === undefined ? {} : { data: error.data }),
    },
  };
}

export function invalidParams(message = "Invalid Params"): FrozenProtocolError {
  return new FrozenProtocolError(FrozenErrorCode.InvalidParams, message, 400);
}

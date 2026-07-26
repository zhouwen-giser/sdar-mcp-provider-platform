import type { RuntimeError } from "../../../domain/src/index.js";
import { isRuntimeError } from "../../../domain/src/index.js";
import { FrozenErrorCode, FrozenProtocolError } from "./errors.js";

const requestErrorKinds = new Set<RuntimeError["kind"]>([
  "invalid_params",
  "task_not_found",
  "task_expired",
  "capability_not_supported",
  "command_in_progress",
]);

export function mapFrozenRuntimeError(error: unknown): FrozenProtocolError {
  if (error instanceof FrozenProtocolError) return error;
  if (!isRuntimeError(error)) {
    return new FrozenProtocolError(FrozenErrorCode.InternalError, "Internal error", 500);
  }
  if (requestErrorKinds.has(error.kind)) {
    return new FrozenProtocolError(FrozenErrorCode.InvalidParams, error.safeMessage, 400, {
      reasonCode: error.reasonCode,
    });
  }
  if (error.kind === "adapter_transient") {
    return new FrozenProtocolError(FrozenErrorCode.InternalError, error.safeMessage, 500, {
      reasonCode: "ADAPTER_TRANSIENT_UNAVAILABLE",
      retryable: true,
    });
  }
  if (error.kind === "adapter_contract" || error.kind === "technical_execution") {
    return new FrozenProtocolError(FrozenErrorCode.InternalError, error.safeMessage, 500, {
      reasonCode: error.reasonCode,
    });
  }
  return new FrozenProtocolError(FrozenErrorCode.InternalError, "Internal error", 500, {
    reasonCode: "BUSINESS_ERROR_CHANNEL_VIOLATION",
  });
}

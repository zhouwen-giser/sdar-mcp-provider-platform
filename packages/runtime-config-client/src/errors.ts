import type { RuntimeConfigClientErrorCode } from "./model.js";

export class RuntimeConfigClientError extends Error {
  readonly code: RuntimeConfigClientErrorCode;
  readonly retryable: boolean;

  constructor(
    code: RuntimeConfigClientErrorCode,
    message: string,
    retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RuntimeConfigClientError";
    this.code = code;
    this.retryable = retryable;
  }
}

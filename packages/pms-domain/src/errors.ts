export type PmsDomainErrorCode =
  | "INVALID_IDENTIFIER"
  | "INVALID_DOMAIN_VALUE"
  | "INVALID_STATE_TRANSITION"
  | "DUPLICATE_RESOURCE_BINDING"
  | "RESOURCE_BINDING_NOT_FOUND";

export class PmsDomainError extends Error {
  readonly code: PmsDomainErrorCode;
  readonly details: Readonly<Record<string, string>>;

  constructor(
    code: PmsDomainErrorCode,
    message: string,
    details: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = "PmsDomainError";
    this.code = code;
    this.details = details;
  }
}

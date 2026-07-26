export type PmsRepositoryErrorCode =
  | "ENTITY_ALREADY_EXISTS"
  | "ENTITY_NOT_FOUND"
  | "OPTIMISTIC_CONCURRENCY_CONFLICT"
  | "LEASE_NOT_OWNED";

export class PmsRepositoryError extends Error {
  readonly code: PmsRepositoryErrorCode;
  readonly details: Readonly<Record<string, string | number | null>>;

  constructor(
    code: PmsRepositoryErrorCode,
    message: string,
    details: Readonly<Record<string, string | number | null>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PmsRepositoryError";
    this.code = code;
    this.details = details;
  }
}

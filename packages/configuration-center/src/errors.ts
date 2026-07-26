export type ConfigurationCenterErrorCode =
  | "CONFIGURATION_DEFINITION_NOT_FOUND"
  | "CONFIGURATION_TARGET_NOT_ALLOWED"
  | "CONFIGURATION_BUSINESS_KEY_CONFLICT"
  | "CONFIGURATION_DRAFT_NOT_FOUND"
  | "CONFIGURATION_DRAFT_VERSION_CONFLICT"
  | "CONFIGURATION_DRAFT_NOT_VALIDATED"
  | "CONFIGURATION_PUBLISH_CONFLICT"
  | "CONFIGURATION_REVISION_NOT_FOUND"
  | "CONFIGURATION_ROLLBACK_TARGET_MISMATCH"
  | "CONFIGURATION_INPUT_INVALID";

export class ConfigurationCenterError extends Error {
  readonly code: ConfigurationCenterErrorCode;
  readonly details: Readonly<Record<string, string>>;

  constructor(
    code: ConfigurationCenterErrorCode,
    message: string,
    details: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = "ConfigurationCenterError";
    this.code = code;
    this.details = details;
  }
}

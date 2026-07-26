export type RuntimeDeploymentErrorCode =
  | "INVALID_RUNTIME_DEPLOYMENT_IDENTIFIER"
  | "INVALID_RUNTIME_DEPLOYMENT_SPEC"
  | "INVALID_RUNTIME_DEPLOYMENT_TRANSITION"
  | "RUNTIME_DEPLOYMENT_STATE_CONFLICT"
  | "RUNTIME_DEPLOYMENT_REVISION_CONFLICT";

export type RuntimeDeploymentErrorDetail = string | number | boolean | null;

export class RuntimeDeploymentError extends Error {
  readonly code: RuntimeDeploymentErrorCode;
  readonly details: Readonly<Record<string, RuntimeDeploymentErrorDetail>>;

  constructor(
    code: RuntimeDeploymentErrorCode,
    message: string,
    details: Readonly<Record<string, RuntimeDeploymentErrorDetail>> = {},
  ) {
    super(message);
    this.name = "RuntimeDeploymentError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

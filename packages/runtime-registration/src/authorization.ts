import type { ExpectedRuntimeInstance } from "./model.js";

export type RuntimeRegistrationScope = "runtime:register" | "runtime:heartbeat";

export interface RuntimeRegistrationCredentials {
  readonly authorization?: string;
}

export interface RuntimeRegistrationPrincipal extends ExpectedRuntimeInstance {
  readonly subjectId: string;
  readonly scopes: readonly RuntimeRegistrationScope[];
}

export interface RuntimeRegistrationAuthorizer {
  authorize(
    credentials: RuntimeRegistrationCredentials,
    target: Pick<ExpectedRuntimeInstance, "deploymentId" | "instanceId">,
    requiredScope: RuntimeRegistrationScope,
  ): Promise<RuntimeRegistrationPrincipal>;
}

export type RuntimeRegistrationAuthorizationErrorCode =
  "RUNTIME_REGISTRATION_UNAUTHORIZED" | "RUNTIME_REGISTRATION_FORBIDDEN";

export class RuntimeRegistrationAuthorizationError extends Error {
  constructor(readonly code: RuntimeRegistrationAuthorizationErrorCode) {
    super(code);
    this.name = "RuntimeRegistrationAuthorizationError";
  }
}

export class DenyRuntimeRegistrationAuthorizer implements RuntimeRegistrationAuthorizer {
  authorize(): Promise<RuntimeRegistrationPrincipal> {
    return Promise.reject(
      new RuntimeRegistrationAuthorizationError("RUNTIME_REGISTRATION_UNAUTHORIZED"),
    );
  }
}

export function assertRuntimeRegistrationPrincipal(
  principal: RuntimeRegistrationPrincipal,
  target: ExpectedRuntimeInstance,
  requiredScope: RuntimeRegistrationScope,
): void {
  if (
    principal.subjectId.trim().length === 0 ||
    !principal.scopes.includes(requiredScope) ||
    principal.providerId !== target.providerId ||
    principal.deploymentId !== target.deploymentId ||
    principal.instanceId !== target.instanceId ||
    principal.runtimeVersion !== target.runtimeVersion ||
    principal.protocolVersion !== target.protocolVersion
  ) {
    throw new RuntimeRegistrationAuthorizationError("RUNTIME_REGISTRATION_FORBIDDEN");
  }
}

import {
  acceptRuntimeHeartbeat,
  registerRuntime,
  RuntimeRegistrationError,
  type ExpectedRuntimeInstance,
  type RuntimeHeartbeatRequest,
  type RuntimeRegistrationMutation,
  type RuntimeRegistrationRequest,
  type RuntimeRegistrationSnapshot,
} from "./model.js";

export interface ExpectedRuntimeInstancePort {
  getExpected(input: {
    readonly providerId: string;
    readonly deploymentId: string;
    readonly instanceId: string;
  }): Promise<ExpectedRuntimeInstance | null>;
}

export interface RuntimeRegistrationStatePort {
  get(instanceId: string): Promise<RuntimeRegistrationSnapshot | null>;
  save(registration: RuntimeRegistrationSnapshot, expectedRevision: number | null): Promise<void>;
}

export interface RuntimeRegistrationAuditEvent {
  readonly action: "runtime.register" | "runtime.heartbeat";
  readonly outcome: "created" | "updated" | "unchanged" | "rejected";
  readonly providerId: string;
  readonly deploymentId: string;
  readonly instanceId: string;
  readonly subjectId: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly reasonCode?: string;
  readonly revision?: number;
}

export interface RuntimeRegistrationAuditPort {
  append(event: RuntimeRegistrationAuditEvent): Promise<void>;
}

export interface RuntimeRegistrationCommandContext {
  readonly subjectId: string;
  readonly requestId: string;
  readonly correlationId: string;
}

export interface RuntimeRegistrationServiceOptions {
  readonly heartbeatTtlMs?: number;
  readonly now?: () => Date;
}

export class RuntimeRegistrationService {
  readonly #heartbeatTtlMs: number;
  readonly #now: () => Date;

  constructor(
    private readonly expectedInstances: ExpectedRuntimeInstancePort,
    private readonly registrations: RuntimeRegistrationStatePort,
    private readonly audit: RuntimeRegistrationAuditPort,
    options: RuntimeRegistrationServiceOptions = {},
  ) {
    this.#heartbeatTtlMs = options.heartbeatTtlMs ?? 30_000;
    if (
      !Number.isSafeInteger(this.#heartbeatTtlMs) ||
      this.#heartbeatTtlMs < 1_000 ||
      this.#heartbeatTtlMs > 300_000
    ) {
      throw new TypeError("RUNTIME_REGISTRATION_HEARTBEAT_TTL_INVALID");
    }
    this.#now = options.now ?? (() => new Date());
  }

  register(
    request: RuntimeRegistrationRequest,
    context: RuntimeRegistrationCommandContext,
  ): Promise<RuntimeRegistrationMutation> {
    return this.execute("runtime.register", request, context, (expected, current) =>
      registerRuntime(expected, current, request, this.#now(), this.#heartbeatTtlMs),
    );
  }

  heartbeat(
    request: RuntimeHeartbeatRequest,
    context: RuntimeRegistrationCommandContext,
  ): Promise<RuntimeRegistrationMutation> {
    return this.execute("runtime.heartbeat", request, context, (expected, current) =>
      acceptRuntimeHeartbeat(expected, current, request, this.#now(), this.#heartbeatTtlMs),
    );
  }

  private async execute(
    action: RuntimeRegistrationAuditEvent["action"],
    request: RuntimeRegistrationRequest,
    context: RuntimeRegistrationCommandContext,
    mutate: (
      expected: ExpectedRuntimeInstance | null,
      current: RuntimeRegistrationSnapshot | null,
    ) => RuntimeRegistrationMutation,
  ): Promise<RuntimeRegistrationMutation> {
    validateContext(context);
    try {
      const expected = await this.expectedInstances.getExpected({
        providerId: request.providerId,
        deploymentId: request.deploymentId,
        instanceId: request.instanceId,
      });
      const current = await this.registrations.get(request.instanceId);
      const result = mutate(expected, current);
      if (result.outcome !== "unchanged") {
        await this.registrations.save(result.registration, current?.revision ?? null);
      }
      await this.audit.append({
        action,
        outcome: result.outcome,
        providerId: request.providerId,
        deploymentId: request.deploymentId,
        instanceId: request.instanceId,
        subjectId: context.subjectId,
        requestId: context.requestId,
        correlationId: context.correlationId,
        revision: result.registration.revision,
      });
      return result;
    } catch (error) {
      await this.audit
        .append({
          action,
          outcome: "rejected",
          providerId: request.providerId,
          deploymentId: request.deploymentId,
          instanceId: request.instanceId,
          subjectId: context.subjectId,
          requestId: context.requestId,
          correlationId: context.correlationId,
          reasonCode:
            error instanceof RuntimeRegistrationError
              ? error.code
              : "RUNTIME_REGISTRATION_OPERATION_FAILED",
        })
        .catch(() => undefined);
      throw error;
    }
  }
}

function validateContext(context: RuntimeRegistrationCommandContext): void {
  const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  if (
    !identifier.test(context.subjectId) ||
    !identifier.test(context.requestId) ||
    !identifier.test(context.correlationId)
  ) {
    throw new RuntimeRegistrationError("RUNTIME_REGISTRATION_INVALID_REQUEST", "context");
  }
}

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
import type {
  ExpectedRuntimeInstancePort,
  RuntimeRegistrationAuditEvent,
  RuntimeRegistrationAuditPort,
  RuntimeRegistrationProcessState,
  RuntimeRegistrationTransactionScope,
  RuntimeRegistrationUnitOfWork,
} from "./unit-of-work.js";

export type {
  ExpectedRuntimeInstancePort,
  RuntimeRegistrationAuditEvent,
  RuntimeRegistrationAuditPort,
  RuntimeRegistrationStatePort,
} from "./unit-of-work.js";

export interface LegacyRuntimeRegistrationStatePort {
  get(instanceId: string): Promise<RuntimeRegistrationSnapshot | null>;
  save(registration: RuntimeRegistrationSnapshot, expectedRevision: number | null): Promise<void>;
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

/**
 * Applies registration changes through one unit of work. The legacy constructor
 * remains only for route contract tests that intentionally do not compose a
 * production database; production callers must provide RuntimeRegistrationUnitOfWork.
 */
export class RuntimeRegistrationService {
  readonly #heartbeatTtlMs: number;
  readonly #now: () => Date;
  readonly #unitOfWork: RuntimeRegistrationUnitOfWork;
  readonly #legacyCompatibility: boolean;

  constructor(
    unitOfWork: RuntimeRegistrationUnitOfWork,
    options?: RuntimeRegistrationServiceOptions,
  );
  constructor(
    expectedInstances: ExpectedRuntimeInstancePort,
    registrations: LegacyRuntimeRegistrationStatePort,
    audit: RuntimeRegistrationAuditPort,
    options?: RuntimeRegistrationServiceOptions,
  );
  constructor(
    unitOfWorkOrExpected: RuntimeRegistrationUnitOfWork | ExpectedRuntimeInstancePort,
    optionsOrRegistrations:
      RuntimeRegistrationServiceOptions | LegacyRuntimeRegistrationStatePort = {},
    legacyAudit?: RuntimeRegistrationAuditPort,
    legacyOptions: RuntimeRegistrationServiceOptions = {},
  ) {
    const isUnitOfWork = "transaction" in unitOfWorkOrExpected;
    this.#legacyCompatibility = !isUnitOfWork;
    this.#unitOfWork = isUnitOfWork
      ? unitOfWorkOrExpected
      : legacyUnitOfWork(
          unitOfWorkOrExpected,
          optionsOrRegistrations as LegacyRuntimeRegistrationStatePort,
          requiredLegacyAudit(legacyAudit),
        );
    const options = isUnitOfWork
      ? (optionsOrRegistrations as RuntimeRegistrationServiceOptions)
      : legacyOptions;
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
    return this.execute("runtime.register", request, context, (expected, current, receivedAt) =>
      registerRuntime(expected, current, request, receivedAt, this.#heartbeatTtlMs),
    );
  }

  heartbeat(
    request: RuntimeHeartbeatRequest,
    context: RuntimeRegistrationCommandContext,
  ): Promise<RuntimeRegistrationMutation> {
    return this.execute("runtime.heartbeat", request, context, (expected, current, receivedAt) =>
      acceptRuntimeHeartbeat(expected, current, request, receivedAt, this.#heartbeatTtlMs),
    );
  }

  private async execute(
    action: RuntimeRegistrationAuditEvent["action"],
    request: RuntimeRegistrationRequest,
    context: RuntimeRegistrationCommandContext,
    mutate: (
      expected: ExpectedRuntimeInstance | null,
      current: RuntimeRegistrationSnapshot | null,
      receivedAt: Date,
    ) => RuntimeRegistrationMutation,
  ): Promise<RuntimeRegistrationMutation> {
    validateContext(context);
    const scope: RuntimeRegistrationTransactionScope = {
      providerId: request.providerId,
      deploymentId: request.deploymentId,
      instanceId: request.instanceId,
    };
    const receivedAt = this.#now();

    try {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          return await this.#unitOfWork.transaction(async (repositories) => {
            // The read order is intentional: expected instance, process, then registration.
            const expected = await repositories.expectedInstances.getExpected(scope);
            const process = await repositories.processes.get(scope);
            const current = await repositories.registrations.get(scope);
            if (process === null) {
              return mutate(null, current, receivedAt);
            }
            const result = mutate(expected, current, receivedAt);
            if (result.outcome === "unchanged") {
              if (this.#legacyCompatibility) {
                await repositories.audit.append({
                  ...successAudit(action, request, context, result),
                  // The historic in-memory route fixture asserted this audit.
                  // PostgreSQL UoW callers do not write an audit for a no-op.
                  outcome: "unchanged",
                });
              }
              return result;
            }

            if (current === null) {
              try {
                await repositories.registrations.insert(scope, result.registration);
              } catch (error) {
                throw registrationConflict(error);
              }
            } else {
              try {
                await repositories.registrations.update(
                  scope,
                  current.revision,
                  result.registration,
                );
              } catch (error) {
                throw registrationConflict(error);
              }
            }

            try {
              await repositories.registrations.updateRegistrationProjection(
                scope,
                process.observedRevision,
                Object.freeze({
                  registrationState: "registered",
                  readinessState: result.registration.readinessState,
                  lastHeartbeatAt: result.registration.lastHeartbeatAt,
                  runtimeVersion: result.registration.runtimeVersion,
                  configRevision: result.registration.configRevision,
                  observedRevision: process.observedRevision + 1,
                }),
              );
            } catch (error) {
              throw projectionConflict(error);
            }

            await repositories.audit.append(successAudit(action, request, context, result));
            return result;
          });
        } catch (error) {
          if (isProjectionConflict(error) && attempt < 3) continue;
          throw error;
        }
      }
      throw new RuntimeRegistrationError("RUNTIME_REGISTRATION_PROJECTION_CONFLICT");
    } catch (error) {
      if (error instanceof RuntimeRegistrationError) {
        await this.appendRejection(action, request, context, error.code);
      }
      throw error;
    }
  }

  private async appendRejection(
    action: RuntimeRegistrationAuditEvent["action"],
    request: RuntimeRegistrationRequest,
    context: RuntimeRegistrationCommandContext,
    reasonCode: string,
  ): Promise<void> {
    await this.#unitOfWork
      .transaction((repositories) =>
        repositories.audit.append({
          action,
          outcome: "rejected",
          providerId: request.providerId,
          deploymentId: request.deploymentId,
          instanceId: request.instanceId,
          subjectId: context.subjectId,
          requestId: context.requestId,
          correlationId: context.correlationId,
          reasonCode,
        }),
      )
      .catch(() => undefined);
  }
}

function successAudit(
  action: RuntimeRegistrationAuditEvent["action"],
  request: RuntimeRegistrationRequest,
  context: RuntimeRegistrationCommandContext,
  result: RuntimeRegistrationMutation,
): RuntimeRegistrationAuditEvent {
  return Object.freeze({
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
}

function registrationConflict(error: unknown): RuntimeRegistrationError {
  if (repositoryConflict(error)) {
    return new RuntimeRegistrationError("RUNTIME_REGISTRATION_REPLAY_CONFLICT");
  }
  throw error;
}

function projectionConflict(error: unknown): RuntimeRegistrationError {
  if (repositoryConflict(error)) {
    return new RuntimeRegistrationError("RUNTIME_REGISTRATION_PROJECTION_CONFLICT");
  }
  throw error;
}

function repositoryConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { readonly code?: unknown }).code === "OPTIMISTIC_CONCURRENCY_CONFLICT" ||
      (error as { readonly code?: unknown }).code === "ENTITY_ALREADY_EXISTS")
  );
}

function isProjectionConflict(error: unknown): boolean {
  return (
    error instanceof RuntimeRegistrationError &&
    error.code === "RUNTIME_REGISTRATION_PROJECTION_CONFLICT"
  );
}

function requiredLegacyAudit(
  value: RuntimeRegistrationAuditPort | undefined,
): RuntimeRegistrationAuditPort {
  if (value === undefined) throw new TypeError("RUNTIME_REGISTRATION_AUDIT_REQUIRED");
  return value;
}

function legacyUnitOfWork(
  expectedInstances: ExpectedRuntimeInstancePort,
  registrations: LegacyRuntimeRegistrationStatePort,
  audit: RuntimeRegistrationAuditPort,
): RuntimeRegistrationUnitOfWork {
  let observedRevision = 0;
  return {
    transaction(work) {
      return work({
        expectedInstances,
        processes: {
          async get(scope): Promise<RuntimeRegistrationProcessState | null> {
            const expected = await expectedInstances.getExpected(scope);
            return expected === null ? null : { ...scope, observedRevision };
          },
        },
        registrations: {
          get(scope) {
            return registrations.get(scope.instanceId);
          },
          async insert(_scope, registration) {
            await registrations.save(registration, null);
          },
          async update(_scope, expectedRevision, registration) {
            await registrations.save(registration, expectedRevision);
          },
          updateRegistrationProjection(_scope, expectedRevision, patch) {
            if (expectedRevision !== observedRevision) {
              return Promise.reject(
                new RuntimeRegistrationError("RUNTIME_REGISTRATION_PROJECTION_CONFLICT"),
              );
            }
            observedRevision = patch.observedRevision;
            return Promise.resolve();
          },
        },
        audit,
      });
    },
  };
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

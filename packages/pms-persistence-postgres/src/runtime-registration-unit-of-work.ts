import type { Pool, PoolClient } from "pg";
import type {
  RuntimeRegistrationRepositories,
  RuntimeRegistrationSnapshot,
  RuntimeRegistrationTransactionScope,
  RuntimeRegistrationUnitOfWork,
} from "../../runtime-registration/src/index.js";
import { PostgresAuditRepository } from "./audit-job-repositories.js";
import { PostgresRuntimeRegistrationAudit } from "./runtime-registration-audit.js";
import {
  PostgresRuntimeRegistrationRepository,
  type RuntimeRegistrationProjectionPatch,
  type RuntimeRegistrationRecordValue,
} from "./runtime-registration-repository.js";
import type { PmsSqlClient } from "./shared.js";

export interface PostgresRuntimeRegistrationUnitOfWorkOptions {
  /** Protocol support is deployment configuration, not a request-derived value. */
  readonly protocolVersion: string;
  readonly now?: () => Date;
}

export class PostgresRuntimeRegistrationUnitOfWork implements RuntimeRegistrationUnitOfWork {
  readonly #protocolVersion: string;
  readonly #now: () => Date;

  constructor(
    private readonly pool: Pool,
    options: PostgresRuntimeRegistrationUnitOfWorkOptions,
  ) {
    if (options.protocolVersion.trim().length === 0) {
      throw new TypeError("RUNTIME_REGISTRATION_PROTOCOL_VERSION_REQUIRED");
    }
    this.#protocolVersion = options.protocolVersion;
    this.#now = options.now ?? (() => new Date());
  }

  async transaction<T>(
    work: (repositories: RuntimeRegistrationRepositories) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(
        runtimeRegistrationRepositories(client, this.#protocolVersion, this.#now),
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export function runtimeRegistrationRepositories(
  client: PoolClient | PmsSqlClient,
  protocolVersion: string,
  now: () => Date = () => new Date(),
): RuntimeRegistrationRepositories {
  const registrations = new PostgresRuntimeRegistrationRepository(client);
  const repositories: RuntimeRegistrationRepositories = {
    expectedInstances: {
      getExpected(scope: RuntimeRegistrationTransactionScope) {
        return registrations.getExpectedRuntimeInstance(
          scope.providerId,
          scope.deploymentId,
          scope.instanceId,
          protocolVersion,
        );
      },
    },
    processes: {
      get(scope: RuntimeRegistrationTransactionScope) {
        return registrations.getProcessForRegistration(
          scope.providerId,
          scope.deploymentId,
          scope.instanceId,
        );
      },
    },
    registrations: {
      async get(scope: RuntimeRegistrationTransactionScope) {
        const value = await registrations.getForUpdate(
          scope.providerId,
          scope.deploymentId,
          scope.instanceId,
        );
        return value === null ? null : registrationSnapshot(value);
      },
      insert(scope: RuntimeRegistrationTransactionScope, value: RuntimeRegistrationSnapshot) {
        return registrations.insert(scope.providerId, scope.deploymentId, record(value));
      },
      update(
        scope: RuntimeRegistrationTransactionScope,
        expectedRevision: number,
        value: RuntimeRegistrationSnapshot,
      ) {
        return registrations.update(
          scope.providerId,
          scope.deploymentId,
          scope.instanceId,
          expectedRevision,
          record(value),
        );
      },
      updateRegistrationProjection(
        scope: RuntimeRegistrationTransactionScope,
        expectedObservedRevision: number,
        patch: Parameters<
          RuntimeRegistrationRepositories["registrations"]["updateRegistrationProjection"]
        >[2],
      ) {
        return registrations.updateRegistrationProjection(
          scope.providerId,
          scope.deploymentId,
          scope.instanceId,
          expectedObservedRevision,
          projectionPatch(patch),
        );
      },
    },
    audit: new PostgresRuntimeRegistrationAudit(new PostgresAuditRepository(client), now),
  };
  return Object.freeze(repositories);
}

function record(value: {
  readonly instanceId: string;
  readonly sessionId: string;
  readonly protocolVersion: string;
  readonly heartbeatSequence: number;
  readonly registeredAt: Date;
  readonly lastHeartbeatAt: Date;
  readonly expiresAt: Date;
  readonly revision: number;
}): RuntimeRegistrationRecordValue {
  return Object.freeze({
    runtimeInstanceId: value.instanceId,
    sessionId: value.sessionId,
    protocolVersion: value.protocolVersion,
    heartbeatSequence: value.heartbeatSequence,
    registeredAt: value.registeredAt,
    lastHeartbeatAt: value.lastHeartbeatAt,
    expiresAt: value.expiresAt,
    revision: value.revision,
  });
}

function projectionPatch(value: {
  readonly registrationState: "registered";
  readonly readinessState: "ready" | "not_ready";
  readonly lastHeartbeatAt: Date;
  readonly runtimeVersion: string;
  readonly configRevision: number;
  readonly observedRevision: number;
}): RuntimeRegistrationProjectionPatch {
  return value;
}

function registrationSnapshot(value: {
  readonly providerId: string;
  readonly deploymentId: string;
  readonly instanceId: string;
  readonly sessionId: string;
  readonly runtimeVersion: string;
  readonly protocolVersion: string;
  readonly configRevision: number;
  readonly readinessState: "ready" | "not_ready" | "unknown";
  readonly heartbeatSequence: number;
  readonly registeredAt: Date;
  readonly lastHeartbeatAt: Date;
  readonly expiresAt: Date;
  readonly revision: number;
}): RuntimeRegistrationSnapshot {
  if (value.readinessState === "unknown") {
    throw new Error("RUNTIME_REGISTRATION_SNAPSHOT_READINESS_INVALID");
  }
  return Object.freeze({ ...value, readinessState: value.readinessState });
}

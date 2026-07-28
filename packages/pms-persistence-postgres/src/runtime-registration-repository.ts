import type { QueryResultRow } from "pg";
import {
  type PmsSqlClient,
  concurrencyConflict,
  isDatabaseError,
  mapWriteError,
} from "./shared.js";
import { PmsRepositoryError } from "../../pms-domain/src/ports/errors.js";
import type { RuntimeProcessProjection } from "../../runtime-deployment/src/process.js";

type ReadyState = RuntimeProcessProjection["readinessState"];
type RegistrationState = RuntimeProcessProjection["registrationState"];

export interface RuntimeRegistrationRecordValue {
  readonly runtimeInstanceId: string;
  readonly sessionId: string;
  readonly protocolVersion: string;
  readonly heartbeatSequence: number;
  readonly registeredAt: Date;
  readonly lastHeartbeatAt: Date;
  readonly expiresAt: Date;
  readonly revision: number;
}

export interface RuntimeRegistrationSnapshot {
  readonly providerId: string;
  readonly deploymentId: string;
  readonly instanceId: string;
  readonly sessionId: string;
  readonly runtimeVersion: string;
  readonly protocolVersion: string;
  readonly configRevision: number;
  readonly readinessState: ReadyState;
  readonly heartbeatSequence: number;
  readonly registeredAt: Date;
  readonly lastHeartbeatAt: Date;
  readonly expiresAt: Date;
  readonly revision: number;
}

export interface RuntimeRegistrationProjectionPatch {
  readonly registrationState: RegistrationState;
  readonly readinessState: ReadyState;
  readonly lastHeartbeatAt: Date;
  readonly runtimeVersion: string;
  readonly configRevision: number;
  readonly observedRevision: number;
}

export interface RuntimeRegistrationRepository {
  get(
    providerId: string,
    deploymentId: string,
    instanceId: string,
  ): Promise<RuntimeRegistrationSnapshot | null>;
  insert(
    providerId: string,
    deploymentId: string,
    value: RuntimeRegistrationRecordValue,
  ): Promise<void>;
  update(
    providerId: string,
    deploymentId: string,
    instanceId: string,
    expectedRegistrationRevision: number,
    value: RuntimeRegistrationRecordValue,
  ): Promise<void>;
  updateRegistrationProjection(
    providerId: string,
    deploymentId: string,
    instanceId: string,
    expectedObservedRevision: number,
    patch: RuntimeRegistrationProjectionPatch,
  ): Promise<void>;
}

interface RuntimeRegistrationRow extends QueryResultRow {
  provider_id: string;
  deployment_id: string;
  runtime_instance_id: string;
  session_id: string;
  protocol_version: string;
  heartbeat_sequence: string;
  registered_at: Date;
  last_heartbeat_at: Date;
  expires_at: Date;
  revision: string;
  runtime_version: string | null;
  config_revision: string | null;
  readiness_state: ReadyState;
}

export class PostgresRuntimeRegistrationRepository implements RuntimeRegistrationRepository {
  constructor(private readonly db: PmsSqlClient) {}

  async get(
    providerId: string,
    deploymentId: string,
    instanceId: string,
  ): Promise<RuntimeRegistrationSnapshot | null> {
    const result = await this.db.query<RuntimeRegistrationRow>(
      `SELECT deployment.provider_id AS provider_id,
              reg.deployment_id AS deployment_id,
              reg.runtime_instance_id AS runtime_instance_id,
              reg.session_id AS session_id,
              reg.protocol_version AS protocol_version,
              reg.heartbeat_sequence AS heartbeat_sequence,
              reg.registered_at AS registered_at,
              reg.last_heartbeat_at AS last_heartbeat_at,
              reg.expires_at AS expires_at,
              reg.revision AS revision,
              process.runtime_version AS runtime_version,
              process.config_revision AS config_revision,
              process.readiness_state AS readiness_state
         FROM runtime_registration reg
         JOIN runtime_deployment deployment
           ON deployment.deployment_id = reg.deployment_id
         JOIN runtime_process process
           ON process.runtime_instance_id = reg.runtime_instance_id
          AND process.deployment_id = reg.deployment_id
        WHERE deployment.provider_id = $1
          AND reg.deployment_id = $2
          AND reg.runtime_instance_id = $3`,
      [providerId, deploymentId, instanceId],
    );
    return result.rows[0] === undefined ? null : runtimeRegistrationFromRow(result.rows[0]);
  }

  async insert(
    providerId: string,
    deploymentId: string,
    value: RuntimeRegistrationRecordValue,
  ): Promise<void> {
    validateRecordInput(value);
    try {
      const result = await this.db.query(
        `INSERT INTO runtime_registration(
           runtime_instance_id,deployment_id,session_id,protocol_version,
           heartbeat_sequence,registered_at,last_heartbeat_at,expires_at,revision
         )
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9
           FROM runtime_process process
           JOIN runtime_deployment deployment
             ON deployment.deployment_id = process.deployment_id
          WHERE process.runtime_instance_id = $1
            AND process.deployment_id = $2
            AND deployment.provider_id = $10`,
        [
          value.runtimeInstanceId,
          deploymentId,
          value.sessionId,
          value.protocolVersion,
          value.heartbeatSequence,
          value.registeredAt,
          value.lastHeartbeatAt,
          value.expiresAt,
          value.revision,
          providerId,
        ],
      );
      if (result.rowCount === 0) {
        throw new PmsRepositoryError(
          "ENTITY_NOT_FOUND",
          "Runtime registration target process not found",
          { aggregate: "RuntimeRegistration", providerId, deploymentId },
        );
      }
    } catch (error) {
      if (isDatabaseError(error) && error.code === "23505") {
        mapWriteError(error, "RuntimeRegistration");
      }
      if (isDatabaseError(error) && error.code === "23503") {
        throw new PmsRepositoryError("ENTITY_NOT_FOUND", "Runtime process not found", {
          aggregate: "RuntimeRegistration",
        });
      }
      throw error;
    }
  }

  async update(
    providerId: string,
    deploymentId: string,
    instanceId: string,
    expectedRegistrationRevision: number,
    value: RuntimeRegistrationRecordValue,
  ): Promise<void> {
    validateRecordInput(value);
    if (!Number.isSafeInteger(expectedRegistrationRevision) || expectedRegistrationRevision < 0) {
      throw new RangeError("RUNTIME_REGISTRATION_EXPECTED_REVISION_INVALID");
    }
    const result = await this.db.query(
      `UPDATE runtime_registration reg
          SET session_id=$5,
              protocol_version=$6,
              heartbeat_sequence=$7,
              registered_at=$8,
              last_heartbeat_at=$9,
              expires_at=$10,
              revision=$11
         FROM runtime_deployment deployment
        WHERE reg.runtime_instance_id = $1
          AND reg.deployment_id = $2
          AND deployment.deployment_id = reg.deployment_id
          AND deployment.provider_id = $3
          AND reg.revision = $4`,
      [
        instanceId,
        deploymentId,
        providerId,
        expectedRegistrationRevision,
        value.sessionId,
        value.protocolVersion,
        value.heartbeatSequence,
        value.registeredAt,
        value.lastHeartbeatAt,
        value.expiresAt,
        value.revision,
      ],
    );
    if (result.rowCount === 1) return;
    throw concurrencyConflict("RuntimeRegistration");
  }

  async updateRegistrationProjection(
    providerId: string,
    deploymentId: string,
    instanceId: string,
    expectedObservedRevision: number,
    patch: RuntimeRegistrationProjectionPatch,
  ): Promise<void> {
    if (!Number.isSafeInteger(expectedObservedRevision) || expectedObservedRevision < 0) {
      throw new RangeError("RUNTIME_REGISTRATION_EXPECTED_OBSERVED_REVISION_INVALID");
    }
    if (
      !Number.isSafeInteger(patch.observedRevision) ||
      patch.observedRevision < 0 ||
      patch.observedRevision !== expectedObservedRevision + 1
    ) {
      throw new RangeError("RUNTIME_REGISTRATION_PATCH_OBSERVED_REVISION_INVALID");
    }
    if (!Number.isSafeInteger(patch.configRevision) || patch.configRevision < 0) {
      throw new RangeError("RUNTIME_REGISTRATION_CONFIG_REVISION_INVALID");
    }
    if (!(patch.lastHeartbeatAt instanceof Date) || Number.isNaN(patch.lastHeartbeatAt.getTime())) {
      throw new RangeError("RUNTIME_REGISTRATION_LAST_HEARTBEAT_AT_INVALID");
    }
    if (patch.runtimeVersion.trim().length === 0) {
      throw new RangeError("RUNTIME_REGISTRATION_RUNTIME_VERSION_INVALID");
    }

    const result = await this.db.query(
      `UPDATE runtime_process process
          SET registration_state=$5,
              readiness_state=$6,
              last_heartbeat_at=$7,
              runtime_version=$8,
              config_revision=$9,
              observed_revision=$10,
              updated_at=GREATEST(
                clock_timestamp(), date_trunc('milliseconds', updated_at) + interval '1 millisecond'
              )
         FROM runtime_deployment deployment
        WHERE process.runtime_instance_id = $1
          AND process.deployment_id = $2
          AND process.observed_revision = $3
          AND deployment.deployment_id = process.deployment_id
          AND deployment.provider_id = $4`,
      [
        instanceId,
        deploymentId,
        expectedObservedRevision,
        providerId,
        patch.registrationState,
        patch.readinessState,
        patch.lastHeartbeatAt,
        patch.runtimeVersion,
        patch.configRevision,
        patch.observedRevision,
      ],
    );
    if (result.rowCount === 1) return;
    throw concurrencyConflict("RuntimeProcess");
  }
}

function runtimeRegistrationFromRow(row: RuntimeRegistrationRow): RuntimeRegistrationSnapshot {
  const runtimeVersion = row.runtime_version;
  if (runtimeVersion === null || runtimeVersion.trim().length === 0) {
    throw new Error("RUNTIME_REGISTRATION_SNAPSHOT_INCOMPLETE");
  }
  return Object.freeze({
    providerId: row.provider_id,
    deploymentId: row.deployment_id,
    instanceId: row.runtime_instance_id,
    sessionId: row.session_id,
    runtimeVersion,
    protocolVersion: row.protocol_version,
    configRevision: row.config_revision === null ? 0 : toNonNegativeInteger(row.config_revision),
    readinessState: row.readiness_state,
    heartbeatSequence: toNonNegativeInteger(row.heartbeat_sequence),
    registeredAt: new Date(row.registered_at),
    lastHeartbeatAt: new Date(row.last_heartbeat_at),
    expiresAt: new Date(row.expires_at),
    revision: toNonNegativeInteger(row.revision),
  });
}

function validateRecordInput(value: RuntimeRegistrationRecordValue): void {
  if (value.runtimeInstanceId.trim().length === 0) {
    throw new RangeError("RUNTIME_REGISTRATION_INSTANCE_ID_REQUIRED");
  }
  if (value.sessionId.trim().length === 0) {
    throw new RangeError("RUNTIME_REGISTRATION_SESSION_ID_REQUIRED");
  }
  if (value.protocolVersion.trim().length === 0) {
    throw new RangeError("RUNTIME_REGISTRATION_PROTOCOL_REQUIRED");
  }
  if (!(value.registeredAt instanceof Date) || Number.isNaN(value.registeredAt.getTime())) {
    throw new RangeError("RUNTIME_REGISTRATION_REGISTERED_AT_INVALID");
  }
  if (!(value.lastHeartbeatAt instanceof Date) || Number.isNaN(value.lastHeartbeatAt.getTime())) {
    throw new RangeError("RUNTIME_REGISTRATION_LAST_HEARTBEAT_AT_INVALID");
  }
  if (!(value.expiresAt instanceof Date) || Number.isNaN(value.expiresAt.getTime())) {
    throw new RangeError("RUNTIME_REGISTRATION_EXPIRES_AT_INVALID");
  }
  if (value.lastHeartbeatAt.getTime() < value.registeredAt.getTime()) {
    throw new RangeError("RUNTIME_REGISTRATION_LAST_HEARTBEAT_INVALID");
  }
  if (value.expiresAt.getTime() <= value.lastHeartbeatAt.getTime()) {
    throw new RangeError("RUNTIME_REGISTRATION_EXPIRES_AT_INVALID");
  }
  if (!Number.isSafeInteger(value.heartbeatSequence) || value.heartbeatSequence < 0) {
    throw new RangeError("RUNTIME_REGISTRATION_HEARTBEAT_SEQUENCE_INVALID");
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new RangeError("RUNTIME_REGISTRATION_REVISION_INVALID");
  }
}

function toNonNegativeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RangeError("RUNTIME_REGISTRATION_NUMBER_INVALID");
  }
  return parsed;
}

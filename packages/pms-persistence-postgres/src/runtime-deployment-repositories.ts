import type { Pool, PoolClient, QueryResultRow } from "pg";
import { PmsRepositoryError } from "../../pms-domain/src/index.js";
import {
  databaseProfileId,
  rehydrateRuntimeDeployment,
  rehydrateRuntimeProcessProjection,
  runtimeConfigProfileId,
  runtimeDeploymentId,
  runtimeEnvironmentId,
  runtimeInstanceId,
  runtimeProviderId,
  type RuntimeDeployment,
  type RuntimeDeploymentSnapshot,
  type RuntimeProcessProjection,
} from "../../runtime-deployment/src/index.js";
import {
  concurrencyConflict,
  isDatabaseError,
  json,
  mapWriteError,
  type PmsSqlClient,
} from "./shared.js";

interface RuntimeDeploymentRow extends QueryResultRow {
  deployment_id: string;
  provider_id: string;
  environment: string;
  desired_state: RuntimeDeploymentSnapshot["desiredState"];
  desired_replicas: number;
  runtime_version: string;
  database_profile_id: string;
  config_profile_id: string;
  adapter_endpoint: string | null;
  status: RuntimeDeploymentSnapshot["status"];
  desired_revision: string;
  observed_revision: string;
}

export interface RuntimeDeploymentSavePrecondition {
  readonly expectedDesiredRevision: number;
  readonly expectedObservedRevision: number;
}

export class PostgresRuntimeDeploymentRepository {
  constructor(private readonly db: PmsSqlClient) {}

  async get(providerId: string, deploymentId: string): Promise<RuntimeDeployment | null> {
    const result = await this.db.query<RuntimeDeploymentRow>(
      `${runtimeDeploymentSelect()}
        WHERE provider_id=$1 AND deployment_id=$2`,
      [providerId, deploymentId],
    );
    return result.rows[0] === undefined ? null : deploymentFromRow(result.rows[0]);
  }

  async listByProvider(
    providerId: string,
    environment?: string,
  ): Promise<readonly RuntimeDeployment[]> {
    const result = await this.db.query<RuntimeDeploymentRow>(
      `${runtimeDeploymentSelect()}
        WHERE provider_id=$1 AND ($2::text IS NULL OR environment=$2)
        ORDER BY environment,deployment_id`,
      [providerId, environment ?? null],
    );
    return result.rows.map(deploymentFromRow);
  }

  async insert(value: RuntimeDeploymentSnapshot): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO runtime_deployment(
           deployment_id,provider_id,environment,desired_state,desired_replicas,
           runtime_version,database_profile_id,config_profile_id,adapter_endpoint,
           status,desired_revision,observed_revision
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        deploymentValues(value),
      );
    } catch (error) {
      mapWriteError(error, "RuntimeDeployment");
    }
  }

  async save(
    value: RuntimeDeploymentSnapshot,
    precondition: RuntimeDeploymentSavePrecondition,
  ): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE runtime_deployment
          SET desired_state=$3,desired_replicas=$4,status=$5,
              desired_revision=$6,observed_revision=$7,
              updated_at=GREATEST(
                clock_timestamp(),date_trunc('milliseconds',updated_at)+interval '1 millisecond'
              )
        WHERE deployment_id=$1 AND provider_id=$2
          AND desired_revision=$8 AND observed_revision=$9`,
      [
        value.deploymentId,
        value.providerId,
        value.desiredState,
        value.desiredReplicas,
        value.status,
        value.desiredRevision,
        value.observedRevision,
        precondition.expectedDesiredRevision,
        precondition.expectedObservedRevision,
      ],
    );
    if (result.rowCount === 1) return true;

    const current = await this.get(value.providerId, value.deploymentId);
    if (current !== null && deploymentsEqual(current.snapshot, value)) return false;
    throw concurrencyConflict("RuntimeDeployment");
  }
}

interface RuntimeProcessRow extends QueryResultRow {
  runtime_instance_id: string;
  deployment_id: string;
  pm2_name: string;
  pid: number | null;
  port: number;
  process_state: RuntimeProcessProjection["processState"];
  liveness_state: RuntimeProcessProjection["livenessState"];
  readiness_state: RuntimeProcessProjection["readinessState"];
  registration_state: RuntimeProcessProjection["registrationState"];
  catalog_state: RuntimeProcessProjection["catalogState"];
  config_state: RuntimeProcessProjection["configState"];
  last_heartbeat_at: Date | null;
  runtime_version: string | null;
  config_revision: string | null;
  restart_count: number;
  observed_revision: string;
}

export class PostgresRuntimeProcessRepository {
  constructor(private readonly db: PmsSqlClient) {}

  async get(providerId: string, instanceId: string): Promise<RuntimeProcessProjection | null> {
    const result = await this.db.query<RuntimeProcessRow>(
      `${runtimeProcessSelect()}
         JOIN runtime_deployment deployment
           ON deployment.deployment_id=process.deployment_id
        WHERE deployment.provider_id=$1 AND process.runtime_instance_id=$2`,
      [providerId, instanceId],
    );
    return result.rows[0] === undefined ? null : processFromRow(result.rows[0]);
  }

  async listByDeployment(
    providerId: string,
    deploymentId: string,
  ): Promise<readonly RuntimeProcessProjection[]> {
    const result = await this.db.query<RuntimeProcessRow>(
      `${runtimeProcessSelect()}
         JOIN runtime_deployment deployment
           ON deployment.deployment_id=process.deployment_id
        WHERE deployment.provider_id=$1 AND process.deployment_id=$2
        ORDER BY process.runtime_instance_id`,
      [providerId, deploymentId],
    );
    return result.rows.map(processFromRow);
  }

  async upsert(
    providerId: string,
    value: RuntimeProcessProjection,
    expectedRevision: number | null,
  ): Promise<boolean> {
    const current = await this.get(providerId, value.instanceId);
    if (current === null) {
      if (expectedRevision !== null || value.observedRevision !== 0) {
        throw concurrencyConflict("RuntimeProcess");
      }
      return this.#insert(providerId, value);
    }
    if (processesEqual(current, value)) return false;
    if (
      expectedRevision === null ||
      current.observedRevision !== expectedRevision ||
      value.observedRevision !== expectedRevision + 1 ||
      !processIdentityEqual(current, value)
    ) {
      throw concurrencyConflict("RuntimeProcess");
    }

    const result = await this.db.query(
      `UPDATE runtime_process
          SET pid=$3,process_state=$4,liveness_state=$5,readiness_state=$6,
              registration_state=$7,catalog_state=$8,config_state=$9,
              last_heartbeat_at=$10,runtime_version=$11,config_revision=$12,
              restart_count=$13,observed_revision=$14,
              updated_at=GREATEST(
                clock_timestamp(),date_trunc('milliseconds',updated_at)+interval '1 millisecond'
              )
        WHERE runtime_instance_id=$1 AND deployment_id=$2 AND observed_revision=$15`,
      [
        value.instanceId,
        value.deploymentId,
        value.pid,
        value.processState,
        value.livenessState,
        value.readinessState,
        value.registrationState,
        value.catalogState,
        value.configState,
        value.lastHeartbeatAt,
        value.runtimeVersion,
        value.configRevision,
        value.restartCount,
        value.observedRevision,
        expectedRevision,
      ],
    );
    if (result.rowCount === 1) return true;
    const raced = await this.get(providerId, value.instanceId);
    if (raced !== null && processesEqual(raced, value)) return false;
    throw concurrencyConflict("RuntimeProcess");
  }

  async #insert(providerId: string, value: RuntimeProcessProjection): Promise<boolean> {
    try {
      const result = await this.db.query(
        `INSERT INTO runtime_process(
           runtime_instance_id,deployment_id,environment,pm2_name,pid,port,
           process_state,liveness_state,readiness_state,registration_state,
           catalog_state,config_state,last_heartbeat_at,runtime_version,
           config_revision,restart_count,observed_revision
         )
         SELECT $1,$2,deployment.environment,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
           FROM runtime_deployment deployment
          WHERE deployment.deployment_id=$2 AND deployment.provider_id=$17`,
        [...processValues(value), providerId],
      );
      if (result.rowCount !== 1) throw concurrencyConflict("RuntimeProcess");
      return true;
    } catch (error) {
      if (isDatabaseError(error) && error.code === "23505") {
        const current = await this.get(providerId, value.instanceId);
        if (current !== null && processesEqual(current, value)) return false;
        throw concurrencyConflict("RuntimeProcess");
      }
      throw error;
    }
  }
}

export type RuntimeDeploymentActionStatus = "pending" | "running" | "succeeded" | "failed" | "noop";

export interface RuntimeDeploymentAction {
  readonly actionId: string;
  readonly deploymentId: string;
  readonly runtimeInstanceId?: string;
  readonly actionType: string;
  readonly idempotencyKey: string;
  readonly status: RuntimeDeploymentActionStatus;
  readonly expectedRevision?: number;
  readonly resultingRevision?: number;
  readonly errorCode?: string;
  readonly resultDetails: Readonly<Record<string, unknown>>;
  readonly actorId: string;
  readonly correlationId: string;
  readonly occurredAt: Date;
  readonly completedAt?: Date;
}

interface RuntimeDeploymentActionRow extends QueryResultRow {
  action_id: string;
  deployment_id: string;
  runtime_instance_id: string | null;
  action_type: string;
  idempotency_key: string;
  status: RuntimeDeploymentActionStatus;
  expected_revision: string | null;
  resulting_revision: string | null;
  error_code: string | null;
  result_details: Record<string, unknown>;
  actor_id: string;
  correlation_id: string;
  occurred_at: Date;
  completed_at: Date | null;
}

export class PostgresRuntimeDeploymentActionRepository {
  constructor(private readonly db: PmsSqlClient) {}

  async append(providerId: string, value: RuntimeDeploymentAction): Promise<boolean> {
    try {
      const result = await this.db.query(
        `INSERT INTO runtime_deployment_action(
           action_id,deployment_id,runtime_instance_id,action_type,idempotency_key,
           status,expected_revision,resulting_revision,error_code,result_details,
           actor_id,correlation_id,occurred_at,completed_at
         )
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14
           FROM runtime_deployment deployment
          WHERE deployment.deployment_id=$2 AND deployment.provider_id=$15`,
        [...actionValues(value), providerId],
      );
      if (result.rowCount !== 1) throw concurrencyConflict("RuntimeDeploymentAction");
      return true;
    } catch (error) {
      if (isDatabaseError(error) && error.code === "23505") {
        const current = await this.getByIdempotencyKey(
          providerId,
          value.deploymentId,
          value.idempotencyKey,
        );
        if (current !== null && actionsEqual(current, value)) return false;
        throw new PmsRepositoryError(
          "ENTITY_ALREADY_EXISTS",
          "RuntimeDeploymentAction idempotency key already exists with different content",
          { aggregate: "RuntimeDeploymentAction" },
          { cause: error },
        );
      }
      throw error;
    }
  }

  async getByIdempotencyKey(
    providerId: string,
    deploymentId: string,
    idempotencyKey: string,
  ): Promise<RuntimeDeploymentAction | null> {
    const result = await this.db.query<RuntimeDeploymentActionRow>(
      `${runtimeDeploymentActionSelect()}
         JOIN runtime_deployment deployment
           ON deployment.deployment_id=action.deployment_id
        WHERE deployment.provider_id=$1
          AND action.deployment_id=$2 AND action.idempotency_key=$3`,
      [providerId, deploymentId, idempotencyKey],
    );
    return result.rows[0] === undefined ? null : actionFromRow(result.rows[0]);
  }

  async listByDeployment(
    providerId: string,
    deploymentId: string,
  ): Promise<readonly RuntimeDeploymentAction[]> {
    const result = await this.db.query<RuntimeDeploymentActionRow>(
      `${runtimeDeploymentActionSelect()}
         JOIN runtime_deployment deployment
           ON deployment.deployment_id=action.deployment_id
        WHERE deployment.provider_id=$1 AND action.deployment_id=$2
        ORDER BY action.occurred_at,action.action_id`,
      [providerId, deploymentId],
    );
    return result.rows.map(actionFromRow);
  }
}

export interface RuntimeDeploymentRepositories {
  readonly deployments: PostgresRuntimeDeploymentRepository;
  readonly processes: PostgresRuntimeProcessRepository;
  readonly actions: PostgresRuntimeDeploymentActionRepository;
}

export function postgresRuntimeDeploymentRepositories(
  client: Pool | PoolClient,
): RuntimeDeploymentRepositories {
  return Object.freeze({
    deployments: new PostgresRuntimeDeploymentRepository(client),
    processes: new PostgresRuntimeProcessRepository(client),
    actions: new PostgresRuntimeDeploymentActionRepository(client),
  });
}

export class PostgresRuntimeDeploymentUnitOfWork {
  constructor(private readonly pool: Pool) {}

  async transaction<T>(
    work: (repositories: RuntimeDeploymentRepositories) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(postgresRuntimeDeploymentRepositories(client));
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

function runtimeDeploymentSelect(): string {
  return `SELECT deployment_id,provider_id,environment,desired_state,desired_replicas,
                 runtime_version,database_profile_id,config_profile_id,adapter_endpoint,
                 status,desired_revision,observed_revision
            FROM runtime_deployment`;
}

function runtimeProcessSelect(): string {
  return `SELECT process.runtime_instance_id,process.deployment_id,process.pm2_name,
                 process.pid,process.port,process.process_state,process.liveness_state,
                 process.readiness_state,process.registration_state,process.catalog_state,
                 process.config_state,process.last_heartbeat_at,process.runtime_version,
                 process.config_revision,process.restart_count,process.observed_revision
            FROM runtime_process process`;
}

function runtimeDeploymentActionSelect(): string {
  return `SELECT action.action_id,action.deployment_id,action.runtime_instance_id,
                 action.action_type,action.idempotency_key,action.status,
                 action.expected_revision,action.resulting_revision,action.error_code,
                 action.result_details,action.actor_id,action.correlation_id,
                 action.occurred_at,action.completed_at
            FROM runtime_deployment_action action`;
}

function deploymentFromRow(row: RuntimeDeploymentRow): RuntimeDeployment {
  return rehydrateRuntimeDeployment({
    deploymentId: runtimeDeploymentId(row.deployment_id),
    providerId: runtimeProviderId(row.provider_id),
    environment: runtimeEnvironmentId(row.environment),
    desiredState: row.desired_state,
    desiredReplicas: row.desired_replicas,
    runtimeVersion: row.runtime_version,
    databaseProfileId: databaseProfileId(row.database_profile_id),
    configProfileId: runtimeConfigProfileId(row.config_profile_id),
    ...(row.adapter_endpoint === null ? {} : { adapterEndpoint: row.adapter_endpoint }),
    status: row.status,
    desiredRevision: Number(row.desired_revision),
    observedRevision: Number(row.observed_revision),
  });
}

function processFromRow(row: RuntimeProcessRow): RuntimeProcessProjection {
  return rehydrateRuntimeProcessProjection({
    instanceId: runtimeInstanceId(row.runtime_instance_id),
    deploymentId: runtimeDeploymentId(row.deployment_id),
    pm2Name: row.pm2_name,
    pid: row.pid,
    port: row.port,
    processState: row.process_state,
    livenessState: row.liveness_state,
    readinessState: row.readiness_state,
    registrationState: row.registration_state,
    catalogState: row.catalog_state,
    configState: row.config_state,
    lastHeartbeatAt: row.last_heartbeat_at,
    runtimeVersion: row.runtime_version,
    configRevision: row.config_revision === null ? null : Number(row.config_revision),
    restartCount: row.restart_count,
    observedRevision: Number(row.observed_revision),
  });
}

function actionFromRow(row: RuntimeDeploymentActionRow): RuntimeDeploymentAction {
  return Object.freeze({
    actionId: row.action_id,
    deploymentId: row.deployment_id,
    ...(row.runtime_instance_id === null ? {} : { runtimeInstanceId: row.runtime_instance_id }),
    actionType: row.action_type,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    ...(row.expected_revision === null ? {} : { expectedRevision: Number(row.expected_revision) }),
    ...(row.resulting_revision === null
      ? {}
      : { resultingRevision: Number(row.resulting_revision) }),
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    resultDetails: Object.freeze({ ...row.result_details }),
    actorId: row.actor_id,
    correlationId: row.correlation_id,
    occurredAt: new Date(row.occurred_at),
    ...(row.completed_at === null ? {} : { completedAt: new Date(row.completed_at) }),
  });
}

function deploymentValues(value: RuntimeDeploymentSnapshot): unknown[] {
  return [
    value.deploymentId,
    value.providerId,
    value.environment,
    value.desiredState,
    value.desiredReplicas,
    value.runtimeVersion,
    value.databaseProfileId,
    value.configProfileId,
    value.adapterEndpoint ?? null,
    value.status,
    value.desiredRevision,
    value.observedRevision,
  ];
}

function processValues(value: RuntimeProcessProjection): readonly unknown[] {
  return [
    value.instanceId,
    value.deploymentId,
    value.pm2Name,
    value.pid,
    value.port,
    value.processState,
    value.livenessState,
    value.readinessState,
    value.registrationState,
    value.catalogState,
    value.configState,
    value.lastHeartbeatAt,
    value.runtimeVersion,
    value.configRevision,
    value.restartCount,
    value.observedRevision,
  ];
}

function actionValues(value: RuntimeDeploymentAction): readonly unknown[] {
  return [
    value.actionId,
    value.deploymentId,
    value.runtimeInstanceId ?? null,
    value.actionType,
    value.idempotencyKey,
    value.status,
    value.expectedRevision ?? null,
    value.resultingRevision ?? null,
    value.errorCode ?? null,
    json(value.resultDetails),
    value.actorId,
    value.correlationId,
    value.occurredAt,
    value.completedAt ?? null,
  ];
}

function deploymentsEqual(
  left: RuntimeDeploymentSnapshot,
  right: RuntimeDeploymentSnapshot,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function processIdentityEqual(
  left: RuntimeProcessProjection,
  right: RuntimeProcessProjection,
): boolean {
  return (
    left.instanceId === right.instanceId &&
    left.deploymentId === right.deploymentId &&
    left.pm2Name === right.pm2Name &&
    left.port === right.port
  );
}

function processesEqual(left: RuntimeProcessProjection, right: RuntimeProcessProjection): boolean {
  return (
    processIdentityEqual(left, right) &&
    left.pid === right.pid &&
    left.processState === right.processState &&
    left.livenessState === right.livenessState &&
    left.readinessState === right.readinessState &&
    left.registrationState === right.registrationState &&
    left.catalogState === right.catalogState &&
    left.configState === right.configState &&
    left.lastHeartbeatAt?.getTime() === right.lastHeartbeatAt?.getTime() &&
    left.runtimeVersion === right.runtimeVersion &&
    left.configRevision === right.configRevision &&
    left.restartCount === right.restartCount &&
    left.observedRevision === right.observedRevision
  );
}

function actionsEqual(left: RuntimeDeploymentAction, right: RuntimeDeploymentAction): boolean {
  return (
    left.actionId === right.actionId &&
    left.deploymentId === right.deploymentId &&
    left.runtimeInstanceId === right.runtimeInstanceId &&
    left.actionType === right.actionType &&
    left.idempotencyKey === right.idempotencyKey &&
    left.status === right.status &&
    left.expectedRevision === right.expectedRevision &&
    left.resultingRevision === right.resultingRevision &&
    left.errorCode === right.errorCode &&
    JSON.stringify(left.resultDetails) === JSON.stringify(right.resultDetails) &&
    left.actorId === right.actorId &&
    left.correlationId === right.correlationId &&
    left.occurredAt.getTime() === right.occurredAt.getTime() &&
    left.completedAt?.getTime() === right.completedAt?.getTime()
  );
}

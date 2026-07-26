import type { QueryResultRow } from "pg";
import {
  RuntimeInstanceAllocationError,
  assertRuntimePortReleasePolicy,
  createRuntimeProcessProjection,
  deriveRuntimeInstanceIdentity,
  runtimePortRange,
  runtimeProcessIdentity,
  type RuntimePortRange,
  type RuntimePortReleasePolicy,
  type RuntimeProcessProjection,
} from "@sdar/runtime-deployment";
import { PostgresRuntimeProcessRepository } from "./runtime-deployment-repositories.js";
import type { PmsSqlClient } from "./shared.js";

export interface RuntimeInstanceAllocationRequest {
  readonly providerId: string;
  readonly deploymentId: string;
  readonly ordinal: number;
  readonly portRange: RuntimePortRange;
}

export type RuntimePortLeaseReleaseResult = "released" | "missing" | "active";

interface DeploymentScopeRow extends QueryResultRow {
  environment: string;
}

interface AllocatedPortRow extends QueryResultRow {
  port: number;
}

export class PostgresRuntimeInstanceAllocator {
  constructor(private readonly db: PmsSqlClient) {}

  async allocate(request: RuntimeInstanceAllocationRequest): Promise<RuntimeProcessProjection> {
    const identity = deriveRuntimeInstanceIdentity(request);
    const range = runtimePortRange(request.portRange.start, request.portRange.end);
    const repository = new PostgresRuntimeProcessRepository(this.db);
    const replay = await repository.get(request.providerId, identity.instanceId);
    if (replay !== null) {
      assertSameIdentity(replay, identity.deploymentId, identity.pm2Name);
      return replay;
    }
    const scope = await this.db.query<DeploymentScopeRow>(
      `SELECT environment
         FROM runtime_deployment
        WHERE deployment_id=$1 AND provider_id=$2`,
      [identity.deploymentId, request.providerId],
    );
    const environment = scope.rows[0]?.environment;
    if (environment === undefined) {
      throw new RuntimeInstanceAllocationError("RUNTIME_INSTANCE_ALLOCATION_CONFLICT");
    }
    const inserted = await this.db.query<AllocatedPortRow>(
      `WITH lease_lock AS MATERIALIZED (
         SELECT pg_advisory_xact_lock(hashtext('runtime-port:' || $3))
       ),
       candidate AS MATERIALIZED (
         SELECT candidate_port AS port
           FROM lease_lock
           CROSS JOIN generate_series($4::integer,$5::integer) candidate_port
          WHERE NOT EXISTS (
            SELECT 1
              FROM runtime_process
             WHERE environment=$3 AND port=candidate_port
          )
          ORDER BY candidate_port
          LIMIT 1
       )
       INSERT INTO runtime_process(
         runtime_instance_id,deployment_id,environment,pm2_name,pid,port,
         process_state,liveness_state,readiness_state,registration_state,
         catalog_state,config_state,last_heartbeat_at,runtime_version,
         config_revision,restart_count,observed_revision
       )
       SELECT $1,$2,$3,$6,NULL,candidate.port,
              'missing','unknown','unknown','unregistered',
              'unknown','unknown',NULL,NULL,NULL,0,0
         FROM candidate
       ON CONFLICT (runtime_instance_id) DO NOTHING
       RETURNING port`,
      [
        identity.instanceId,
        identity.deploymentId,
        environment,
        range.start,
        range.end,
        identity.pm2Name,
      ],
    );
    const port = inserted.rows[0]?.port;
    if (port !== undefined) {
      return createRuntimeProcessProjection(
        runtimeProcessIdentity(identity, port),
        initialObservation(),
      );
    }
    const raced = await repository.get(request.providerId, identity.instanceId);
    if (raced !== null) {
      assertSameIdentity(raced, identity.deploymentId, identity.pm2Name);
      return raced;
    }
    throw new RuntimeInstanceAllocationError("RUNTIME_PORT_RANGE_EXHAUSTED");
  }

  async release(
    request: RuntimeInstanceAllocationRequest,
    policy: RuntimePortReleasePolicy,
  ): Promise<RuntimePortLeaseReleaseResult> {
    const identity = deriveRuntimeInstanceIdentity(request);
    assertRuntimePortReleasePolicy(identity, policy);
    if (policy.providerId !== request.providerId) {
      throw new RuntimeInstanceAllocationError("INVALID_RUNTIME_INSTANCE_ALLOCATION");
    }
    const result = await this.db.query(
      `DELETE FROM runtime_process process
        USING runtime_deployment deployment
        WHERE process.runtime_instance_id=$1
          AND process.deployment_id=$2
          AND process.deployment_id=deployment.deployment_id
          AND deployment.provider_id=$3
          AND process.process_state IN ('missing','stopped')`,
      [identity.instanceId, identity.deploymentId, request.providerId],
    );
    if (result.rowCount === 1) return "released";
    const existing = await new PostgresRuntimeProcessRepository(this.db).get(
      request.providerId,
      identity.instanceId,
    );
    return existing === null ? "missing" : "active";
  }
}

function initialObservation() {
  return {
    pid: null,
    processState: "missing" as const,
    livenessState: "unknown" as const,
    readinessState: "unknown" as const,
    registrationState: "unregistered" as const,
    catalogState: "unknown" as const,
    configState: "unknown" as const,
    lastHeartbeatAt: null,
    runtimeVersion: null,
    configRevision: null,
    restartCount: 0,
  };
}

function assertSameIdentity(
  process: RuntimeProcessProjection,
  deploymentId: string,
  pm2Name: string,
): void {
  if (process.deploymentId !== deploymentId || process.pm2Name !== pm2Name) {
    throw new RuntimeInstanceAllocationError("RUNTIME_INSTANCE_ALLOCATION_CONFLICT");
  }
}

import type { QueryResultRow } from "pg";
import {
  auditEventId,
  createAuditEvent,
  PmsRepositoryError,
  type AuditEvent,
  type AuditQuery,
  type AuditRepository,
  type ClaimJobs,
  type EnqueueJob,
  type JobLease,
  type JobLeaseRepository,
  type JobQuery,
  type LeaseIdentity,
  type Page,
  type PmsJob,
} from "../../pms-domain/src/index.js";
import { json, mapWriteError, pageLimit, pageOffset, toPage, type PmsSqlClient } from "./shared.js";

interface AuditRow extends QueryResultRow {
  audit_event_id: string;
  action: string;
  actor_id: string;
  correlation_id: string;
  subject_type: string;
  subject_id: string;
  occurred_at: Date;
  metadata: AuditEvent["metadata"];
}

export class PostgresAuditRepository implements AuditRepository {
  constructor(private readonly db: PmsSqlClient) {}

  async append(value: AuditEvent): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO audit(
           audit_event_id,action,actor_id,correlation_id,
           subject_type,subject_id,occurred_at,metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [
          value.auditEventId,
          value.action,
          value.actorId,
          value.correlationId,
          value.subjectType,
          value.subjectId,
          value.occurredAt,
          json(value.metadata),
        ],
      );
    } catch (error) {
      mapWriteError(error, "AuditEvent");
    }
  }

  async list(query: AuditQuery): Promise<Page<AuditEvent>> {
    const result = await this.db.query<AuditRow>(
      `SELECT audit_event_id,action,actor_id,correlation_id,
              subject_type,subject_id,occurred_at,metadata
         FROM audit
        WHERE ($1::text IS NULL OR subject_type=$1)
          AND ($2::text IS NULL OR subject_id=$2)
          AND ($3::text IS NULL OR correlation_id=$3)
          AND ($4::timestamptz IS NULL OR occurred_at<$4)
        ORDER BY occurred_at DESC,audit_event_id DESC
        OFFSET $5 LIMIT $6`,
      [
        query.subjectType ?? null,
        query.subjectId ?? null,
        query.correlationId ?? null,
        query.occurredBefore ?? null,
        pageOffset(query),
        pageLimit(query) + 1,
      ],
    );
    return toPage(result.rows.map(auditFromRow), query);
  }
}

interface JobRow extends QueryResultRow {
  job_id: string;
  job_type: string;
  payload: PmsJob["payload"];
  status: PmsJob["status"];
  attempt: number;
  available_at: Date;
  created_at: Date;
  updated_at: Date;
}

interface LeaseRow extends JobRow {
  lease_owner: string;
  lease_token: string;
  fencing_token: string;
  lease_expires_at: Date;
}

export class PostgresJobLeaseRepository implements JobLeaseRepository {
  constructor(private readonly db: PmsSqlClient) {}

  async enqueue(value: EnqueueJob): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO job_lease(job_id,job_type,payload,status,available_at)
         VALUES ($1,$2,$3::jsonb,'pending',COALESCE($4,clock_timestamp()))`,
        [value.jobId, value.jobType, json(value.payload), value.availableAt ?? null],
      );
    } catch (error) {
      mapWriteError(error, "PmsJob");
    }
  }

  async claim(input: ClaimJobs): Promise<readonly JobLease[]> {
    assertLeaseRequest(input.limit, input.leaseDurationMs);
    if (input.owner.trim().length === 0 || input.jobTypes.length === 0) {
      throw new RangeError("PMS_JOB_CLAIM_INVALID");
    }
    const result = await this.db.query<LeaseRow>(
      `WITH candidates AS (
         SELECT job_id
           FROM job_lease
          WHERE job_type=ANY($1::text[])
            AND (
              (status IN ('pending','failed') AND available_at<=clock_timestamp())
              OR (status='leased' AND lease_expires_at<=clock_timestamp())
            )
          ORDER BY available_at,created_at,job_id
          FOR UPDATE SKIP LOCKED
          LIMIT $2
       )
       UPDATE job_lease job
          SET status='leased',lease_owner=$3,lease_token=gen_random_uuid(),
              lease_expires_at=clock_timestamp()+($4::text||' milliseconds')::interval,
              fencing_token=fencing_token+1,attempt=attempt+1,updated_at=clock_timestamp()
         FROM candidates
        WHERE job.job_id=candidates.job_id
       RETURNING job.*`,
      [input.jobTypes, input.limit, input.owner, input.leaseDurationMs],
    );
    return result.rows.map(leaseFromRow);
  }

  async renew(identity: LeaseIdentity, leaseDurationMs: number): Promise<JobLease> {
    assertLeaseRequest(1, leaseDurationMs);
    const result = await this.db.query<LeaseRow>(
      `UPDATE job_lease
          SET lease_expires_at=clock_timestamp()+($5::text||' milliseconds')::interval,
              updated_at=clock_timestamp()
        WHERE job_id=$1 AND status='leased' AND lease_owner=$2
          AND lease_token=$3 AND fencing_token=$4
          AND lease_expires_at>clock_timestamp()
       RETURNING *`,
      [...identityValues(identity), leaseDurationMs],
    );
    const row = result.rows[0];
    if (row === undefined) throw leaseNotOwned(identity.jobId);
    return leaseFromRow(row);
  }

  async release(identity: LeaseIdentity, availableAt?: Date): Promise<void> {
    const result = await this.db.query(
      `UPDATE job_lease
          SET status='pending',available_at=COALESCE($5,clock_timestamp()),
              lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
              updated_at=clock_timestamp()
        WHERE job_id=$1 AND status='leased' AND lease_owner=$2
          AND lease_token=$3 AND fencing_token=$4`,
      [...identityValues(identity), availableAt ?? null],
    );
    assertLeaseResult(result.rowCount, identity.jobId);
  }

  async complete(identity: LeaseIdentity): Promise<void> {
    const result = await this.db.query(
      `UPDATE job_lease
          SET status='succeeded',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
              updated_at=clock_timestamp()
        WHERE job_id=$1 AND status='leased' AND lease_owner=$2
          AND lease_token=$3 AND fencing_token=$4`,
      identityValues(identity),
    );
    assertLeaseResult(result.rowCount, identity.jobId);
  }

  async fail(identity: LeaseIdentity, availableAt: Date): Promise<void> {
    const result = await this.db.query(
      `UPDATE job_lease
          SET status='failed',available_at=$5,
              lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
              updated_at=clock_timestamp()
        WHERE job_id=$1 AND status='leased' AND lease_owner=$2
          AND lease_token=$3 AND fencing_token=$4`,
      [...identityValues(identity), availableAt],
    );
    assertLeaseResult(result.rowCount, identity.jobId);
  }

  async list(query: JobQuery): Promise<Page<PmsJob>> {
    const result = await this.db.query<JobRow>(
      `SELECT job_id,job_type,payload,status,attempt,available_at,created_at,updated_at
         FROM job_lease
        WHERE ($1::text IS NULL OR job_type=$1)
          AND ($2::text IS NULL OR status=$2)
        ORDER BY created_at,job_id OFFSET $3 LIMIT $4`,
      [query.jobType ?? null, query.status ?? null, pageOffset(query), pageLimit(query) + 1],
    );
    return toPage(result.rows.map(jobFromRow), query);
  }
}

function auditFromRow(row: AuditRow): AuditEvent {
  return createAuditEvent({
    auditEventId: auditEventId(row.audit_event_id),
    action: row.action,
    actorId: row.actor_id,
    correlationId: row.correlation_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    occurredAt: row.occurred_at,
    metadata: row.metadata,
  });
}

function jobFromRow(row: JobRow): PmsJob {
  return Object.freeze({
    jobId: row.job_id,
    jobType: row.job_type,
    payload: Object.freeze({ ...row.payload }),
    status: row.status,
    attempt: row.attempt,
    availableAt: new Date(row.available_at),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
}

function leaseFromRow(row: LeaseRow): JobLease {
  return Object.freeze({
    job: jobFromRow(row),
    owner: row.lease_owner,
    token: row.lease_token,
    fencingToken: BigInt(row.fencing_token),
    expiresAt: new Date(row.lease_expires_at),
  });
}

function identityValues(identity: LeaseIdentity): unknown[] {
  return [identity.jobId, identity.owner, identity.token, identity.fencingToken.toString()];
}

function leaseNotOwned(jobId: string): PmsRepositoryError {
  return new PmsRepositoryError("LEASE_NOT_OWNED", "Job Lease is stale or not owned", { jobId });
}

function assertLeaseResult(rowCount: number | null, jobId: string): void {
  if (rowCount !== 1) throw leaseNotOwned(jobId);
}

function assertLeaseRequest(limit: number, leaseDurationMs: number): void {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 500 ||
    !Number.isSafeInteger(leaseDurationMs) ||
    leaseDurationMs < 1 ||
    leaseDurationMs > 86_400_000
  ) {
    throw new RangeError("PMS_JOB_LEASE_BOUNDS_INVALID");
  }
}

import type { JsonObject } from "../entities.js";
import type { Page, PageRequest } from "./common.js";

export type JobStatus = "pending" | "leased" | "succeeded" | "failed";

export interface PmsJob {
  readonly jobId: string;
  readonly jobType: string;
  readonly payload: JsonObject;
  readonly status: JobStatus;
  readonly attempt: number;
  readonly availableAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface JobLease {
  readonly job: PmsJob;
  readonly owner: string;
  readonly token: string;
  readonly fencingToken: bigint;
  readonly expiresAt: Date;
}

export interface LeaseIdentity {
  readonly jobId: string;
  readonly owner: string;
  readonly token: string;
  readonly fencingToken: bigint;
}

export interface EnqueueJob {
  readonly jobId: string;
  readonly jobType: string;
  readonly payload: JsonObject;
  readonly availableAt?: Date;
}

export interface ClaimJobs {
  readonly owner: string;
  readonly jobTypes: readonly string[];
  readonly limit: number;
  readonly leaseDurationMs: number;
}

export interface JobQuery extends PageRequest {
  readonly jobType?: string;
  readonly status?: JobStatus;
}

export interface JobLeaseRepository {
  enqueue(job: EnqueueJob): Promise<void>;
  /**
   * Atomically claims distinct jobs. Implementations use database time for expiry and increment
   * fencingToken on every successful claim.
   */
  claim(input: ClaimJobs): Promise<readonly JobLease[]>;
  /** Renews only when owner, token, and fencingToken still match the current lease. */
  renew(lease: LeaseIdentity, leaseDurationMs: number): Promise<JobLease>;
  release(lease: LeaseIdentity, availableAt?: Date): Promise<void>;
  complete(lease: LeaseIdentity): Promise<void>;
  fail(lease: LeaseIdentity, availableAt: Date): Promise<void>;
  list(query: JobQuery): Promise<Page<PmsJob>>;
}

export interface ScheduleRuntimeReconcileJobs {
  readonly limit: number;
  readonly minimumAgeMs: number;
}

export interface RuntimeReconcileSchedulerRepository {
  /**
   * Uses database time and transaction-scoped advisory exclusion to enqueue due reconcile work.
   * Pending or leased work for the same Provider/Deployment remains authoritative.
   */
  enqueueDue(input: ScheduleRuntimeReconcileJobs): Promise<number>;
}

import type {
  JobLease,
  JobLeaseRepository,
  LeaseIdentity,
} from "../../../packages/pms-domain/src/index.js";
import type { PmsJobExecutionContext, PmsJobHandler } from "./job-registry.js";

export const MINIMUM_LEASE_RENEWAL_INTERVAL_MS = 100;

export interface ExecutePmsJobInput {
  readonly lease: JobLease;
  readonly handler: PmsJobHandler | undefined;
  readonly jobs: JobLeaseRepository;
  readonly leaseDurationMs: number;
  readonly retryDelayMs: number;
  readonly workerSignal: AbortSignal;
}

export async function executePmsJob(input: ExecutePmsJobInput): Promise<void> {
  const leaseIdentity = identity(input.lease);
  if (input.handler === undefined) {
    await input.jobs.fail(leaseIdentity, retryAt(input.retryDelayMs));
    return;
  }

  const execution = new AbortController();
  const renewal = new AbortController();
  const abortForWorkerStop = (): void => execution.abort("PMS_WORKER_STOPPED");
  if (input.workerSignal.aborted) abortForWorkerStop();
  else input.workerSignal.addEventListener("abort", abortForWorkerStop, { once: true });

  const leaseState = { lost: false };
  let authoritativeExpiresAt = new Date(input.lease.expiresAt);
  const context = executionContext(
    leaseIdentity,
    execution.signal,
    () => new Date(authoritativeExpiresAt),
  );
  const renewalLoop = renewUntilSettled();
  let handlerFailure: unknown;
  try {
    await input.handler.execute(input.lease, context);
  } catch (error) {
    handlerFailure = error;
    console.error(
      JSON.stringify({
        event: "pms_job_failed",
        jobType: input.lease.job.jobType,
        errorCode: failureCode(error),
      }),
    );
  } finally {
    renewal.abort();
    await renewalLoop;
    input.workerSignal.removeEventListener("abort", abortForWorkerStop);
  }

  if (leaseState.lost || isAborted(execution.signal)) return;
  if (handlerFailure === undefined) {
    await input.jobs.complete(leaseIdentity);
    return;
  }
  await input.jobs.fail(leaseIdentity, retryAt(input.retryDelayMs));

  async function renewUntilSettled(): Promise<void> {
    const intervalMs = renewalInterval(input.leaseDurationMs);
    while (!isAborted(renewal.signal)) {
      await abortableDelay(intervalMs, renewal.signal);
      if (isAborted(renewal.signal)) return;
      try {
        const renewed = await input.jobs.renew(leaseIdentity, input.leaseDurationMs);
        authoritativeExpiresAt = new Date(renewed.expiresAt);
      } catch {
        leaseState.lost = true;
        execution.abort("PMS_WORKER_LEASE_LOST");
        return;
      }
    }
  }
}

function failureCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "UNKNOWN";
  if ("code" in error && typeof error.code === "string") return error.code;
  if (error instanceof Error && error.name.length > 0) return error.name;
  return "UNKNOWN";
}

export function renewalInterval(leaseDurationMs: number): number {
  const interval = Math.floor(leaseDurationMs / 3);
  if (interval < MINIMUM_LEASE_RENEWAL_INTERVAL_MS) {
    throw new RangeError("PMS_WORKER_LEASE_DURATION_TOO_SHORT");
  }
  return interval;
}

function executionContext(
  leaseIdentity: LeaseIdentity,
  signal: AbortSignal,
  leaseExpiresAt: () => Date,
): PmsJobExecutionContext {
  const fence = String(leaseIdentity.fencingToken);
  return Object.freeze({
    signal,
    leaseIdentity: Object.freeze({ ...leaseIdentity }),
    operationId: `job:${leaseIdentity.jobId}:fence:${fence}`,
    idempotencyKey: `${leaseIdentity.jobId}:${fence}`,
    leaseExpiresAt,
  });
}

function identity(lease: JobLease): LeaseIdentity {
  return {
    jobId: lease.job.jobId,
    owner: lease.owner,
    token: lease.token,
    fencingToken: lease.fencingToken,
  };
}

function retryAt(delayMs: number): Date {
  return new Date(Date.now() + delayMs);
}

async function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolveDelay) => {
    const timer = setTimeout(resolveDelay, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolveDelay();
      },
      { once: true },
    );
  });
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

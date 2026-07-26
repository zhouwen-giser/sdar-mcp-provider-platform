import type { JobLease, JobLeaseRepository } from "../../../packages/pms-domain/src/index.js";
import type { PmsWorkerConfig } from "./config.js";
import { WorkerHealth } from "./health.js";
import type { PmsJobRegistry } from "./job-registry.js";

export class PmsWorker {
  readonly health = new WorkerHealth();
  readonly #abort = new AbortController();
  #loop?: Promise<void>;

  constructor(
    private readonly config: PmsWorkerConfig,
    private readonly jobs: JobLeaseRepository,
    private readonly registry: PmsJobRegistry,
  ) {}

  start(): void {
    if (this.#loop !== undefined) throw new Error("PMS_WORKER_ALREADY_STARTED");
    if (this.registry.jobTypes().length === 0) throw new Error("PMS_JOB_REGISTRY_EMPTY");
    this.health.ready();
    this.#loop = this.runLoop();
  }

  async runOnce(): Promise<number> {
    const leases = await this.jobs.claim({
      owner: this.config.workerId,
      jobTypes: this.registry.jobTypes(),
      limit: this.config.claimLimit,
      leaseDurationMs: this.config.leaseDurationMs,
    });
    for (const lease of leases) await this.execute(lease);
    this.health.loopSucceeded();
    return leases.length;
  }

  async stop(): Promise<void> {
    if (this.#loop === undefined) {
      this.health.stopped();
      return;
    }
    this.health.stopping();
    this.#abort.abort();
    await this.#loop;
    this.health.stopped();
  }

  private async runLoop(): Promise<void> {
    while (!this.#abort.signal.aborted) {
      try {
        await this.runOnce();
      } catch {
        this.health.failed("PMS_WORKER_LOOP_FAILED");
      }
      await abortableDelay(this.config.pollIntervalMs, this.#abort.signal);
    }
  }

  private async execute(lease: JobLease): Promise<void> {
    const handler = this.registry.get(lease.job.jobType);
    if (handler === undefined) {
      await this.jobs.fail(identity(lease), retryAt(this.config.retryDelayMs));
      return;
    }
    try {
      await handler.execute(lease);
      await this.jobs.complete(identity(lease));
    } catch {
      await this.jobs.fail(identity(lease), retryAt(this.config.retryDelayMs));
    }
  }
}

function identity(lease: JobLease) {
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

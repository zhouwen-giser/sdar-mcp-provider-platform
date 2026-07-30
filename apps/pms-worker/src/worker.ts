import type { JobLeaseRepository } from "../../../packages/pms-domain/src/index.js";
import type { PmsWorkerConfig } from "./config.js";
import { WorkerHealth } from "./health.js";
import { executePmsJob } from "./job-execution.js";
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
    await Promise.all(
      leases.map((lease) =>
        executePmsJob({
          lease,
          handler: this.registry.get(lease.job.jobType),
          jobs: this.jobs,
          leaseDurationMs: this.config.leaseDurationMs,
          retryDelayMs: this.config.retryDelayMs,
          workerSignal: this.#abort.signal,
        }),
      ),
    );
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

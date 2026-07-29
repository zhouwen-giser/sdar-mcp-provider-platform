import type { RuntimeReconcileSchedulerRepository } from "../../../packages/pms-domain/src/index.js";

export interface PeriodicReconcileSchedulerOptions {
  readonly intervalMs: number;
  readonly batchSize: number;
  readonly minimumAgeMs?: number;
  readonly delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly onError?: (error: unknown) => void;
}

/**
 * Triggers bounded enqueue ticks only. The repository owns PostgreSQL database-time selection,
 * transaction-scoped advisory locking, and pending/leased deduplication.
 */
export class PeriodicReconcileScheduler {
  readonly #intervalMs: number;
  readonly #batchSize: number;
  readonly #minimumAgeMs: number;
  readonly #delay: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly #onError: (error: unknown) => void;
  #controller: AbortController | undefined;
  #loop: Promise<void> | undefined;
  #currentTick: Promise<number> | undefined;

  constructor(
    private readonly repository: RuntimeReconcileSchedulerRepository,
    options: PeriodicReconcileSchedulerOptions,
  ) {
    this.#intervalMs = boundedInteger(options.intervalMs, 1_000, 300_000);
    this.#batchSize = boundedInteger(options.batchSize, 1, 500);
    this.#minimumAgeMs = boundedInteger(options.minimumAgeMs ?? options.intervalMs, 0, 300_000);
    this.#delay = options.delay ?? abortableDelay;
    this.#onError = options.onError ?? (() => undefined);
  }

  start(): void {
    if (this.#loop !== undefined) return;
    this.#controller = new AbortController();
    this.#loop = this.run(this.#controller);
  }

  tick(): Promise<number> {
    if (this.#currentTick !== undefined) return this.#currentTick;
    const execution = this.repository.enqueueDue({
      limit: this.#batchSize,
      minimumAgeMs: this.#minimumAgeMs,
    });
    this.#currentTick = execution;
    const clear = (): void => {
      if (this.#currentTick === execution) this.#currentTick = undefined;
    };
    void execution.then(clear, clear);
    return execution;
  }

  async stop(): Promise<void> {
    const loop = this.#loop;
    if (loop === undefined) return;
    this.#controller?.abort();
    await loop;
    this.#loop = undefined;
    this.#controller = undefined;
  }

  private async run(controller: AbortController): Promise<void> {
    while (!controller.signal.aborted) {
      try {
        await this.tick();
      } catch (error) {
        this.#onError(error);
      }
      await this.#delay(this.#intervalMs, controller.signal);
    }
  }
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError("PMS_RUNTIME_RECONCILE_SCHEDULER_BOUNDS");
  }
  return value;
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

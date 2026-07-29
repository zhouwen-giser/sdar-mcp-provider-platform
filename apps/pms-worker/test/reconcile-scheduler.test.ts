import { describe, expect, it, vi } from "vitest";
import type { RuntimeReconcileSchedulerRepository } from "../../../packages/pms-domain/src/index.js";
import { PeriodicReconcileScheduler } from "../src/index.js";

describe("PeriodicReconcileScheduler", () => {
  it("coalesces overlapping ticks and applies bounded repository input", async () => {
    const pending = deferred<number>();
    const enqueueDue = vi.fn(() => pending.promise);
    const scheduler = new PeriodicReconcileScheduler(
      { enqueueDue },
      { intervalMs: 15_000, batchSize: 25, minimumAgeMs: 5_000 },
    );

    const left = scheduler.tick();
    const right = scheduler.tick();
    pending.resolve(3);

    await expect(left).resolves.toBe(3);
    await expect(right).resolves.toBe(3);
    expect(enqueueDue).toHaveBeenCalledOnce();
    expect(enqueueDue).toHaveBeenCalledWith({ limit: 25, minimumAgeMs: 5_000 });
  });

  it("makes stop idempotent and waits for the active database tick", async () => {
    const pending = deferred<number>();
    const repository: RuntimeReconcileSchedulerRepository = {
      enqueueDue: vi.fn(() => pending.promise),
    };
    const scheduler = new PeriodicReconcileScheduler(repository, {
      intervalMs: 1_000,
      batchSize: 10,
    });

    scheduler.start();
    scheduler.start();
    let stopped = false;
    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    pending.resolve(1);
    await stopping;
    await scheduler.stop();
    expect(repository.enqueueDue).toHaveBeenCalledOnce();
  });

  it("releases overlap state after failure so a later tick can recover", async () => {
    const onError = vi.fn();
    const enqueueDue = vi
      .fn<RuntimeReconcileSchedulerRepository["enqueueDue"]>()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(2);
    const scheduler = new PeriodicReconcileScheduler(
      { enqueueDue },
      { intervalMs: 1_000, batchSize: 10, onError },
    );

    await expect(scheduler.tick()).rejects.toThrow("database unavailable");
    await expect(scheduler.tick()).resolves.toBe(2);
    expect(enqueueDue).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });

  it("delays after failed loop ticks and reports errors without a busy loop", async () => {
    const onError = vi.fn();
    const delay = vi.fn((_milliseconds: number, signal: AbortSignal) => abortableTestDelay(signal));
    const scheduler = new PeriodicReconcileScheduler(
      { enqueueDue: vi.fn(() => Promise.reject(new Error("tick failed"))) },
      { intervalMs: 1_000, batchSize: 10, onError, delay },
    );

    scheduler.start();
    await waitFor(() => onError.mock.calls.length === 1 && delay.mock.calls.length === 1);
    await scheduler.stop();

    expect(delay).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "tick failed" }));
  });

  it("rejects unsafe interval and batch bounds", () => {
    const repository: RuntimeReconcileSchedulerRepository = {
      enqueueDue: vi.fn(() => Promise.resolve(0)),
    };

    expect(
      () => new PeriodicReconcileScheduler(repository, { intervalMs: 0, batchSize: 10 }),
    ).toThrow("PMS_RUNTIME_RECONCILE_SCHEDULER_BOUNDS");
    expect(
      () => new PeriodicReconcileScheduler(repository, { intervalMs: 1_000, batchSize: 501 }),
    ).toThrow("PMS_RUNTIME_RECONCILE_SCHEDULER_BOUNDS");
  });
});

function deferred<T>() {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function abortableTestDelay(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolveDelay) => {
    signal.addEventListener("abort", () => resolveDelay(), { once: true });
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1));
  }
  throw new Error("TEST_WAIT_TIMEOUT");
}

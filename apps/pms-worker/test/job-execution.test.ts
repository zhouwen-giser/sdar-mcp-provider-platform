import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PmsRepositoryError,
  type JobLease,
  type JobLeaseRepository,
} from "../../../packages/pms-domain/src/index.js";
import {
  executePmsJob,
  MINIMUM_LEASE_RENEWAL_INTERVAL_MS,
  renewalInterval,
  type PmsJobExecutionContext,
} from "../src/index.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("PMS job lease execution", () => {
  it("renews independently for more than two lease periods before completing", async () => {
    vi.useFakeTimers();
    let renewalCount = 0;
    const renew = vi.fn<JobLeaseRepository["renew"]>(() => {
      renewalCount += 1;
      return Promise.resolve({
        ...lease(),
        expiresAt: new Date(Date.UTC(2026, 6, 29, 0, 0, renewalCount)),
      });
    });
    const fixture = repository({ renew });
    let finish: (() => void) | undefined;
    const handler = {
      jobType: "test.long",
      execute: vi.fn(
        (_lease: JobLease, _context: PmsJobExecutionContext) =>
          new Promise<void>((resolve) => {
            void _lease;
            void _context;
            finish = resolve;
          }),
      ),
    };

    const running = executePmsJob({
      lease: lease(),
      handler,
      jobs: fixture.repository,
      leaseDurationMs: 300,
      retryDelayMs: 50,
      workerSignal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(650);
    expect(renew).toHaveBeenCalledTimes(6);
    expect(handler.execute.mock.calls[0]?.[1]?.leaseExpiresAt()).toEqual(
      new Date("2026-07-29T00:00:06.000Z"),
    );
    finish?.();
    await running;

    expect(fixture.complete).toHaveBeenCalledOnce();
    expect(fixture.fail).not.toHaveBeenCalled();
  });

  it("uses a bounded renewal interval no greater than one third of the lease", () => {
    expect(renewalInterval(1_000)).toBe(333);
    expect(renewalInterval(300)).toBe(MINIMUM_LEASE_RENEWAL_INTERVAL_MS);
    expect(() => renewalInterval(299)).toThrow("PMS_WORKER_LEASE_DURATION_TOO_SHORT");
  });

  it("aborts on renewal loss and performs no terminal lease write", async () => {
    vi.useFakeTimers();
    const fixture = repository({
      renew: vi.fn(() => Promise.reject(new PmsRepositoryError("LEASE_NOT_OWNED", "lost"))),
    });
    const handler = {
      jobType: "test.lost",
      execute: vi.fn(
        (_lease: JobLease, context: { readonly signal: AbortSignal }) =>
          new Promise<void>((resolve) => {
            context.signal.addEventListener("abort", () => resolve(), { once: true });
          }),
      ),
    };

    const running = executePmsJob({
      lease: lease(),
      handler,
      jobs: fixture.repository,
      leaseDurationMs: 300,
      retryDelayMs: 50,
      workerSignal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(100);
    await running;

    expect(handler.execute.mock.calls[0]?.[1]?.signal.aborted).toBe(true);
    expect(fixture.complete).not.toHaveBeenCalled();
    expect(fixture.fail).not.toHaveBeenCalled();
  });

  it("propagates stale complete and fail writes", async () => {
    const stale = new PmsRepositoryError("LEASE_NOT_OWNED", "stale");
    const completion = repository({ complete: vi.fn(() => Promise.reject(stale)) });
    await expect(
      executePmsJob({
        lease: lease(),
        handler: { jobType: "test.complete", execute: vi.fn(() => Promise.resolve()) },
        jobs: completion.repository,
        leaseDurationMs: 300,
        retryDelayMs: 50,
        workerSignal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "LEASE_NOT_OWNED" });

    const failure = repository({ fail: vi.fn(() => Promise.reject(stale)) });
    await expect(
      executePmsJob({
        lease: lease(),
        handler: { jobType: "test.fail", execute: vi.fn(() => Promise.reject(new Error("boom"))) },
        jobs: failure.repository,
        leaseDurationMs: 300,
        retryDelayMs: 50,
        workerSignal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "LEASE_NOT_OWNED" });
  });
});

function repository(
  overrides: Partial<Pick<JobLeaseRepository, "renew" | "complete" | "fail">> = {},
) {
  const renew = vi.fn<JobLeaseRepository["renew"]>(() => Promise.resolve(lease()));
  const complete = overrides.complete ?? vi.fn(() => Promise.resolve());
  const fail = overrides.fail ?? vi.fn(() => Promise.resolve());
  const repository: JobLeaseRepository = {
    enqueue: vi.fn(() => Promise.resolve()),
    claim: vi.fn(() => Promise.resolve([])),
    renew: overrides.renew ?? renew,
    release: vi.fn(() => Promise.resolve()),
    complete,
    fail,
    list: vi.fn(() => Promise.resolve({ items: [] })),
  };
  return { repository, renew, complete, fail };
}

function lease(): JobLease {
  const now = new Date("2026-07-29T00:00:00.000Z");
  return {
    job: {
      jobId: "job-long",
      jobType: "test.long",
      payload: {},
      status: "leased",
      attempt: 1,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    },
    owner: "worker-1",
    token: "11111111-1111-4111-8111-111111111111",
    fencingToken: 7n,
    expiresAt: new Date(now.getTime() + 300),
  };
}

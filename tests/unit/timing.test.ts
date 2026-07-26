import { describe, expect, it } from "vitest";
import { defaultTiming, validateTiming } from "../../packages/domain/src/index.js";

const acceptedAt = new Date("2026-07-16T00:00:00Z");
const capabilities = { scheduling: true, maxElapsed: true };

describe("task timing contracts", () => {
  it("uses a bounded compatibility window when optional timing metadata is absent", () => {
    expect(defaultTiming).toEqual({
      start: { mode: "immediate", startToleranceMs: 30_000 },
      maxElapsedMs: null,
    });
  });

  it("anchors immediate and scheduled deadlines correctly", () => {
    const immediate = validateTiming(
      { start: { mode: "immediate", startToleranceMs: 500 }, maxElapsedMs: 2_000 },
      capabilities,
      acceptedAt,
    );
    expect(immediate.notBefore.toISOString()).toBe("2026-07-16T00:00:00.000Z");
    expect(immediate.latestStartAt.toISOString()).toBe("2026-07-16T00:00:00.500Z");
    expect(immediate.deadlineAt?.toISOString()).toBe("2026-07-16T00:00:02.000Z");

    const scheduled = validateTiming(
      {
        start: {
          mode: "scheduled",
          scheduledAt: "2026-07-16T01:00:00+01:00",
          startToleranceMs: 1_000,
        },
        maxElapsedMs: null,
      },
      capabilities,
      acceptedAt,
    );
    expect(scheduled.notBefore.toISOString()).toBe("2026-07-16T00:00:00.000Z");
    expect(scheduled.latestStartAt.toISOString()).toBe("2026-07-16T00:00:01.000Z");
    expect(scheduled.deadlineAt).toBeNull();
  });

  it("rejects unsupported, unzoned, and invalid timing", () => {
    expect(() =>
      validateTiming(
        {
          start: { mode: "scheduled", scheduledAt: "2026-07-16T00:00:00", startToleranceMs: 0 },
          maxElapsedMs: null,
        },
        capabilities,
        acceptedAt,
      ),
    ).toThrow("INVALID_SCHEDULED_AT");
    expect(() =>
      validateTiming(
        {
          start: { mode: "scheduled", scheduledAt: acceptedAt.toISOString(), startToleranceMs: 0 },
          maxElapsedMs: null,
        },
        { scheduling: false, maxElapsed: true },
        acceptedAt,
      ),
    ).toThrow("SCHEDULING_NOT_SUPPORTED");
    expect(() =>
      validateTiming(
        { start: { mode: "immediate", startToleranceMs: 0 }, maxElapsedMs: 1 },
        { scheduling: true, maxElapsed: false },
        acceptedAt,
      ),
    ).toThrow("MAX_ELAPSED_NOT_SUPPORTED");
  });
});

import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "../../apps/runtime/src/config.js";

describe("notification configuration frozen bounds", () => {
  it.each([
    ["TASK_NOTIFICATION_POLL_INTERVAL_MS", 100, 10_000, 500],
    ["TASK_NOTIFICATION_MAX_SUBSCRIPTIONS", 1, 10_000, 256],
    ["TASK_NOTIFICATION_MAX_SUBSCRIPTIONS_PER_AUTH", 1, 1_000, 32],
    ["TASK_NOTIFICATION_MAX_TASK_BINDINGS", 1, 100_000, 4_096],
    ["TASK_NOTIFICATION_MAX_QUEUE_MESSAGES", 1, 1_024, 64],
    ["TASK_NOTIFICATION_MAX_QUEUE_BYTES", 4_096, 16_777_216, 1_048_576],
    ["TASK_NOTIFICATION_BATCH_SIZE", 1, 1_000, 256],
  ] as const)("accepts exact limits for %s", (name, minimum, maximum, fallback) => {
    expect(loadRuntimeConfig({})[name]).toBe(fallback);
    expect(loadRuntimeConfig({ [name]: String(minimum) })[name]).toBe(minimum);
    expect(loadRuntimeConfig({ [name]: String(maximum) })[name]).toBe(maximum);
    expect(() => loadRuntimeConfig({ [name]: String(minimum - 1) })).toThrow();
    expect(() => loadRuntimeConfig({ [name]: String(maximum + 1) })).toThrow();
  });
});

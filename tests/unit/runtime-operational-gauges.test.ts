import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { updateOperationalGauges } from "../../apps/runtime/src/runtime.js";

describe("operational gauge query backpressure", () => {
  it("keeps one query per pool while slow statistics are pending", async () => {
    let finish!: (value: { rows: Record<string, string>[] }) => void;
    const query = vi.fn(
      () =>
        new Promise<{ rows: Record<string, string>[] }>((resolve) => {
          finish = resolve;
        }),
    );
    const pool = { query } as unknown as Pool;
    const telemetry = { metric: vi.fn() };
    const pending = updateOperationalGauges(pool, telemetry);
    await Promise.all(Array.from({ length: 20 }, () => updateOperationalGauges(pool, telemetry)));
    expect(query).toHaveBeenCalledTimes(1);
    const anotherQuery = vi.fn().mockResolvedValue({ rows: [] });
    await updateOperationalGauges({ query: anotherQuery } as unknown as Pool, telemetry);
    expect(anotherQuery).toHaveBeenCalledOnce();
    finish({
      rows: [
        {
          active_tasks: "1",
          pending_commands: "2",
          outbox_pending: "3",
          recovery_backlog: "4",
          telemetry_audit_backlog: "5",
          telemetry_audit_oldest_age_seconds: "6",
        },
      ],
    });
    await pending;
    expect(telemetry.metric).toHaveBeenCalledWith("active_tasks", 1, {}, "gauge");
    const next = updateOperationalGauges(pool, telemetry);
    expect(query).toHaveBeenCalledTimes(2);
    finish({ rows: [] });
    await next;
  });

  it("releases the pool guard after query failure and skips absent telemetry", async () => {
    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error("database timeout"))
      .mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;
    const telemetry = { metric: vi.fn() };
    await updateOperationalGauges(pool, undefined);
    expect(query).not.toHaveBeenCalled();
    await expect(updateOperationalGauges(pool, telemetry)).resolves.toBeUndefined();
    await updateOperationalGauges(pool, telemetry);
    expect(query).toHaveBeenCalledTimes(2);
    expect(telemetry.metric).not.toHaveBeenCalled();
  });
});

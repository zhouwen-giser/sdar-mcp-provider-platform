import { describe, expect, it } from "vitest";
import { MutationQueue } from "../../apps/ugv-provider-adapter/src/mutation-queue.js";

describe("UGV ordered projections and priority controls", () => {
  it("admits controls while snapshot persistence is pending, preserving observation order", async () => {
    const queue = new MutationQueue();
    const seen: string[] = [];
    let release!: () => void;
    const durable = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = queue.enqueue(async () => {
      seen.push("first");
    }, durable);
    const second = queue.enqueue(async () => {
      seen.push("second");
    });
    await queue.enqueue(
      async () => {
        seen.push("stop");
      },
      undefined,
      true,
    );
    expect(seen).toEqual(["stop"]);
    release();
    await Promise.all([first, second, queue.idle()]);
    expect(seen).toEqual(["stop", "first", "second"]);
  });

  it("never overlaps writers, including priority controls", async () => {
    const queue = new MutationQueue();
    const seen: string[] = [];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = queue.enqueue(async () => {
      seen.push("begin");
      await pending;
      seen.push("end");
    });
    const control = queue.enqueue(
      async () => {
        seen.push("control");
      },
      undefined,
      true,
    );
    expect(seen).toEqual(["begin"]);
    release();
    await Promise.all([running, control]);
    expect(seen).toEqual(["begin", "end", "control"]);
  });

  it("rejects failed durability without projecting and keeps the writer usable", async () => {
    const queue = new MutationQueue();
    let projected = false;
    const first = queue.enqueue(
      async () => {
        projected = true;
      },
      Promise.reject(Error("WRITE_FAILED")),
    );
    await expect(first).rejects.toThrow("WRITE_FAILED");
    expect(projected).toBe(false);
    await expect(queue.enqueue(async () => "usable")).resolves.toBe("usable");
    await queue.idle();
  });
});

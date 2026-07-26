import { describe, expect, it, vi } from "vitest";
import {
  createRuntimeShutdown,
  RuntimeDrainController,
  V0_1_ACTIVE_TASK_SHUTDOWN_POLICY,
} from "../src/shutdown.js";

describe("Runtime V0.1 drain policy", () => {
  it("rejects new admission after drain begins and converges idempotently", () => {
    const drain = new RuntimeDrainController();

    expect(drain.acceptingInvocations).toBe(true);
    expect(drain.beginDrain()).toBe(true);
    expect(drain.beginDrain()).toBe(false);
    expect(drain.state).toBe("draining");
    expect(drain.acceptingInvocations).toBe(false);
    drain.closed();
    expect(drain.state).toBe("closed");
  });

  it("preserves active tasks for recovery by the same Task Authority", () => {
    expect(V0_1_ACTIVE_TASK_SHUTDOWN_POLICY).toEqual({
      newInvocations: "reject_while_draining",
      activeTasks: "persist_for_same_authority_recovery",
      taskAuthoritySwitch: "forbidden",
    });
    expect(V0_1_ACTIVE_TASK_SHUTDOWN_POLICY).not.toHaveProperty("deleteTasks");
    expect(V0_1_ACTIVE_TASK_SHUTDOWN_POLICY).not.toHaveProperty("cancelTasks");
  });

  it("releases config and Runtime resources in order exactly once", async () => {
    const order: string[] = [];
    const beginDrain = vi.fn(() => order.push("drain"));
    const stopConfig = vi.fn(() => {
      order.push("config");
      return Promise.resolve();
    });
    const closeRuntime = vi.fn(() => {
      order.push("runtime");
      return Promise.resolve();
    });
    const shutdown = createRuntimeShutdown({ beginDrain, stopConfig, closeRuntime });

    const first = shutdown("SIGTERM");
    const replay = shutdown("SIGINT");
    await Promise.all([first, replay]);

    expect(first).toBe(replay);
    expect(order).toEqual(["drain", "config", "runtime"]);
    expect(beginDrain).toHaveBeenCalledOnce();
    expect(stopConfig).toHaveBeenCalledOnce();
    expect(closeRuntime).toHaveBeenCalledOnce();
  });
});

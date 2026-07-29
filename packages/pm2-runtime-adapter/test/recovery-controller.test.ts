import { describe, expect, it, vi } from "vitest";
import type {
  RuntimeRecoveryDeploymentStatusPort,
  RuntimeRecoveryRecord,
  RuntimeRecoveryStateStore,
} from "../src/index.js";
import {
  DEFAULT_RUNTIME_CRASH_RECOVERY_POLICY,
  RuntimeCrashRecoveryController,
} from "../src/index.js";

describe("RuntimeCrashRecoveryController", () => {
  it("persists bounded backoff across controller recreation", async () => {
    const records = new Map<string, RuntimeRecoveryRecord>();
    const store = persistentStore(records);
    const setObservedStatus = vi.fn(() => Promise.resolve());
    const now = new Date("2026-07-26T00:00:00.000Z");

    const first = await controller(store, setObservedStatus, now).observe(process("errored", 1));
    const second = await controller(store, setObservedStatus, now).observe(process("errored", 2));

    expect(first).toMatchObject({
      state: "backoff",
      observedStatus: "DEGRADED",
      restartCount: 1,
      retryAfterMs: 5_000,
      automaticRestartAllowed: true,
    });
    expect(second).toMatchObject({
      state: "backoff",
      observedStatus: "DEGRADED",
      restartCount: 2,
      retryAfterMs: 10_000,
    });
    expect(records.get("instance-1")).toMatchObject({
      consecutiveFailures: 2,
      revision: 2,
      restartCount: 2,
    });
  });

  it("requires manual intervention after the bounded restart limit", async () => {
    const records = new Map<string, RuntimeRecoveryRecord>();
    const store = persistentStore(records);
    const setObservedStatus = vi.fn(() => Promise.resolve());

    const result = await controller(store, setObservedStatus).observe(process("errored", 5));

    expect(result).toEqual({
      state: "manual_intervention",
      observedStatus: "FAILED",
      restartCount: 5,
      automaticRestartAllowed: false,
      manualInterventionRequired: true,
    });
    expect(setObservedStatus).toHaveBeenCalledWith({
      deploymentId: "deployment-1",
      instanceId: "instance-1",
      status: "FAILED",
      reason: "RUNTIME_CRASH_RESTART_LIMIT_REACHED",
      restartCount: 5,
      manualInterventionRequired: true,
    });
  });

  it("resets consecutive failures only after observing the process online", async () => {
    const records = new Map<string, RuntimeRecoveryRecord>();
    const store = persistentStore(records);
    const setObservedStatus = vi.fn(() => Promise.resolve());
    const recovery = controller(store, setObservedStatus);

    await recovery.observe(process("errored", 2));
    const result = await recovery.observe(process("online", 2));

    expect(result).toEqual({
      state: "healthy",
      restartCount: 2,
      automaticRestartAllowed: true,
      manualInterventionRequired: false,
    });
    expect(records.get("instance-1")).toMatchObject({
      consecutiveFailures: 0,
      restartCount: 2,
    });
    expect(setObservedStatus).toHaveBeenCalledTimes(1);
  });

  it("rejects an unsafe policy before reading persistent state", () => {
    const get = vi.fn(() => Promise.resolve(null));

    expect(
      () =>
        new RuntimeCrashRecoveryController({
          policy: { ...DEFAULT_RUNTIME_CRASH_RECOVERY_POLICY, maxRestarts: 21 },
          stateStore: { get, save: vi.fn(() => Promise.resolve()) },
          deploymentStatus: { setObservedStatus: vi.fn(() => Promise.resolve()) },
        }),
    ).toThrow("PM2_RECOVERY_POLICY_INVALID");
    expect(get).not.toHaveBeenCalled();
  });

  it("does not treat desired stop states as crashes or schedule a restart", async () => {
    const get = vi.fn(() => Promise.resolve(null));
    const save = vi.fn(() => Promise.resolve());
    const setObservedStatus = vi.fn(() => Promise.resolve());
    const recovery = controller({ get, save }, setObservedStatus);

    const result = await recovery.observe(process("stopped", 0));

    expect(result).toBeNull();
    expect(get).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(setObservedStatus).not.toHaveBeenCalled();
  });
});

function controller(
  stateStore: RuntimeRecoveryStateStore,
  setObservedStatus: RuntimeRecoveryDeploymentStatusPort["setObservedStatus"],
  now = new Date("2026-07-26T00:00:00.000Z"),
): RuntimeCrashRecoveryController {
  return new RuntimeCrashRecoveryController({
    policy: DEFAULT_RUNTIME_CRASH_RECOVERY_POLICY,
    stateStore,
    deploymentStatus: { setObservedStatus },
    now: () => now,
  });
}

function persistentStore(records: Map<string, RuntimeRecoveryRecord>): RuntimeRecoveryStateStore {
  return {
    get(instanceId) {
      return Promise.resolve(records.get(instanceId) ?? null);
    },
    save(record) {
      records.set(record.instanceId, record);
      return Promise.resolve();
    },
  };
}

function process(state: "online" | "errored" | "stopped", restartCount: number) {
  return {
    target: {
      providerId: "provider-a",
      deploymentId: "deployment-1",
      environment: "production",
      runtimeVersion: "2.0.0-rc.1",
      instanceId: "instance-1",
      ordinal: 0,
      processName: "sdar-runtime-provider-a-0",
    },
    state,
    restartCount,
    opaqueLogRef: "runtime-process:sdar-runtime-provider-a-0",
  } as const;
}

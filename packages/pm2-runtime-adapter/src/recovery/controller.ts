import type { RuntimeInfrastructureProcessObservation } from "@sdar/runtime-deployment";
import type { RuntimeCrashRecoveryPolicy } from "../pm2/process-manager.js";

export type RuntimeRecoveryState = "healthy" | "backoff" | "manual_intervention";
export type RuntimeRecoveryObservedStatus = "DEGRADED" | "FAILED";

export interface RuntimeRecoveryRecord {
  readonly instanceId: string;
  readonly processName: string;
  readonly state: RuntimeRecoveryState;
  readonly restartCount: number;
  readonly consecutiveFailures: number;
  readonly nextRetryAt?: string;
  readonly updatedAt: string;
  readonly revision: number;
}

export interface RuntimeRecoveryStateStore {
  get(instanceId: string): Promise<RuntimeRecoveryRecord | null>;
  save(record: RuntimeRecoveryRecord): Promise<void>;
}

export interface RuntimeRecoveryDeploymentStatusPort {
  setObservedStatus(input: {
    readonly deploymentId: string;
    readonly instanceId: string;
    readonly status: RuntimeRecoveryObservedStatus;
    readonly reason: "RUNTIME_CRASH_RESTART_BACKOFF" | "RUNTIME_CRASH_RESTART_LIMIT_REACHED";
    readonly restartCount: number;
    readonly manualInterventionRequired: boolean;
  }): Promise<void>;
}

export interface RuntimeCrashRecoveryDecision {
  readonly state: RuntimeRecoveryState;
  readonly observedStatus?: RuntimeRecoveryObservedStatus;
  readonly restartCount: number;
  readonly automaticRestartAllowed: boolean;
  readonly manualInterventionRequired: boolean;
  readonly retryAfterMs?: number;
  readonly nextRetryAt?: string;
}

export interface RuntimeCrashRecoveryControllerOptions {
  readonly policy: RuntimeCrashRecoveryPolicy;
  readonly stateStore: RuntimeRecoveryStateStore;
  readonly deploymentStatus: RuntimeRecoveryDeploymentStatusPort;
  readonly now?: () => Date;
}

export class RuntimeCrashRecoveryController {
  readonly #now: () => Date;

  constructor(private readonly options: RuntimeCrashRecoveryControllerOptions) {
    assertPolicy(options.policy);
    this.#now = options.now ?? (() => new Date());
  }

  async observe(
    process: RuntimeInfrastructureProcessObservation,
  ): Promise<RuntimeCrashRecoveryDecision | null> {
    if (process.state !== "online" && process.state !== "errored") return null;
    const prior = await this.options.stateStore.get(process.target.instanceId);
    const now = this.#now();
    const restartCount = Math.max(prior?.restartCount ?? 0, process.restartCount);

    if (process.state === "online") {
      const record = this.record(process, prior, {
        state: "healthy",
        restartCount,
        consecutiveFailures: 0,
        updatedAt: now.toISOString(),
      });
      await this.options.stateStore.save(record);
      return decision(record, true, false);
    }

    const consecutiveFailures = (prior?.consecutiveFailures ?? 0) + 1;
    if (restartCount >= this.options.policy.maxRestarts) {
      const record = this.record(process, prior, {
        state: "manual_intervention",
        restartCount,
        consecutiveFailures,
        updatedAt: now.toISOString(),
      });
      await this.persistAndPublish(
        process,
        record,
        "FAILED",
        "RUNTIME_CRASH_RESTART_LIMIT_REACHED",
      );
      return decision(record, false, true, "FAILED");
    }

    const retryAfterMs = backoffDelay(this.options.policy.restartDelayMs, consecutiveFailures);
    const nextRetryAt = new Date(now.getTime() + retryAfterMs).toISOString();
    const record = this.record(process, prior, {
      state: "backoff",
      restartCount,
      consecutiveFailures,
      nextRetryAt,
      updatedAt: now.toISOString(),
    });
    await this.persistAndPublish(process, record, "DEGRADED", "RUNTIME_CRASH_RESTART_BACKOFF");
    return {
      ...decision(record, true, false, "DEGRADED"),
      retryAfterMs,
      nextRetryAt,
    };
  }

  private record(
    process: RuntimeInfrastructureProcessObservation,
    prior: RuntimeRecoveryRecord | null,
    value: Omit<RuntimeRecoveryRecord, "instanceId" | "processName" | "revision">,
  ): RuntimeRecoveryRecord {
    return Object.freeze({
      instanceId: process.target.instanceId,
      processName: process.target.processName,
      ...value,
      revision: (prior?.revision ?? 0) + 1,
    });
  }

  private async persistAndPublish(
    process: RuntimeInfrastructureProcessObservation,
    record: RuntimeRecoveryRecord,
    status: RuntimeRecoveryObservedStatus,
    reason: Parameters<RuntimeRecoveryDeploymentStatusPort["setObservedStatus"]>[0]["reason"],
  ): Promise<void> {
    await this.options.stateStore.save(record);
    await this.options.deploymentStatus.setObservedStatus({
      deploymentId: process.target.deploymentId,
      instanceId: process.target.instanceId,
      status,
      reason,
      restartCount: record.restartCount,
      manualInterventionRequired: record.state === "manual_intervention",
    });
  }
}

function decision(
  record: RuntimeRecoveryRecord,
  automaticRestartAllowed: boolean,
  manualInterventionRequired: boolean,
  observedStatus?: RuntimeRecoveryObservedStatus,
): RuntimeCrashRecoveryDecision {
  return Object.freeze({
    state: record.state,
    restartCount: record.restartCount,
    automaticRestartAllowed,
    manualInterventionRequired,
    ...(observedStatus === undefined ? {} : { observedStatus }),
    ...(record.nextRetryAt === undefined ? {} : { nextRetryAt: record.nextRetryAt }),
  });
}

function backoffDelay(baseDelayMs: number, consecutiveFailures: number): number {
  const exponent = Math.min(Math.max(consecutiveFailures - 1, 0), 6);
  return Math.min(baseDelayMs * 2 ** exponent, 300_000);
}

function assertPolicy(policy: RuntimeCrashRecoveryPolicy): void {
  if (
    !boundedInteger(policy.restartDelayMs, 1_000, 300_000) ||
    !boundedInteger(policy.maxRestarts, 1, 20) ||
    !boundedInteger(policy.maxMemoryBytes, 64 * 1024 * 1024, 8 * 1024 * 1024 * 1024) ||
    !boundedInteger(policy.minUptimeMs, 1_000, 300_000)
  ) {
    throw new Error("PM2_RECOVERY_POLICY_INVALID");
  }
}

function boundedInteger(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

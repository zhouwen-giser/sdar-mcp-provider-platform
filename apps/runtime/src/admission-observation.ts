import type { ProviderAdmissionObservation } from "../../../packages/mcp-protocol/src/index.js";
import type { RuntimePlatformIdentity } from "./config.js";

export interface DevelopmentAdmissionObservation {
  readonly schemaVersion: 1;
  readonly observedAt: string;
  readonly rawResponse: Readonly<Record<string, unknown>>;
  readonly localIdentities: {
    readonly taskId: string;
    readonly providerId: string;
    readonly externalExecutionId: string | null;
    readonly operationName: string;
    readonly deploymentId: string | null;
    readonly instanceId: string;
  };
  readonly revisions: {
    readonly runtimeRevision: string;
    readonly providerRevision: string | null;
  };
  readonly correlation: {
    readonly correlationId: string | null;
    readonly executionMode: string;
    readonly simulationId: string | null;
  };
  readonly authority: {
    readonly rawResponse: "transport_observation";
    readonly taskAndExecution: "provider_committed_postgres";
    readonly deployment: "provider_bootstrap_config" | "not_configured";
    readonly instance: "provider_committed_postgres";
    readonly originClaims: "non_authoritative";
  };
  readonly unresolvedContractIdentities: readonly ["providerSource", "server"];
}

/** Bounded, process-local development observation surface. */
export class DevelopmentAdmissionObservationStore {
  readonly #observations = new Map<string, DevelopmentAdmissionObservation>();

  constructor(
    readonly platformIdentity: RuntimePlatformIdentity | null,
    readonly maximumEntries = 100,
    readonly now: () => Date = () => new Date(),
  ) {
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 10_000) {
      throw new RangeError("DEVELOPMENT_ADMISSION_OBSERVATION_LIMIT_INVALID");
    }
  }

  record(input: ProviderAdmissionObservation): void {
    const result = record(input.rawResponse.result);
    const execution = record(result?._meta);
    const profile = record(execution?.["io.sdar/taskExecution"]);
    const providerIdentity = record(execution?.["io.sdar/providerIdentity"]);
    if (
      result?.taskId !== input.localIdentity.taskId ||
      providerIdentity?.profileVersion !== "1.0" ||
      providerIdentity.providerId !== input.localIdentity.providerId ||
      providerIdentity.providerInstanceId !== input.localIdentity.providerInstanceId ||
      profile?.runtimeRevision !== input.localIdentity.runtimeRevision ||
      (profile.providerRevision ?? null) !== input.localIdentity.providerRevision
    ) {
      throw new Error("DEVELOPMENT_ADMISSION_OBSERVATION_IDENTITY_MISMATCH");
    }

    const observation: DevelopmentAdmissionObservation = {
      schemaVersion: 1,
      observedAt: this.now().toISOString(),
      rawResponse: structuredClone(input.rawResponse),
      localIdentities: {
        taskId: input.localIdentity.taskId,
        providerId: input.localIdentity.providerId,
        externalExecutionId: input.localIdentity.externalExecutionId,
        operationName: input.localIdentity.operationName,
        deploymentId: this.platformIdentity?.deploymentId ?? null,
        instanceId: input.localIdentity.providerInstanceId,
      },
      revisions: {
        runtimeRevision: input.localIdentity.runtimeRevision,
        providerRevision: input.localIdentity.providerRevision,
      },
      correlation: {
        correlationId: input.localIdentity.correlationId,
        executionMode: input.localIdentity.executionMode,
        simulationId: input.localIdentity.simulationId,
      },
      authority: {
        rawResponse: "transport_observation",
        taskAndExecution: "provider_committed_postgres",
        deployment: this.platformIdentity === null ? "not_configured" : "provider_bootstrap_config",
        instance: "provider_committed_postgres",
        originClaims: "non_authoritative",
      },
      unresolvedContractIdentities: ["providerSource", "server"],
    };
    this.#observations.delete(input.localIdentity.taskId);
    this.#observations.set(input.localIdentity.taskId, observation);
    while (this.#observations.size > this.maximumEntries) {
      const oldest = this.#observations.keys().next().value;
      if (oldest === undefined) break;
      this.#observations.delete(oldest);
    }
  }

  get(taskId: string): DevelopmentAdmissionObservation | undefined {
    const observation = this.#observations.get(taskId);
    return observation === undefined ? undefined : structuredClone(observation);
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

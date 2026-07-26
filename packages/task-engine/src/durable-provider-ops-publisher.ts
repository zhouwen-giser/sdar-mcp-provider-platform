import type {
  ProviderOpsDeliveryRecord,
  ProviderOpsDeliveryRepository,
} from "../../persistence-postgres/src/index.js";

export interface ProviderOpsAuditExporter {
  export(records: ProviderOpsDeliveryRecord[]): Promise<void>;
}

export interface DurableProviderOpsPublisherResult {
  claimed: number;
  delivered: number;
  retried: number;
  exhausted: number;
}

export class DurableProviderOpsPublisher {
  constructor(
    readonly repository: ProviderOpsDeliveryRepository,
    readonly exporter: ProviderOpsAuditExporter,
    readonly ownerId: string,
    readonly options: {
      batchSize?: number;
      leaseMilliseconds?: number;
      maximumAttempts?: number;
      onEvent?: (event: "delivered" | "retry" | "exhausted", amount: number) => void;
    } = {},
  ) {}

  async tick(): Promise<DurableProviderOpsPublisherResult> {
    const result: DurableProviderOpsPublisherResult = {
      claimed: 0,
      delivered: 0,
      retried: 0,
      exhausted: 0,
    };
    const records = await this.repository.claimDue(
      this.ownerId,
      this.options.leaseMilliseconds ?? 30_000,
      this.options.batchSize ?? 100,
    );
    result.claimed = records.length;
    for (const record of records) {
      try {
        await this.exporter.export([record]);
        if (!(await this.repository.markDelivered(record.recordId, this.ownerId))) continue;
        result.delivered += 1;
        this.#emit("delivered", 1);
      } catch (error) {
        const state = await this.repository.recordFailure(
          record.recordId,
          this.ownerId,
          "TELEMETRY_EXPORT_FAILED",
          error instanceof Error ? error.name : "unknown",
          new Date(),
          this.options.maximumAttempts ?? 20,
        );
        if (state === "EXHAUSTED") {
          result.exhausted += 1;
          this.#emit("exhausted", 1);
        } else if (state === "RETRY_WAIT") {
          result.retried += 1;
          this.#emit("retry", 1);
        }
      }
    }
    return result;
  }

  #emit(event: "delivered" | "retry" | "exhausted", amount: number): void {
    try {
      this.options.onEvent?.(event, amount);
    } catch {
      // Publisher observability cannot alter durable delivery state.
    }
  }
}

import { describe, expect, it, vi } from "vitest";
import { DurableProviderOpsPublisher } from "../../packages/task-engine/src/durable-provider-ops-publisher.js";
import type {
  ProviderOpsDeliveryRepository,
  ProviderOpsDeliveryRecord,
} from "../../packages/persistence-postgres/src/provider-ops-delivery.js";

describe("durable ProviderOps batch delivery", () => {
  function fixture() {
    const records = ["one", "two", "three"].map(
      (recordId) => ({ recordId }) as ProviderOpsDeliveryRecord,
    );
    const repository = {
      claimDue: vi.fn(async () => records),
      markDelivered: vi.fn(async () => true),
      recordFailure: vi.fn(async () => "RETRY_WAIT"),
    };
    return { records, repository, typed: repository as unknown as ProviderOpsDeliveryRepository };
  }
  it("delivers a claimed batch with one complete acknowledgement", async () => {
    const { records, repository, typed } = fixture();
    const exporter = { export: vi.fn(async () => undefined) };
    const result = await new DurableProviderOpsPublisher(typed, exporter, "owner").tick();
    expect(exporter.export.mock.calls).toEqual([[records]]);
    expect(repository.claimDue).toHaveBeenCalledWith("owner", 30000, 10);
    expect(repository.markDelivered).toHaveBeenCalledTimes(3);
    expect(repository.recordFailure).not.toHaveBeenCalled();
    expect(result).toEqual({ claimed: 3, delivered: 3, retried: 0, exhausted: 0 });
  });
  it("isolates a rejected record after an incomplete batch acknowledgement", async () => {
    const { records, repository, typed } = fixture();
    const exporter = {
      export: vi.fn(async (batch: ProviderOpsDeliveryRecord[]) => {
        if (batch.length > 1 || batch[0]?.recordId === "two") throw new Error("rejected");
      }),
    };
    const result = await new DurableProviderOpsPublisher(typed, exporter, "owner").tick();
    expect(exporter.export.mock.calls.map(([batch]) => batch.map((r) => r.recordId))).toEqual([
      records.map((r) => r.recordId),
      ["one"],
      ["two"],
      ["three"],
    ]);
    expect(repository.markDelivered.mock.calls).toEqual([
      ["one", "owner"],
      ["three", "owner"],
    ]);
    expect(repository.recordFailure).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ claimed: 3, delivered: 2, retried: 1, exhausted: 0 });
  });
});

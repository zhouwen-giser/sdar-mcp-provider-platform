import { describe, expect, it } from "vitest";
import { createBusinessEventProviderOpsEnvelope } from "../../packages/observability/src/index.js";

describe("Business Event Provider Ops envelope", () => {
  it("has stable record identity and hash across replicas and emitted time", () => {
    const input = {
      providerId: "provider-a",
      recordType: "provider.business_event.publication.lifecycle" as const,
      stableAggregateIdentity: "event-1",
      eventIdentity: "published",
      revision: "900719925474099312345",
      occurredAt: "2026-07-22T01:02:03.000Z",
      payload: {
        event: "published",
        eventId: "event-1",
        runtimeSequence: "900719925474099312345",
        rawPayload: "must disappear",
      },
    };
    const first = createBusinessEventProviderOpsEnvelope(
      { runtimeVersion: "2.0.0-rc.1", instanceId: "replica-a" },
      input,
    );
    const second = createBusinessEventProviderOpsEnvelope(
      { runtimeVersion: "2.0.0-rc.1", instanceId: "replica-b" },
      input,
    );
    expect(second.recordId).toBe(first.recordId);
    expect(second.recordHash).toBe(first.recordHash);
    expect(first.schemaVersion).toBe("1.1.0");
    expect(first.payload).toEqual({
      event: "published",
      eventId: "event-1",
      runtimeSequence: "900719925474099312345",
    });
    expect(first.providerEventSequence).toBeUndefined();
  });
});

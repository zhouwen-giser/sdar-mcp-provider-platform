import { describe, expect, it } from "vitest";
import {
  calculateProviderOpsRecordHash,
  createProviderOpsEnvelope,
  type ProviderOpsEnvelope,
} from "../../packages/observability/src/index.js";
import { providerOpsEnvelopeForExport } from "../../apps/runtime/src/runtime.js";

describe("Runtime ProviderOps durable authority", () => {
  it("preserves the authority instance frozen in the durable record", () => {
    const durable = {
      attributes: {},
      instanceId: "smpp-runtime-postgres-authority",
      emittedAt: "2026-08-31T12:47:34.186Z",
    } as ProviderOpsEnvelope;

    expect(providerOpsEnvelopeForExport(durable, "2026-08-31T13:20:00.000Z")).toMatchObject({
      instanceId: "smpp-runtime-postgres-authority",
      emittedAt: "2026-08-31T13:20:00.000Z",
    });
    expect(durable.instanceId).toBe("smpp-runtime-postgres-authority");
  });
});

it.each(["sdar.evidence.authority", "sdar.mission.authority"])(
  "replays queued navigation authority with registered identity: %s",
  (key) => {
    const durable = createProviderOpsEnvelope({
      recordType: "provider.resource.state",
      eventCategory: "resource.state",
      deliveryClass: "audit",
      providerId: "provider",
      runtimeVersion: "1",
      instanceId: "service-key",
      stableAggregateIdentity: "task",
      eventIdentity: "receipt",
      occurredAt: "2026-09-09T15:52:00.000Z",
      attributes: { [key]: "navigation_dispatch_receipt_v1" },
      payload: {},
    });
    const exported = providerOpsEnvelopeForExport(durable);
    expect(exported.instanceId).toBe("smpp-runtime-postgres-authority");
    expect(exported.recordId).toBe(durable.recordId);
    expect(calculateProviderOpsRecordHash(exported)).toBe(durable.recordHash);
    expect(durable.instanceId).toBe("service-key");
  },
);

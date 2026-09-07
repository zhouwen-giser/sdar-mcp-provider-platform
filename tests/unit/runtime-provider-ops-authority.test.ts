import { describe, expect, it } from "vitest";
import type { ProviderOpsEnvelope } from "../../packages/observability/src/index.js";
import { providerOpsEnvelopeForExport } from "../../apps/runtime/src/runtime.js";

describe("Runtime ProviderOps durable authority", () => {
  it("preserves the authority instance frozen in the durable record", () => {
    const durable = {
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

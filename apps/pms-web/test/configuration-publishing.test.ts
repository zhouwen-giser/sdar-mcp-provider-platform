import { describe, expect, it } from "vitest";
import { MockPmsWebDataSource } from "../src/data/mock-data-source.js";

describe("configuration publishing prototype", () => {
  it("never returns a secret value outside its SecretRef", async () => {
    const source = new MockPmsWebDataSource();
    const profile = (await source.configurationProfiles())[0];
    const secret = profile?.fields.find((field) => field.secretRef !== undefined);
    expect(secret?.value).toBe(secret?.secretRef);
    expect(secret?.secretRef).toMatch(/^secretref:\/\//);
  });

  it("simulates pull, apply and acknowledgements", async () => {
    let id = 0;
    const source = new MockPmsWebDataSource("healthy", { id: () => String(++id) });
    let operation = source.publishConfiguration("provider-runtime");
    expect((await source.runtimeConfigurationAcks("provider-runtime"))[0]?.status).toBe(
      "PENDING",
    );
    while (operation.status !== "COMPLETED")
      operation = source.advanceOperation(operation.operationId);
    const acks = await source.runtimeConfigurationAcks("provider-runtime");
    expect(acks.map((ack) => ack.status)).toEqual(["APPLIED", "RESTART_REQUIRED"]);
  });

  it("exposes scenario-specific pending, offline and partial ACK states", async () => {
    const pending = new MockPmsWebDataSource("pending-approval");
    expect((await pending.configurationProfiles())[0]?.status).toBe("PENDING_APPROVAL");
    const drift = new MockPmsWebDataSource("config-drift");
    expect((await drift.runtimeConfigurationAcks("provider-runtime"))[0]?.status).toBe(
      "OFFLINE",
    );
    const partial = new MockPmsWebDataSource("partial-data");
    expect((await partial.configurationProfiles())).toHaveLength(1);
  });
});

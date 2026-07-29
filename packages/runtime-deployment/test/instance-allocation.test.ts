import { describe, expect, it } from "vitest";
import {
  deriveRuntimeInstanceIdentity,
  runtimePortRange,
  runtimeProcessIdentity,
  selectRuntimePort,
} from "../src/index.js";

describe("Runtime instance identity and port allocation", () => {
  it("derives stable retry-safe identities and distinct ordinals", () => {
    const input = {
      providerId: "isr.vehicle:Provider_A",
      deploymentId: "deployment:production:A",
      ordinal: 0,
    };
    const first = deriveRuntimeInstanceIdentity(input);
    const replay = deriveRuntimeInstanceIdentity(input);
    const second = deriveRuntimeInstanceIdentity({ ...input, ordinal: 1 });

    expect(first).toEqual(replay);
    expect(first.instanceId).not.toBe(second.instanceId);
    expect(first.pm2Name).not.toBe(second.pm2Name);
    expect(first.pm2Name).toMatch(/^sdar-runtime-isr-vehicle-provider-a-[0-9a-f]{12}-0$/);
    expect(first.pm2Name.length).toBeLessThanOrEqual(128);
  });

  it("normalizes allowed logical punctuation and rejects injection-shaped Provider IDs", () => {
    expect(
      deriveRuntimeInstanceIdentity({
        providerId: "Provider...A:::B___C",
        deploymentId: "deployment-1",
        ordinal: 0,
      }).pm2Name,
    ).toMatch(/^sdar-runtime-provider-a-b-c-[0-9a-f]{12}-0$/);
    for (const providerId of [
      "provider;touch-pwned",
      "../provider",
      "provider $(command)",
      "provider\nNODE_OPTIONS=x",
    ]) {
      expect(() =>
        deriveRuntimeInstanceIdentity({
          providerId,
          deploymentId: "deployment-1",
          ordinal: 0,
        }),
      ).toThrow(expect.objectContaining({ code: "INVALID_RUNTIME_DEPLOYMENT_IDENTIFIER" }));
    }
  });

  it("selects the first free port and fails closed when the bounded range is exhausted", () => {
    const range = runtimePortRange(31_000, 31_002);
    expect(selectRuntimePort(range, new Set([31_000, 31_002]))).toBe(31_001);
    expect(() => selectRuntimePort(range, new Set([31_000, 31_001, 31_002]))).toThrow(
      expect.objectContaining({ code: "RUNTIME_PORT_RANGE_EXHAUSTED" }),
    );
    expect(() => runtimePortRange(1, 65_535)).toThrow(
      expect.objectContaining({ code: "INVALID_RUNTIME_INSTANCE_ALLOCATION" }),
    );
  });

  it("combines a derived identity only with a valid allocated port", () => {
    const identity = deriveRuntimeInstanceIdentity({
      providerId: "provider-a",
      deploymentId: "deployment-1",
      ordinal: 0,
    });
    expect(runtimeProcessIdentity(identity, 31_000)).toMatchObject({
      instanceId: identity.instanceId,
      deploymentId: identity.deploymentId,
      pm2Name: identity.pm2Name,
      port: 31_000,
    });
  });
});

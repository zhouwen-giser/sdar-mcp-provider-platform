import { describe, expect, it } from "vitest";
import { AdapterManifestWatcher } from "../../apps/runtime/src/manifest-watcher.js";
import {
  jsonToProtoStruct,
  type ProviderManifest,
} from "../../packages/adapter-protocol/src/index.js";
import type { GrpcAdapterGateway } from "../../packages/adapter-protocol/src/index.js";
import { OperationRegistry } from "../../packages/operation-registry/src/index.js";

describe("H5 Adapter Manifest drift detection", () => {
  it("latches readiness failure after the startup Manifest changes", async () => {
    const startup = manifest("1.0.0");
    let current = startup;
    const gateway = {
      describeProvider: () => Promise.resolve(current),
    } as unknown as GrpcAdapterGateway;
    const startupHash = new OperationRegistry().validate(startup).manifestHash;
    const watcher = new AdapterManifestWatcher(gateway, startupHash);

    await expect(watcher.tick()).resolves.toBeUndefined();
    current = manifest("1.0.1");
    await expect(watcher.tick()).rejects.toThrow("ADAPTER_MANIFEST_DRIFT");
    current = startup;
    await expect(watcher.tick()).rejects.toThrow("ADAPTER_MANIFEST_DRIFT");
  });
});

function manifest(providerVersion: string): ProviderManifest {
  return {
    adapterProtocolVersion: "1.0",
    providerId: "test-provider",
    providerType: "test",
    providerVersion,
    inventoryMode: "OPAQUE",
    operations: [
      {
        name: "echo_sync",
        description: "Echo",
        execution: "SYNCHRONOUS",
        inputSchema: jsonToProtoStruct({ type: "object" }),
        outputSchema: jsonToProtoStruct({ type: "object" }),
        capabilities: {
          availability: true,
          scheduling: false,
          maxElapsed: false,
          cancel: false,
          pauseResume: false,
          inputRequired: false,
          idempotency: true,
          observations: false,
        },
      },
    ],
  };
}

import type { GrpcAdapterGateway } from "../../../packages/adapter-protocol/src/index.js";
import { OperationRegistry } from "../../../packages/operation-registry/src/index.js";

export class AdapterManifestWatcher {
  #drifted = false;

  constructor(
    readonly gateway: GrpcAdapterGateway,
    readonly startupManifestHash: string,
    readonly registry = new OperationRegistry(),
  ) {}

  async tick(): Promise<void> {
    if (this.#drifted) throw new Error("ADAPTER_MANIFEST_DRIFT");
    const description = await this.gateway.describeProvider();
    let currentHash: string;
    try {
      currentHash = this.registry.validate(description).manifestHash;
    } catch (error) {
      this.#drifted = true;
      throw new Error("ADAPTER_MANIFEST_INVALID", { cause: error });
    }
    if (currentHash !== this.startupManifestHash) {
      this.#drifted = true;
      throw new Error("ADAPTER_MANIFEST_DRIFT");
    }
  }
}

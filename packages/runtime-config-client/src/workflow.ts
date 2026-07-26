import { createRuntimeConfigCacheArtifact } from "./client.js";
import type { RuntimeConfigClient } from "./client.js";
import type {
  RuntimeConfigAckOutbox,
  RuntimeConfigAcknowledgement,
  RuntimeConfigAcknowledgementPort,
  RuntimeConfigApplyHandler,
  RuntimeConfigCacheStore,
  RuntimeConfigDocument,
  RuntimeConfigTarget,
  RuntimeConfigWatchPort,
} from "./model.js";

export type RuntimeConfigSyncResult =
  | { readonly state: "lkg"; readonly document: RuntimeConfigDocument }
  | { readonly state: "unchanged"; readonly document: RuntimeConfigDocument }
  | { readonly state: "applied"; readonly document: RuntimeConfigDocument }
  | { readonly state: "restart_required"; readonly document: RuntimeConfigDocument }
  | {
      readonly state: "rejected";
      readonly document: RuntimeConfigDocument;
      readonly reasonCode: "RUNTIME_CONFIG_APPLY_FAILED" | "RUNTIME_CONFIG_IMMUTABLE";
    };

export interface RuntimeConfigWorkflowOptions {
  readonly reconnectDelay?: (attempt: number) => Promise<void>;
}

export class RuntimeConfigApplyHandlerRegistry {
  readonly #handlers = new Map<string, RuntimeConfigApplyHandler>();

  register(configGroup: string, handler: RuntimeConfigApplyHandler): void {
    if (configGroup.length === 0 || this.#handlers.has(configGroup)) {
      throw new Error("RUNTIME_CONFIG_APPLY_HANDLER_DUPLICATE");
    }
    this.#handlers.set(configGroup, handler);
  }

  get(configGroup: string): RuntimeConfigApplyHandler | undefined {
    return this.#handlers.get(configGroup);
  }
}

export class RuntimeConfigWorkflow {
  readonly #reconnectDelay: (attempt: number) => Promise<void>;

  constructor(
    private readonly target: RuntimeConfigTarget,
    private readonly client: RuntimeConfigClient,
    private readonly lkg: RuntimeConfigCacheStore,
    private readonly handlers: RuntimeConfigApplyHandlerRegistry,
    private readonly acknowledgements: RuntimeConfigAcknowledgementPort,
    private readonly outbox: RuntimeConfigAckOutbox,
    private readonly watch?: RuntimeConfigWatchPort,
    options: RuntimeConfigWorkflowOptions = {},
  ) {
    this.#reconnectDelay =
      options.reconnectDelay ??
      ((attempt) =>
        new Promise((resolve) => {
          setTimeout(resolve, Math.min(500 * 2 ** Math.min(attempt - 1, 6), 30_000));
        }));
  }

  async syncOnce(): Promise<RuntimeConfigSyncResult> {
    await this.flushAcknowledgements();
    const candidate = await this.client.pullCandidate(this.target);
    if (candidate.source === "lkg") {
      return {
        state: candidate.fallbackReason === undefined ? "unchanged" : "lkg",
        document: candidate.document,
      };
    }
    if (!candidate.changed) {
      return { state: "unchanged", document: candidate.document };
    }

    const document = candidate.document;
    if (document.applyMode === "restart_required") {
      await this.#queueAndAttempt({
        revisionId: document.revisionId,
        status: "restart_required",
      });
      return { state: "restart_required", document };
    }
    if (document.applyMode === "immutable") {
      const reasonCode = "RUNTIME_CONFIG_IMMUTABLE";
      await this.#queueAndAttempt({
        revisionId: document.revisionId,
        status: "rejected",
        reasonCode,
      });
      return { state: "rejected", document, reasonCode };
    }

    const handler = this.handlers.get(this.target.configGroup);
    try {
      if (handler === undefined) throw new Error("APPLY_HANDLER_NOT_FOUND");
      await handler.apply(document, document.applyMode);
    } catch {
      const reasonCode = "RUNTIME_CONFIG_APPLY_FAILED";
      await this.#queueAndAttempt({
        revisionId: document.revisionId,
        status: "rejected",
        reasonCode,
      });
      return { state: "rejected", document, reasonCode };
    }

    await this.lkg.write(createRuntimeConfigCacheArtifact(candidate.etag, document));
    await this.#queueAndAttempt({
      revisionId: document.revisionId,
      status: "applied",
      appliedChecksum: document.checksum,
    });
    return { state: "applied", document };
  }

  async flushAcknowledgements(): Promise<void> {
    for (const record of await this.outbox.list()) {
      try {
        await this.acknowledgements.acknowledge(record.target, record.acknowledgement);
        await this.outbox.remove(record.acknowledgement.revisionId);
      } catch {
        return;
      }
    }
  }

  async run(signal: AbortSignal): Promise<void> {
    let reconnectAttempt = 0;
    while (!signal.aborted) {
      try {
        await this.syncOnce();
        if (this.watch === undefined) return;
        for await (const hint of this.watch.watch(this.target, signal)) {
          void hint;
          if (isAborted(signal)) return;
          await this.syncOnce();
        }
        reconnectAttempt = 0;
      } catch {
        // Pull failures without an LKG and Watch disconnects are retried. A valid
        // LKG remains untouched and usable throughout the reconnect cycle.
      }
      if (isAborted(signal)) return;
      reconnectAttempt += 1;
      await this.#reconnectDelay(reconnectAttempt);
    }
  }

  async #queueAndAttempt(acknowledgement: RuntimeConfigAcknowledgement): Promise<void> {
    await this.outbox.put({ target: this.target, acknowledgement });
    await this.flushAcknowledgements();
  }
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

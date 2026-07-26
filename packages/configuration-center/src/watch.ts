import type { RuntimeConfigClientRequest } from "./runtime-query.js";

export interface RuntimeConfigRevisionHint {
  readonly revisionId: string;
  readonly revision: number;
  readonly checksum: string;
}

export interface ConfigurationPublishedEvent extends RuntimeConfigRevisionHint {
  readonly environment: string;
  readonly targetType: "runtime_deployment" | "runtime_instance";
  readonly targetId: string;
  readonly deploymentId?: string;
  readonly configGroup: string;
  readonly dataId: string;
}

export interface RuntimeConfigWatchSubscription {
  next(): Promise<RuntimeConfigRevisionHint | null>;
  close(): void;
}

export class RuntimeConfigWatchHub {
  readonly #subscriptions = new Set<Subscription>();

  constructor(private readonly maximumSubscribers = 1_000) {
    if (!Number.isSafeInteger(maximumSubscribers) || maximumSubscribers < 1) {
      throw new RangeError("RUNTIME_CONFIG_WATCH_CAPACITY_INVALID");
    }
  }

  subscribe(request: RuntimeConfigClientRequest): RuntimeConfigWatchSubscription {
    if (this.#subscriptions.size >= this.maximumSubscribers) {
      throw new RangeError("RUNTIME_CONFIG_WATCH_CAPACITY_EXCEEDED");
    }
    const subscription = new Subscription(request, () => {
      this.#subscriptions.delete(subscription);
    });
    this.#subscriptions.add(subscription);
    return subscription;
  }

  publish(event: ConfigurationPublishedEvent): void {
    for (const subscription of this.#subscriptions) subscription.publish(event);
  }
}

class Subscription implements RuntimeConfigWatchSubscription {
  readonly #queued: RuntimeConfigRevisionHint[] = [];
  readonly #waiters: ((hint: RuntimeConfigRevisionHint | null) => void)[] = [];
  #closed = false;

  constructor(
    private readonly request: RuntimeConfigClientRequest,
    private readonly onClose: () => void,
  ) {}

  next(): Promise<RuntimeConfigRevisionHint | null> {
    if (this.#closed) return Promise.resolve(null);
    const queued = this.#queued.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  publish(event: ConfigurationPublishedEvent): void {
    if (this.#closed || !matches(this.request, event)) return;
    const hint = {
      revisionId: event.revisionId,
      revision: event.revision,
      checksum: event.checksum,
    };
    const waiter = this.#waiters.shift();
    if (waiter === undefined) this.#queued.push(hint);
    else waiter(hint);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#queued.length = 0;
    for (const waiter of this.#waiters.splice(0)) waiter(null);
    this.onClose();
  }
}

function matches(request: RuntimeConfigClientRequest, event: ConfigurationPublishedEvent): boolean {
  return (
    request.environment === event.environment &&
    request.configGroup === event.configGroup &&
    request.dataId === event.dataId &&
    (event.targetType === "runtime_deployment"
      ? request.deploymentId === event.targetId
      : request.instanceId === event.targetId &&
        (event.deploymentId === undefined || request.deploymentId === event.deploymentId))
  );
}

import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { AuthorizationContext } from "../../../domain/src/index.js";
import { isRuntimeError } from "../../../domain/src/index.js";
import type { TaskEngine } from "../../../task-engine/src/index.js";
import { FrozenErrorCode, FrozenProtocolError, invalidParams } from "./errors.js";
import type { FrozenJsonRpcRequest } from "./request-validator.js";

export interface TaskNotificationMetrics {
  increment(name: string, labels?: Record<string, string>, amount?: number): void;
  gauge(name: string, value: number): void;
}

export interface TaskNotificationStreamOptions {
  pollIntervalMs?: number;
  maxSubscriptions?: number;
  maxSubscriptionsPerAuth?: number;
  maxTaskBindings?: number;
  maxQueueMessages?: number;
  maxQueueBytes?: number;
  batchSize?: number;
  metrics?: TaskNotificationMetrics;
}

export interface SubscriptionIdentity {
  internalId: string;
  transportScopeId: string;
  wireRequestId: string | number;
  typedWireRequestKey: string;
  authorizationScope: string;
}

interface WriterOptions {
  maxMessages: number;
  maxBytes: number;
  onQueueDelta(messages: number, bytes: number): void;
  onRejected(reason: "queue_message_limit" | "queue_byte_limit"): void;
  onSent(): void;
}

export class TaskNotificationWriter {
  readonly #queue: { frame: string; bytes: number }[] = [];
  #queueBytes = 0;
  #waitingForDrain = false;
  #closed = false;

  constructor(
    readonly response: ServerResponse,
    readonly options: WriterOptions,
  ) {}

  enqueue(message: Record<string, unknown>): boolean {
    if (this.#closed) return false;
    const frame = `event: message\ndata: ${JSON.stringify(message)}\n\n`;
    const bytes = Buffer.byteLength(frame);
    if (this.#queue.length + 1 > this.options.maxMessages) {
      this.options.onRejected("queue_message_limit");
      this.close();
      return false;
    }
    if (this.#queueBytes + bytes > this.options.maxBytes) {
      this.options.onRejected("queue_byte_limit");
      this.close();
      return false;
    }
    this.#queue.push({ frame, bytes });
    this.#queueBytes += bytes;
    this.options.onQueueDelta(1, bytes);
    this.#flush();
    return true;
  }

  close(): void {
    if (this.#closed) return;
    this.dispose();
    this.response.end();
  }

  dispose(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#queue.length > 0) {
      this.options.onQueueDelta(-this.#queue.length, -this.#queueBytes);
      this.#queue.length = 0;
      this.#queueBytes = 0;
    }
  }

  #flush(): void {
    if (this.#closed || this.#waitingForDrain) return;
    while (this.#queue.length > 0) {
      const next = this.#queue.shift();
      if (next === undefined) return;
      this.#queueBytes -= next.bytes;
      this.options.onQueueDelta(-1, -next.bytes);
      const writable = this.response.write(next.frame);
      this.options.onSent();
      if (!writable) {
        this.#waitingForDrain = true;
        this.response.once("drain", () => {
          this.#waitingForDrain = false;
          this.#flush();
        });
        return;
      }
    }
  }
}

export class TaskNotificationSubscription {
  readonly cancellation = new AbortController();
  readonly revisions = new Map<string, NotificationState>();
  readonly writer: TaskNotificationWriter;
  readonly startedAt = Date.now();
  acceptedTaskIds: string[] = [];

  constructor(
    readonly identity: SubscriptionIdentity,
    readonly authorization: AuthorizationContext,
    readonly response: ServerResponse,
    writerOptions: WriterOptions,
  ) {
    this.writer = new TaskNotificationWriter(response, writerOptions);
  }
}

type NotificationTaskEngine = Pick<TaskEngine, "getFrozenTask"> &
  Partial<Pick<TaskEngine, "getFrozenTasks">>;

export class TaskNotificationManager {
  readonly #options: Required<Omit<TaskNotificationStreamOptions, "metrics">>;
  readonly #metrics: TaskNotificationMetrics | undefined;
  readonly #subscriptions = new Map<string, TaskNotificationSubscription>();
  readonly #transportWireIndex = new Map<string, Set<string>>();
  #timer: NodeJS.Timeout | undefined;
  #polling = false;
  #taskBindings = 0;
  #queueMessages = 0;
  #queueBytes = 0;

  constructor(
    readonly taskEngine: NotificationTaskEngine,
    options: TaskNotificationStreamOptions = {},
  ) {
    this.#options = {
      pollIntervalMs: options.pollIntervalMs ?? 500,
      maxSubscriptions: options.maxSubscriptions ?? 256,
      maxSubscriptionsPerAuth: options.maxSubscriptionsPerAuth ?? 32,
      maxTaskBindings: options.maxTaskBindings ?? 4096,
      maxQueueMessages: options.maxQueueMessages ?? 64,
      maxQueueBytes: options.maxQueueBytes ?? 1_048_576,
      batchSize: options.batchSize ?? 256,
    };
    this.#metrics = options.metrics;
  }

  async listen(
    request: FrozenJsonRpcRequest,
    response: ServerResponse,
    authorization: AuthorizationContext,
    transportScopeId = "direct",
  ): Promise<void> {
    const requestedTaskIds = parseTaskIds(request.params);
    const identity = subscriptionIdentity(request.id, transportScopeId, authorization);
    this.#assertCapacity(identity.authorizationScope, requestedTaskIds.length);
    const transportKey = transportWireIndexKey(identity);
    const existing = this.#transportWireIndex.get(transportKey);
    if (
      existing !== undefined &&
      [...existing].some(
        (internalId) =>
          this.#subscriptions.get(internalId)?.identity.authorizationScope ===
          identity.authorizationScope,
      )
    ) {
      throw invalidParams();
    }
    const subscription = new TaskNotificationSubscription(identity, authorization, response, {
      maxMessages: this.#options.maxQueueMessages,
      maxBytes: this.#options.maxQueueBytes,
      onQueueDelta: (messages, bytes) => this.#updateQueueMetrics(messages, bytes),
      onRejected: (reason) => {
        this.#increment("sdar_task_notification_events_total", { outcome: "overflow" });
        this.#increment("sdar_task_notification_rejections_total", { reason });
      },
      onSent: () => this.#increment("sdar_task_notification_events_total", { outcome: "sent" }),
    });
    subscription.acceptedTaskIds = requestedTaskIds;
    this.#subscriptions.set(identity.internalId, subscription);
    this.#taskBindings += requestedTaskIds.length;
    this.#updateActiveMetrics();
    const indexed = existing ?? new Set<string>();
    indexed.add(identity.internalId);
    this.#transportWireIndex.set(transportKey, indexed);
    try {
      const current = await this.#authorizedSnapshots(requestedTaskIds, authorization);
      this.#taskBindings += current.size - subscription.acceptedTaskIds.length;
      subscription.acceptedTaskIds = [...current.keys()].sort();
      this.#updateActiveMetrics();

      response.statusCode = 200;
      response.setHeader("content-type", "text/event-stream");
      response.setHeader("cache-control", "no-cache, no-transform");
      response.setHeader("connection", "keep-alive");
      response.flushHeaders();

      if (!subscription.writer.enqueue(acknowledged(request.id, subscription.acceptedTaskIds)))
        return;
      for (const taskId of subscription.acceptedTaskIds) {
        const snapshot = current.get(taskId);
        if (snapshot === undefined) continue;
        const revision = runtimeRevision(snapshot);
        subscription.revisions.set(taskId, notificationState(snapshot, revision));
        if (!this.#enqueueTaskNotification(subscription, snapshot)) return;
      }
      if (subscription.acceptedTaskIds.length === 0) {
        subscription.writer.close();
        return;
      }
      this.#startPolling();
      await this.#waitForSubscription(subscription);
    } finally {
      this.#release(subscription);
    }
  }

  cancel(
    requestId: string | number,
    transportScopeId = "direct",
    authorization?: AuthorizationContext,
  ): boolean {
    const key = transportWireIndexKey({
      transportScopeId,
      typedWireRequestKey: typedWireRequestKey(requestId),
    });
    const candidates = [...(this.#transportWireIndex.get(key) ?? [])]
      .map((internalId) => this.#subscriptions.get(internalId))
      .filter((candidate): candidate is TaskNotificationSubscription => candidate !== undefined)
      .filter(
        (candidate) =>
          authorization === undefined ||
          candidate.identity.authorizationScope === authorizationScope(authorization),
      );
    if (candidates.length !== 1) return false;
    candidates[0]?.cancellation.abort();
    return true;
  }

  handleCancelledNotification(
    value: unknown,
    transportScopeId = "direct",
    authorization?: AuthorizationContext,
  ): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidParams();
    const notification = value as Record<string, unknown>;
    if (notification.jsonrpc !== "2.0" || notification.method !== "notifications/cancelled") {
      throw invalidParams();
    }
    const params = notification.params;
    if (typeof params !== "object" || params === null || Array.isArray(params))
      throw invalidParams();
    const record = params as Record<string, unknown>;
    if (
      Object.keys(record).length !== 1 ||
      (typeof record.requestId !== "string" && !Number.isInteger(record.requestId))
    ) {
      throw invalidParams();
    }
    return this.cancel(record.requestId as string | number, transportScopeId, authorization);
  }

  async #waitForSubscription(subscription: TaskNotificationSubscription): Promise<void> {
    await new Promise<void>((resolve) => {
      let closed = false;
      const close = (): void => {
        if (closed) return;
        closed = true;
        subscription.cancellation.signal.removeEventListener("abort", cancel);
        resolve();
      };
      const cancel = (): void => {
        subscription.writer.close();
        close();
      };
      subscription.response.once("close", close);
      subscription.response.once("error", close);
      subscription.cancellation.signal.addEventListener("abort", cancel, { once: true });
    });
  }

  #startPolling(): void {
    if (this.#timer !== undefined) return;
    this.#timer = setInterval(() => {
      if (this.#polling) return;
      this.#polling = true;
      void this.#pollAll()
        .catch(() => {
          for (const subscription of this.#subscriptions.values()) subscription.writer.close();
        })
        .finally(() => {
          this.#polling = false;
        });
    }, this.#options.pollIntervalMs);
    this.#timer.unref();
  }

  async #pollAll(): Promise<void> {
    const groups = new Map<string, TaskNotificationSubscription[]>();
    for (const subscription of this.#subscriptions.values()) {
      const group = groups.get(subscription.identity.authorizationScope) ?? [];
      group.push(subscription);
      groups.set(subscription.identity.authorizationScope, group);
    }
    for (const subscriptions of groups.values()) {
      const authorization = subscriptions[0]?.authorization;
      if (authorization === undefined) continue;
      const taskIds = [...new Set(subscriptions.flatMap((item) => item.acceptedTaskIds))].sort();
      const snapshots = await this.#authorizedSnapshots(taskIds, authorization);
      for (const subscription of subscriptions) {
        for (const taskId of subscription.acceptedTaskIds) {
          const snapshot = snapshots.get(taskId);
          if (snapshot !== undefined) this.#deliverChangedSnapshot(subscription, taskId, snapshot);
        }
      }
    }
  }

  #deliverChangedSnapshot(
    subscription: TaskNotificationSubscription,
    taskId: string,
    snapshot: Record<string, unknown>,
  ): void {
    const revision = runtimeRevision(snapshot);
    const previous = subscription.revisions.get(taskId);
    if (previous !== undefined && BigInt(revision) < BigInt(previous.revision)) {
      throw new Error("TASK_NOTIFICATION_REVISION_REGRESSION");
    }
    const next = notificationState(snapshot, revision);
    if (previous?.revision === revision) {
      if (previous.signature !== next.signature)
        throw new Error("TASK_NOTIFICATION_REVISION_CONFLICT");
      this.#increment("sdar_task_notification_events_total", { outcome: "deduplicated" });
      return;
    }
    if (previous?.terminal === true && !next.terminal) {
      throw new Error("TASK_NOTIFICATION_TERMINAL_REGRESSION");
    }
    subscription.revisions.set(taskId, next);
    this.#enqueueTaskNotification(subscription, snapshot);
  }

  async #authorizedSnapshots(
    taskIds: string[],
    authorization: AuthorizationContext,
  ): Promise<Map<string, Record<string, unknown>>> {
    const snapshots = new Map<string, Record<string, unknown>>();
    for (let offset = 0; offset < taskIds.length; offset += this.#options.batchSize) {
      const batch = taskIds.slice(offset, offset + this.#options.batchSize);
      this.#increment("sdar_task_notification_poll_batches_total");
      this.#increment("sdar_task_notification_poll_tasks_total", {}, batch.length);
      if (this.taskEngine.getFrozenTasks !== undefined) {
        const loaded = await this.taskEngine.getFrozenTasks(batch, authorization);
        for (const [taskId, snapshot] of loaded) snapshots.set(taskId, snapshot);
        continue;
      }
      for (const taskId of batch) {
        const snapshot = await this.#authorizedSnapshot(taskId, authorization);
        if (snapshot !== undefined) snapshots.set(taskId, snapshot);
      }
    }
    return snapshots;
  }

  async #authorizedSnapshot(
    taskId: string,
    authorization: AuthorizationContext,
  ): Promise<Record<string, unknown> | undefined> {
    try {
      return await this.taskEngine.getFrozenTask(taskId, authorization, "notification");
    } catch (error) {
      if (
        isRuntimeError(error) &&
        (error.kind === "task_not_found" || error.kind === "task_expired")
      ) {
        return undefined;
      }
      throw error;
    }
  }

  #assertCapacity(authorizationKey: string, requestedBindings: number): void {
    const perAuthorization = [...this.#subscriptions.values()].filter(
      (subscription) => subscription.identity.authorizationScope === authorizationKey,
    ).length;
    const reason =
      this.#subscriptions.size >= this.#options.maxSubscriptions
        ? "replica_limit"
        : perAuthorization >= this.#options.maxSubscriptionsPerAuth
          ? "authorization_limit"
          : this.#taskBindings + requestedBindings > this.#options.maxTaskBindings
            ? "binding_limit"
            : null;
    if (reason !== null) {
      this.#increment("sdar_task_notification_rejections_total", { reason });
      throw new FrozenProtocolError(
        FrozenErrorCode.InternalError,
        "Task notification capacity exceeded",
        503,
        {
          reasonCode: "TASK_NOTIFICATION_CAPACITY_EXCEEDED",
          retryable: true,
        },
      );
    }
  }

  #enqueueTaskNotification(
    subscription: TaskNotificationSubscription,
    snapshot: Record<string, unknown>,
  ): boolean {
    return subscription.writer.enqueue(
      taskNotification(subscription.identity.wireRequestId, snapshot),
    );
  }

  #release(subscription: TaskNotificationSubscription): void {
    if (!this.#subscriptions.delete(subscription.identity.internalId)) return;
    subscription.writer.dispose();
    this.#increment("sdar_task_notification_events_total", { outcome: "closed" });
    this.#taskBindings -= subscription.acceptedTaskIds.length;
    const key = transportWireIndexKey(subscription.identity);
    const indexed = this.#transportWireIndex.get(key);
    indexed?.delete(subscription.identity.internalId);
    if (indexed?.size === 0) this.#transportWireIndex.delete(key);
    this.#increment(
      "sdar_task_notification_stream_duration_seconds",
      {},
      (Date.now() - subscription.startedAt) / 1000,
    );
    this.#updateActiveMetrics();
    if (this.#subscriptions.size === 0 && this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  #updateQueueMetrics(messages: number, bytes: number): void {
    this.#queueMessages += messages;
    this.#queueBytes += bytes;
    this.#gauge("sdar_task_notification_queue_messages", this.#queueMessages);
    this.#gauge("sdar_task_notification_queue_bytes", this.#queueBytes);
  }

  #updateActiveMetrics(): void {
    this.#gauge("sdar_task_notification_active_subscriptions", this.#subscriptions.size);
    this.#gauge("sdar_task_notification_active_bindings", this.#taskBindings);
  }

  #increment(name: string, labels: Record<string, string> = {}, amount = 1): void {
    try {
      this.#metrics?.increment(name, labels, amount);
    } catch {
      // Telemetry is fail-open and cannot affect subscription behavior.
    }
  }

  #gauge(name: string, value: number): void {
    try {
      this.#metrics?.gauge(name, value);
    } catch {
      // Telemetry is fail-open and cannot affect subscription behavior.
    }
  }
}

export class TaskNotificationStream extends TaskNotificationManager {}

interface NotificationState {
  revision: string;
  signature: string;
  terminal: boolean;
}

function subscriptionIdentity(
  wireRequestId: string | number,
  transportScopeId: string,
  authorization: AuthorizationContext,
): SubscriptionIdentity {
  return {
    internalId: randomUUID(),
    transportScopeId,
    wireRequestId,
    typedWireRequestKey: typedWireRequestKey(wireRequestId),
    authorizationScope: authorizationScope(authorization),
  };
}

function typedWireRequestKey(requestId: string | number): string {
  return `${typeof requestId}:${String(requestId)}`;
}
function authorizationScope(authorization: AuthorizationContext): string {
  return [authorization.hash, authorization.executionMode, authorization.simulationId ?? ""].join(
    ":",
  );
}
function transportWireIndexKey(
  identity: Pick<SubscriptionIdentity, "transportScopeId" | "typedWireRequestKey">,
): string {
  return `${identity.transportScopeId}\u0000${identity.typedWireRequestKey}`;
}
function notificationState(snapshot: Record<string, unknown>, revision: string): NotificationState {
  return {
    revision,
    signature: JSON.stringify(snapshot),
    terminal: new Set(["completed", "failed", "cancelled"]).has(String(snapshot.status)),
  };
}

function parseTaskIds(params: Record<string, unknown>): string[] {
  if (Object.keys(params).some((key) => key !== "notifications" && key !== "_meta"))
    throw invalidParams();
  const notifications = params.notifications;
  if (notifications === null || typeof notifications !== "object" || Array.isArray(notifications))
    throw invalidParams();
  const record = notifications as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "taskIds")) throw invalidParams();
  const taskIds = record.taskIds;
  if (!Array.isArray(taskIds) || taskIds.length > 256) throw invalidParams();
  if (taskIds.some((taskId) => typeof taskId !== "string" || taskId.length === 0))
    throw invalidParams();
  return [...new Set(taskIds as string[])].sort();
}

function acknowledged(subscriptionId: string | number, taskIds: string[]): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    method: "notifications/subscriptions/acknowledged",
    params: {
      _meta: { "io.modelcontextprotocol/subscriptionId": subscriptionId },
      notifications: { taskIds },
    },
  };
}

function taskNotification(
  subscriptionId: string | number,
  snapshot: Record<string, unknown>,
): Record<string, unknown> {
  const meta =
    typeof snapshot._meta === "object" && snapshot._meta !== null && !Array.isArray(snapshot._meta)
      ? (snapshot._meta as Record<string, unknown>)
      : {};
  return {
    jsonrpc: "2.0",
    method: "notifications/tasks",
    params: {
      ...snapshot,
      _meta: { ...meta, "io.modelcontextprotocol/subscriptionId": subscriptionId },
    },
  };
}

function runtimeRevision(snapshot: Record<string, unknown>): string {
  const meta = snapshot._meta as Record<string, Record<string, unknown>> | undefined;
  const revision = meta?.["io.sdar/taskExecution"]?.runtimeRevision;
  if (typeof revision !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(revision))
    throw new Error("TASK_NOTIFICATION_REVISION_INVALID");
  return revision;
}

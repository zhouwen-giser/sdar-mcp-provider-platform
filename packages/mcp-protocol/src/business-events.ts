import type { ServerResponse } from "node:http";
import type { AuthorizationContext } from "../../domain/src/index.js";
import type {
  BusinessEventGeneration,
  BusinessEventSourceDefinition,
  FinalizedBusinessEvent,
  ProjectionIdentity,
  ProjectionPage,
  RotationResult,
} from "../../persistence-postgres/src/index.js";
import { FrozenErrorCode, FrozenProtocolError, invalidParams } from "./sep2663/errors.js";
import type { FrozenJsonRpcRequest } from "./sep2663/request-validator.js";
import { TaskNotificationWriter } from "./sep2663/notifications.js";

export const BUSINESS_EVENTS_EXTENSION = "io.sdar/businessEvents";
export const BUSINESS_EVENTS_PROFILE_VERSION = "1.0";

export interface AuthorizedBusinessEventProjection {
  event: FinalizedBusinessEvent;
  relatedTaskIds: string[];
  candidateRelationHash: string;
  projectionRelationHash: string;
}

export interface BusinessEventReader {
  currentGeneration(providerId: string): Promise<BusinessEventGeneration | undefined>;
  generation(providerId: string, streamId: string): Promise<BusinessEventGeneration | undefined>;
  sourceRoster(providerId: string, streamId: string): Promise<BusinessEventSourceDefinition[]>;
  replayEvents(
    providerId: string,
    streamId: string,
    afterSequence: string,
    throughSequence: string,
    limit: number,
  ): Promise<FinalizedBusinessEvent[]>;
  authorizedEventProjection(
    providerId: string,
    streamId: string,
    eventId: string,
    authorization: {
      authorizationScopeHash: string;
      executionMode: AuthorizationContext["executionMode"];
      simulationId: string | null;
    },
  ): Promise<AuthorizedBusinessEventProjection | undefined>;
  continuityForPreviousStream(
    providerId: string,
    previousStreamId: string,
  ): Promise<RotationResult | undefined>;
}

export interface BusinessEventNotificationOptions {
  pollIntervalMs?: number;
  replayBatchSize?: number;
  maxQueueMessages?: number;
  maxQueueBytes?: number;
  maxStreamDurationMs?: number;
  maxSubscriptions?: number;
  maxSubscriptionsPerAuth?: number;
  metrics?: BusinessEventMetrics;
}

export interface BusinessEventMetrics {
  increment(name: string, labels?: Record<string, string>, amount?: number): void;
  gauge(name: string, value: number, labels?: Record<string, string>): void;
  event?(name: string, body: Record<string, unknown>): void;
  trace?<T>(
    name: string,
    attributes: Record<string, string | number | boolean>,
    operation: () => Promise<T>,
  ): Promise<T>;
}

export interface BusinessEventRelationReader extends BusinessEventReader {
  createRelationProjection(
    identity: ProjectionIdentity,
    taskIds: string[],
    ttlMs: number,
  ): Promise<string>;
  relationProjectionPage(
    token: string,
    expected: Pick<ProjectionIdentity, "providerId" | "streamId" | "eventId">,
    authorization: Pick<
      ProjectionIdentity,
      "authorizationScopeHash" | "executionMode" | "simulationId"
    >,
    afterTaskId: string | undefined,
    limit: number,
  ): Promise<ProjectionPage>;
}

export class BusinessEventRelationManager {
  constructor(
    readonly providerId: string,
    readonly reader: BusinessEventRelationReader,
    readonly projectionTtlMs = 300_000,
    readonly metrics?: BusinessEventMetrics,
  ) {}

  async list(
    request: FrozenJsonRpcRequest,
    authorization: AuthorizationContext,
  ): Promise<Record<string, unknown>> {
    return traceBusinessEvent(this.metrics, "business_events.relation.query", {}, () =>
      this.#list(request, authorization),
    );
  }

  async #list(
    request: FrozenJsonRpcRequest,
    authorization: AuthorizationContext,
  ): Promise<Record<string, unknown>> {
    requireBusinessEventsCapability(request);
    const parsed = parseRelationRequest(request.params);
    const generation = await this.reader.generation(this.providerId, parsed.streamId);
    if (generation === undefined || generation.status === "retired") {
      throw relationError("BUSINESS_EVENT_STREAM_RESET", 409);
    }
    const authorizationIdentity = {
      authorizationScopeHash: authorization.hash,
      executionMode: authorization.executionMode,
      simulationId: authorization.simulationId,
    };
    try {
      let projectionToken = parsed.projectionToken;
      if (projectionToken === undefined) {
        const projection = await this.reader.authorizedEventProjection(
          this.providerId,
          parsed.streamId,
          parsed.eventId,
          authorizationIdentity,
        );
        if (projection?.event.scope !== "resource") {
          throw relationError("BUSINESS_EVENT_NOT_FOUND", 404);
        }
        projectionToken = await this.reader.createRelationProjection(
          {
            providerId: this.providerId,
            streamId: parsed.streamId,
            eventId: parsed.eventId,
            ...authorizationIdentity,
            candidateRelationHash: projection.candidateRelationHash,
            projectionRelationHash: projection.projectionRelationHash,
          },
          projection.relatedTaskIds,
          this.projectionTtlMs,
        );
      }
      const page = await this.reader.relationProjectionPage(
        projectionToken,
        { providerId: this.providerId, streamId: parsed.streamId, eventId: parsed.eventId },
        authorizationIdentity,
        parsed.afterTaskId,
        parsed.limit,
      );
      this.#increment("sdar_business_event_relation_pages_total", { outcome: "complete" });
      this.#event("business_events.relation.query", {
        outcome: "complete",
        relatedTaskCount: page.items.length,
        relationTruncated: page.nextAfterTaskId !== undefined,
      });
      return {
        resultType: "complete",
        streamId: parsed.streamId,
        eventId: parsed.eventId,
        projectionToken,
        items: page.items,
        total: page.total,
        ...(page.nextAfterTaskId === undefined ? {} : { nextAfterTaskId: page.nextAfterTaskId }),
      };
    } catch (error) {
      if (error instanceof FrozenProtocolError) throw error;
      if (error instanceof Error && error.message === "BUSINESS_EVENT_RELATION_CURSOR_EXPIRED") {
        this.#increment("sdar_business_event_relation_token_expired_total");
      }
      this.#event("business_events.relation.query", {
        outcome: "failed",
        reasonCode: relationReasonCode(error),
      });
      throw mapRelationError(error);
    }
  }

  #increment(name: string, labels: Record<string, string> = {}): void {
    try {
      this.metrics?.increment(name, labels);
    } catch {
      // Telemetry is best effort and cannot affect protocol behavior.
    }
  }

  #event(name: string, body: Record<string, unknown>): void {
    try {
      this.metrics?.event?.(name, body);
    } catch {
      // Diagnostics cannot affect protocol behavior.
    }
  }
}

export interface BusinessEventDiscovery {
  [key: string]: unknown;
  profileVersion: "1.0";
  delivery: "post_sse";
  scopes: ["task", "resource"];
  resumeMode: "stream_sequence";
  maxRelatedTaskIds: 256;
  retentionMs: number;
  authorizationModel: "subscription_snapshot_projection";
  relationOverflow: "paged_query";
  streamCancellation: "connection_close";
  continuityClass: BusinessEventGeneration["continuityClass"];
  sources: { sourceId: string; deliverySemantics: string }[];
}

export class BusinessEventNotificationManager {
  readonly #options: Required<BusinessEventNotificationOptions>;
  #activeSubscriptions = 0;
  readonly #activeSubscriptionsByAuth = new Map<string, number>();

  constructor(
    readonly providerId: string,
    readonly reader: BusinessEventReader,
    options: BusinessEventNotificationOptions = {},
  ) {
    this.#options = {
      pollIntervalMs: options.pollIntervalMs ?? 250,
      replayBatchSize: options.replayBatchSize ?? 256,
      maxQueueMessages: options.maxQueueMessages ?? 64,
      maxQueueBytes: options.maxQueueBytes ?? 1_048_576,
      maxStreamDurationMs: options.maxStreamDurationMs ?? 86_400_000,
      maxSubscriptions: options.maxSubscriptions ?? 256,
      maxSubscriptionsPerAuth: options.maxSubscriptionsPerAuth ?? 32,
      metrics: options.metrics ?? { increment: () => undefined, gauge: () => undefined },
    };
  }

  async discovery(retentionMs: number): Promise<BusinessEventDiscovery> {
    const generation = await this.reader.currentGeneration(this.providerId);
    if (generation === undefined) throw new Error("BUSINESS_EVENT_NOT_READY");
    const roster = await this.reader.sourceRoster(this.providerId, generation.streamId);
    if (roster.length === 0) throw new Error("BUSINESS_EVENT_NOT_READY");
    return {
      profileVersion: "1.0",
      delivery: "post_sse",
      scopes: ["task", "resource"],
      resumeMode: "stream_sequence",
      maxRelatedTaskIds: 256,
      retentionMs,
      authorizationModel: "subscription_snapshot_projection",
      relationOverflow: "paged_query",
      streamCancellation: "connection_close",
      continuityClass: generation.continuityClass,
      sources: roster.map((source) => ({
        sourceId: source.sourceId,
        deliverySemantics: source.deliverySemantics,
      })),
    };
  }

  async listen(
    request: FrozenJsonRpcRequest,
    response: ServerResponse,
    authorization: AuthorizationContext,
  ): Promise<void> {
    requireBusinessEventsCapability(request);
    const authorizationKey = `${authorization.hash}\0${authorization.executionMode}\0${authorization.simulationId ?? ""}`;
    const activeForAuthorization = this.#activeSubscriptionsByAuth.get(authorizationKey) ?? 0;
    if (
      this.#activeSubscriptions >= this.#options.maxSubscriptions ||
      activeForAuthorization >= this.#options.maxSubscriptionsPerAuth
    ) {
      this.#increment("sdar_business_event_live_events_total", {
        outcome: "subscription_capacity",
      });
      throw businessEventError("BUSINESS_EVENT_SUBSCRIPTION_CAPACITY_EXCEEDED", 429);
    }
    this.#activeSubscriptions += 1;
    this.#activeSubscriptionsByAuth.set(authorizationKey, activeForAuthorization + 1);
    this.#gauge("sdar_business_event_active_subscriptions", this.#activeSubscriptions);
    try {
      const selection = parseListenSelection(request.params);
      const current = await traceBusinessEvent(
        this.#options.metrics,
        "business_events.stream.listen",
        {},
        () => this.reader.currentGeneration(this.providerId),
      );
      if (current === undefined) throw businessEventError("BUSINESS_EVENT_STREAM_RESET", 409);
      const generation =
        selection.kind === "cursor"
          ? await this.reader.generation(this.providerId, selection.streamId)
          : current;
      if (generation === undefined || generation.status === "retired") {
        throw businessEventError("BUSINESS_EVENT_STREAM_RESET", 409, {
          currentStreamId: current.streamId,
        });
      }
      const afterSequence = acceptedAfterSequence(selection, generation);
      validateCursor(afterSequence, generation, current.streamId);
      const highWatermark =
        generation.status === "replayable_closed"
          ? generation.lastReplayableSequence
          : generation.currentSequence;
      const state = { closed: false };
      const writer = new TaskNotificationWriter(response, {
        maxMessages: this.#options.maxQueueMessages,
        maxBytes: this.#options.maxQueueBytes,
        onQueueDelta: () => undefined,
        onRejected: (reason) =>
          this.#increment("sdar_business_event_live_events_total", {
            outcome:
              reason === "queue_byte_limit" ? "queue_byte_overflow" : "queue_message_overflow",
          }),
        onSent: () => undefined,
      });
      const close = (): void => {
        state.closed = true;
        writer.dispose();
      };
      response.once("close", close);
      response.once("error", close);
      response.statusCode = 200;
      response.setHeader("content-type", "text/event-stream");
      response.setHeader("cache-control", "no-cache, no-transform");
      response.setHeader("connection", "keep-alive");
      response.flushHeaders();
      try {
        if (!writer.enqueue(await this.#ack(request.id, generation, afterSequence))) return;
        let lastScannedSequence = afterSequence;
        let lastDeliveredSequence = afterSequence;
        ({ lastScannedSequence, lastDeliveredSequence } = await this.#replay(
          writer,
          request.id,
          authorization,
          generation.streamId,
          lastScannedSequence,
          lastDeliveredSequence,
          highWatermark,
          "replay",
          () => state.closed,
        ));
        if (state.closed) return;
        if (generation.status === "replayable_closed") {
          await this.#sendContinuity(writer, request.id, generation.streamId);
          writer.close();
          return;
        }
        const startedAt = Date.now();
        // The response callbacks mutate this state asynchronously; static control-flow analysis
        // cannot observe that mutation across the awaited poll boundary.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        while (!state.closed && Date.now() - startedAt < this.#options.maxStreamDurationMs) {
          await delay(this.#options.pollIntervalMs, () => state.closed);
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (state.closed) break;
          const observed = await this.reader.generation(this.providerId, generation.streamId);
          if (observed?.status !== "current") {
            await this.#sendContinuity(writer, request.id, generation.streamId);
            writer.close();
            return;
          }
          ({ lastScannedSequence, lastDeliveredSequence } = await this.#replay(
            writer,
            request.id,
            authorization,
            generation.streamId,
            lastScannedSequence,
            lastDeliveredSequence,
            observed.currentSequence,
            "live",
            () => state.closed,
          ));
        }
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!state.closed) writer.close();
      } finally {
        response.removeListener("close", close);
        response.removeListener("error", close);
        writer.dispose();
      }
    } finally {
      const remaining = (this.#activeSubscriptionsByAuth.get(authorizationKey) ?? 1) - 1;
      if (remaining === 0) this.#activeSubscriptionsByAuth.delete(authorizationKey);
      else this.#activeSubscriptionsByAuth.set(authorizationKey, remaining);
      this.#activeSubscriptions -= 1;
      this.#gauge("sdar_business_event_active_subscriptions", this.#activeSubscriptions);
    }
  }

  async #ack(
    subscriptionId: string | number,
    generation: BusinessEventGeneration,
    acceptedAfterSequence: string,
  ): Promise<Record<string, unknown>> {
    const roster = await this.reader.sourceRoster(this.providerId, generation.streamId);
    return {
      jsonrpc: "2.0",
      method: "notifications/io.sdar/businessEvents/acknowledged",
      params: {
        profileVersion: "1.0",
        streamId: generation.streamId,
        generationStatus: generation.status,
        acceptedAfterSequence,
        earliestAvailableSequence: generation.earliestAvailableSequence,
        currentSequence:
          generation.status === "replayable_closed"
            ? generation.lastReplayableSequence
            : generation.currentSequence,
        sourceContinuity: {
          continuityClass: generation.continuityClass,
          status: generation.continuityClass === "all_durable" ? "continuous" : "best_effort",
          ...(generation.continuityClass === "all_durable"
            ? { continuousSinceSequence: generation.earliestAvailableSequence }
            : {}),
          degradedSourceIds: roster
            .filter((source) => source.deliverySemantics === "best_effort_live")
            .map((source) => source.sourceId),
        },
        _meta: subscriptionMeta(subscriptionId),
      },
    };
  }

  async #replay(
    writer: TaskNotificationWriter,
    subscriptionId: string | number,
    authorization: AuthorizationContext,
    streamId: string,
    initialScanned: string,
    initialDelivered: string,
    throughSequence: string,
    deliveryPhase: "replay" | "live",
    isClosed: () => boolean,
  ): Promise<{ lastScannedSequence: string; lastDeliveredSequence: string }> {
    let lastScannedSequence = initialScanned;
    let lastDeliveredSequence = initialDelivered;
    while (BigInt(lastScannedSequence) < BigInt(throughSequence) && !isClosed()) {
      const generation = await this.reader.generation(this.providerId, streamId);
      if (generation === undefined || generation.status === "retired") break;
      const events = await traceBusinessEvent(
        this.#options.metrics,
        deliveryPhase === "replay"
          ? "business_events.stream.replay"
          : "business_events.stream.live",
        {},
        () =>
          this.reader.replayEvents(
            this.providerId,
            streamId,
            lastScannedSequence,
            throughSequence,
            this.#options.replayBatchSize,
          ),
      );
      this.#event("business_events.stream.delivery", {
        outcome: deliveryPhase,
        batchSize: events.length,
      });
      if (events.length === 0) break;
      for (const event of events) {
        lastScannedSequence = event.sequence;
        const projection = await this.reader.authorizedEventProjection(
          this.providerId,
          streamId,
          event.eventId,
          {
            authorizationScopeHash: authorization.hash,
            executionMode: authorization.executionMode,
            simulationId: authorization.simulationId,
          },
        );
        if (projection === undefined) {
          this.#increment("sdar_business_event_projection_filtered_total", {
            reason: "authorization",
          });
          continue;
        }
        if (!writer.enqueue(eventNotification(subscriptionId, projection))) {
          return { lastScannedSequence, lastDeliveredSequence };
        }
        lastDeliveredSequence = event.sequence;
        this.#increment(
          deliveryPhase === "replay"
            ? "sdar_business_event_replay_events_total"
            : "sdar_business_event_live_events_total",
          { outcome: "delivered" },
        );
      }
    }
    return { lastScannedSequence, lastDeliveredSequence };
  }

  async #sendContinuity(
    writer: TaskNotificationWriter,
    subscriptionId: string | number,
    previousStreamId: string,
  ): Promise<void> {
    const continuity = await this.reader.continuityForPreviousStream(
      this.providerId,
      previousStreamId,
    );
    if (continuity === undefined) return;
    this.#increment("sdar_business_event_continuity_notifications_total");
    writer.enqueue({
      jsonrpc: "2.0",
      method: "notifications/io.sdar/businessEvents/continuity",
      params: {
        profileVersion: "1.0",
        previousStreamId: continuity.previousStreamId,
        newStreamId: continuity.newStreamId,
        reasonCode: continuity.reasonCode,
        affectedSourceIds: continuity.affectedSourceIds,
        gapDetectedAt: continuity.gapDetectedAt.toISOString(),
        lastReplayableSequence: continuity.lastReplayableSequence,
        ...(continuity.lastContinuousSequence === null
          ? {}
          : { lastContinuousSequence: continuity.lastContinuousSequence }),
        _meta: subscriptionMeta(subscriptionId),
      },
    });
  }

  #increment(name: string, labels: Record<string, string> = {}, amount = 1): void {
    try {
      this.#options.metrics.increment(name, labels, amount);
    } catch {
      // Telemetry is best effort and cannot affect protocol behavior.
    }
  }

  #gauge(name: string, value: number): void {
    try {
      this.#options.metrics.gauge(name, value);
    } catch {
      // Telemetry is best effort and cannot affect protocol behavior.
    }
  }

  #event(name: string, body: Record<string, unknown>): void {
    try {
      this.#options.metrics.event?.(name, body);
    } catch {
      // Diagnostics cannot affect protocol behavior.
    }
  }
}

async function traceBusinessEvent<T>(
  telemetry: BusinessEventMetrics | undefined,
  name: string,
  attributes: Record<string, string | number | boolean>,
  operation: () => Promise<T>,
): Promise<T> {
  if (telemetry?.trace === undefined) return operation();
  const invocation = { started: false };
  const invoke = (): Promise<T> => {
    invocation.started = true;
    return operation();
  };
  try {
    return await telemetry.trace(name, attributes, invoke);
  } catch (error) {
    if (invocation.started) throw error;
    return operation();
  }
}

function relationReasonCode(error: unknown): string {
  return error instanceof Error && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.message)
    ? error.message
    : "UNKNOWN";
}

export function requireBusinessEventsCapability(request: FrozenJsonRpcRequest): void {
  const extensions = request.meta.clientCapabilities.extensions;
  const capability =
    typeof extensions === "object" && extensions !== null && !Array.isArray(extensions)
      ? (extensions as Record<string, unknown>)[BUSINESS_EVENTS_EXTENSION]
      : undefined;
  if (
    typeof capability !== "object" ||
    capability === null ||
    Array.isArray(capability) ||
    (capability as Record<string, unknown>).profileVersion !== BUSINESS_EVENTS_PROFILE_VERSION
  ) {
    throw new FrozenProtocolError(
      FrozenErrorCode.MissingRequiredClientCapability,
      "Missing required client capability",
      400,
      {
        requiredCapabilities: {
          extensions: {
            [BUSINESS_EVENTS_EXTENSION]: { profileVersion: BUSINESS_EVENTS_PROFILE_VERSION },
          },
        },
      },
    );
  }
}

function parseListenSelection(
  params: Record<string, unknown>,
):
  | { kind: "cursor"; streamId: string; afterSequence: string }
  | { kind: "start"; position: "latest" | "earliest_available" } {
  const cursor = params.cursor;
  const startPosition = params.startPosition;
  if ((cursor === undefined) === (startPosition === undefined)) throw invalidParams();
  if (cursor !== undefined) {
    if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor))
      throw invalidParams();
    const value = cursor as Record<string, unknown>;
    if (
      Object.keys(value).length !== 2 ||
      typeof value.streamId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.streamId) ||
      typeof value.afterSequence !== "string" ||
      !/^(0|[1-9][0-9]{0,18})$/.test(value.afterSequence)
    ) {
      throw invalidParams();
    }
    return { kind: "cursor", streamId: value.streamId, afterSequence: value.afterSequence };
  }
  if (startPosition !== "latest" && startPosition !== "earliest_available") throw invalidParams();
  return { kind: "start", position: startPosition };
}

function acceptedAfterSequence(
  selection: ReturnType<typeof parseListenSelection>,
  generation: BusinessEventGeneration,
): string {
  if (selection.kind === "cursor") return selection.afterSequence;
  if (selection.position === "latest") {
    return generation.status === "replayable_closed"
      ? generation.lastReplayableSequence
      : generation.currentSequence;
  }
  return (BigInt(generation.earliestAvailableSequence) - 1n).toString();
}

function parseRelationRequest(params: Record<string, unknown>): {
  streamId: string;
  eventId: string;
  projectionToken?: string;
  afterTaskId?: string;
  limit: number;
} {
  const streamIdValue = params.streamId;
  const eventIdValue = params.eventId;
  const tokenValue = params.projectionToken;
  const afterValue = params.afterTaskId;
  const limitValue = params.limit;
  if (
    typeof streamIdValue !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(streamIdValue) ||
    typeof eventIdValue !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(eventIdValue) ||
    !Number.isInteger(limitValue) ||
    (limitValue as number) < 1 ||
    (limitValue as number) > 256 ||
    (tokenValue === undefined) !== (afterValue === undefined) ||
    (tokenValue !== undefined &&
      (typeof tokenValue !== "string" || !/^[A-Za-z0-9_-]{22,256}$/.test(tokenValue))) ||
    (afterValue !== undefined &&
      (typeof afterValue !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(afterValue)))
  ) {
    throw invalidParams();
  }
  return {
    streamId: streamIdValue,
    eventId: eventIdValue,
    limit: limitValue as number,
    ...(typeof tokenValue === "string" ? { projectionToken: tokenValue } : {}),
    ...(typeof afterValue === "string" ? { afterTaskId: afterValue } : {}),
  };
}

function validateCursor(
  afterSequence: string,
  generation: BusinessEventGeneration,
  currentStreamId: string,
): void {
  const after = BigInt(afterSequence);
  const last = BigInt(
    generation.status === "replayable_closed"
      ? generation.lastReplayableSequence
      : generation.currentSequence,
  );
  if (after > last) {
    throw businessEventError("BUSINESS_EVENT_CURSOR_AHEAD", 400, { currentStreamId });
  }
  if (after + 1n < BigInt(generation.earliestAvailableSequence)) {
    throw businessEventError("BUSINESS_EVENT_CURSOR_EXPIRED", 409, { currentStreamId });
  }
}

function eventNotification(
  subscriptionId: string | number,
  projection: AuthorizedBusinessEventProjection,
): Record<string, unknown> {
  const event = projection.event;
  return {
    jsonrpc: "2.0",
    method: "notifications/io.sdar/businessEvents",
    params: {
      streamId: event.streamId,
      eventId: event.eventId,
      sequence: event.sequence,
      sourceId: event.sourceId,
      eventType: event.eventType,
      occurredAt: event.occurredAt.toISOString(),
      scope: event.scope,
      description: event.description,
      ...(event.severityHint === null ? {} : { severityHint: event.severityHint }),
      ...(event.reasonCode === null ? {} : { reasonCode: event.reasonCode }),
      ...(event.rawPayload === null ? {} : { rawPayload: event.rawPayload }),
      ...(event.scope === "task"
        ? { taskId: event.taskId }
        : {
            resourceRef: event.resourceRef,
            relatedTaskIds: projection.relatedTaskIds.slice(0, 256),
            relatedTaskCount: projection.relatedTaskIds.length,
            relationTruncated: projection.relatedTaskIds.length > 256,
          }),
      _meta: subscriptionMeta(subscriptionId),
    },
  };
}

function subscriptionMeta(subscriptionId: string | number): Record<string, unknown> {
  return {
    "io.modelcontextprotocol/subscriptionId": subscriptionId,
    [BUSINESS_EVENTS_EXTENSION]: { profileVersion: BUSINESS_EVENTS_PROFILE_VERSION },
  };
}

function businessEventError(
  reasonCode: string,
  httpStatus: number,
  extra: Record<string, unknown> = {},
): FrozenProtocolError {
  return new FrozenProtocolError(
    FrozenErrorCode.InvalidParams,
    "Business Event request failed",
    httpStatus,
    {
      reasonCode,
      retryable: false,
      recoveryAction: "Reconnect using the current stream discovery metadata.",
      ...extra,
    },
  );
}

function relationError(reasonCode: string, httpStatus: number): FrozenProtocolError {
  return new FrozenProtocolError(
    FrozenErrorCode.InvalidParams,
    "Business Event relation failed",
    httpStatus,
    {
      reasonCode,
      retryable: false,
      recoveryAction: "Create a fresh authorized relation projection.",
    },
  );
}

function mapRelationError(error: unknown): FrozenProtocolError {
  const message = error instanceof Error ? error.message : "";
  const mapping: Record<string, [string, number]> = {
    BUSINESS_EVENT_RELATION_CURSOR_EXPIRED: ["BUSINESS_EVENT_RELATION_CURSOR_EXPIRED", 410],
    BUSINESS_EVENT_AUTHORIZATION_MISMATCH: ["BUSINESS_EVENT_AUTHORIZATION_MISMATCH", 403],
    BUSINESS_EVENT_STREAM_RESET: ["BUSINESS_EVENT_STREAM_RESET", 409],
    BUSINESS_EVENT_RELATION_PROJECTION_STALE: ["BUSINESS_EVENT_RELATION_PROJECTION_STALE", 409],
    BUSINESS_EVENT_RETENTION_AUTHORITY_INVALID: ["BUSINESS_EVENT_RETENTION_AUTHORITY_INVALID", 409],
    BUSINESS_EVENT_RELATION_CURSOR_INVALID: ["BUSINESS_EVENT_RELATION_CURSOR_INVALID", 400],
  };
  const mapped = mapping[message] ?? ["BUSINESS_EVENT_NOT_FOUND", 404];
  return relationError(mapped[0], mapped[1]);
}

async function delay(milliseconds: number, isClosed: () => boolean): Promise<void> {
  if (isClosed()) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });
}

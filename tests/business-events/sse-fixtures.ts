import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import type {
  BusinessEventReader,
  FrozenJsonRpcRequest,
} from "../../packages/mcp-protocol/src/index.js";
import type {
  BusinessEventGeneration,
  FinalizedBusinessEvent,
  RotationResult,
} from "../../packages/persistence-postgres/src/index.js";

export const streamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0701";
export const nextStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0702";

export class FakeBusinessEventReader implements BusinessEventReader {
  generationValue = generation();
  events: FinalizedBusinessEvent[] = [];
  visibleEventIds = new Set<string>();
  replayAfter: string[] = [];
  continuity: RotationResult | undefined;

  currentGeneration(): Promise<BusinessEventGeneration> {
    return Promise.resolve(this.generationValue);
  }

  generation(
    _providerId: string,
    requestedStreamId: string,
  ): Promise<BusinessEventGeneration | undefined> {
    return Promise.resolve(
      requestedStreamId === this.generationValue.streamId ? this.generationValue : undefined,
    );
  }

  sourceRoster() {
    return Promise.resolve([
      {
        sourceId: "source.a",
        sourceStreamId: "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0799",
        deliverySemantics: "durable_at_least_once" as const,
      },
    ]);
  }

  replayEvents(
    _providerId: string,
    _streamId: string,
    afterSequence: string,
    throughSequence: string,
    limit: number,
  ): Promise<FinalizedBusinessEvent[]> {
    this.replayAfter.push(afterSequence);
    return Promise.resolve(
      this.events
        .filter(
          (event) =>
            BigInt(event.sequence) > BigInt(afterSequence) &&
            BigInt(event.sequence) <= BigInt(throughSequence),
        )
        .slice(0, limit),
    );
  }

  authorizedEventProjection(_providerId: string, _streamId: string, eventId: string) {
    const event = this.events.find((candidate) => candidate.eventId === eventId);
    return Promise.resolve(
      event === undefined || !this.visibleEventIds.has(eventId)
        ? undefined
        : {
            event,
            relatedTaskIds: ["018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0711"],
            candidateRelationHash: `sha256:${"a".repeat(64)}`,
            projectionRelationHash: `sha256:${"b".repeat(64)}`,
          },
    );
  }

  continuityForPreviousStream(): Promise<RotationResult | undefined> {
    return Promise.resolve(this.continuity);
  }
}

export class FakeBusinessEventResponse extends EventEmitter {
  readonly headers: Record<string, string> = {};
  readonly frames: string[] = [];
  statusCode = 0;

  constructor(readonly closeAfterFrames: number) {
    super();
  }

  asServerResponse(): ServerResponse {
    return this as unknown as ServerResponse;
  }

  setHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  flushHeaders(): void {
    return undefined;
  }

  write(frame: string): boolean {
    this.frames.push(frame);
    if (this.frames.length >= this.closeAfterFrames) setImmediate(() => this.emit("close"));
    return true;
  }

  end(): void {
    setImmediate(() => this.emit("close"));
  }

  messages(): Record<string, unknown>[] {
    return this.frames.map(
      (frame) => JSON.parse(frame.split("data: ")[1]?.trim() ?? "null") as Record<string, unknown>,
    );
  }
}

export function listenRequest(
  selection:
    | { startPosition: "latest" | "earliest_available" }
    | { cursor: { streamId: string; afterSequence: string } },
  capability = true,
): FrozenJsonRpcRequest {
  return {
    jsonrpc: "2.0",
    id: "business-events-subscription",
    method: "io.sdar/businessEvents/listen",
    params: { ...selection, _meta: {} },
    meta: {
      protocolVersion: "2026-07-28",
      clientInfo: { name: "test", version: "1.0.0" },
      clientCapabilities: capability
        ? { extensions: { "io.sdar/businessEvents": { profileVersion: "1.0" } } }
        : {},
      raw: {},
    },
  };
}

export function generation(
  overrides: Partial<BusinessEventGeneration> = {},
): BusinessEventGeneration {
  return {
    providerId: "provider.stream",
    streamId,
    status: "current",
    currentSequence: "0",
    earliestAvailableSequence: "1",
    lastReplayableSequence: "0",
    lastContinuousSequence: "0",
    continuityClass: "all_durable",
    ...overrides,
  };
}

export function event(sequence: string): FinalizedBusinessEvent {
  return {
    providerId: "provider.stream",
    streamId,
    sequence,
    eventId: sequence.padStart(43, "a"),
    sourceId: "source.a",
    sourceStreamId: "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0799",
    sourceEventId: `event-${sequence}`,
    sourceSequence: sequence,
    eventType: "resource.changed",
    occurredAt: new Date("2026-07-22T01:00:00Z"),
    scope: "resource",
    description: "Resource changed.",
    taskId: null,
    resourceRef: "vehicle:42",
    candidateRelatedTaskCount: 1,
    severityHint: "info",
    reasonCode: null,
    rawPayload: {},
  };
}

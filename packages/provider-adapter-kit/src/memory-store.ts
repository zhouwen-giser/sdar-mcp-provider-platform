import { createHash, randomUUID } from "node:crypto";
import type { AdapterBusinessEvent } from "../../adapter-protocol/src/index.js";
import { jsonToProtoStruct } from "../../adapter-protocol/src/index.js";
import { businessEventSourceCapabilities } from "./sources.js";
import type {
  BusinessEventDraft,
  CommandAckRecord,
  DeviceToolCallRecord,
  ProviderExecution,
  ProviderStore,
  SnapshotRecord,
} from "./types.js";
import { TERMINAL_EXECUTION_STATES } from "./types.js";

export class MemoryProviderStore implements ProviderStore {
  readonly #executions = new Map<string, ProviderExecution>();
  readonly #acks = new Map<string, CommandAckRecord>();
  readonly #events = new Map<string, AdapterBusinessEvent[]>();
  readonly toolCalls: DeviceToolCallRecord[] = [];
  readonly snapshots: SnapshotRecord[] = [];

  initialize(): Promise<void> {
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  getExecution(taskId: string): Promise<ProviderExecution | undefined> {
    return Promise.resolve(clone(this.#executions.get(taskId)));
  }
  listActiveExecutions(): Promise<ProviderExecution[]> {
    return Promise.resolve(
      [...this.#executions.values()]
        .filter((x) => !TERMINAL_EXECUTION_STATES.has(x.state))
        .map((x) => structuredClone(x)),
    );
  }
  putExecution(execution: ProviderExecution): Promise<void> {
    const existing = this.#executions.get(execution.taskId);
    if (
      existing !== undefined &&
      (existing.externalExecutionId !== execution.externalExecutionId ||
        existing.argumentHash !== execution.argumentHash ||
        existing.operationName !== execution.operationName)
    )
      return Promise.reject(new Error("TASK_IDENTITY_CONFLICT"));
    this.#executions.set(execution.taskId, structuredClone(execution));
    return Promise.resolve();
  }
  getCommandAck(
    taskId: string,
    command: string,
    commandSequence: string,
  ): Promise<CommandAckRecord | undefined> {
    return Promise.resolve(clone(this.#acks.get(key(taskId, command, commandSequence))));
  }
  putCommandAck(ack: CommandAckRecord): Promise<void> {
    this.#acks.set(key(ack.taskId, ack.command, ack.commandSequence), structuredClone(ack));
    return Promise.resolve();
  }
  appendDeviceToolCall(record: DeviceToolCallRecord): Promise<void> {
    this.toolCalls.push(structuredClone(record));
    return Promise.resolve();
  }
  putSnapshot(record: SnapshotRecord): Promise<void> {
    if (!this.snapshots.some((x) => x.revision === record.revision))
      this.snapshots.push(structuredClone(record));
    return Promise.resolve();
  }
  appendBusinessEvent(draft: BusinessEventDraft): Promise<AdapterBusinessEvent> {
    const source = businessEventSourceCapabilities().find((x) => x.sourceId === draft.sourceId);
    if (source === undefined) return Promise.reject(new Error("SOURCE_NOT_FOUND"));
    const events = this.#events.get(draft.sourceId) ?? [];
    const sequence = String(events.length + 1);
    const sourceEventId = createHash("sha256")
      .update(`${draft.sourceId}\0${sequence}\0${randomUUID()}`)
      .digest("base64url");
    const event: AdapterBusinessEvent = {
      sourceEventId,
      sourceSequence: sequence,
      sourceStreamId: source.sourceStreamId,
      scope: draft.scope,
      occurredAt: timestamp(draft.occurredAt),
      eventType: draft.eventType,
      description: draft.description,
      ...(draft.externalExecutionId === undefined
        ? {}
        : { externalExecutionId: draft.externalExecutionId }),
      ...(draft.resourceRef === undefined ? {} : { resourceRef: draft.resourceRef }),
      severityHint: draft.severityHint,
      reasonCode: draft.reasonCode,
      rawPayload: jsonToProtoStruct(draft.rawPayload),
    };
    events.push(event);
    this.#events.set(draft.sourceId, events);
    return Promise.resolve(structuredClone(event));
  }
  replayBusinessEvents(
    sourceId: string,
    sourceStreamId: string,
    afterSourceSequence: bigint,
  ): Promise<AdapterBusinessEvent[]> {
    const source = businessEventSourceCapabilities().find((x) => x.sourceId === sourceId);
    if (source === undefined) return Promise.reject(new Error("SOURCE_NOT_FOUND"));
    if (source.sourceStreamId !== sourceStreamId)
      return Promise.reject(new Error("SOURCE_STREAM_RESET"));
    const events = this.#events.get(sourceId) ?? [];
    if (afterSourceSequence > BigInt(events.length))
      return Promise.reject(new Error("SOURCE_CURSOR_AHEAD"));
    return Promise.resolve(
      events
        .filter((x) => BigInt(x.sourceSequence) > afterSourceSequence)
        .map((x) => structuredClone(x)),
    );
  }
  businessEventSources() {
    return businessEventSourceCapabilities();
  }
}

function key(taskId: string, command: string, sequence: string): string {
  return `${taskId}\0${command}\0${sequence}`;
}
function clone<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}
function timestamp(value: string): { seconds: string; nanos: number } {
  const milliseconds = Date.parse(value);
  return {
    seconds: String(Math.floor(milliseconds / 1000)),
    nanos: (milliseconds % 1000) * 1_000_000,
  };
}

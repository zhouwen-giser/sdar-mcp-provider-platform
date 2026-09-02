import { createHash, randomUUID } from "node:crypto";
import type { AdapterBusinessEvent } from "../../adapter-protocol/src/index.js";
import { jsonToProtoStruct } from "../../adapter-protocol/src/index.js";
import { businessEventSourceCapabilities } from "./sources.js";
import {
  assertMutationJournalEntry,
  assertMutationJournalTransition,
  sameMutationJournalIdentity,
} from "./mutation-journal.js";
import type {
  BusinessEventDraft,
  CommandAckClaim,
  CommandAckRecord,
  DeviceToolCallRecord,
  MutationJournalClaim,
  MutationJournalEntry,
  MutationJournalState,
  ProviderExecution,
  ProviderStore,
  SnapshotRecord,
} from "./types.js";
import { TERMINAL_EXECUTION_STATES } from "./types.js";
import type {
  SmppDiagnosticBinding,
  SmppDiagnosticControlResult,
  SmppDiagnosticLease,
  SmppDiagnosticReceipt,
} from "./diagnostics.js";

export class MemoryProviderStore implements ProviderStore {
  readonly #executions = new Map<string, ProviderExecution>();
  readonly #acks = new Map<string, CommandAckRecord>();
  readonly #mutationJournal = new Map<string, MutationJournalEntry>();
  readonly #events = new Map<string, AdapterBusinessEvent[]>();
  readonly #diagnosticLeases = new Map<string, SmppDiagnosticLease>();
  readonly #diagnosticReceipts = new Map<string, SmppDiagnosticReceipt>();
  #diagnosticFence = 0;
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
  claimCommandAck(ack: CommandAckRecord): Promise<CommandAckClaim> {
    const ackKey = key(ack.taskId, ack.command, ack.commandSequence);
    const existing = this.#acks.get(ackKey);
    if (existing !== undefined)
      return Promise.resolve({ claimed: false, record: structuredClone(existing) });
    const claimed = structuredClone(ack);
    this.#acks.set(ackKey, claimed);
    return Promise.resolve({ claimed: true, record: structuredClone(claimed) });
  }
  completeCommandAck(ack: CommandAckRecord, expectedReasonCode?: string): Promise<boolean> {
    const ackKey = key(ack.taskId, ack.command, ack.commandSequence);
    const existing = this.#acks.get(ackKey);
    if (existing === undefined) return Promise.reject(new Error("COMMAND_ACK_CLAIM_REQUIRED"));
    if (expectedReasonCode !== undefined && existing.response.reasonCode !== expectedReasonCode)
      return Promise.resolve(false);
    this.#acks.set(ackKey, structuredClone(ack));
    return Promise.resolve(true);
  }
  putCommandAck(ack: CommandAckRecord): Promise<void> {
    this.#acks.set(key(ack.taskId, ack.command, ack.commandSequence), structuredClone(ack));
    return Promise.resolve();
  }
  getMutationJournalEntry(
    taskId: string,
    stepId: string,
  ): Promise<MutationJournalEntry | undefined> {
    return Promise.resolve(clone(this.#mutationJournal.get(journalKey(taskId, stepId))));
  }
  listMutationJournal(taskId: string): Promise<MutationJournalEntry[]> {
    return Promise.resolve(
      [...this.#mutationJournal.values()]
        .filter((entry) => entry.taskId === taskId)
        .sort(
          (left, right) =>
            left.intentPersistedAt.localeCompare(right.intentPersistedAt) ||
            left.stepId.localeCompare(right.stepId),
        )
        .map((entry) => structuredClone(entry)),
    );
  }
  claimMutationJournal(entry: MutationJournalEntry): Promise<MutationJournalClaim> {
    return Promise.resolve().then(() => {
      assertMutationJournalEntry(entry);
      if (entry.state !== "INTENT_PERSISTED")
        throw new Error("MUTATION_JOURNAL_INTENT_STATE_REQUIRED");
      if (!this.#executions.has(entry.taskId))
        throw new Error("MUTATION_JOURNAL_EXECUTION_REQUIRED");
      const entryKey = journalKey(entry.taskId, entry.stepId);
      const existing = this.#mutationJournal.get(entryKey);
      if (existing !== undefined) {
        if (!sameMutationJournalIdentity(existing, entry))
          throw new Error("MUTATION_JOURNAL_IDENTITY_CONFLICT");
        return { claimed: false, record: structuredClone(existing) };
      }
      this.#mutationJournal.set(entryKey, structuredClone(entry));
      return { claimed: true, record: structuredClone(entry) };
    });
  }
  advanceMutationJournal(
    entry: MutationJournalEntry,
    expectedState: MutationJournalState,
  ): Promise<boolean> {
    return Promise.resolve().then(() => {
      const entryKey = journalKey(entry.taskId, entry.stepId);
      const existing = this.#mutationJournal.get(entryKey);
      if (existing === undefined) throw new Error("MUTATION_JOURNAL_INTENT_REQUIRED");
      if (!sameMutationJournalIdentity(existing, entry))
        throw new Error("MUTATION_JOURNAL_IDENTITY_CONFLICT");
      if (existing.state !== expectedState) return false;
      assertMutationJournalTransition(existing, entry, expectedState);
      this.#mutationJournal.set(entryKey, structuredClone(entry));
      return true;
    });
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
  armDiagnosticLease(
    lease: Omit<SmppDiagnosticLease, "fence">,
    receipt: Omit<SmppDiagnosticReceipt, "state">,
  ): Promise<SmppDiagnosticControlResult> {
    const existing = [...this.#diagnosticLeases.values()].find(
      (candidate) => candidate.stableOperationKey === lease.stableOperationKey,
    );
    if (existing !== undefined) {
      if (existing.canonicalRequestHash !== lease.canonicalRequestHash)
        return Promise.reject(new Error("SMPP_DIAGNOSTIC_OPERATION_CONFLICT"));
      return Promise.resolve(this.#diagnosticResult(existing, "armed"));
    }
    const selectorConflict = [...this.#diagnosticLeases.values()].some(
      (candidate) =>
        candidate.scope.selector.argumentHash === lease.scope.selector.argumentHash &&
        ["ARMED", "BOUND"].includes(candidate.state) &&
        Date.parse(candidate.expiresAt) > Date.parse(lease.armedAt),
    );
    if (selectorConflict) return Promise.reject(new Error("SMPP_DIAGNOSTIC_SELECTOR_CONFLICT"));
    const stored: SmppDiagnosticLease = structuredClone({
      ...lease,
      fence: String(++this.#diagnosticFence),
    });
    const storedReceipt: SmppDiagnosticReceipt = structuredClone({
      ...receipt,
      state: stored.state,
    });
    this.#diagnosticLeases.set(stored.leaseId, stored);
    this.#diagnosticReceipts.set(receiptKey(stored.leaseId, "armed"), storedReceipt);
    return Promise.resolve({ lease: structuredClone(stored), receipt: storedReceipt });
  }
  getDiagnosticLease(leaseId: string): Promise<SmppDiagnosticLease | undefined> {
    return Promise.resolve(clone(this.#diagnosticLeases.get(leaseId)));
  }
  getDiagnosticStatus(leaseId: string): Promise<SmppDiagnosticControlResult | undefined> {
    const lease = this.#diagnosticLeases.get(leaseId);
    if (lease === undefined) return Promise.resolve(undefined);
    const receipt = [...this.#diagnosticReceipts.values()]
      .filter((candidate) => candidate.leaseId === leaseId)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0];
    if (receipt === undefined)
      return Promise.reject(new Error("SMPP_DIAGNOSTIC_RECEIPT_NOT_FOUND"));
    return Promise.resolve({ lease: structuredClone(lease), receipt: structuredClone(receipt) });
  }
  disarmDiagnosticLease(
    leaseId: string,
    requestHash: string,
    receiptId: string,
    occurredAt: string,
  ): Promise<SmppDiagnosticControlResult> {
    const lease = this.#requiredDiagnosticLease(leaseId);
    const existing = this.#diagnosticReceipts.get(receiptKey(leaseId, "disarmed"));
    if (existing !== undefined) {
      if (existing.requestHash !== requestHash)
        return Promise.reject(new Error("SMPP_DIAGNOSTIC_OPERATION_CONFLICT"));
      return Promise.resolve({ lease: structuredClone(lease), receipt: structuredClone(existing) });
    }
    lease.state = "DISARMED";
    lease.cleanupAt = occurredAt;
    const receipt: SmppDiagnosticReceipt = {
      contract: lease.contract,
      receiptId,
      leaseId,
      action: "disarmed",
      requestHash,
      occurredAt,
      state: lease.state,
      reasonCode: "SMPP_DIAGNOSTIC_DISARMED",
    };
    this.#diagnosticReceipts.set(receiptKey(leaseId, "disarmed"), receipt);
    return Promise.resolve({ lease: structuredClone(lease), receipt: structuredClone(receipt) });
  }
  bindDiagnosticLease(
    binding: SmppDiagnosticBinding,
  ): Promise<SmppDiagnosticControlResult | undefined> {
    const matches = [...this.#diagnosticLeases.values()]
      .filter(
        (candidate) =>
          candidate.state === "ARMED" &&
          candidate.capabilityId === binding.capabilityId &&
          candidate.scope.selector.argumentHash === binding.argumentHash &&
          (candidate.scope.taskId === undefined || candidate.scope.taskId === binding.taskId) &&
          Date.parse(candidate.expiresAt) > Date.parse(binding.observedAt),
      )
      .sort((left, right) => Number(left.fence) - Number(right.fence));
    if (matches.length > 1) return Promise.reject(new Error("SMPP_DIAGNOSTIC_SELECTOR_AMBIGUOUS"));
    const lease = matches[0];
    if (lease === undefined) return Promise.resolve(undefined);
    lease.state = "BOUND";
    lease.boundAt = binding.observedAt;
    lease.logicalInvocationId = binding.logicalInvocationId;
    lease.taskId = binding.taskId;
    lease.externalExecutionId = binding.externalExecutionId;
    lease.deviceMissionId = binding.deviceMissionId;
    const receipt: SmppDiagnosticReceipt = {
      contract: lease.contract,
      receiptId: randomUUID(),
      leaseId: lease.leaseId,
      action: "bound",
      requestHash: lease.canonicalRequestHash,
      occurredAt: binding.observedAt,
      state: lease.state,
      reasonCode: "SMPP_DIAGNOSTIC_BOUND",
      binding: diagnosticReceiptBinding(binding),
    };
    this.#diagnosticReceipts.set(receiptKey(lease.leaseId, "bound"), receipt);
    return Promise.resolve({ lease: structuredClone(lease), receipt: structuredClone(receipt) });
  }
  consumeDiagnosticLease(
    leaseId: string,
    requestHash: string,
    receiptId: string,
    occurredAt: string,
  ): Promise<SmppDiagnosticControlResult> {
    const lease = this.#requiredDiagnosticLease(leaseId);
    const existing = this.#diagnosticReceipts.get(receiptKey(leaseId, "consumed"));
    if (existing !== undefined)
      return Promise.resolve({ lease: structuredClone(lease), receipt: structuredClone(existing) });
    if (lease.state !== "BOUND") return Promise.reject(new Error("SMPP_DIAGNOSTIC_NOT_BOUND"));
    lease.state = "CONSUMED";
    lease.consumedAt = occurredAt;
    const receipt: SmppDiagnosticReceipt = {
      contract: lease.contract,
      receiptId,
      leaseId,
      action: "consumed",
      requestHash,
      occurredAt,
      state: lease.state,
      reasonCode: "SMPP_DIAGNOSTIC_CONSUMED",
      ...(lease.logicalInvocationId === undefined ||
      lease.taskId === undefined ||
      lease.externalExecutionId === undefined ||
      lease.deviceMissionId === undefined
        ? {}
        : {
            binding: {
              operationName: lease.operationName,
              argumentHash: lease.scope.selector.argumentHash,
              logicalInvocationId: lease.logicalInvocationId,
              taskId: lease.taskId,
              externalExecutionId: lease.externalExecutionId,
              deviceMissionId: lease.deviceMissionId,
            },
          }),
    };
    this.#diagnosticReceipts.set(receiptKey(leaseId, "consumed"), receipt);
    return Promise.resolve({ lease: structuredClone(lease), receipt: structuredClone(receipt) });
  }
  expireDiagnosticLeases(occurredAt: string): Promise<readonly SmppDiagnosticControlResult[]> {
    const results: SmppDiagnosticControlResult[] = [];
    for (const lease of this.#diagnosticLeases.values()) {
      if (
        !["ARMED", "BOUND"].includes(lease.state) ||
        Date.parse(lease.expiresAt) > Date.parse(occurredAt)
      )
        continue;
      lease.state = "EXPIRED";
      lease.cleanupAt = occurredAt;
      const receipt: SmppDiagnosticReceipt = {
        contract: lease.contract,
        receiptId: randomUUID(),
        leaseId: lease.leaseId,
        action: "expired",
        requestHash: lease.canonicalRequestHash,
        occurredAt,
        state: lease.state,
        reasonCode: "SMPP_DIAGNOSTIC_EXPIRED",
      };
      this.#diagnosticReceipts.set(receiptKey(lease.leaseId, "expired"), receipt);
      results.push({ lease: structuredClone(lease), receipt: structuredClone(receipt) });
    }
    return Promise.resolve(results);
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
  #requiredDiagnosticLease(leaseId: string): SmppDiagnosticLease {
    const lease = this.#diagnosticLeases.get(leaseId);
    if (lease === undefined) throw new Error("SMPP_DIAGNOSTIC_LEASE_NOT_FOUND");
    return lease;
  }
  #diagnosticResult(
    lease: SmppDiagnosticLease,
    action: SmppDiagnosticReceipt["action"],
  ): SmppDiagnosticControlResult {
    const receipt = this.#diagnosticReceipts.get(receiptKey(lease.leaseId, action));
    if (receipt === undefined) throw new Error("SMPP_DIAGNOSTIC_RECEIPT_NOT_FOUND");
    return { lease: structuredClone(lease), receipt: structuredClone(receipt) };
  }
}

function key(taskId: string, command: string, sequence: string): string {
  return `${taskId}\0${command}\0${sequence}`;
}
function journalKey(taskId: string, stepId: string): string {
  return `${taskId}\0${stepId}`;
}
function receiptKey(leaseId: string, action: SmppDiagnosticReceipt["action"]): string {
  return `${leaseId}\0${action}`;
}
function diagnosticReceiptBinding(binding: SmppDiagnosticBinding) {
  return {
    operationName: binding.operationName,
    argumentHash: binding.argumentHash,
    logicalInvocationId: binding.logicalInvocationId,
    taskId: binding.taskId,
    externalExecutionId: binding.externalExecutionId,
    deviceMissionId: binding.deviceMissionId,
  };
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

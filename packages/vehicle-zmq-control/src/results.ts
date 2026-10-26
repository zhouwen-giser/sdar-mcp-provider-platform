import { z } from "zod";
import { canonical, sha256 } from "../../vehicle-zmq-observer/src/config.js";
import type { SourceRef, ZmqExecution } from "./model.js";

export const LegacyResultIdentity = z
  .object({
    scopeHash: z.string().regex(/^[a-f0-9]{64}$/),
    providerId: z.string().min(1),
    resourceId: z.string().min(1),
    taskId: z.string().min(1),
    externalExecutionId: z.string().min(1),
    operationName: z.string().min(1),
    authorizationContextHash: z.string().regex(/^[a-f0-9]{64}$/),
    executionMode: z.literal("simulation"),
    simulationId: z.string().min(1),
  })
  .strict();
export const SiteResultIdentity = LegacyResultIdentity.extend({
  executionMode: z.literal("live"),
  simulationId: z.null(),
});
export const ResultIdentity = z.union([LegacyResultIdentity, SiteResultIdentity]);
export type ResultIdentity = Omit<
  z.infer<typeof LegacyResultIdentity>,
  "executionMode" | "simulationId"
> & { executionMode: "simulation" | "live"; simulationId: string | null };
export function resultIdentity(e: ZmqExecution): ResultIdentity {
  return ResultIdentity.parse({
    scopeHash: e.zmqControl.scopeHash,
    providerId: e.providerId,
    resourceId: e.resourceId,
    taskId: e.taskId,
    externalExecutionId: e.externalExecutionId,
    operationName: e.operationName,
    authorizationContextHash: e.executionContext.authorizationContextHash,
    executionMode: e.executionContext.executionMode,
    simulationId: e.executionContext.simulationId || null,
  });
}
export const identityHash = (identity: ResultIdentity) =>
  sha256(canonical(ResultIdentity.parse(identity)));
export interface ResultDraft {
  identity: ResultIdentity;
  kind: "inspection_frame" | "coverage" | "effect";
  sourceRef: SourceRef;
  receivedAt: string;
  content: Record<string, unknown>;
}
export interface ResultRecord extends ResultDraft {
  schemaVersion: "ugv.zmq-result-record/1" | "ugv.zmq-result-record/2";
  revision: number;
  contentHash: string;
}
export interface ResultPage {
  schemaVersion: "ugv.zmq-result-page/1" | "ugv.zmq-result-page/2";
  identity: ResultIdentity;
  records: ResultRecord[];
  nextRevision: number;
  hasMore: boolean;
  /** These are platform-retained receptions, never recovered server history. */
  historySource: "platform_retained_only";
}
export interface ResultRepository {
  appendResult(draft: ResultDraft): Promise<ResultRecord>;
  resultPage(identity: ResultIdentity, afterRevision?: number, limit?: number): Promise<ResultPage>;
}
export const resultKey = (draft: ResultDraft) =>
  `zmq-result:${identityHash(draft.identity)}:${sha256(canonical(draft.sourceRef))}`;
export function resultDraft(record: ResultRecord): ResultDraft {
  return {
    identity: record.identity,
    kind: record.kind,
    sourceRef: record.sourceRef,
    receivedAt: record.receivedAt,
    content: record.content,
  };
}
export function resultHash(draft: ResultDraft): string {
  ResultIdentity.parse(draft.identity);
  if (
    !Number.isFinite(Date.parse(draft.receivedAt)) ||
    Buffer.byteLength(canonical(draft)) > 262144
  )
    throw Error("ZMQ_RESULT_RECORD_INVALID_OR_TOO_LARGE");
  return sha256(canonical(draft));
}
export function resultPage(
  identity: ResultIdentity,
  records: ResultRecord[],
  after = 0,
  limit = 8,
): ResultPage {
  if (
    !Number.isSafeInteger(after) ||
    after < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 8
  )
    throw Error("ZMQ_RESULT_CURSOR_INVALID");
  const selected: ResultRecord[] = [];
  let bytes = 0;
  for (const record of records.slice(0, limit)) {
    if (
      record.contentHash !== resultHash(resultDraft(record)) ||
      canonical(record.identity) !== canonical(identity)
    )
      throw Error("ZMQ_RESULT_INTEGRITY_FAILED");
    const size = Buffer.byteLength(canonical(record));
    if (bytes + size > 900000) break;
    selected.push(record);
    bytes += size;
  }
  return {
    schemaVersion:
      identity.executionMode === "live" ? "ugv.zmq-result-page/2" : "ugv.zmq-result-page/1",
    identity,
    records: selected,
    nextRevision: selected.at(-1)?.revision ?? after,
    hasMore: records.length > selected.length,
    historySource: "platform_retained_only",
  };
}

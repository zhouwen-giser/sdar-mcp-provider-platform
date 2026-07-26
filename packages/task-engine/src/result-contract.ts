import { protoStructToJson } from "../../adapter-protocol/src/index.js";
import type { ExecutionSnapshot } from "../../adapter-protocol/src/index.js";
import {
  AdapterContractError,
  mapAdapterSnapshot,
  TechnicalExecutionError,
} from "../../domain/src/index.js";
import type { SnapshotTransition } from "../../domain/src/index.js";
import type { ValidatedOperation } from "../../operation-registry/src/index.js";

export function adapterResultPayload(snapshot: ExecutionSnapshot): Record<string, unknown> {
  return protoStructToJson(snapshot.result);
}

export function assertAdapterResultContract(
  operation: ValidatedOperation,
  snapshot: ExecutionSnapshot,
): void {
  const payload = sanitizedAdapterResultPayload(snapshot);
  if (
    snapshot.state === "SUCCEEDED" ||
    snapshot.state === "BUSINESS_FAILED" ||
    snapshot.state === "PARTIALLY_COMPLETED"
  ) {
    operation.validateOutput(payload);
  }
}

export function sanitizedAdapterResultPayload(
  snapshot: ExecutionSnapshot,
): Record<string, unknown> {
  const result = adapterResultPayload(snapshot);
  assertResultLimits(result);
  return sanitizeResult(result) as Record<string, unknown>;
}

export function validatedSnapshotTransition(
  operation: ValidatedOperation,
  snapshot: ExecutionSnapshot,
): SnapshotTransition {
  try {
    const result = sanitizedAdapterResultPayload(snapshot);
    if (
      snapshot.state === "SUCCEEDED" ||
      snapshot.state === "BUSINESS_FAILED" ||
      snapshot.state === "PARTIALLY_COMPLETED"
    ) {
      operation.validateOutput(result);
    }
    return attachEvidence(
      mapAdapterSnapshot(normalizeSnapshot(snapshot, result)),
      snapshot,
      result,
    );
  } catch (error) {
    if (error instanceof AdapterContractError) {
      return technicalFailureTransition(error.reasonCode);
    }
    return technicalFailureTransition("ADAPTER_STATE_INVALID");
  }
}

export function synchronousResult(
  operation: ValidatedOperation,
  snapshot: ExecutionSnapshot,
): Record<string, unknown> {
  const payload = sanitizedAdapterResultPayload(snapshot);
  if (
    snapshot.state === "SUCCEEDED" ||
    snapshot.state === "BUSINESS_FAILED" ||
    snapshot.state === "PARTIALLY_COMPLETED"
  ) {
    operation.validateOutput(payload);
  }
  let transition: SnapshotTransition;
  try {
    transition = mapAdapterSnapshot(normalizeSnapshot(snapshot, payload));
  } catch (error) {
    throw new AdapterContractError("ADAPTER_STATE_INVALID", { cause: error });
  }
  if (!transition.terminal) {
    throw new AdapterContractError("SYNCHRONOUS_OPERATION_RETURNED_NONTERMINAL");
  }
  if (transition.mcpStatus === "failed") {
    throw new TechnicalExecutionError(snapshot.reasonCode || "TECHNICAL_EXECUTION_FAILED");
  }
  const mappedResult = transition.result;
  if (mappedResult === null) {
    throw new AdapterContractError("SYNCHRONOUS_RESULT_MISSING");
  }
  return attachEvidenceToResult(mappedResult, snapshot, payload);
}

function attachEvidence(
  transition: SnapshotTransition,
  snapshot: ExecutionSnapshot,
  structuredContent: Record<string, unknown>,
): SnapshotTransition {
  if (transition.result === null) return transition;
  return {
    ...transition,
    result: attachEvidenceToResult(transition.result, snapshot, structuredContent),
  };
}

export function attachEvidenceToResult(
  result: Record<string, unknown>,
  snapshot: ExecutionSnapshot,
  structuredContent: Record<string, unknown>,
): Record<string, unknown> {
  const items = validateEvidence(snapshot.evidence ?? [], structuredContent);
  return {
    resultType: "complete",
    ...result,
    ...(items.length === 0
      ? {}
      : {
          _meta: {
            "io.sdar/evidence": { profileVersion: "1.0", items },
          },
        }),
  };
}

function validateEvidence(
  evidence: NonNullable<ExecutionSnapshot["evidence"]>,
  structuredContent: Record<string, unknown>,
): Record<string, unknown>[] {
  if (evidence.length > 64) throw new AdapterContractError("ADAPTER_EVIDENCE_TOO_MANY_ITEMS");
  const ids = new Set<string>();
  const items = evidence.map((item) => {
    bounded(item.evidenceId, 1, 128, "ADAPTER_EVIDENCE_ID_INVALID");
    if (ids.has(item.evidenceId)) throw new AdapterContractError("ADAPTER_EVIDENCE_ID_DUPLICATE");
    ids.add(item.evidenceId);
    bounded(item.evidenceType, 1, 128, "ADAPTER_EVIDENCE_TYPE_INVALID");
    if (!isZonedRfc3339(item.observedAt)) {
      throw new AdapterContractError("ADAPTER_EVIDENCE_OBSERVED_AT_INVALID");
    }
    if (item.subjectRef !== undefined) {
      bounded(item.subjectRef, 1, 512, "ADAPTER_EVIDENCE_SUBJECT_REF_INVALID");
    }
    const rawProducer: unknown = item.producer;
    if (
      rawProducer !== undefined &&
      (!Array.isArray(rawProducer) ||
        rawProducer.length > 16 ||
        rawProducer.some((value) => typeof value !== "string"))
    ) {
      throw new AdapterContractError("ADAPTER_EVIDENCE_PRODUCER_INVALID");
    }
    const producer = (rawProducer ?? []) as string[];
    const payloadRef = evidencePayloadRef(item.payloadRef, structuredContent);
    return {
      evidenceId: item.evidenceId,
      evidenceType: item.evidenceType,
      observedAt: item.observedAt,
      ...(item.subjectRef === undefined ? {} : { subjectRef: item.subjectRef }),
      payloadRef,
      ...(producer.length === 0 ? {} : { producer }),
    };
  });
  let serialized: string;
  try {
    serialized = JSON.stringify({ profileVersion: "1.0", items });
  } catch (error) {
    throw new AdapterContractError("ADAPTER_EVIDENCE_NOT_JSON", { cause: error });
  }
  if (Buffer.byteLength(serialized) > 262_144) {
    throw new AdapterContractError("ADAPTER_EVIDENCE_TOO_LARGE");
  }
  assertJsonDepth(items, 16, "ADAPTER_EVIDENCE_TOO_DEEP");
  return items;
}

function evidencePayloadRef(
  value: NonNullable<ExecutionSnapshot["evidence"]>[number]["payloadRef"],
  structuredContent: Record<string, unknown>,
): Record<string, unknown> {
  if (value?.kind === "structured_content") {
    const pointer = value.jsonPointer;
    if (typeof pointer !== "string" || pointer.length > 512 || !isJsonPointer(pointer)) {
      throw new AdapterContractError("ADAPTER_EVIDENCE_POINTER_INVALID");
    }
    if (!jsonPointerExists(structuredContent, pointer)) {
      throw new AdapterContractError("ADAPTER_EVIDENCE_POINTER_MISSING");
    }
    return { kind: "structured_content", jsonPointer: pointer };
  }
  if (value?.kind === "uri") {
    const uri = value.uri;
    if (typeof uri !== "string" || uri.length > 2_048 || !allowedEvidenceUri(uri)) {
      throw new AdapterContractError("ADAPTER_EVIDENCE_URI_INVALID");
    }
    if (value.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(value.sha256)) {
      throw new AdapterContractError("ADAPTER_EVIDENCE_SHA256_INVALID");
    }
    return {
      kind: "uri",
      uri,
      ...(value.mediaType === undefined ? {} : { mediaType: value.mediaType }),
      ...(value.sha256 === undefined ? {} : { sha256: value.sha256 }),
    };
  }
  throw new AdapterContractError("ADAPTER_EVIDENCE_PAYLOAD_REF_INVALID");
}

function bounded(value: string, min: number, max: number, code: string): void {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw new AdapterContractError(code);
  }
}

function isZonedRfc3339(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isJsonPointer(value: string): boolean {
  return /^(?:|(?:\/(?:[^~/]|~[01])*)*)$/.test(value);
}

function jsonPointerExists(root: unknown, pointer: string): boolean {
  if (pointer === "") return true;
  let current = root;
  for (const segment of pointer.slice(1).split("/")) {
    const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (typeof current !== "object" || current === null || !(key in current)) return false;
    current = (current as Record<string, unknown>)[key];
  }
  return true;
}

function allowedEvidenceUri(value: string): boolean {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  return scheme !== undefined && new Set(["https", "s3", "gs", "azblob", "urn"]).has(scheme);
}

function assertJsonDepth(value: unknown, maximum: number, code: string, depth = 0): void {
  if (depth > maximum) throw new AdapterContractError(code);
  if (Array.isArray(value)) {
    for (const child of value) assertJsonDepth(child, maximum, code, depth + 1);
  } else if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) assertJsonDepth(child, maximum, code, depth + 1);
  }
}

function technicalFailureTransition(reasonCode: string): SnapshotTransition {
  return mapAdapterSnapshot({
    state: "TECHNICAL_FAILED",
    reasonCode,
    message: "Adapter result failed Runtime contract validation.",
    retryable: false,
    result: {},
  });
}

function normalizeSnapshot(snapshot: ExecutionSnapshot, result: Record<string, unknown>) {
  return {
    state: snapshot.state,
    reasonCode: snapshot.reasonCode,
    message: snapshot.message,
    retryable: snapshot.retryable,
    result,
  };
}

function assertResultLimits(value: unknown): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new AdapterContractError("ADAPTER_RESULT_NOT_JSON", { cause: error });
  }
  if (Buffer.byteLength(serialized) > 1_048_576) {
    throw new AdapterContractError("ADAPTER_RESULT_TOO_LARGE");
  }
  let nodes = 0;
  const visit = (item: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > 10_000) throw new AdapterContractError("ADAPTER_RESULT_TOO_COMPLEX");
    if (depth > 32) throw new AdapterContractError("ADAPTER_RESULT_TOO_DEEP");
    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1);
    } else if (typeof item === "object" && item !== null) {
      for (const child of Object.values(item)) visit(child, depth + 1);
    }
  };
  visit(value, 0);
}

function sanitizeResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeResult);
  if (typeof value !== "object" || value === null) return value;
  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") continue;
    sanitized[key] = sanitizeResult(child);
  }
  return sanitized;
}

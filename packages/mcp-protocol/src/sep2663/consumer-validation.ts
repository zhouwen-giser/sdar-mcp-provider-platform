export type FrozenTaskBehavior = "synchronous_only" | "server_directed" | "task_required";

export interface SdarEvidenceRequirement {
  requirementId: string;
  evidenceType: string;
  required: boolean;
  hardGate: boolean;
}

export function validateFrozenCallToolResult(
  value: unknown,
  taskBehavior: FrozenTaskBehavior,
): Record<string, unknown> {
  const result = record(value, "CALL_TOOL_RESULT_INVALID");
  if (result.resultType !== "complete" && result.resultType !== "task") {
    throw new Error("CALL_TOOL_RESULT_TYPE_MISSING");
  }
  if (taskBehavior === "synchronous_only" && result.resultType === "task") {
    throw new Error("SYNCHRONOUS_ONLY_RETURNED_TASK");
  }
  if (taskBehavior === "task_required" && result.resultType === "complete") {
    const structured = record(result.structuredContent, "TASK_REQUIRED_SYNCHRONOUS_SUCCESS");
    if (result.isError !== true || structured.outcome !== "admission_rejected") {
      throw new Error("TASK_REQUIRED_SYNCHRONOUS_SUCCESS");
    }
  }
  return result;
}

export function bindSdarEvidenceRequirements(
  callToolResult: unknown,
  requirements: readonly SdarEvidenceRequirement[],
): Record<string, string[]> {
  const result = validateFrozenCallToolResult(callToolResult, "server_directed");
  if (result.resultType !== "complete") return {};
  const structuredContent = record(result.structuredContent ?? {}, "EVIDENCE_RESULT_INVALID");
  const meta = record(result._meta ?? {}, "EVIDENCE_META_INVALID");
  const rawProfile = meta["io.sdar/evidence"];
  const items = rawProfile === undefined ? [] : evidenceItems(rawProfile);
  const bindings: Record<string, string[]> = {};

  for (const requirement of requirements) {
    const matches = items.filter((item) => item.evidenceType === requirement.evidenceType);
    for (const item of matches)
      validateEvidencePayload(item, structuredContent, requirement.hardGate);
    if (requirement.required && matches.length === 0) {
      throw new Error("EVIDENCE_REQUIRED_MISSING");
    }
    bindings[requirement.requirementId] = matches.map((item) => item.evidenceId);
  }
  return bindings;
}

interface EvidenceItem {
  evidenceId: string;
  evidenceType: string;
  payloadRef: Record<string, unknown>;
}

function evidenceItems(value: unknown): EvidenceItem[] {
  const profile = record(value, "EVIDENCE_PROFILE_INVALID");
  if (profile.profileVersion !== "1.0" || !Array.isArray(profile.items)) {
    throw new Error("EVIDENCE_PROFILE_INVALID");
  }
  return profile.items.map((raw) => {
    const item = record(raw, "EVIDENCE_ITEM_INVALID");
    if (Object.hasOwn(item, "requirementId")) throw new Error("EVIDENCE_REQUIREMENT_ID_FORBIDDEN");
    if (typeof item.evidenceId !== "string" || typeof item.evidenceType !== "string") {
      throw new Error("EVIDENCE_ITEM_INVALID");
    }
    return {
      evidenceId: item.evidenceId,
      evidenceType: item.evidenceType,
      payloadRef: record(item.payloadRef, "EVIDENCE_PAYLOAD_REF_INVALID"),
    };
  });
}

function validateEvidencePayload(
  item: EvidenceItem,
  structuredContent: Record<string, unknown>,
  hardGate: boolean,
): void {
  if (item.payloadRef.kind === "structured_content") {
    const pointer = item.payloadRef.jsonPointer;
    if (typeof pointer !== "string" || !jsonPointerExists(structuredContent, pointer)) {
      throw new Error("EVIDENCE_POINTER_MISSING");
    }
    return;
  }
  if (item.payloadRef.kind === "uri") {
    const uri = item.payloadRef.uri;
    if (typeof uri !== "string" || !/^(https|s3|gs|azblob|urn):/i.test(uri)) {
      throw new Error("EVIDENCE_URI_INVALID");
    }
    const sha256 = item.payloadRef.sha256;
    if (hardGate && (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256))) {
      throw new Error("EVIDENCE_URI_HASH_MISSING");
    }
    return;
  }
  throw new Error("EVIDENCE_PAYLOAD_REF_INVALID");
}

function jsonPointerExists(root: unknown, pointer: string): boolean {
  if (pointer === "") return true;
  if (!/^(?:\/(?:[^~/]|~[01])*)+$/.test(pointer)) return false;
  let current = root;
  for (const rawSegment of pointer.slice(1).split("/")) {
    const segment = rawSegment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (typeof current !== "object" || current === null || !(segment in current)) return false;
    current = (current as Record<string, unknown>)[segment];
  }
  return true;
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

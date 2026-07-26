import { describe, expect, it } from "vitest";
import {
  bindSdarEvidenceRequirements,
  validateFrozenCallToolResult,
} from "../../packages/mcp-protocol/src/index.js";

describe("frozen result and Evidence consumer validation", () => {
  it("C-015 rejects a legacy nested Task result", () => {
    expect(() =>
      validateFrozenCallToolResult({ task: { taskId: "legacy" } }, "server_directed"),
    ).toThrow("CALL_TOOL_RESULT_TYPE_MISSING");
  });

  it("C-032 accepts a valid structured-content Evidence hard gate", () => {
    expect(bindSdarEvidenceRequirements(result(evidence()), [requirement()])).toEqual({
      "final-position": ["evidence-1"],
    });
  });

  it("C-033 rejects a missing required Evidence item", () => {
    expect(() =>
      bindSdarEvidenceRequirements(
        {
          ...result(evidence()),
          _meta: { "io.sdar/evidence": { profileVersion: "1.0", items: [] } },
        },
        [requirement()],
      ),
    ).toThrow("EVIDENCE_REQUIRED_MISSING");
  });

  it("C-034 rejects an Evidence pointer absent from structuredContent", () => {
    expect(() =>
      bindSdarEvidenceRequirements(
        result(evidence({ payloadRef: { kind: "structured_content", jsonPointer: "/missing" } })),
        [requirement()],
      ),
    ).toThrow("EVIDENCE_POINTER_MISSING");
  });

  it("C-035 permits URI Evidence without SHA when it is not a hard gate", () => {
    expect(
      bindSdarEvidenceRequirements(
        result(
          evidence({ payloadRef: { kind: "uri", uri: "https://example.test/evidence.json" } }),
        ),
        [{ ...requirement(), hardGate: false }],
      ),
    ).toEqual({ "final-position": ["evidence-1"] });
  });

  it("C-067 rejects a CallToolResult without resultType", () => {
    expect(() => validateFrozenCallToolResult({ isError: false }, "server_directed")).toThrow(
      "CALL_TOOL_RESULT_TYPE_MISSING",
    );
  });

  it("C-068 rejects synchronous success for task_required", () => {
    expect(() =>
      validateFrozenCallToolResult(
        { resultType: "complete", structuredContent: { ok: true }, isError: false },
        "task_required",
      ),
    ).toThrow("TASK_REQUIRED_SYNCHRONOUS_SUCCESS");
  });

  it("C-069 allows synchronous admission_rejected for task_required", () => {
    expect(
      validateFrozenCallToolResult(
        {
          resultType: "complete",
          structuredContent: { outcome: "admission_rejected" },
          isError: true,
        },
        "task_required",
      ),
    ).toMatchObject({ resultType: "complete", isError: true });
  });

  it("C-071 rejects Provider Evidence containing requirementId", () => {
    expect(() =>
      bindSdarEvidenceRequirements(result(evidence({ requirementId: "local-only" })), [
        requirement(),
      ]),
    ).toThrow("EVIDENCE_REQUIREMENT_ID_FORBIDDEN");
  });

  it("C-072 binds a local Skill requirement by evidenceType", () => {
    expect(bindSdarEvidenceRequirements(result(evidence()), [requirement()])).toEqual({
      "final-position": ["evidence-1"],
    });
  });

  it("C-074 rejects missing SHA-256 only when URI Evidence is a hard gate", () => {
    const uriResult = result(
      evidence({ payloadRef: { kind: "uri", uri: "https://example.test/evidence.json" } }),
    );
    expect(
      bindSdarEvidenceRequirements(uriResult, [{ ...requirement(), hardGate: false }]),
    ).toEqual({
      "final-position": ["evidence-1"],
    });
    expect(() => bindSdarEvidenceRequirements(uriResult, [requirement()])).toThrow(
      "EVIDENCE_URI_HASH_MISSING",
    );
  });
});

function result(item: Record<string, unknown>): Record<string, unknown> {
  return {
    resultType: "complete",
    structuredContent: { finalPosition: { x: 1, y: 2 } },
    isError: false,
    _meta: { "io.sdar/evidence": { profileVersion: "1.0", items: [item] } },
  };
}

function evidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    evidenceId: "evidence-1",
    evidenceType: "position.observation",
    observedAt: "2026-07-18T03:12:00.000Z",
    payloadRef: { kind: "structured_content", jsonPointer: "/finalPosition" },
    ...overrides,
  };
}

function requirement() {
  return {
    requirementId: "final-position",
    evidenceType: "position.observation",
    required: true,
    hardGate: true,
  } as const;
}

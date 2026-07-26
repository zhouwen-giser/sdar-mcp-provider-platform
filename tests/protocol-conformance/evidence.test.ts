import { describe, expect, it } from "vitest";
import {
  jsonToProtoStruct,
  type ExecutionSnapshot,
  type ProviderManifest,
} from "../../packages/adapter-protocol/src/index.js";
import {
  attachEvidenceToResult,
  synchronousResult,
  validatedSnapshotTransition,
} from "../../packages/task-engine/src/result-contract.js";
import { OperationRegistry } from "../../packages/operation-registry/src/index.js";

describe("frozen type-only Evidence", () => {
  it("maps validated Adapter Evidence without requirementId", () => {
    const result = attachEvidenceToResult(
      { content: [], structuredContent: { finalPosition: { x: 1, y: 2 } }, isError: false },
      snapshot([
        {
          evidenceId: "position-1",
          evidenceType: "position.observation",
          observedAt: "2026-07-18T03:12:00.000Z",
          subjectRef: "resource:UGV-001",
          payloadRef: { kind: "structured_content", jsonPointer: "/finalPosition" },
          producer: ["sensor:gps-1"],
          requirementId: "must-not-cross-wire-boundary",
        },
      ]),
      { finalPosition: { x: 1, y: 2 } },
    );
    expect(result).toMatchObject({
      resultType: "complete",
      _meta: {
        "io.sdar/evidence": {
          profileVersion: "1.0",
          items: [
            {
              evidenceId: "position-1",
              evidenceType: "position.observation",
              payloadRef: { kind: "structured_content", jsonPointer: "/finalPosition" },
            },
          ],
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("requirementId");
  });

  it.each([
    [
      [
        {
          evidenceId: "missing",
          evidenceType: "position.observation",
          observedAt: "2026-07-18T03:12:00Z",
          payloadRef: { kind: "structured_content", jsonPointer: "/missing" },
        },
      ],
      "ADAPTER_EVIDENCE_POINTER_MISSING",
    ],
    [
      [
        {
          evidenceId: "uri",
          evidenceType: "artifact",
          observedAt: "2026-07-18T03:12:00Z",
          payloadRef: { kind: "uri", uri: "file:///private/evidence.json" },
        },
      ],
      "ADAPTER_EVIDENCE_URI_INVALID",
    ],
    [
      [
        {
          evidenceId: "time",
          evidenceType: "artifact",
          observedAt: "2026-07-18T03:12:00",
          payloadRef: { kind: "uri", uri: "https://example.test/evidence.json" },
        },
      ],
      "ADAPTER_EVIDENCE_OBSERVED_AT_INVALID",
    ],
  ])("rejects invalid Evidence contracts", (items, code) => {
    expect(() => attachEvidenceToResult({}, snapshot(items), {})).toThrow(code);
  });

  it("C-040 gives synchronous and asynchronous completion the same Evidence shape", () => {
    const operation = new OperationRegistry().validate(evidenceManifest()).operations[0];
    if (operation === undefined) throw new Error("missing test operation");
    const adapterSnapshot = {
      state: "SUCCEEDED",
      result: jsonToProtoStruct({ finalPosition: { x: 1, y: 2 } }),
      evidence: [
        {
          evidenceId: "position-1",
          evidenceType: "position.observation",
          observedAt: "2026-07-18T03:12:00.000Z",
          payloadRef: { kind: "structured_content", jsonPointer: "/finalPosition" },
        },
      ],
    } as ExecutionSnapshot;
    expect(synchronousResult(operation, adapterSnapshot)).toEqual(
      validatedSnapshotTransition(operation, adapterSnapshot).result,
    );
  });
});

function snapshot(evidence: unknown[]): ExecutionSnapshot {
  return { evidence } as unknown as ExecutionSnapshot;
}

function evidenceManifest(): ProviderManifest {
  return {
    adapterProtocolVersion: "1.0",
    providerId: "evidence-provider",
    providerType: "test",
    providerVersion: "1.0.0",
    inventoryMode: "OPAQUE",
    operations: [
      {
        name: "evidence.read",
        description: "Read Evidence",
        execution: "SYNCHRONOUS",
        inputSchema: jsonToProtoStruct({ type: "object" }),
        outputSchema: jsonToProtoStruct({
          type: "object",
          properties: { finalPosition: { type: "object" } },
          required: ["finalPosition"],
        }),
        capabilities: {
          availability: false,
          scheduling: false,
          maxElapsed: false,
          cancel: false,
          pauseResume: false,
          inputRequired: false,
          idempotency: true,
          observations: false,
        },
      },
    ],
  };
}

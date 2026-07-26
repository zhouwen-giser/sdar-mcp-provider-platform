import { describe, expect, it } from "vitest";
import {
  sanitizeBusinessEventAuditPayload,
  sanitizeBusinessEventDiagnosticBody,
  sanitizeBusinessEventTraceAttributes,
} from "../../packages/observability/src/index.js";

describe("Business Event telemetry sanitizer", () => {
  const malicious = {
    event: "received",
    sourceId: "source-a",
    sourceSequence: "900719925474099312345",
    rawPayload: "secret",
    rawEnvelopeJson: "secret",
    description: "secret",
    relatedTaskIds: ["task-secret"],
    resourceRef: "resource-secret",
    projectionToken: "token-secret",
    authorizationContextHash: "auth-secret",
    errorMessage: "credential-secret",
    stack: "stack-secret",
    headers: { authorization: "secret" },
  };

  it("keeps only the record-type audit allowlist and preserves decimal strings", () => {
    expect(
      sanitizeBusinessEventAuditPayload("provider.business_event.ingest.lifecycle", malicious),
    ).toEqual({ event: "received", sourceId: "source-a", sourceSequence: "900719925474099312345" });
  });

  it("removes forbidden diagnostic and trace fields", () => {
    expect(sanitizeBusinessEventDiagnosticBody(malicious)).toEqual({ sourceId: "source-a" });
    expect(sanitizeBusinessEventTraceAttributes(malicious)).toEqual({ sourceId: "source-a" });
  });
});

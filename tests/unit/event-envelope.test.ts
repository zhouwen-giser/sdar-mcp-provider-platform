import { describe, expect, it } from "vitest";
import {
  calculateProviderOpsRecordHash,
  createProviderOpsEnvelope,
} from "../../packages/observability/src/index.js";

const baseInput = {
  recordType: "task.state_transitioned",
  eventCategory: "task.lifecycle",
  deliveryClass: "audit",
  providerId: "provider-test",
  runtimeVersion: "1.1.0",
  instanceId: "runtime-a",
  taskId: "task-123",
  stableAggregateIdentity: "task-123",
  eventIdentity: "state-transition",
  revision: 7,
  occurredAt: "2026-07-18T00:00:00.000Z",
  attributes: { from: "working", to: "completed" },
  payload: { outcome: "success", sequence: 7 },
} as const;

describe("ProviderOpsEnvelope", () => {
  it("derives a deterministic UUIDv5 record ID", () => {
    const first = createProviderOpsEnvelope({
      ...baseInput,
      emittedAt: "2026-07-18T00:00:01.000Z",
    });
    const second = createProviderOpsEnvelope({
      ...baseInput,
      emittedAt: "2026-07-18T00:01:00.000Z",
    });

    expect(first.recordId).toBe(second.recordId);
    expect(first.recordId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("keeps the record hash stable across key order and delivery time", () => {
    const first = createProviderOpsEnvelope({
      ...baseInput,
      emittedAt: "2026-07-18T00:00:01.000Z",
    });
    const second = createProviderOpsEnvelope({
      ...baseInput,
      attributes: { to: "completed", from: "working" },
      payload: { sequence: 7, outcome: "success" },
      emittedAt: "2026-07-18T00:03:00.000Z",
    });

    expect(first.recordHash).toBe(second.recordHash);
    expect(calculateProviderOpsRecordHash(first)).toBe(first.recordHash);
  });

  it("keeps the record hash stable across Runtime replicas", () => {
    const first = createProviderOpsEnvelope({ ...baseInput, instanceId: "runtime-a" });
    const second = createProviderOpsEnvelope({ ...baseInput, instanceId: "runtime-b" });

    expect(first.recordId).toBe(second.recordId);
    expect(first.recordHash).toBe(second.recordHash);
  });

  it("changes the record hash when stable payload content changes", () => {
    const first = createProviderOpsEnvelope(baseInput);
    const changed = createProviderOpsEnvelope({
      ...baseInput,
      payload: { outcome: "failure", sequence: 7 },
    });

    expect(changed.recordId).toBe(first.recordId);
    expect(changed.recordHash).not.toBe(first.recordHash);
  });
});

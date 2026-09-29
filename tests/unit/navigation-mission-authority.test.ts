import { requireValue } from "../../packages/gowm-shared-storage-adapter/src/value.js";
import { describe, expect, it } from "vitest";
import {
  navigationMissionEnvelopes,
  type NavigationAuthorityInput,
} from "../../packages/gowm-shared-storage-adapter/src/navigation-mission-outbox.js";
const input: NavigationAuthorityInput = {
  deviceId: "device-a",
  serviceKey: "service",
  bindingId: "binding-a",
  taskId: "task-a",
  executionId: "execution-a",
  providerId: "provider",
  resourceId: "vehicle:a",
  argumentHash: "a".repeat(64),
  authorizationHash: "b".repeat(64),
  executionMode: "live",
  observedAt: "2026-09-09T10:52:00.000Z",
  receipts: [
    {
      stepId: "primary",
      state: "ACCEPTED",
      nativeMissionId: "41987",
      resultHash: "c".repeat(64),
      completedAt: "2026-09-09T10:51:00.000Z",
      missionInstanceId: "mission-instance-a",
    },
  ],
};
describe("committed navigation mission authority", () => {
  it("publishes exact identity only with linked, hashed receipt evidence", () => {
    const events = navigationMissionEnvelopes(input);
    expect(events).toHaveLength(2);
    expect(events[1]?.payload).toMatchObject({
      relationStatus: "exact",
      deviceMissionId: "41987",
      sourceRecordRefs: [events[0]?.recordId],
    });
    expect(events[1]?.attributes["sdar.mission.source_record_hashes"]).toEqual({
      [requireValue(events[0]).recordId]: requireValue(events[0]).recordHash,
    });
    expect(events[0]?.attributes["sdar.evidence.authority"]).toBe("navigation_dispatch_receipt_v1");
    expect(navigationMissionEnvelopes(structuredClone(input))).toEqual(events);
  });
  it("uses one normalized timestamp in the envelope and relation payload", () => {
    const event = requireValue(
      navigationMissionEnvelopes({ ...input, observedAt: "2026-09-09T10:52:00Z" }).at(-1),
    );
    expect(event.payload).toMatchObject({ observedAt: event.occurredAt });
  });
  it.each([
    { state: "UNCERTAIN" },
    { resultHash: null },
    { missionInstanceId: null },
    { nativeMissionId: null },
    { nativeMissionId: "" },
  ])("does not invent authority from an incomplete receipt: %j", (patch) => {
    const events = navigationMissionEnvelopes({
      ...input,
      receipts: [{ ...requireValue(input.receipts[0]), ...patch }],
    });
    expect(events.at(-1)?.payload).toMatchObject({
      relationStatus: "unresolved",
      deviceMissionId: null,
    });
  });
  it("treats repeated controls of the same Mission as one identity, differing IDs as conflict", () => {
    const followup = { ...requireValue(input.receipts[0]), stepId: "followup" };
    expect(
      navigationMissionEnvelopes({ ...input, receipts: [...input.receipts, followup] }).at(-1)
        ?.payload,
    ).toMatchObject({ relationStatus: "exact" });
    expect(
      navigationMissionEnvelopes({
        ...input,
        receipts: [...input.receipts, { ...followup, nativeMissionId: "41988" }],
      }).at(-1)?.payload,
    ).toMatchObject({ relationStatus: "conflict", deviceMissionId: null });
  });
  it("keeps source identity and hash stable across input ordering and isolates device/binding/execution", () => {
    const receipts = [
      ...input.receipts,
      { ...requireValue(input.receipts[0]), stepId: "followup" },
    ];
    expect(navigationMissionEnvelopes({ ...input, receipts })).toEqual(
      navigationMissionEnvelopes({ ...input, receipts: [...receipts].reverse() }),
    );
    const original = requireValue(navigationMissionEnvelopes(input).at(-1));
    for (const patch of [
      { deviceId: "device-b" },
      { bindingId: "binding-b" },
      { executionId: "execution-b" },
      { serviceKey: "other" },
    ]) {
      const other = requireValue(navigationMissionEnvelopes({ ...input, ...patch }).at(-1));
      expect(other.recordId).not.toBe(original.recordId);
      expect(other.recordHash).not.toBe(original.recordHash);
    }
  });
});

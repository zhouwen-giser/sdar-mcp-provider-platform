import { describe, expect, it } from "vitest";
import type { AuthorizationContext } from "../../../packages/domain/src/index.js";
import { BusinessEventNotificationManager } from "../../../packages/mcp-protocol/src/index.js";
import {
  FakeBusinessEventReader,
  FakeBusinessEventResponse,
  generation,
  listenRequest,
  nextStreamId,
  streamId,
} from "../sse-fixtures.js";

const authorization: AuthorizationContext = {
  hash: "a".repeat(64),
  executionMode: "live",
  simulationId: null,
};

describe("Business Event continuity", () => {
  it("drains a replayable generation, sends continuity, and closes", async () => {
    const reader = new FakeBusinessEventReader();
    reader.generationValue = generation({
      status: "replayable_closed",
      currentSequence: "4",
      lastReplayableSequence: "4",
      lastContinuousSequence: "4",
    });
    reader.continuity = {
      previousStreamId: streamId,
      newStreamId: nextStreamId,
      reasonCode: "SOURCE_ROSTER_CHANGED",
      affectedSourceIds: ["source.a"],
      lastReplayableSequence: "4",
      lastContinuousSequence: "4",
      gapDetectedAt: new Date("2026-07-22T01:00:00Z"),
    };
    const response = new FakeBusinessEventResponse(2);
    await new BusinessEventNotificationManager("provider.stream", reader).listen(
      listenRequest({ cursor: { streamId, afterSequence: "4" } }),
      response.asServerResponse(),
      authorization,
    );
    expect(response.messages().map((message) => message.method)).toEqual([
      "notifications/io.sdar/businessEvents/acknowledged",
      "notifications/io.sdar/businessEvents/continuity",
    ]);
  });
});

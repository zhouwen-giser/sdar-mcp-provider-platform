import { describe, expect, it } from "vitest";
import type { AuthorizationContext } from "../../../packages/domain/src/index.js";
import { BusinessEventNotificationManager } from "../../../packages/mcp-protocol/src/index.js";
import {
  event,
  FakeBusinessEventReader,
  FakeBusinessEventResponse,
  generation,
  listenRequest,
  streamId,
} from "../sse-fixtures.js";

const authorization: AuthorizationContext = {
  hash: "a".repeat(64),
  executionMode: "live",
  simulationId: null,
};

describe("Business Event replay", () => {
  it("advances lastScanned across filtered events and delivers the authorized projection", async () => {
    const reader = new FakeBusinessEventReader();
    reader.generationValue = generation({ currentSequence: "2" });
    reader.events = [event("1"), event("2")];
    reader.visibleEventIds.add(reader.events[1]?.eventId ?? "");
    const response = new FakeBusinessEventResponse(2);
    await new BusinessEventNotificationManager("provider.stream", reader, {
      replayBatchSize: 1,
    }).listen(
      listenRequest({ cursor: { streamId, afterSequence: "0" } }),
      response.asServerResponse(),
      authorization,
    );
    expect(reader.replayAfter).toEqual(["0", "1"]);
    expect(response.messages().map((message) => message.method)).toEqual([
      "notifications/io.sdar/businessEvents/acknowledged",
      "notifications/io.sdar/businessEvents",
    ]);
    expect(response.messages()[1]).toMatchObject({
      params: { sequence: "2", relatedTaskCount: 1 },
    });
  });

  it("rejects ahead and expired cursors before starting SSE", async () => {
    const reader = new FakeBusinessEventReader();
    reader.generationValue = generation({ currentSequence: "10", earliestAvailableSequence: "5" });
    const manager = new BusinessEventNotificationManager("provider.stream", reader);
    for (const [afterSequence, reasonCode] of [
      ["11", "BUSINESS_EVENT_CURSOR_AHEAD"],
      ["3", "BUSINESS_EVENT_CURSOR_EXPIRED"],
    ] as const) {
      await expect(
        manager.listen(
          listenRequest({ cursor: { streamId, afterSequence } }),
          new FakeBusinessEventResponse(1).asServerResponse(),
          authorization,
        ),
      ).rejects.toMatchObject({ data: { reasonCode } });
    }
  });
});

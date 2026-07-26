import { describe, expect, it } from "vitest";
import { BusinessEventNotificationManager } from "../../../packages/mcp-protocol/src/index.js";
import type { AuthorizationContext } from "../../../packages/domain/src/index.js";
import {
  FakeBusinessEventReader,
  FakeBusinessEventResponse,
  listenRequest,
} from "../sse-fixtures.js";

const authorization: AuthorizationContext = {
  hash: "a".repeat(64),
  executionMode: "live",
  simulationId: null,
};

describe("Business Event stream", () => {
  it("requires the capability on every listen request", async () => {
    const manager = new BusinessEventNotificationManager(
      "provider.stream",
      new FakeBusinessEventReader(),
    );
    await expect(
      manager.listen(
        listenRequest({ startPosition: "latest" }, false),
        new FakeBusinessEventResponse(1).asServerResponse(),
        authorization,
      ),
    ).rejects.toMatchObject({ code: -32003 });
  });

  it("sends Ack first for an empty latest stream and snapshots discovery roster", async () => {
    const manager = new BusinessEventNotificationManager(
      "provider.stream",
      new FakeBusinessEventReader(),
      {
        maxStreamDurationMs: 10,
      },
    );
    await expect(manager.discovery(604_800_000)).resolves.toMatchObject({
      profileVersion: "1.0",
      continuityClass: "all_durable",
      sources: [{ sourceId: "source.a", deliverySemantics: "durable_at_least_once" }],
    });
    const response = new FakeBusinessEventResponse(1);
    await manager.listen(
      listenRequest({ startPosition: "latest" }),
      response.asServerResponse(),
      authorization,
    );
    expect(response.headers["content-type"]).toBe("text/event-stream");
    expect(response.messages()[0]).toMatchObject({
      method: "notifications/io.sdar/businessEvents/acknowledged",
      params: { acceptedAfterSequence: "0", generationStatus: "current" },
    });
  });
});

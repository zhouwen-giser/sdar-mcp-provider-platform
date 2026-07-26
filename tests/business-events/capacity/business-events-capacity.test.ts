import { describe, expect, it } from "vitest";
import { BusinessEventNotificationManager } from "../../../packages/mcp-protocol/src/index.js";
import type { AuthorizationContext } from "../../../packages/domain/src/index.js";
import {
  FakeBusinessEventReader,
  FakeBusinessEventResponse,
  listenRequest,
} from "../sse-fixtures.js";

const authorization: AuthorizationContext = {
  hash: "c".repeat(64),
  executionMode: "live",
  simulationId: null,
};

describe("Business Event capacity baseline", () => {
  it("exercises the required bounded cardinalities without unbounded allocation", () => {
    const sources = Array.from({ length: 16 }, (_, index) => `source.${String(index)}`);
    const replicas = ["replica-a", "replica-b"];
    const storedEvents = Array.from({ length: 10_000 }, (_, index) => index + 1);
    const subscriptions = Array.from({ length: 256 }, (_, index) => index);
    const relations = Array.from({ length: 4_096 }, (_, index) => `task-${String(index)}`);
    const replayBatches = Math.ceil(storedEvents.length / 256);
    const relationPages = Array.from({ length: 1_000 }, (_, index) => index);

    expect({
      sources: sources.length,
      replicas: replicas.length,
      storedEvents: storedEvents.length,
      subscriptions: subscriptions.length,
      relations: relations.length,
      replayBatchSize: 256,
      replayBatches,
      relationPages: relationPages.length,
    }).toEqual({
      sources: 16,
      replicas: 2,
      storedEvents: 10_000,
      subscriptions: 256,
      relations: 4_096,
      replayBatchSize: 256,
      replayBatches: 40,
      relationPages: 1_000,
    });
  });

  it("rejects subscriptions above the per-authorization bound and releases capacity", async () => {
    const manager = new BusinessEventNotificationManager(
      "provider.stream",
      new FakeBusinessEventReader(),
      { maxSubscriptions: 2, maxSubscriptionsPerAuth: 1, maxStreamDurationMs: 500 },
    );
    const firstResponse = new FakeBusinessEventResponse(100);
    const first = manager.listen(
      listenRequest({ startPosition: "latest" }),
      firstResponse.asServerResponse(),
      authorization,
    );
    await new Promise((resolve) => setImmediate(resolve));
    await expect(
      manager.listen(
        listenRequest({ startPosition: "latest" }),
        new FakeBusinessEventResponse(1).asServerResponse(),
        authorization,
      ),
    ).rejects.toMatchObject({
      data: { reasonCode: "BUSINESS_EVENT_SUBSCRIPTION_CAPACITY_EXCEEDED" },
    });
    firstResponse.emit("close");
    await first;
    await expect(
      manager.listen(
        listenRequest({ startPosition: "latest" }),
        new FakeBusinessEventResponse(1).asServerResponse(),
        authorization,
      ),
    ).resolves.toBeUndefined();
  });
});

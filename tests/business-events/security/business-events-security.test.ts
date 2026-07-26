import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "../../../apps/runtime/src/config.js";
import { createRuntime } from "../../../apps/runtime/src/runtime.js";

const forbiddenMetricLabels = [
  "eventId",
  "taskId",
  "resourceRef",
  "sourceEventId",
  "subscriptionId",
  "authorizationHash",
];

describe("Business Event operational security", () => {
  it("keeps the feature and readiness dependency disabled by default", () => {
    expect(loadRuntimeConfig({})).toMatchObject({
      BUSINESS_EVENTS_ENABLED: false,
      BUSINESS_EVENTS_REQUIRED_FOR_RUNTIME_READY: false,
      BUSINESS_EVENTS_RETENTION_MS: 604_800_000,
      BUSINESS_EVENTS_REPLAY_BATCH_SIZE: 256,
    });
  });

  it("rejects out-of-bound resource controls", () => {
    expect(() => loadRuntimeConfig({ BUSINESS_EVENTS_MAX_QUEUE_MESSAGES: "0" })).toThrow();
    expect(() => loadRuntimeConfig({ BUSINESS_EVENTS_MAX_EVENT_BYTES: "1048577" })).toThrow();
    expect(() => loadRuntimeConfig({ BUSINESS_EVENTS_MAX_PAYLOAD_DEPTH: "65" })).toThrow();
  });

  it("exposes every required readiness component while disabled", async () => {
    const runtime = createRuntime(loadRuntimeConfig({ RUNTIME_ENV: "test" }));
    expect(runtime.dependencies).toMatchObject({
      businessEventPersistence: "disabled",
      businessEventReplay: "disabled",
      businessEventIngest: "disabled",
      businessEventFinalizer: "disabled",
      businessEventAdapterSources: {},
      businessEventRetention: "disabled",
      businessEventProjection: "disabled",
    });
    await runtime.app.close();
  });

  it("does not use sensitive or unbounded business-event metric labels", () => {
    const sources = [
      "packages/mcp-protocol/src/business-events.ts",
      "apps/runtime/src/business-events/source-client.ts",
    ].map((path) => readFileSync(path, "utf8"));
    for (const source of sources) {
      for (const label of forbiddenMetricLabels) {
        expect(source).not.toMatch(
          new RegExp(`metrics?\\?*\\.?(?:increment|gauge)\\([^\\n]+${label}`),
        );
      }
    }
  });
});

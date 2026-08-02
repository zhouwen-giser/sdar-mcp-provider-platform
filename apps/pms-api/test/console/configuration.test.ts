import { describe, expect, it } from "vitest";
import { createConsoleTestApp, WRITE_HEADERS } from "./helpers.js";

describe("Console Configuration operations", () => {
  it("preserves Draft, Preview and Publication result objects", async () => {
    const { app } = createConsoleTestApp();
    const draft = await app.inject({
      method: "POST",
      url: "/api/console/v1/configuration-drafts",
      headers: WRITE_HEADERS,
      payload: {
        draftId: "draft-1",
        definitionId: "definition-1",
        environment: "production",
        targetType: "provider",
        targetId: "provider-1",
        configGroup: "runtime",
        dataId: "default",
        content: { endpoint: "http://device.invalid" },
      },
    });
    expect(draft.statusCode).toBe(201);
    expect(draft.json()).toMatchObject({ draftId: "draft-1", key: { targetType: "provider" } });
    const preview = await app.inject({
      method: "GET",
      url: "/api/console/v1/configuration-drafts/draft-1/effective",
    });
    expect(preview.json()).toMatchObject({ valid: true, applyMode: "restart_required" });
    const publish = await app.inject({
      method: "POST",
      url: "/api/console/v1/configuration-drafts/draft-1/publish",
      headers: WRITE_HEADERS,
      payload: { expectedDraftVersion: 1, expectedPublishedRevision: null },
    });
    expect(publish.statusCode).toBe(200);
    expect(publish.json()).toMatchObject({ outcome: "published", revision: { revision: 1 } });
    await app.close();
  });
});

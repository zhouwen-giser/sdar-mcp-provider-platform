import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLightConfig } from "../../apps/home-assistant-light-provider/src/config.js";
import { normalizeLightState } from "../../apps/home-assistant-light-provider/src/home-assistant.js";
import { loadLightResources } from "../../apps/home-assistant-light-provider/src/resources.js";

describe("Home Assistant light core", () => {
  it("requires a token file and rejects the token environment variable", () => {
    const directory = mkdtempSync(join(tmpdir(), "light-config-"));
    const token = join(directory, "token");
    writeFileSync(token, "secret\n");
    const base = {
      HOME_ASSISTANT_URL: "http://127.0.0.1:8123",
      HOME_ASSISTANT_TOKEN_FILE: token,
      LIGHT_RESOURCES_FILE: join(directory, "lights.json"),
      PROVIDER_STATE_PATH: join(directory, "state.json"),
      RUNTIME_ENV: "test",
    };
    expect(loadLightConfig(base).homeAssistantToken).toBe("secret");
    expect(() => loadLightConfig({ ...base, HOME_ASSISTANT_TOKEN: "bad" })).toThrow(
      "HOME_ASSISTANT_TOKEN_ENVIRONMENT_FORBIDDEN",
    );
    expect(() => loadLightConfig({ ...base, RUNTIME_ENV: "production" })).toThrow(
      "HOME_ASSISTANT_INSECURE_HTTP_FORBIDDEN",
    );
  });

  it("keeps light entity identifiers allowlisted and maps unsupported brightness to null", () => {
    const directory = mkdtempSync(join(tmpdir(), "light-resource-"));
    const path = join(directory, "lights.json");
    writeFileSync(
      path,
      JSON.stringify({
        resources: [
          { resourceId: "main", entityId: "light.main", displayName: "Main", enabled: true },
        ],
      }),
    );
    expect(loadLightResources(path)).toHaveLength(1);
    expect(
      normalizeLightState("main", {
        entity_id: "light.main",
        state: "on",
        attributes: {},
        last_changed: "2026-07-18T00:00:00Z",
        last_updated: "2026-07-18T00:00:00Z",
      }),
    ).toMatchObject({
      power: "on",
      reachable: true,
      brightnessPercent: null,
      supportsBrightness: false,
    });
    expect(
      normalizeLightState("main", {
        entity_id: "light.main",
        state: "on",
        attributes: { brightness: 128 },
        last_changed: "2026-07-18T00:00:00Z",
        last_updated: "2026-07-18T00:00:00Z",
      }),
    ).toMatchObject({ brightnessPercent: 50, supportsBrightness: true });
    expect(
      normalizeLightState("main", {
        entity_id: "light.main",
        state: "unexpected",
        attributes: {},
        last_changed: "2026-07-18T00:00:00Z",
        last_updated: "2026-07-18T00:00:00Z",
      }),
    ).toMatchObject({ power: "unknown", reachable: false });
  });
});

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadClimateConfig } from "../../apps/home-assistant-climate-provider/src/config.js";
import { normalizeClimateState } from "../../apps/home-assistant-climate-provider/src/home-assistant.js";
import { loadClimateResources } from "../../apps/home-assistant-climate-provider/src/resources.js";
import { stableClimateEventId } from "../../apps/home-assistant-climate-provider/src/telemetry.js";
describe("Home Assistant climate core", () => {
  it("requires a token file and rejects insecure production HTTP", () => {
    const d = mkdtempSync(join(tmpdir(), "climate-config-"));
    const token = join(d, "token");
    writeFileSync(token, "secret\n");
    const base = {
      HOME_ASSISTANT_URL: "http://127.0.0.1:8123",
      HOME_ASSISTANT_TOKEN_FILE: token,
      CLIMATE_RESOURCES_FILE: join(d, "climates.json"),
      PROVIDER_STATE_PATH: join(d, "state.json"),
      RUNTIME_ENV: "test",
    };
    expect(loadClimateConfig(base).homeAssistantToken).toBe("secret");
    expect(() => loadClimateConfig({ ...base, HOME_ASSISTANT_TOKEN: "bad" })).toThrow(
      "HOME_ASSISTANT_TOKEN_ENVIRONMENT_FORBIDDEN",
    );
    expect(() => loadClimateConfig({ ...base, RUNTIME_ENV: "production" })).toThrow(
      "HOME_ASSISTANT_INSECURE_HTTP_FORBIDDEN",
    );
  });
  it("validates climate domain and normalizes temperatures", () => {
    const d = mkdtempSync(join(tmpdir(), "climate-resource-"));
    const path = join(d, "climates.json");
    writeFileSync(
      path,
      JSON.stringify({
        resources: [
          {
            resourceId: "living",
            entityId: "climate.living",
            displayName: "Living",
            enabled: true,
            temperatureRange: { minimum: 16, maximum: 30 },
            allowedHvacModes: ["cool", "heat"],
          },
        ],
      }),
    );
    expect(loadClimateResources(path)).toHaveLength(1);
    const s = normalizeClimateState("living", {
      entity_id: "climate.living",
      state: "cool",
      attributes: {
        current_temperature: 26.5,
        temperature: 24,
        min_temp: 16,
        max_temp: 30,
        hvac_modes: ["cool", "heat"],
        temperature_unit: "°C",
      },
      last_changed: "2026-07-18T00:00:00Z",
      last_updated: "2026-07-18T00:00:00Z",
    });
    expect(s).toMatchObject({
      power: "on",
      hvacMode: "cool",
      currentTemperature: 26.5,
      targetTemperature: 24,
      reachable: true,
    });
  });
  it("builds stable telemetry event ids", () => {
    const a = stableClimateEventId("p", "climate.internal", "t", "RESOURCE_STATE", {
      state: "cool",
      reasonCode: "x",
    });
    const b = stableClimateEventId("p", "climate.internal", "t", "RESOURCE_STATE", {
      reasonCode: "x",
      state: "cool",
    });
    expect(a).toBe(b);
  });
});

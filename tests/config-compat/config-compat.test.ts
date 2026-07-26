import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadClimateConfig } from "../../apps/home-assistant-climate-provider/src/config.js";
import { loadNpcTankProviderConfig } from "../../apps/npc-tank-provider-adapter/src/config.js";
import { loadRuntimeConfig } from "../../apps/runtime/src/config.js";
import { loadUgvProviderConfig } from "../../apps/ugv-provider-adapter/src/config.js";
import inventoryJson from "../../docs/configuration/CONFIG_INVENTORY.json" with { type: "json" };

interface InventoryItem {
  readonly component: string;
  readonly key: string;
  readonly defaultDefined: boolean;
  readonly defaultValue: unknown;
  readonly defaultSha256?: string;
  readonly secret: boolean;
}

const inventory = inventoryJson as { items: InventoryItem[] };

describe("configuration extraction compatibility", () => {
  it("preserves every Runtime default from the pre-extraction inventory", () => {
    assertInventoryDefaults("runtime", loadRuntimeConfig({}));
  });

  it("preserves every UGV default from the pre-extraction inventory", () => {
    assertInventoryDefaults("ugv", loadUgvProviderConfig({}));
  });

  it("preserves every NPC Tank default from the pre-extraction inventory", () => {
    assertInventoryDefaults("npc-tank", loadNpcTankProviderConfig({}));
  });

  it("preserves every Home Assistant Climate default and required fixture", () => {
    const directory = mkdtempSync(join(tmpdir(), "sdar-config-compat-ha-"));
    const tokenFile = join(directory, "token");
    writeFileSync(tokenFile, "compatibility-token\n");
    const configuration = loadClimateConfig({
      HOME_ASSISTANT_URL: "http://127.0.0.1:8123",
      HOME_ASSISTANT_TOKEN_FILE: tokenFile,
      CLIMATE_RESOURCES_FILE: join(directory, "climates.json"),
      PROVIDER_STATE_PATH: join(directory, "state.json"),
    });

    assertInventoryDefaults("home-assistant-climate", configuration);
    expect(configuration).toMatchObject({
      HOME_ASSISTANT_URL: "http://127.0.0.1:8123",
      HOME_ASSISTANT_TOKEN_FILE: tokenFile,
      CLIMATE_RESOURCES_FILE: join(directory, "climates.json"),
      PROVIDER_STATE_PATH: join(directory, "state.json"),
      homeAssistantToken: "compatibility-token",
    });
  });

  it("preserves representative invalid Runtime behavior", () => {
    expect(() => loadRuntimeConfig({ PORT: "70000" })).toThrow();
    expect(() => loadRuntimeConfig({ ALLOW_WEAK_LEASE_CONFIGURATION: "ambiguous" })).toThrow(
      "INVALID_BOOLEAN_ENV:ambiguous",
    );
    expect(() => loadRuntimeConfig({ ADAPTER_TLS_MODE: "required" })).toThrow(
      "mTLS requires CA, certificate, and key paths",
    );
    expect(() => loadRuntimeConfig({ RUNTIME_ENV: "production" })).toThrow(
      "production forbids development auth",
    );
  });

  it("preserves representative invalid UGV and NPC Tank behavior", () => {
    expect(() => loadUgvProviderConfig({ ADAPTER_PORT: "0" })).toThrow();
    expect(() => loadUgvProviderConfig({ UGV_MQTT_TLS_MODE: "required" })).toThrow(
      "UGV_MQTT_MTLS_FILES_REQUIRED",
    );
    expect(() =>
      loadNpcTankProviderConfig({ NPC_TANK_DEVICE_MCP_ALLOW_MOCK_CONTRACT: "yes" }),
    ).toThrow();
    expect(() => loadNpcTankProviderConfig({ RUNTIME_ENV: "production" })).toThrow(
      "PRODUCTION_ADAPTER_MTLS_REQUIRED",
    );
  });

  it("preserves Home Assistant validation and secret isolation", () => {
    const required = {
      HOME_ASSISTANT_URL: "http://127.0.0.1:8123",
      HOME_ASSISTANT_TOKEN_FILE: "/missing/token",
      CLIMATE_RESOURCES_FILE: "/config/climates.json",
      PROVIDER_STATE_PATH: "/state/provider.json",
      RUNTIME_ENV: "test",
    };
    expect(() => loadClimateConfig({ ...required, HOME_ASSISTANT_TOKEN: "forbidden" })).toThrow(
      "HOME_ASSISTANT_TOKEN_ENVIRONMENT_FORBIDDEN",
    );
    expect(() => loadClimateConfig({ ...required, RUNTIME_ENV: "production" })).toThrow(
      "HOME_ASSISTANT_INSECURE_HTTP_FORBIDDEN",
    );
    expect(() => loadClimateConfig(required)).toThrow("HOME_ASSISTANT_TOKEN_FILE_READ_FAILED");
  });

  it("defines DATABASE_URL_FILE as file-wins while keeping the legacy env valid", () => {
    const directory = mkdtempSync(join(tmpdir(), "sdar-config-compat-runtime-"));
    const secretFile = join(directory, "database-url");
    writeFileSync(secretFile, "postgresql://file.example.test/runtime\n");

    expect(
      loadRuntimeConfig({
        DATABASE_URL: "postgresql://legacy.example.test/runtime",
      }).DATABASE_URL,
    ).toBe("postgresql://legacy.example.test/runtime");
    expect(
      loadRuntimeConfig({
        DATABASE_URL: "postgresql://legacy.example.test/runtime",
        DATABASE_URL_FILE: secretFile,
      }).DATABASE_URL,
    ).toBe("postgresql://file.example.test/runtime");
  });
});

function assertInventoryDefaults(component: string, configuration: Record<string, unknown>): void {
  const defaults = inventory.items.filter(
    (item) => item.component === component && item.defaultDefined,
  );
  expect(defaults.length).toBeGreaterThan(0);
  for (const item of defaults) {
    const actual = configuration[item.key];
    if (item.secret) {
      expect(item.defaultSha256).toBeDefined();
      expect(createHash("sha256").update(String(actual)).digest("hex")).toBe(item.defaultSha256);
    } else {
      expect(actual, `${component}.${item.key}`).toEqual(item.defaultValue);
    }
  }
}

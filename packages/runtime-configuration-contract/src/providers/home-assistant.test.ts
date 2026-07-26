import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HomeAssistantClimateConfigurationDefinition,
  homeAssistantClimateLogContext,
  loadHomeAssistantClimateConfiguration,
} from "./home-assistant.js";

describe("Home Assistant Climate configuration contract", () => {
  it("preserves the legacy configuration and keeps Token out of log context", () => {
    const directory = mkdtempSync(join(tmpdir(), "sdar-ha-contract-"));
    const tokenFile = join(directory, "token");
    writeFileSync(tokenFile, "classified-token\n");
    const configuration = loadHomeAssistantClimateConfiguration({
      HOME_ASSISTANT_URL: "http://127.0.0.1:8123",
      HOME_ASSISTANT_TOKEN_FILE: tokenFile,
      CLIMATE_RESOURCES_FILE: join(directory, "climates.json"),
      PROVIDER_STATE_PATH: join(directory, "state.json"),
      RUNTIME_ENV: "test",
    });

    expect(configuration.homeAssistantToken).toBe("classified-token");
    expect(JSON.stringify(homeAssistantClimateLogContext(configuration))).not.toContain(
      "classified-token",
    );
    expect(homeAssistantClimateLogContext(configuration)).not.toHaveProperty(
      "HOME_ASSISTANT_TOKEN_FILE",
    );
  });

  it("covers all 26 inventory fields and omits Secret defaults", () => {
    const inventory = JSON.parse(
      readFileSync("../../docs/configuration/CONFIG_INVENTORY.json", "utf8"),
    ) as { items: { component: string; key: string }[] };
    const expected = inventory.items
      .filter(({ component }) => component === "home-assistant-climate")
      .map(({ key }) => key)
      .sort();
    const actual = HomeAssistantClimateConfigurationDefinition.fields
      .map(({ path }) => path.slice(1))
      .sort();

    expect(actual).toHaveLength(26);
    expect(actual).toEqual(expected);
    for (const path of HomeAssistantClimateConfigurationDefinition.secretPaths) {
      expect(HomeAssistantClimateConfigurationDefinition.defaults).not.toHaveProperty(
        path.slice(1),
      );
    }
  });

  it("retains stable file, URL, and TLS errors", () => {
    const base = {
      HOME_ASSISTANT_URL: "http://127.0.0.1:8123",
      HOME_ASSISTANT_TOKEN_FILE: "/missing/token",
      CLIMATE_RESOURCES_FILE: "/config/climates.json",
      PROVIDER_STATE_PATH: "/state/provider.json",
      RUNTIME_ENV: "test",
    };
    expect(() => loadHomeAssistantClimateConfiguration(base)).toThrow(
      "HOME_ASSISTANT_TOKEN_FILE_READ_FAILED",
    );
    expect(() =>
      loadHomeAssistantClimateConfiguration({ ...base, HOME_ASSISTANT_TOKEN: "forbidden" }),
    ).toThrow("HOME_ASSISTANT_TOKEN_ENVIRONMENT_FORBIDDEN");
    expect(() =>
      loadHomeAssistantClimateConfiguration({
        ...base,
        ADAPTER_TLS_MODE: "required",
      }),
    ).toThrow("ADAPTER_MTLS_FILES_REQUIRED");
  });
});

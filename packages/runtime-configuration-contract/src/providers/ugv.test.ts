import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadUgvProviderConfiguration, UgvProviderConfigurationDefinition } from "./ugv.js";

describe("UGV Provider configuration contract", () => {
  it("preserves the legacy environment fixture", () => {
    expect(
      loadUgvProviderConfiguration({
        PROVIDER_ID: "isr.vehicle.ugv.custom",
        ADAPTER_PORT: "7110",
        UGV_MQTT_WIRE_MODE: "direct_domain_json",
        UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT: "1",
        UGV_ALLOW_NAVIGATION_WITH_RECON: "false",
      }),
    ).toMatchObject({
      PROVIDER_ID: "isr.vehicle.ugv.custom",
      ADAPTER_PORT: 7110,
      UGV_MQTT_WIRE_MODE: "direct_domain_json",
      UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT: true,
      UGV_ALLOW_NAVIGATION_WITH_RECON: false,
    });
  });

  it("accepts the explicit heterogeneous ROS bridge wire profile", () => {
    expect(loadUgvProviderConfiguration({ UGV_MQTT_WIRE_MODE: "ros_bridge_json" })).toMatchObject({
      UGV_MQTT_WIRE_MODE: "ros_bridge_json",
    });
    expect(
      (UgvProviderConfigurationDefinition.schema.properties as Record<string, { enum?: unknown[] }>)
        .UGV_MQTT_WIRE_MODE?.enum,
    ).toContain("ros_bridge_json");
  });

  it("covers all 50 inventory fields", () => {
    const inventory = JSON.parse(
      readFileSync("../../docs/configuration/CONFIG_INVENTORY.json", "utf8"),
    ) as { items: { component: string; key: string }[] };
    const expected = inventory.items
      .filter(({ component }) => component === "ugv")
      .map(({ key }) => key)
      .sort();
    const actual = UgvProviderConfigurationDefinition.fields
      .map(({ path }) => path.slice(1))
      .sort();

    expect(actual).toHaveLength(50);
    expect(actual).toEqual(expected);
  });

  it("marks identity immutable and excludes Secret defaults", () => {
    const byPath = new Map(
      UgvProviderConfigurationDefinition.fields.map((field) => [field.path, field]),
    );
    expect(byPath.get("/PROVIDER_ID")).toMatchObject({
      applyMode: "immutable",
      overridePolicy: { mode: "forbidden" },
    });
    for (const path of UgvProviderConfigurationDefinition.secretPaths) {
      expect(UgvProviderConfigurationDefinition.defaults).not.toHaveProperty(path.slice(1));
      expect(
        (
          UgvProviderConfigurationDefinition.schema.properties as Record<
            string,
            { default?: unknown }
          >
        )[path.slice(1)],
      ).not.toHaveProperty("default");
    }
  });

  it("retains production fail-closed validation", () => {
    expect(() => loadUgvProviderConfiguration({ RUNTIME_ENV: "production" })).toThrow(
      "PRODUCTION_ADAPTER_MTLS_REQUIRED",
    );
    expect(() =>
      loadUgvProviderConfiguration({
        UGV_MQTT_TLS_MODE: "required",
        UGV_MQTT_TLS_CA_PATH: "/run/secrets/ca",
      }),
    ).toThrow("UGV_MQTT_MTLS_FILES_REQUIRED");
  });
});

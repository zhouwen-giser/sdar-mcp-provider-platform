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

  it("covers all 66 inventory fields", () => {
    const inventory = JSON.parse(
      readFileSync(
        new URL("../../../../docs/configuration/CONFIG_INVENTORY.json", import.meta.url),
        "utf8",
      ),
    ) as { items: { component: string; key: string }[] };
    const expected = inventory.items
      .filter(({ component }) => component === "ugv")
      .map(({ key }) => key)
      .sort();
    const actual = UgvProviderConfigurationDefinition.fields
      .map(({ path }) => path.slice(1))
      .sort();

    expect(actual).toHaveLength(66);
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
    const required = new Set(
      (UgvProviderConfigurationDefinition.schema.required as readonly string[] | undefined) ?? [],
    );
    for (const path of UgvProviderConfigurationDefinition.secretPaths) {
      expect(required.has(path.slice(1))).toBe(false);
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

  it("keeps production fail-closed by default and permits explicit internal plaintext", () => {
    expect(() => loadUgvProviderConfiguration({ RUNTIME_ENV: "production" })).toThrow(
      "PRODUCTION_ADAPTER_MTLS_REQUIRED",
    );
    expect(
      loadUgvProviderConfiguration({
        RUNTIME_ENV: "production",
        ALLOW_INSECURE_INTERNAL_TRANSPORT: "true",
        UGV_MQTT_WIRE_MODE: "direct_domain_json",
      }),
    ).toMatchObject({
      RUNTIME_ENV: "production",
      ALLOW_INSECURE_INTERNAL_TRANSPORT: true,
      ADAPTER_TLS_MODE: "disabled",
      UGV_MQTT_TLS_MODE: "disabled",
      UGV_ADAPTER_STORE_MODE: "postgres",
    });
    expect(() =>
      loadUgvProviderConfiguration({ ALLOW_INSECURE_INTERNAL_TRANSPORT: "yes" }),
    ).toThrow();
    expect(() =>
      loadUgvProviderConfiguration({
        UGV_MQTT_TLS_MODE: "required",
        UGV_MQTT_TLS_CA_PATH: "/run/secrets/ca",
      }),
    ).toThrow("UGV_MQTT_MTLS_FILES_REQUIRED");
  });

  it("defaults to simulation, disables fire, and rejects live mock execution", () => {
    expect(loadUgvProviderConfiguration({})).toMatchObject({
      UGV_RESOURCE_ID: "vehicle:ugv1",
      UGV_ENTITY_ID: "ugv1",
      UGV_VEHICLE_TYPE: "ugv",
      UGV_EXECUTION_MODE: "simulation",
      UGV_FIRE_ENABLED: false,
      UGV_STATIONARY_MIN_SAMPLES: 2,
    });
    expect(() =>
      loadUgvProviderConfiguration({
        UGV_EXECUTION_MODE: "live",
        UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT: "true",
      }),
    ).toThrow("UGV_LIVE_MOCK_CONTRACT_FORBIDDEN");
    expect(loadUgvProviderConfiguration({ UGV_EXECUTION_MODE: "live" })).toMatchObject({
      UGV_EXECUTION_MODE: "live",
      UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT: false,
      UGV_ADAPTER_STORE_MODE: "postgres",
    });
  });

  it("bounds the continuous stationary sample requirement", () => {
    expect(loadUgvProviderConfiguration({ UGV_STATIONARY_MIN_SAMPLES: "1" })).toMatchObject({
      UGV_STATIONARY_MIN_SAMPLES: 1,
    });
    expect(loadUgvProviderConfiguration({ UGV_STATIONARY_MIN_SAMPLES: "100" })).toMatchObject({
      UGV_STATIONARY_MIN_SAMPLES: 100,
    });
    expect(() => loadUgvProviderConfiguration({ UGV_STATIONARY_MIN_SAMPLES: "0" })).toThrow();
    expect(() => loadUgvProviderConfiguration({ UGV_STATIONARY_MIN_SAMPLES: "101" })).toThrow();
  });

  it("accepts configured single-resource identity and rejects unsafe identity forms", () => {
    expect(
      loadUgvProviderConfiguration({
        PROVIDER_ID: "isr.vehicle.ugv.alpha-1",
        UGV_RESOURCE_ID: "vehicle:alpha-1",
        UGV_ENTITY_ID: "alpha_1",
        UGV_VEHICLE_TYPE: "ugv_alpha",
      }),
    ).toMatchObject({
      PROVIDER_ID: "isr.vehicle.ugv.alpha-1",
      UGV_RESOURCE_ID: "vehicle:alpha-1",
      UGV_ENTITY_ID: "alpha_1",
      UGV_VEHICLE_TYPE: "ugv_alpha",
    });
    for (const environment of [
      { PROVIDER_ID: " provider" },
      { UGV_RESOURCE_ID: "vehicle alpha" },
      { UGV_ENTITY_ID: "alpha/one" },
      { UGV_VEHICLE_TYPE: "UGV" },
    ])
      expect(() => loadUgvProviderConfiguration(environment)).toThrow();
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  loadNpcTankProviderConfiguration,
  NpcTankProviderConfigurationDefinition,
} from "./npc-tank.js";

describe("NPC Tank Provider configuration contract", () => {
  it("preserves legacy defaults and all conditional capability combinations", () => {
    expect(loadNpcTankProviderConfiguration({})).toMatchObject({
      PROVIDER_ID: "isr.vehicle.npc-tank.npc-tank1",
      NPC_TANK_ALLOW_NAVIGATION_WITH_RECON: true,
      NPC_TANK_FIRE_REQUIRES_CHASSIS_STOPPED: true,
    });
    for (const navigation of ["true", "false"] as const) {
      for (const stopped of ["true", "false"] as const) {
        expect(
          loadNpcTankProviderConfiguration({
            NPC_TANK_ALLOW_NAVIGATION_WITH_RECON: navigation,
            NPC_TANK_FIRE_REQUIRES_CHASSIS_STOPPED: stopped,
          }),
        ).toMatchObject({
          NPC_TANK_ALLOW_NAVIGATION_WITH_RECON: navigation === "true",
          NPC_TANK_FIRE_REQUIRES_CHASSIS_STOPPED: stopped === "true",
        });
      }
    }
  });

  it("covers all 52 inventory fields", () => {
    const inventory = JSON.parse(
      readFileSync("../../docs/configuration/CONFIG_INVENTORY.json", "utf8"),
    ) as { items: { component: string; key: string }[] };
    const expected = inventory.items
      .filter(({ component }) => component === "npc-tank")
      .map(({ key }) => key)
      .sort();
    const actual = NpcTankProviderConfigurationDefinition.fields
      .map(({ path }) => path.slice(1))
      .sort();

    expect(actual).toHaveLength(52);
    expect(actual).toEqual(expected);
  });

  it("marks identity immutable and excludes Secret defaults", () => {
    const byPath = new Map(
      NpcTankProviderConfigurationDefinition.fields.map((field) => [field.path, field]),
    );
    expect(byPath.get("/PROVIDER_ID")).toMatchObject({
      applyMode: "immutable",
      overridePolicy: { mode: "forbidden" },
    });
    const required = new Set(
      (NpcTankProviderConfigurationDefinition.schema.required as readonly string[] | undefined) ??
        [],
    );
    for (const path of NpcTankProviderConfigurationDefinition.secretPaths) {
      expect(required.has(path.slice(1))).toBe(false);
      expect(NpcTankProviderConfigurationDefinition.defaults).not.toHaveProperty(path.slice(1));
      expect(
        (
          NpcTankProviderConfigurationDefinition.schema.properties as Record<
            string,
            { default?: unknown }
          >
        )[path.slice(1)],
      ).not.toHaveProperty("default");
    }
  });

  it("rejects existing invalid production capability combinations", () => {
    expect(() => loadNpcTankProviderConfiguration({ RUNTIME_ENV: "production" })).toThrow(
      "PRODUCTION_ADAPTER_MTLS_REQUIRED",
    );
    expect(() =>
      loadNpcTankProviderConfiguration({
        RUNTIME_ENV: "production",
        ADAPTER_TLS_MODE: "required",
        ADAPTER_TLS_CA_PATH: "/run/secrets/adapter-ca",
        ADAPTER_TLS_CERT_PATH: "/run/secrets/adapter-cert",
        ADAPTER_TLS_KEY_PATH: "/run/secrets/adapter-key",
        NPC_TANK_MQTT_TLS_MODE: "required",
        NPC_TANK_MQTT_TLS_CA_PATH: "/run/secrets/mqtt-ca",
        NPC_TANK_MQTT_TLS_CERT_PATH: "/run/secrets/mqtt-cert",
        NPC_TANK_MQTT_TLS_KEY_PATH: "/run/secrets/mqtt-key",
        NPC_TANK_MQTT_WIRE_MODE: "auto",
      }),
    ).toThrow("PRODUCTION_MQTT_WIRE_MODE_MUST_BE_EXPLICIT");
  });
});

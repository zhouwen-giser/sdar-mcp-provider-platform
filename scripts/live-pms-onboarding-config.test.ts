import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveLivePmsOnboardingConfig } from "./live-pms-onboarding-config.js";

describe("live PMS onboarding configuration", () => {
  const root = resolve("fixture-repository");

  it("preserves the existing local defaults", () => {
    const config = resolveLivePmsOnboardingConfig({}, root);

    expect(config.apiBaseUrl).toBe("http://127.0.0.1:8090");
    expect(config.localStateRoot).toBe(resolve(root, ".local"));
    expect(config.paths.resources).toBe(
      resolve(root, ".local/ha-real-device/resources.local.json"),
    );
    expect(config.providers.climate).toMatchObject({
      adapterHost: "127.0.0.1",
      adapterPort: 17_020,
      adapterEndpoint: "127.0.0.1:17020",
      databaseMode: "provisioned",
    });
    expect(config.providers.climate.databaseName).toBeUndefined();
    expect(config.providers.light).toMatchObject({
      adapterHost: "127.0.0.1",
      adapterPort: 17_021,
      adapterEndpoint: "127.0.0.1:17021",
      databaseMode: "provisioned",
    });
    expect(config.providers.light.databaseName).toBeUndefined();
  });

  it("maps isolated state, API, adapter, and exact preexisting database overrides", () => {
    const localStateRoot = resolve(root, "g01-state");
    const config = resolveLivePmsOnboardingConfig(
      {
        SMPP_LOCAL_STATE_ROOT: localStateRoot,
        SMPP_PMS_API_URL: "http://127.0.0.1:28090/",
        SMPP_CLIMATE_ADAPTER_HOST: "LOCALHOST",
        SMPP_CLIMATE_ADAPTER_PORT: "27020",
        SMPP_LIGHT_ADAPTER_HOST: "127.0.0.2",
        SMPP_LIGHT_ADAPTER_PORT: "27021",
        SMPP_CLIMATE_RUNTIME_DATABASE_NAME: "smpp_climate_runtime_integration",
        SMPP_LIGHT_RUNTIME_DATABASE_NAME: "smpp_light_runtime_integration",
      },
      root,
    );

    expect(config.localStateRoot).toBe(localStateRoot);
    expect(config.apiBaseUrl).toBe("http://127.0.0.1:28090");
    expect(config.paths.databaseUrl).toBe(
      resolve(localStateRoot, "pms-continuation/secrets/pms-database-url"),
    );
    expect(config.providers.climate).toMatchObject({
      adapterHost: "localhost",
      adapterPort: 27_020,
      adapterEndpoint: "localhost:27020",
      databaseMode: "preexisting",
      databaseName: "smpp_climate_runtime_integration",
    });
    expect(config.providers.light).toMatchObject({
      adapterHost: "127.0.0.2",
      adapterPort: 27_021,
      adapterEndpoint: "127.0.0.2:27021",
      databaseMode: "preexisting",
      databaseName: "smpp_light_runtime_integration",
    });
  });

  it.each([
    [{ SMPP_LOCAL_STATE_ROOT: "  " }, "SMPP_LOCAL_STATE_ROOT_INVALID"],
    [{ SMPP_PMS_API_URL: "postgresql://127.0.0.1:8090" }, "SMPP_PMS_API_URL_INVALID"],
    [{ SMPP_PMS_API_URL: "http://token@127.0.0.1:8090" }, "SMPP_PMS_API_URL_INVALID"],
    [{ SMPP_CLIMATE_ADAPTER_HOST: "http://127.0.0.1" }, "SMPP_ADAPTER_HOST_INVALID"],
    [{ SMPP_LIGHT_ADAPTER_PORT: "0" }, "SMPP_ADAPTER_PORT_INVALID"],
    [
      { SMPP_CLIMATE_RUNTIME_DATABASE_NAME: "smpp-climate-runtime-integration" },
      "SMPP_RUNTIME_DATABASE_NAME_INVALID",
    ],
  ])("rejects unsafe overrides: %j", (environment, code) => {
    expect(() => resolveLivePmsOnboardingConfig(environment, root)).toThrow(code);
  });
});

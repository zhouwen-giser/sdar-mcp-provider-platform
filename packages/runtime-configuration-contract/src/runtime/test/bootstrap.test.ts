import { describe, expect, it, vi } from "vitest";
import {
  loadRuntimeBootstrapEnvironment,
  RuntimeBootstrapConfigurationDefinition,
} from "../bootstrap.js";

describe("Runtime bootstrap configuration contract", () => {
  it("preserves valid legacy environment behavior and defaults", () => {
    const defaults = loadRuntimeBootstrapEnvironment({});
    expect(defaults).toMatchObject({
      RUNTIME_ENV: "development",
      HOST: "0.0.0.0",
      PORT: 8080,
      PROVIDER_ID: "mock-provider",
      DATABASE_POOL_MAX: 10,
      ADAPTER_ENDPOINT: "127.0.0.1:7001",
      ADAPTER_TLS_MODE: "disabled",
      ADAPTER_RPC_TIMEOUT_MS: 5_000,
    });

    expect(
      loadRuntimeBootstrapEnvironment({
        DATABASE_URL: "postgresql://legacy.example.test/runtime",
      }).DATABASE_URL,
    ).toBe("postgresql://legacy.example.test/runtime");
  });

  it("loads the database secret from DATABASE_URL_FILE", () => {
    const readSecret = vi.fn(() => "  postgresql://file.example.test/runtime\n");

    const config = loadRuntimeBootstrapEnvironment(
      { DATABASE_URL_FILE: "/run/secrets/runtime-database-url" },
      readSecret,
    );

    expect(config.DATABASE_URL).toBe("postgresql://file.example.test/runtime");
    expect(readSecret).toHaveBeenCalledWith("/run/secrets/runtime-database-url");
    expect(config).not.toHaveProperty("DATABASE_URL_FILE");
  });

  it("gives the file SecretRef precedence over the legacy direct value", () => {
    const config = loadRuntimeBootstrapEnvironment(
      {
        DATABASE_URL: "postgresql://legacy.example.test/runtime",
        DATABASE_URL_FILE: "/run/secrets/runtime-database-url",
      },
      () => "postgresql://file.example.test/runtime",
    );

    expect(config.DATABASE_URL).toBe("postgresql://file.example.test/runtime");
  });

  it.each([
    [(): string => "", "DATABASE_URL_FILE_EMPTY"],
    [(): string => "not-a-url", "DATABASE_URL_FILE_INVALID"],
    [
      (): string => {
        throw new Error("sensitive operating system detail");
      },
      "DATABASE_URL_FILE_READ_FAILED",
    ],
  ] as const)("reports stable file-secret failures without value disclosure", (reader, code) => {
    expect(() =>
      loadRuntimeBootstrapEnvironment({ DATABASE_URL_FILE: "/secret/path" }, reader),
    ).toThrow(expect.objectContaining({ code, message: code }));
  });

  it("makes Provider identity immutable and connection settings restart-required", () => {
    const byPath = new Map(
      RuntimeBootstrapConfigurationDefinition.fields.map((item) => [item.path, item]),
    );

    expect(byPath.get("/PROVIDER_ID")).toMatchObject({
      applyMode: "immutable",
      overridePolicy: { mode: "forbidden" },
    });
    for (const path of [
      "/PORT",
      "/DATABASE_URL",
      "/DATABASE_URL_FILE",
      "/DATABASE_POOL_MAX",
      "/ADAPTER_ENDPOINT",
      "/ADAPTER_TLS_MODE",
      "/ADAPTER_TLS_CA_PATH",
      "/ADAPTER_TLS_CERT_PATH",
      "/ADAPTER_TLS_KEY_PATH",
      "/ADAPTER_RPC_TIMEOUT_MS",
    ]) {
      expect(byPath.get(path)?.applyMode).toBe("restart_required");
    }
  });
});

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEnv } from "node:util";
import { loadRuntimeConfig } from "../../apps/runtime/src/config.js";
import { loadUgvProviderConfig } from "../../apps/ugv-provider-adapter/src/config.js";

const script = resolve("deploy/development/server/package.mjs");
const template = readFileSync(resolve("deploy/development/server/.env.example"), "utf8");
describe("source deployment configuration", () => {
  it("passes custom values without shell inheritance and keeps data volumes", () => {
    const dir = mkdtempSync(join(tmpdir(), "smpp-config-custom-"));
    try {
      const file = join(dir, "test.env");
      const source = template
        .replace("DEPLOY_PORT=19100", "DEPLOY_PORT=19999")
        .replace("DEPLOY_STAGE=development_debug", "DEPLOY_STAGE=qualification");
      writeFileSync(file, source);
      for (let i = 0; i < 2; i++)
        execFileSync(process.execPath, [script, "config", file], {
          env: { ...process.env, DEPLOY_PORT: "1" },
        });
      const compose = JSON.parse(
        readFileSync(resolve("deploy/development/server/state/compose.json"), "utf8"),
      ) as {
        services: {
          runtime: { ports: string[] };
          adapter: { environment: Record<string, string> };
        };
        volumes: Record<string, unknown>;
      };
      expect(compose.services.runtime.ports).toEqual(["0.0.0.0:19999:8080"]);
      expect(compose.services.adapter.environment.UGV_DELIVERY_STAGE).toBe("qualification");
      expect(compose.services.adapter.environment.UGV_EXECUTION_MODE).toBe("live");
      expect(Object.keys(compose.volumes)).toContain("runtime-db");
      expect(readFileSync(file, "utf8")).toBe(source);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("covers schema fields and loads actual defaults for both services", () => {
    execFileSync(process.execPath, [script, "check-template"]);
    const env = parseEnv(template);
    const side = (prefix: string) =>
      Object.fromEntries(
        Object.entries(env)
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => [k.slice(prefix.length), v]),
      );
    expect(loadRuntimeConfig(side("RUNTIME__")).SIMULATOR_CREDENTIAL_FREE).toBe(true);
    expect(loadUgvProviderConfig(side("ADAPTER__")).UGV_EXECUTION_MODE).toBe("live");
  });
  it("rejects misspelled variables before docker and preserves env input", () => {
    const dir = mkdtempSync(join(tmpdir(), "smpp-env-test-"));
    try {
      const file = join(dir, "test.env");
      const source = template + "\nADAPTER__TYPO_FIELD=true\n";
      writeFileSync(file, source);
      expect(() =>
        execFileSync(process.execPath, [script, "config", file], { stdio: "pipe" }),
      ).toThrow();
      expect(readFileSync(file, "utf8")).toBe(source);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("sz-gowm deployment profile", () => {
  const shared = readFileSync(resolve("deploy/development/server/.env.gowm.example"), "utf8");
  it("renders only application containers on the existing external GOWM network", () => {
    execFileSync(process.execPath, [
      script,
      "config",
      resolve("deploy/development/server/.env.gowm.example"),
    ]);
    const compose = JSON.parse(
      readFileSync(resolve("deploy/development/server/state/compose.json"), "utf8"),
    ) as {
      services: Record<string, { environment: Record<string, string>; networks: string[] }>;
      volumes: Record<string, unknown>;
      networks: Record<string, { external?: boolean; name?: string }>;
    };
    expect(Object.keys(compose.services).sort()).toEqual(["adapter", "runtime"]);
    expect(compose.services.adapter?.environment.UGV_FIRE_ENABLED).toBe("true");
    expect(compose.services.adapter?.environment.PROVIDER_TELEMETRY_ENDPOINT).toBe("runtime:7002");
    expect(compose.services.runtime?.environment.PROVIDER_TELEMETRY_HOST).toBe("0.0.0.0");
    expect(Object.keys(compose.volumes).sort()).toEqual(["adapter-state", "runtime-state"]);
    expect(compose.networks.gowm).toEqual({
      external: true,
      name: "gowm-analysis-dev-d2bf0ea98e_default",
    });
    for (const service of Object.values(compose.services)) {
      expect(service.networks).toContain("gowm");
      expect(service.environment.SMPP_ALLOWED_DEVICE_IDS).toBe('["ugv:ugv"]');
      expect(service.environment.GOWM_DATABASE_URL_FILE).toBe("/run/config/gowm.url");
      expect(service.environment.DATABASE_URL).toBeUndefined();
      expect(service.environment.UGV_ADAPTER_DATABASE_URL).toBeUndefined();
    }
  });
  it("loads shared simulation defaults with timeout-compatible leases", () => {
    const env = parseEnv(shared);
    const side = (prefix: string) =>
      Object.fromEntries(
        Object.entries(env)
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => [k.slice(prefix.length), v]),
      );
    const identity = {
      GOWM_DATABASE_URL_FILE: undefined,
      GOWM_DATABASE_URL: "postgresql://test:test@localhost/gowm",
      SMPP_GOWM_BINDING_ID: "00000000-0000-0000-0000-000000000001",
    };
    expect(loadRuntimeConfig({ ...side("RUNTIME__"), ...identity }).ADAPTER_RPC_TIMEOUT_MS).toBe(
      60000,
    );
    expect(loadUgvProviderConfig({ ...side("ADAPTER__"), ...identity }).UGV_FIRE_ENABLED).toBe(
      true,
    );
  });
  it("rejects one-sided mode and legacy connection before calling Docker", () => {
    const dir = mkdtempSync(join(tmpdir(), "smpp-gowm-profile-"));
    try {
      for (const text of [
        shared.replace(
          'ADAPTER__SMPP_STORAGE_MODE="gowm-shared"',
          'ADAPTER__SMPP_STORAGE_MODE="standalone"',
        ),
        shared + "\nRUNTIME__DATABASE_URL=postgresql://wrong/wrong\n",
      ]) {
        const file = join(dir, "test.env");
        writeFileSync(file, text);
        expect(() =>
          execFileSync(process.execPath, [script, "config", file], { stdio: "pipe" }),
        ).toThrow();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

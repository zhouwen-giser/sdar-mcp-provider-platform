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

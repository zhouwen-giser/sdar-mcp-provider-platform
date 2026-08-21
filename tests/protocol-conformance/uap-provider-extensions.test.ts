import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

describe("UAP additive frozen northbound extensions", () => {
  it("accepts pause/resume request envelopes and requires routed task identity", () => {
    const validateTask = validator("mcp-tasks-sep2663.schema.json");
    const validateRouting = validator("mcp-streamable-http-routing.schema.json");
    for (const method of [
      "io.sdar/taskExecution/tasks/pause",
      "io.sdar/taskExecution/tasks/resume",
    ]) {
      expect(
        validateTask(request(method, { taskId: "task-1" })),
        JSON.stringify(validateTask.errors),
      ).toBe(true);
      expect(validateTask(request(method, {}))).toBe(false);
      expect(validateRouting(headers(method, "task-1"))).toBe(true);
      expect(validateRouting(headers(method))).toBe(false);
    }
  });

  it("validates an exact public provider catalog while retaining old-runtime compatibility", () => {
    const validate = validator("mcp-stateless-base.schema.json");
    const current = discovery();
    expect(validate(current), JSON.stringify(validate.errors)).toBe(true);

    const privateField = structuredClone(current);
    providerCatalog(privateField).endpoint = "http://adapter.internal";
    expect(validate(privateField)).toBe(false);

    const badHash = structuredClone(current);
    providerCatalog(badHash).manifestHash = "invalid";
    expect(validate(badHash)).toBe(false);

    const olderRuntime = structuredClone(current);
    delete olderRuntime.capabilities.extensions["io.sdar/providerCatalog"];
    expect(validate(olderRuntime), JSON.stringify(validate.errors)).toBe(true);
  });
});

function validator(filename: string) {
  const schema = JSON.parse(readFileSync(resolve(root, "protocol", filename), "utf8")) as object;
  return new Ajv2020({ strict: false, validateFormats: false }).compile(schema);
}

function request(method: string, params: Record<string, unknown>): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: "request-1",
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "sdar", version: "1.0.0" },
        "io.modelcontextprotocol/clientCapabilities": {
          extensions: { "io.modelcontextprotocol/tasks": {} },
        },
      },
    },
  };
}

function headers(method: string, name?: string): Record<string, string> {
  return {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": method,
    ...(name === undefined ? {} : { "mcp-name": name }),
  };
}

interface DiscoveryFixture extends Record<string, unknown> {
  capabilities: {
    tools: Record<string, never>;
    extensions: Record<string, Record<string, unknown> | undefined>;
  };
}

function providerCatalog(value: DiscoveryFixture): Record<string, unknown> {
  const catalog = value.capabilities.extensions["io.sdar/providerCatalog"];
  if (catalog === undefined) throw new Error("PROVIDER_CATALOG_FIXTURE_MISSING");
  return catalog;
}

function discovery(): DiscoveryFixture {
  return {
    resultType: "complete",
    supportedVersions: ["2026-07-28"],
    capabilities: {
      tools: {},
      extensions: {
        "io.modelcontextprotocol/tasks": {},
        "io.sdar/taskExecution": { profileVersion: "1.0", taskNotifications: true },
        "io.sdar/providerCatalog": {
          providerId: "isr.vehicle.ugv.ugv1",
          providerType: "isr.vehicle.ugv",
          providerVersion: "1.0.0",
          manifestHash: "a".repeat(64),
        },
      },
    },
    _meta: {
      "io.modelcontextprotocol/serverInfo": {
        name: "sdar-mcp-tasks-provider-runtime",
        version: "2.0.0-rc.1",
      },
    },
    ttlMs: 3_600_000,
    cacheScope: "public",
  };
}

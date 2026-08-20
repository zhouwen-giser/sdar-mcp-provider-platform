import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const deploy = resolve(root, "deploy/development/ugv-provider-template");
const validator = resolve(root, "scripts/ugv-provider-template/validate-development-config.mjs");
const liveRunner = resolve(root, "scripts/ugv-provider-template/live-point-validation.mjs");
const example = resolve(deploy, ".env.example");

interface ComposeService {
  environment: Record<string, string>;
  tmpfs?: string[];
}

interface ComposeDocument {
  services: Record<string, ComposeService>;
}

interface LiveEvidence {
  authorized: boolean;
  mutatingCallCount: number;
  result: string;
  target: { longitude: number; latitude: number; altitude: number };
  failure: { reasonCode: string };
}

describe("UGV Provider development template", () => {
  it("ships the required executable lifecycle and safety files", () => {
    for (const name of [
      "compose.yaml",
      ".env.example",
      "README.md",
      "up.sh",
      "down.sh",
      "smoke.sh",
      "contract-check.sh",
      "live-point-validation.sh",
    ]) {
      expect(statSync(resolve(deploy, name)).isFile(), name).toBe(true);
    }
    for (const name of [
      "up.sh",
      "down.sh",
      "smoke.sh",
      "contract-check.sh",
      "live-point-validation.sh",
    ]) {
      expect(statSync(resolve(deploy, name)).mode & 0o111, name).not.toBe(0);
    }
  });

  it("renders an isolated deterministic mock profile", () => {
    const document = compose("mock");
    expect(Object.keys(document.services).sort()).toEqual([
      "mock-mqtt",
      "mock-ugv-device-mcp",
      "mock-ugv-mqtt-publisher",
      "ugv-adapter",
      "ugv-adapter-postgres",
      "ugv-runtime",
      "ugv-runtime-postgres",
    ]);
    expect(service(document, "ugv-adapter").environment).toMatchObject({
      UGV_EXECUTION_MODE: "simulation",
      UGV_DEVICE_MCP_URL: "http://mock-ugv-device-mcp:19000/mcp",
      UGV_MQTT_URL: "mqtt://mock-mqtt:1883",
      UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT: "false",
      UGV_FIRE_ENABLED: "false",
    });
    for (const name of [
      "mock-ugv-device-mcp",
      "mock-ugv-mqtt-publisher",
      "ugv-adapter",
      "ugv-runtime",
    ]) {
      expect(service(document, name).tmpfs).toHaveLength(1);
      expect(service(document, name).tmpfs?.[0]).toMatch(/^\/tmp:/u);
    }
    validate("mock", document);
  });

  it("renders an external profile without any mock service or fallback", () => {
    const document = compose("external", {
      UGV_TEMPLATE_EXECUTION_MODE: "live",
      UGV_SIM_DEVICE_MCP_URL: "http://192.0.2.10:19000/mcp",
      UGV_SIM_MQTT_URL: "mqtt://192.0.2.10:1883",
    });
    expect(Object.keys(document.services).sort()).toEqual([
      "ugv-adapter",
      "ugv-adapter-postgres",
      "ugv-runtime",
      "ugv-runtime-postgres",
    ]);
    expect(service(document, "ugv-adapter").environment).toMatchObject({
      UGV_EXECUTION_MODE: "live",
      UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT: "false",
      UGV_FIRE_ENABLED: "false",
    });
    validate("external", document);

    const invalid = structuredClone(document);
    service(invalid, "ugv-adapter").environment.UGV_DEVICE_MCP_URL =
      "http://mock-ugv-device-mcp:19000/mcp";
    const result = validateResult("external", invalid);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("UGV_TEMPLATE_EXTERNAL_MOCK_ENDPOINT_FORBIDDEN");
  });

  it("runs the external read-only preflight before Adapter startup and never falls back", () => {
    const source = readFileSync(resolve(deploy, "up.sh"), "utf8");
    expect(source.indexOf('bash "$deploy_dir/contract-check.sh" external')).toBeGreaterThan(0);
    expect(source.indexOf('bash "$deploy_dir/contract-check.sh" external')).toBeLessThan(
      source.lastIndexOf("ugv-adapter ugv-runtime"),
    );
    expect(source).not.toContain("|| profile=mock");
    expect(source).not.toContain('profile="mock" # fallback');
  });

  it("blocks the LIVE runner before any mutation unless every explicit gate is present", () => {
    const directory = mkdtempSync(join(tmpdir(), "sdar-ugv-live-gate-"));
    const output = resolve(directory, "evidence.json");
    const result = spawnSync(process.execPath, [liveRunner, "--output", output], {
      cwd: root,
      encoding: "utf8",
      env: withoutLiveAuthorization(process.env),
    });
    expect(result.status).toBe(2);
    const evidence = JSON.parse(readFileSync(output, "utf8")) as LiveEvidence;
    expect(evidence).toMatchObject({
      authorized: false,
      mutatingCallCount: 0,
      result: "BLOCKED_BEFORE_DISPATCH",
      target: { longitude: 106.8134463, latitude: 29.72034353, altitude: 500 },
    });
    expect(evidence.failure.reasonCode).toBe("ALLOW_REAL_UGV_SIDE_EFFECTS_REQUIRED");
  });

  it("forbids reuse of the previous rejected LIVE identity before opening databases", () => {
    const directory = mkdtempSync(join(tmpdir(), "sdar-ugv-live-old-id-"));
    const output = resolve(directory, "evidence.json");
    const result = spawnSync(process.execPath, [liveRunner, "--output", output], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...withoutLiveAuthorization(process.env),
        ALLOW_REAL_UGV_SIDE_EFFECTS: "YES",
        LIVE_TEST_RUN_ID: "ugv-nav-20260818-10681344630",
        UGV_RUNTIME_MCP_URL: "http://127.0.0.1:19100/mcp",
        UGV_TEST_RESOURCE_ID: "vehicle:ugv1",
        UGV_LIVE_RUNTIME_DATABASE_URL: "postgresql://user:secret@127.0.0.1/runtime",
        UGV_LIVE_ADAPTER_DATABASE_URL: "postgresql://user:secret@127.0.0.1/adapter",
      },
    });
    expect(result.status).toBe(2);
    const evidence = JSON.parse(readFileSync(output, "utf8")) as LiveEvidence;
    expect(evidence.mutatingCallCount).toBe(0);
    expect(evidence.failure.reasonCode).toBe("UGV_LIVE_PREVIOUS_RUN_ID_FORBIDDEN");
  });

  it("keeps the fixed target and one explicit non-retrying dispatch boundary", () => {
    const source = readFileSync(liveRunner, "utf8");
    expect(source).toContain("longitude: 106.8134463");
    expect(source).toContain("latitude: 29.72034353");
    expect(source).toContain("altitude: 500");
    expect(source).toContain("This is the only mutating request in this process");
    expect(source).toContain("It is deliberately not wrapped in a retry");
    expect(source).toContain("UGV_LIVE_DISPATCH_UNCERTAIN_NO_REPLAY");
    expect(source).not.toContain("ugv-nav-20260818-10681344630:retry");
  });
});

function compose(profile: "mock" | "external", overrides: NodeJS.ProcessEnv = {}): ComposeDocument {
  return JSON.parse(
    execFileSync(
      "docker",
      [
        "compose",
        "--env-file",
        example,
        "-f",
        resolve(deploy, "compose.yaml"),
        "--profile",
        profile,
        "config",
        "--format",
        "json",
      ],
      { cwd: root, encoding: "utf8", env: { ...process.env, ...overrides } },
    ),
  ) as ComposeDocument;
}

function validate(profile: "mock" | "external", document: ComposeDocument): void {
  const result = validateResult(profile, document);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain(`UGV_TEMPLATE_COMPOSE_VALID: profile=${profile}`);
}

function validateResult(profile: "mock" | "external", document: ComposeDocument) {
  const directory = mkdtempSync(join(tmpdir(), "sdar-ugv-template-config-"));
  const path = resolve(directory, "compose.json");
  writeFileSync(path, JSON.stringify(document));
  return spawnSync(process.execPath, [validator, "--profile", profile, "--compose-json", path], {
    cwd: root,
    encoding: "utf8",
  });
}

function service(document: ComposeDocument, name: string): ComposeService {
  const value = document.services[name];
  if (value === undefined) throw new Error(`COMPOSE_SERVICE_MISSING:${name}`);
  return value;
}

function withoutLiveAuthorization(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...environment };
  for (const name of [
    "ALLOW_REAL_UGV_SIDE_EFFECTS",
    "LIVE_TEST_RUN_ID",
    "UGV_RUNTIME_MCP_URL",
    "UGV_TEST_RESOURCE_ID",
    "UGV_LIVE_RUNTIME_DATABASE_URL",
    "UGV_LIVE_ADAPTER_DATABASE_URL",
  ])
    Reflect.deleteProperty(result, name);
  return result;
}

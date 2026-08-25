import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "../..");
const deploy = resolve(root, "deploy/ugv-agent-profile-simulation");
const override = resolve(root, "compose.ugv-agent-profile-simulation.yaml");
const validator = resolve(
  root,
  "scripts/ugv-agent-profile-simulation/validate-compose-profile.mjs",
);
const reservation = resolve(root, "scripts/ugv-agent-profile-simulation/reserve-preflight-run.mjs");
const consumer = resolve(root, "scripts/ugv-agent-profile-simulation/consume-preflight-run.mjs");
const profile = "ugv-agent-profile-simulation";
const profileServices = [
  "ugv-agent-profile-adapter",
  "ugv-agent-profile-adapter-postgres",
  "ugv-agent-profile-runtime",
  "ugv-agent-profile-runtime-postgres",
];

interface ComposeService {
  profiles?: string[];
  environment?: Record<string, string>;
  depends_on?: Record<string, unknown>;
  networks?: Record<string, null> | string[];
  ports?: { host_ip?: string; published?: string; target?: number }[];
}

interface ComposeDocument {
  name: string;
  services: Record<string, ComposeService>;
  volumes: Record<string, { name: string }>;
}

describe("UGV Agent Profile external-simulation deployment", () => {
  it("ships an executable complete lifecycle and runbook", () => {
    for (const name of [
      "common.sh",
      "preflight.sh",
      "up.sh",
      "health.sh",
      "down.sh",
      "logs.sh",
      "clean.sh",
      "qualify-provider-readonly.sh",
      "README.md",
    ]) {
      expect(statSync(resolve(deploy, name)).isFile(), name).toBe(true);
    }
    for (const name of [
      "common.sh",
      "preflight.sh",
      "up.sh",
      "health.sh",
      "down.sh",
      "logs.sh",
      "clean.sh",
      "qualify-provider-readonly.sh",
    ]) {
      expect(statSync(resolve(deploy, name)).mode & 0o111, name).not.toBe(0);
      const result = spawnSync("bash", ["-n", resolve(deploy, name)], { encoding: "utf8" });
      expect(result.status, `${name}: ${result.stderr}`).toBe(0);
    }
  });

  it("keeps MTS declarations inside the typed lint project", () => {
    const eslintConfig = readFileSync(resolve(root, "eslint.config.js"), "utf8");
    const tsconfig = readFileSync(resolve(root, "tsconfig.json"), "utf8");
    expect(eslintConfig).toContain('"scripts/**/*.d.mts"');
    expect(tsconfig).toContain('"scripts/**/*.d.mts"');
  });

  it("renders four isolated Goal services with fixed external simulation boundaries", () => {
    const document = compose();
    expect(document.name).toBe("sdar-ugv-agent-profile-simulation");
    expect(
      Object.entries(document.services)
        .filter(([, service]) => service.profiles?.includes(profile))
        .map(([name]) => name)
        .sort(),
    ).toEqual(profileServices);

    const adapter = service(document, "ugv-agent-profile-adapter");
    expect(adapter.environment).toMatchObject({
      RUNTIME_ENV: "test",
      ALLOW_INSECURE_INTERNAL_TRANSPORT: "true",
      PROVIDER_ID: "isr.vehicle.ugv.ugv1",
      UGV_RESOURCE_ID: "vehicle:ugv1",
      UGV_EXECUTION_MODE: "simulation",
      UGV_FIRE_ENABLED: "false",
      UGV_ALLOW_NAVIGATION_WITH_RECON: "false",
      UGV_DEVICE_MCP_URL: "http://192.168.2.63:19000/mcp",
      UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT: "false",
      UGV_MQTT_URL: "mqtt://192.168.2.63:1883",
      UGV_MQTT_WIRE_MODE: "ros_bridge_json",
      UGV_ADAPTER_STORE_MODE: "postgres",
    });
    expect(service(document, "ugv-agent-profile-runtime").environment).toMatchObject({
      RUNTIME_ENV: "test",
      INTERNAL_ENDPOINTS_ENABLED: "false",
      ADAPTER_ENDPOINT: "ugv-agent-profile-adapter:7010",
      BUSINESS_EVENTS_REQUIRED_FOR_RUNTIME_READY: "true",
      PROVIDER_TELEMETRY_INGRESS_ENABLED: "true",
    });
    expect(adapter.ports).toContainEqual(
      expect.objectContaining({ host_ip: "127.0.0.1", published: "17021", target: 7010 }),
    );
    expect(service(document, "ugv-agent-profile-runtime").ports).toContainEqual(
      expect.objectContaining({ host_ip: "127.0.0.1", published: "19121", target: 8080 }),
    );
    expect(validate(document).status).toBe(0);
  });

  it("keeps root defaults and built-in UGV mocks outside the selected service closure", () => {
    const document = compose();
    const closure = dependencyClosure(document, profileServices);
    expect([...closure].sort()).toEqual(profileServices);
    for (const name of [
      "postgres",
      "adapter-typescript",
      "runtime",
      "mqtt-ugv-test",
      "mock-ugv-device-mcp",
      "mock-ugv-mqtt-publisher",
    ])
      expect(closure.has(name), name).toBe(false);

    const up = readFileSync(resolve(deploy, "up.sh"), "utf8");
    expect(up).toContain('bash "$deploy_dir/preflight.sh"');
    expect(up.indexOf('bash "$deploy_dir/preflight.sh"')).toBeLessThan(
      up.indexOf("uap_compose up"),
    );
    expect(up.indexOf("consume-preflight-run.mjs")).toBeLessThan(up.indexOf("uap_compose up"));
    for (const name of profileServices) expect(up).toContain(serviceVariable(name));
    expect(up).not.toMatch(/(?:mock-ugv|mqtt-ugv-test|\|\|\s*.*mock)/u);
  });

  it("fails closed for endpoint, wire, Fire, fallback, recon, or remote-admin drift", () => {
    const mutations: [string, (document: ComposeDocument) => void][] = [
      ["endpoint", (document) => setAdapter(document, "UGV_MQTT_URL", "mqtt://127.0.0.1:1883")],
      ["wire", (document) => setAdapter(document, "UGV_MQTT_WIRE_MODE", "auto")],
      ["fire", (document) => setAdapter(document, "UGV_FIRE_ENABLED", "true")],
      [
        "fallback",
        (document) => setAdapter(document, "UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT", "true"),
      ],
      ["recon", (document) => setAdapter(document, "UGV_ALLOW_NAVIGATION_WITH_RECON", "true")],
      [
        "admin",
        (document) => {
          environment(document, "ugv-agent-profile-runtime").INTERNAL_ENDPOINTS_ENABLED = "true";
        },
      ],
    ];
    for (const [label, mutate] of mutations) {
      const document = structuredClone(compose());
      mutate(document);
      expect(validate(document).status, label).toBe(2);
    }
  });

  it("uses one fixed project and scopes clean to Compose project volumes only", () => {
    const common = readFileSync(resolve(deploy, "common.sh"), "utf8");
    const clean = readFileSync(resolve(deploy, "clean.sh"), "utf8");
    expect(common).toContain('readonly UAP_PROJECT_NAME="sdar-ugv-agent-profile-simulation"');
    expect(common).not.toContain("UAP_PROJECT_NAME:-");
    expect(clean).toContain("uap_compose down --volumes --remove-orphans");
    expect(clean).not.toMatch(/docker\s+volume\s+(?:rm|prune)/u);
    expect(clean).not.toMatch(/--rmi|system\s+prune|volume\s+prune/u);
    expect(clean).not.toContain("*");

    const document = compose();
    for (const name of [
      "ugv-agent-profile-adapter-postgres-data",
      "ugv-agent-profile-runtime-postgres-data",
      "ugv-agent-profile-adapter-state",
    ])
      expect(document.volumes[name]?.name).toBe(`sdar-ugv-agent-profile-simulation_${name}`);
  });

  it("keeps preflight passive and exposes no remote shell or command administration", () => {
    const preflight = readFileSync(resolve(deploy, "preflight.sh"), "utf8");
    const composeSource = readFileSync(override, "utf8");
    expect(preflight).toContain('UGV_ENABLE_REAL_CONTROL="false"');
    expect(preflight).toContain('UGV_ENABLE_RECON_TESTS="false"');
    expect(preflight).toContain('UGV_ENABLE_EFFECTOR_TESTS="false"');
    expect(preflight).toContain('run_id="${UGV_SIMULATION_RUN_ID:-}"');
    expect(preflight).toContain("deployment-preflight-${run_id}.redacted.json");
    expect(preflight.indexOf("reserve-preflight-run.mjs")).toBeLessThan(
      preflight.indexOf("uap_validate_config"),
    );
    expect(preflight.indexOf("reserve-preflight-run.mjs")).toBeLessThan(
      preflight.indexOf("freeze-contracts.mjs"),
    );
    expect(preflight).not.toContain("deployment-preflight.redacted.json");
    expect(preflight).not.toContain(".callTool(");
    expect(preflight).not.toContain(".publish(");
    expect(composeSource).toContain('INTERNAL_ENDPOINTS_ENABLED: "false"');
    expect(composeSource).not.toMatch(/REMOTE_COMMAND_ENABLED|SHELL_(?:ACCESS|ADMIN)|EXEC_ADMIN/u);
  });

  it("consumes a run ID before later gates and rejects every reuse", () => {
    const attempts = mkdtempSync(join(tmpdir(), "uap-preflight-attempts-"));
    const args = [reservation, "--attempts-dir", attempts, "--run-id", "uap-test-reservation-01"];
    const first = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
    expect(first.status, first.stderr).toBe(0);
    const marker = JSON.parse(
      readFileSync(
        resolve(attempts, "deployment-preflight-uap-test-reservation-01.used.json"),
        "utf8",
      ),
    ) as {
      runId: string;
      status: string;
      evidenceClass: string;
      generatedAt: string;
      reservedAt: string;
      authorizationGranted: boolean;
      safety: Record<string, number>;
    };
    expect(marker).toMatchObject({
      runId: "uap-test-reservation-01",
      status: "RESERVED_IMMUTABLY",
      evidenceClass: "external_simulation",
      authorizationGranted: false,
      safety: {
        toolsCallCount: 0,
        mqttPublishCount: 0,
        controlInvocationCount: 0,
        forbiddenOperationCallCount: 0,
      },
    });
    expect(marker.generatedAt).toBe(marker.reservedAt);

    // Simulate any failure after reservation by doing no further work. Reuse still fails closed.
    const second = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
    expect(second.status).toBe(2);
    expect(readFileSync(reservation, "utf8")).toContain("UAP_SIMULATION_RUN_ID_ALREADY_USED");
  });

  it("consumes a successful preflight exactly once before deployment", () => {
    const attempts = mkdtempSync(join(tmpdir(), "uap-deployment-attempts-"));
    const runId = "uap-test-deployment-01";
    writeFileSync(
      resolve(attempts, `deployment-preflight-${runId}.redacted.json`),
      JSON.stringify({
        runId,
        status: "PASS",
        evidenceClass: "external_simulation",
        productionEligible: false,
        physicalVehicleQualified: false,
        authorizationGranted: false,
        safety: {
          mockFallbackEnabled: false,
          toolsCallCount: 0,
          directDeviceToolCallCount: 0,
          navigationDispatchCount: 0,
          mutatingToolCallCount: 0,
          forbiddenOperationCallCount: 0,
          mqttPublishCount: 0,
          controlInvocationCount: 0,
        },
      }),
    );
    const args = [consumer, "--attempts-dir", attempts, "--run-id", runId];
    expect(spawnSync(process.execPath, args, { cwd: root }).status).toBe(0);
    expect(spawnSync(process.execPath, args, { cwd: root }).status).toBe(2);

    const invalidId = "uap-test-deployment-invalid-01";
    writeFileSync(
      resolve(attempts, `deployment-preflight-${invalidId}.redacted.json`),
      JSON.stringify({ runId: invalidId, status: "PASS", safety: {} }),
    );
    const invalidArgs = [consumer, "--attempts-dir", attempts, "--run-id", invalidId];
    expect(spawnSync(process.execPath, invalidArgs, { cwd: root }).status).toBe(2);
    // Validation failure occurs after the immutable start reservation, so the same ID is burned.
    expect(spawnSync(process.execPath, invalidArgs, { cwd: root }).status).toBe(2);
    expect(
      readFileSync(resolve(attempts, `deployment-start-${invalidId}.used.json`), "utf8"),
    ).toContain('"status": "RESERVED_IMMUTABLY"');
  });
});

function compose(): ComposeDocument {
  const base = parse(readFileSync(resolve(root, "compose.yaml"), "utf8")) as ComposeDocument;
  const addition = parse(readFileSync(override, "utf8")) as ComposeDocument;
  const services = { ...base.services, ...addition.services };
  for (const [name, value] of Object.entries(services)) {
    if (!value.profiles?.includes(profile)) continue;
    const rawNetworks = value.networks as unknown;
    if (Array.isArray(rawNetworks)) {
      const networkNames = rawNetworks.map((network) => {
        if (typeof network !== "string") throw new Error("COMPOSE_NETWORK_NAME_INVALID");
        return network;
      });
      value.networks = Object.fromEntries(networkNames.map((network) => [network, null]));
    }
    if (name === "ugv-agent-profile-adapter")
      value.ports = [{ host_ip: "127.0.0.1", published: "17021", target: 7010 }];
    if (name === "ugv-agent-profile-runtime")
      value.ports = [{ host_ip: "127.0.0.1", published: "19121", target: 8080 }];
  }
  const rawVolumes = { ...base.volumes, ...addition.volumes };
  const volumes = Object.fromEntries(
    Object.keys(rawVolumes).map((name) => [
      name,
      { name: `sdar-ugv-agent-profile-simulation_${name}` },
    ]),
  );
  return {
    name: "sdar-ugv-agent-profile-simulation",
    services,
    volumes,
  };
}

function validate(document: ComposeDocument) {
  const directory = mkdtempSync(join(tmpdir(), "uap-compose-validation-"));
  const path = resolve(directory, "compose.json");
  writeFileSync(path, JSON.stringify(document));
  return spawnSync(process.execPath, [validator, "--compose-json", path], {
    cwd: root,
    encoding: "utf8",
  });
}

function service(document: ComposeDocument, name: string): ComposeService {
  const value = document.services[name];
  if (value === undefined) throw new Error(`COMPOSE_SERVICE_MISSING:${name}`);
  return value;
}

function setAdapter(document: ComposeDocument, key: string, value: string): void {
  environment(document, "ugv-agent-profile-adapter")[key] = value;
}

function environment(document: ComposeDocument, name: string): Record<string, string> {
  const value = service(document, name).environment;
  if (value === undefined) throw new Error(`COMPOSE_SERVICE_ENVIRONMENT_MISSING:${name}`);
  return value;
}

function dependencyClosure(document: ComposeDocument, roots: string[]): Set<string> {
  const result = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    const name = pending.pop();
    if (name === undefined) continue;
    if (result.has(name)) continue;
    result.add(name);
    pending.push(...Object.keys(service(document, name).depends_on ?? {}));
  }
  return result;
}

function serviceVariable(name: string): string {
  if (name === "ugv-agent-profile-adapter") return '"$UAP_ADAPTER_SERVICE"';
  if (name === "ugv-agent-profile-runtime") return '"$UAP_RUNTIME_SERVICE"';
  if (name === "ugv-agent-profile-adapter-postgres") return '"$UAP_ADAPTER_DB_SERVICE"';
  return '"$UAP_RUNTIME_DB_SERVICE"';
}

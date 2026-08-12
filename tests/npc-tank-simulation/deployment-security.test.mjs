import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  DeploymentValidationError,
  loadEnvironment,
  validateDeploymentEnvironment,
  validateSecretFile,
} from "../../deploy/npc-tank-simulation/validate-deployment.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const deploy = join(root, "deploy", "npc-tank-simulation");
const temporaryDirectories = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("Goal 11 NPC Tank deployment security", () => {
  it("parses .env as inert data and validates external credentials without leaking them", () => {
    const fixture = deploymentFixture();
    const marker = join(fixture.root, "must-not-exist");
    const envFile = join(fixture.root, "qualification.env");
    writeFileSync(
      envFile,
      `${environmentText(fixture)}\nNPC_TANK_SIM_MQTT_USERNAME=$(touch ${marker})\n`,
      { mode: 0o600 },
    );
    const environment = loadEnvironment(envFile, {});
    expect(environment.NPC_TANK_SIM_MQTT_USERNAME).toBe(`$(touch ${marker})`);
    expect(existsSync(marker)).toBe(false);
    expect(validateDeploymentEnvironment(environment, root)).toMatchObject({
      wireMode: "ros_bridge_json",
      controlEnabled: false,
      reconEnabled: false,
      effectorEnabled: false,
    });
  });

  it("rejects repository-contained, symlinked, and over-permissive secret files", () => {
    const fixture = deploymentFixture();
    const inside = join(root, "tests", "npc-tank-simulation", "not-a-live-secret");
    const link = join(fixture.root, "password-link");
    symlinkSync(fixture.adapterPassword, link);

    expectCode(() => validateSecretFile(inside, "TEST_SECRET", root), "TEST_SECRET_STAT_FAILED");
    expectCode(
      () => validateSecretFile(link, "TEST_SECRET", root),
      "TEST_SECRET_REGULAR_FILE_REQUIRED",
    );
    chmodSync(fixture.adapterPassword, 0o640);
    expectCode(
      () => validateSecretFile(fixture.adapterPassword, "TEST_SECRET", root),
      "TEST_SECRET_PERMISSIONS_MUST_NOT_EXCEED_0600",
    );
  });

  it("requires double opt-in and explicit operator fixtures for mutating phases", () => {
    const fixture = deploymentFixture();
    const environment = fixture.environment;
    expectCode(
      () => validateDeploymentEnvironment(environment, root, { runControl: true }),
      "NPC_TANK_REAL_CONTROL_EXPLICIT_ENABLE_REQUIRED",
    );
    expectCode(
      () => validateDeploymentEnvironment(environment, root, { runRecon: true }),
      "NPC_TANK_RECON_EXPLICIT_ENABLE_REQUIRED",
    );
    expectCode(
      () => validateDeploymentEnvironment(environment, root, { runEffector: true }),
      "NPC_TANK_EFFECTOR_EXPLICIT_ENABLE_REQUIRED",
    );

    const enabled = {
      ...environment,
      NPC_TANK_ENABLE_REAL_CONTROL: "true",
      NPC_TANK_TEST_DISTANCE_M: "1",
      NPC_TANK_TEST_SAFE_POINT_JSON: '{"longitude":120,"latitude":30}',
      NPC_TANK_TEST_SAFE_WAYPOINTS_JSON:
        '[{"longitude":120,"latitude":30},{"longitude":120.00001,"latitude":30.00001}]',
      NPC_TANK_ENABLE_RECON_TESTS: "true",
      NPC_TANK_TEST_RECON_REGION_JSON: '{"region_points":[[120,30,0],[120.00001,30.00001,0]]}',
    };
    expect(
      validateDeploymentEnvironment(enabled, root, { runControl: true, runRecon: true }),
    ).toMatchObject({ controlEnabled: true, reconEnabled: true });
  });

  it("layers only NPC additions over the authoritative PMS Compose and has no mock service", () => {
    const fixture = deploymentFixture();
    const envFile = join(fixture.root, "compose.env");
    writeFileSync(envFile, environmentText(fixture), { mode: 0o600 });
    const document = JSON.parse(
      execFileSync(
        "docker",
        [
          "compose",
          "--project-name",
          "sdar-npc-tank-simulation-real",
          "--env-file",
          envFile,
          "-f",
          join(root, "deploy", "pms-console", "compose.yaml"),
          "-f",
          join(deploy, "compose.yaml"),
          "--profile",
          "preflight",
          "config",
          "--format",
          "json",
        ],
        { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
    expect(document.name).toBe("sdar-npc-tank-simulation-real");
    expect(Object.keys(document.services).sort()).toEqual(
      [
        "pms-postgres",
        "pms-api",
        "pms-worker",
        "pms-web",
        "npc-runtime-postgres",
        "npc-adapter-postgres",
        "npc-preflight",
        "npc-tank-adapter",
        "npc-tank-runtime",
      ].sort(),
    );
    for (const [name, service] of Object.entries(document.services)) {
      expect(`${name} ${service.image ?? ""} ${service.build?.target ?? ""}`).not.toMatch(
        /mock-npc|mqtt-npc-test|simulator-mock/i,
      );
    }
    expect(document.services["npc-preflight"].read_only).toBe(true);
    expect(document.services["npc-tank-adapter"].environment).toMatchObject({
      NPC_TANK_DEVICE_MCP_ALLOW_MOCK_CONTRACT: "false",
      NPC_TANK_MQTT_WIRE_MODE: "ros_bridge_json",
    });
    expect(document.services["npc-tank-runtime"].ports[0].host_ip).toBe("127.0.0.1");

    const overlay = readFileSync(join(deploy, "compose.yaml"), "utf8");
    expect(overlay).not.toMatch(/^\s{2}pms-(?:postgres|web):/m);
    expect(overlay.match(/^\s{2}pms-api:/gm)).toHaveLength(1);
    expect(overlay.match(/^\s{2}pms-worker:/gm)).toHaveLength(1);
    for (const service of ["pms-api", "pms-worker"])
      expect(document.services[service].volumes).toContainEqual(
        expect.objectContaining({ target: "/run/npc-pms-credentials", read_only: true }),
      );
    expect(document.services["pms-worker"].environment).toMatchObject({
      PMS_RUNTIME_CONTROL_PLANE_CREDENTIAL_ROOT: "/run/npc-pms-credentials/runtime-control-plane",
    });
    expect(overlay).toContain("target: npc-real-adapter");
    expect(overlay).toContain("target: npc-real-runtime");
    expect(overlay).not.toContain("POSTGRES_PASSWORD:");
  });

  it("uses exact-head, non-root NPC image targets with a one-application allowlist", () => {
    const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
    const targets = dockerfile.slice(
      dockerfile.indexOf("FROM production-dependencies AS npc-real-production-dependencies"),
      dockerfile.indexOf("FROM node:22-bookworm-slim AS runtime"),
    );
    expect(targets).toContain("FROM npc-real-base AS npc-real-runtime");
    expect(targets).toContain("FROM npc-real-base AS npc-real-adapter");
    expect(targets).toContain("USER node");
    expect(targets).toContain('org.opencontainers.image.revision="${VCS_REF}"');
    expect(targets).toContain(
      "COPY --from=build --chown=root:root /workspace/dist/apps/runtime /app/dist/apps/runtime",
    );
    expect(targets).toContain(
      "COPY --from=build --chown=root:root /workspace/dist/apps/npc-tank-provider-adapter /app/dist/apps/npc-tank-provider-adapter",
    );
    expect(targets).not.toContain("/workspace/dist /app/dist");
    expect(targets).not.toMatch(/dist\/apps\/mock-/);
    expect(targets).not.toContain("dist/apps/ugv-provider-adapter");

    const up = readFileSync(join(deploy, "up.sh"), "utf8");
    expect(up).toContain('git -C "$repo_root" archive --format=tar');
    expect(up).toContain("org.opencontainers.image.revision");
    expect(up).toContain("test ! -d /app/node_modules/.pnpm/node_modules/@sdar");
  });

  it("uses the fixed project/two-file lifecycle and preserves all volumes", () => {
    for (const name of ["up.sh", "smoke.sh", "qualify.sh", "down.sh"]) {
      const body = readFileSync(join(deploy, name), "utf8");
      expect(body).toContain('project_name="sdar-npc-tank-simulation-real"');
      expect(body).toContain('-f "$pms_compose_file"');
      expect(body).toContain('-f "$npc_compose_file"');
      expect(body).not.toMatch(/(?:source|\.)\s+[^\n]*(?:\.env|env_file)/);
      expect(body).not.toMatch(/(?:cat|printf|echo)[^\n]*(?:password|authorization|token)/i);
    }
    const down = readFileSync(join(deploy, "down.sh"), "utf8");
    expect(down).not.toContain("--volumes");
    expect(down).not.toContain("volume rm");
    const qualify = readFileSync(join(deploy, "qualify.sh"), "utf8");
    expect(qualify).toContain("--control");
    expect(qualify).toContain("NOT_EXECUTED");
    expect(qualify).toContain("BLOCKED_IMPLEMENTATION");
    const smoke = readFileSync(join(deploy, "smoke.sh"), "utf8");
    expect(smoke).toContain('runtime_probe_service="pms-worker"');
    expect(smoke).toContain("NPC_TANK_REQUIRE_PMS_REGISTRY=$registry_required");
    expect(smoke).toContain('"$runtime_probe_service" node');
  });

  it("documents the observed wire defect and forbids direct PMS persistence", () => {
    const example = readFileSync(join(deploy, ".env.example"), "utf8");
    const readme = readFileSync(join(deploy, "README.md"), "utf8");
    const scripts = ["up.sh", "smoke.sh", "qualify.sh", "down.sh"]
      .map((name) => readFileSync(join(deploy, name), "utf8"))
      .join("\n");
    expect(example).toContain("NPC_TANK_MQTT_WIRE_MODE=ros_bridge_json");
    expect(example).toContain("NPC_TANK_ENABLE_REAL_CONTROL=false");
    expect(example).toContain("NPC_TANK_ENABLE_RECON_TESTS=false");
    expect(example).toContain("NPC_TANK_ENABLE_EFFECTOR_TESTS=false");
    expect(readme).toContain("SIMULATOR_INTERFACE_DEFECT_MIXED_MQTT_WIRE_SHAPES");
    expect(readme).toContain("PMS API/application flows");
    expect(scripts).not.toMatch(/\bpsql\b|INSERT\s+INTO|UPDATE\s+.+\s+SET|DELETE\s+FROM/i);
  });
});

function deploymentFixture() {
  const rootPath = mkdtempSync(join(tmpdir(), "npc-deployment-security-"));
  temporaryDirectories.push(rootPath);
  const credentialRoot = join(rootPath, "pms-credentials");
  mkdirSync(credentialRoot, { mode: 0o700 });
  const token = join(credentialRoot, "management-administrator.token");
  writeFileSync(token, "test-only-management-token\n", { mode: 0o600 });
  writeFileSync(
    join(credentialRoot, "management.json"),
    `${JSON.stringify({
      management: {
        reader: [],
        administrator: [
          {
            subjectId: "npc-qualification-admin",
            tokenFile: "/run/npc-pms-credentials/management-administrator.token",
          },
        ],
      },
    })}\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    join(credentialRoot, "runtime.json"),
    `${JSON.stringify({ runtimeConfig: [], runtimeRegistration: [] })}\n`,
    { mode: 0o600 },
  );
  const adapterPassword = join(rootPath, "adapter-password");
  const adapterUrl = join(rootPath, "adapter-url");
  const runtimePassword = join(rootPath, "runtime-password");
  const runtimeUrl = join(rootPath, "runtime-url");
  writeFileSync(adapterPassword, "adapter-test-password-123\n", { mode: 0o600 });
  writeFileSync(
    adapterUrl,
    "postgresql://npc_adapter:adapter-test-password-123@npc-adapter-postgres:5432/npc_adapter\n",
    { mode: 0o600 },
  );
  writeFileSync(runtimePassword, "runtime-test-password-123\n", { mode: 0o600 });
  writeFileSync(
    runtimeUrl,
    "postgresql://npc_runtime:runtime-test-password-123@npc-runtime-postgres:5432/npc_runtime\n",
    { mode: 0o600 },
  );
  const environment = {
    PMS_CONSOLE_SECRET_ROOT: join(rootPath, "pms-console-secrets"),
    NPC_TANK_PMS_CREDENTIAL_ROOT: credentialRoot,
    NPC_TANK_SIM_DEVICE_MCP_URL: "http://host.docker.internal:19003/mcp",
    NPC_TANK_SIM_MQTT_URL: "mqtt://host.docker.internal:1883",
    NPC_TANK_MQTT_WIRE_MODE: "ros_bridge_json",
    NPC_TANK_DEVICE_MCP_ALLOW_MOCK_CONTRACT: "false",
    NPC_TANK_ADAPTER_DB_PASSWORD_FILE: adapterPassword,
    NPC_TANK_ADAPTER_DATABASE_URL_FILE: adapterUrl,
    NPC_TANK_RUNTIME_DB_PASSWORD_FILE: runtimePassword,
    NPC_TANK_RUNTIME_DATABASE_URL_FILE: runtimeUrl,
    NPC_TANK_ENABLE_REAL_CONTROL: "false",
    NPC_TANK_ENABLE_RECON_TESTS: "false",
    NPC_TANK_ENABLE_EFFECTOR_TESTS: "false",
    NPC_TANK_REQUIRE_PMS_REGISTRY: "false",
    NPC_TANK_QUALIFICATION_GIT_SHA: "a".repeat(40),
    PMS_CONSOLE_GIT_SHA: "a".repeat(40),
  };
  return {
    root: rootPath,
    credentialRoot,
    adapterPassword,
    environment,
  };
}

function environmentText(fixture) {
  return `${Object.entries(fixture.environment)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

function expectCode(callback, code) {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(DeploymentValidationError);
    expect(error.code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

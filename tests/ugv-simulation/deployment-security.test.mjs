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
  loadEnvironment,
  qualificationSourceState,
  validateDeploymentSecretFiles,
  validateExactMqttSubscriptionGrants,
  validateNodeVersion,
} from "../../scripts/ugv-simulation/lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryDirectories = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("Goal 10 deployment security", () => {
  it("requires an exact, unique MQTT SUBACK topic/QoS set", () => {
    const expected = [
      { topic: "/ugv/status", qos: 1 },
      { topic: "/ugv/area_recon/coverage", qos: 0 },
    ];
    expect(
      validateExactMqttSubscriptionGrants(
        expected.map((subscription) => ({ ...subscription })),
        expected,
      ),
    ).toEqual(expected);
    expectQualificationCode(
      () =>
        validateExactMqttSubscriptionGrants(
          [
            { topic: "/ugv/status", qos: 1 },
            { topic: "/ugv/status", qos: 1 },
          ],
          expected,
        ),
      "MQTT_SUBSCRIPTION_GRANT_SET_MISMATCH",
    );
    expectQualificationCode(
      () =>
        validateExactMqttSubscriptionGrants(
          [{ topic: "/ugv/status", qos: 0 }, expected[1]],
          expected,
        ),
      "MQTT_SUBSCRIPTION_QOS_REJECTED",
    );
  });

  it("fails closed below Node.js 22", () => {
    expect(validateNodeVersion("22.0.0")).toBe(22);
    expect(validateNodeVersion("24.1.0")).toBe(24);
    expectQualificationCode(() => validateNodeVersion("21.99.0"), "NODE_22_OR_NEWER_REQUIRED");
    expectQualificationCode(() => validateNodeVersion("invalid"), "NODE_22_OR_NEWER_REQUIRED");
    for (const script of ["up.sh", "smoke.sh"]) {
      const body = readFileSync(join(root, "deploy", "ugv-simulation", script), "utf8");
      expect(body).toContain('node "$repo_root/scripts/ugv-simulation/validate-node-version.mjs"');
    }
  });

  it("accepts only regular, repository-external secret files with strict permissions", () => {
    const sandbox = temporaryDirectory();
    const repository = join(sandbox, "repository");
    const external = join(sandbox, "external");
    mkdirSync(repository);
    mkdirSync(external);
    const secret = join(external, "mqtt-password");
    writeFileSync(secret, "test-only-secret\n", { mode: 0o600 });

    expect(
      validateDeploymentSecretFiles({ UGV_SIM_MQTT_PASSWORD_FILE: secret }, repository),
    ).toMatchObject({ UGV_SIM_MQTT_PASSWORD_FILE: true });

    chmodSync(secret, 0o640);
    expectQualificationCode(
      () => validateDeploymentSecretFiles({ UGV_SIM_MQTT_PASSWORD_FILE: secret }, repository),
      "UGV_SIM_MQTT_PASSWORD_FILE_PERMISSIONS_MUST_NOT_EXCEED_0600",
    );
  });

  it("rejects relative, repository-contained, directory, and symlink secret paths", () => {
    const sandbox = temporaryDirectory();
    const repository = join(sandbox, "repository");
    const external = join(sandbox, "external");
    mkdirSync(repository);
    mkdirSync(external);
    const inside = join(repository, "secret");
    const outside = join(external, "secret");
    const link = join(external, "secret-link");
    writeFileSync(inside, "inside\n", { mode: 0o600 });
    writeFileSync(outside, "outside\n", { mode: 0o600 });
    symlinkSync(outside, link);

    expectQualificationCode(
      () =>
        validateDeploymentSecretFiles(
          { UGV_SIM_DEVICE_MCP_HEADERS_FILE: "relative-secret" },
          repository,
        ),
      "UGV_SIM_DEVICE_MCP_HEADERS_FILE_ABSOLUTE_PATH_REQUIRED",
    );
    expectQualificationCode(
      () => validateDeploymentSecretFiles({ UGV_SIM_DEVICE_MCP_HEADERS_FILE: inside }, repository),
      "UGV_SIM_DEVICE_MCP_HEADERS_FILE_OUTSIDE_REPOSITORY_REQUIRED",
    );
    expectQualificationCode(
      () =>
        validateDeploymentSecretFiles({ UGV_SIM_DEVICE_MCP_HEADERS_FILE: external }, repository),
      "UGV_SIM_DEVICE_MCP_HEADERS_FILE_REGULAR_FILE_REQUIRED",
    );
    expectQualificationCode(
      () => validateDeploymentSecretFiles({ UGV_SIM_DEVICE_MCP_HEADERS_FILE: link }, repository),
      "UGV_SIM_DEVICE_MCP_HEADERS_FILE_REGULAR_FILE_REQUIRED",
    );
  });

  it("parses env files as inert data and never evaluates shell syntax", () => {
    const sandbox = temporaryDirectory();
    const marker = join(sandbox, "must-not-exist");
    const envFile = join(sandbox, "qualification.env");
    writeFileSync(envFile, `UGV_SIM_MQTT_PASSWORD_FILE=$(touch ${marker})\n`, { mode: 0o600 });
    const previous = process.env.UGV_SIM_MQTT_PASSWORD_FILE;
    delete process.env.UGV_SIM_MQTT_PASSWORD_FILE;
    try {
      const environment = loadEnvironment(envFile);
      expect(environment.UGV_SIM_MQTT_PASSWORD_FILE).toBe(`$(touch ${marker})`);
      expect(existsSync(marker)).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.UGV_SIM_MQTT_PASSWORD_FILE;
      else process.env.UGV_SIM_MQTT_PASSWORD_FILE = previous;
    }
  });

  it("binds qualification to HEAD while allowing only report artifacts to be dirty", () => {
    const repository = initializedRepository();
    const evidenceDirectory = join(repository, "reports", "ugv-simulation", "delivery");
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(join(evidenceDirectory, "artifact.json"), "{}\n");

    const state = qualificationSourceState(repository);
    expect(state.gitSha).toMatch(/^[0-9a-f]{40,64}$/);
    expect(state.trackedSourceClean).toBe(true);
    expect(state.allowedEvidenceChanges).toBe(1);

    writeFileSync(join(repository, "untracked-source.mjs"), "export {};\n");
    expectQualificationCode(
      () => qualificationSourceState(repository),
      "QUALIFICATION_SOURCE_TREE_DIRTY",
    );
  });

  it("rejects both unstaged and staged tracked source changes", () => {
    const unstagedRepository = initializedRepository();
    writeFileSync(join(unstagedRepository, "source.txt"), "unstaged\n");
    expectQualificationCode(
      () => qualificationSourceState(unstagedRepository),
      "QUALIFICATION_SOURCE_TREE_DIRTY",
    );

    const stagedRepository = initializedRepository();
    writeFileSync(join(stagedRepository, "source.txt"), "staged\n");
    git(stagedRepository, "add", "source.txt");
    expectQualificationCode(
      () => qualificationSourceState(stagedRepository),
      "QUALIFICATION_SOURCE_TREE_DIRTY",
    );
  });

  it("materializes the qualified Docker build context from HEAD without ignored sentinels", () => {
    const repository = initializedRepository();
    writeFileSync(join(repository, ".gitignore"), "ignored-sentinel.secret\n");
    git(repository, "add", ".gitignore");
    commit(repository, "ignore local sentinel");
    writeFileSync(join(repository, "ignored-sentinel.secret"), "must-not-enter-build-context\n");

    expect(qualificationSourceState(repository).trackedSourceClean).toBe(true);
    const archive = execFileSync(
      "git",
      ["-C", repository, "archive", "--format=tar", qualificationSourceState(repository).gitSha],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const entries = execFileSync("tar", ["-tf", "-"], {
      encoding: "utf8",
      input: archive,
      stdio: ["pipe", "pipe", "pipe"],
    })
      .split(/\r?\n/)
      .filter(Boolean);
    expect(entries).toContain("source.txt");
    expect(entries).not.toContain("ignored-sentinel.secret");

    const up = readFileSync(join(root, "deploy", "ugv-simulation", "up.sh"), "utf8");
    expect(up).toContain('git -C "$repo_root" archive --format=tar "$UGV_QUALIFICATION_GIT_SHA"');
    expect(up).toContain('export UGV_QUALIFICATION_BUILD_CONTEXT="$qualification_build_context"');
  });

  it("uses dedicated real UGV image targets with an exact application allowlist", () => {
    const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
    const compose = readFileSync(join(root, "deploy", "ugv-simulation", "compose.yaml"), "utf8");
    const up = readFileSync(join(root, "deploy", "ugv-simulation", "up.sh"), "utf8");
    const smoke = readFileSync(join(root, "deploy", "ugv-simulation", "smoke.sh"), "utf8");
    const realTargets = dockerfile.slice(
      dockerfile.indexOf("FROM production-dependencies AS ugv-real-production-dependencies"),
      dockerfile.indexOf("FROM production-dependencies AS npc-real-production-dependencies"),
    );

    expect(realTargets).toContain("rm -rf node_modules/.pnpm/node_modules/@sdar");
    expect(realTargets).toContain(
      "COPY --from=ugv-real-production-dependencies --chown=root:root /workspace/node_modules /app/node_modules",
    );
    expect(realTargets).toContain(
      "COPY --from=build --chown=root:root /workspace/dist/packages /app/dist/packages",
    );
    expect(realTargets).toContain(
      "COPY --from=build --chown=root:root /workspace/dist/apps/runtime /app/dist/apps/runtime",
    );
    expect(realTargets).toContain(
      "COPY --from=build --chown=root:root /workspace/dist/apps/ugv-provider-adapter /app/dist/apps/ugv-provider-adapter",
    );
    expect(realTargets).toContain(
      "COPY --from=build --chown=root:root /workspace/scripts/ugv-simulation /app/scripts/ugv-simulation",
    );
    expect(realTargets).not.toContain("/workspace/dist /app/dist");
    expect(realTargets).not.toMatch(/dist\/apps\/mock-/);
    expect(compose.match(/target: ugv-real-adapter/g)).toHaveLength(2);
    expect(compose.match(/target: ugv-real-runtime/g)).toHaveLength(1);
    expect(
      compose.match(/context: \$\{UGV_QUALIFICATION_BUILD_CONTEXT:-\.\.\/\.\.\}/g),
    ).toHaveLength(3);
    expect(compose.match(/image: sdar-ugv-simulation-real\/ugv-adapter:\$\{/g)).toHaveLength(2);
    expect(compose.match(/image: sdar-ugv-simulation-real\/runtime:\$\{/g)).toHaveLength(1);
    for (const script of [up, smoke]) {
      expect(script).toContain("--no-build");
      expect(script).toContain("--pull never");
      expect(script).toContain("org.opencontainers.image.revision");
      expect(script).not.toContain('"${compose[@]}" run --rm --no-deps ugv-preflight');
    }
    expect(up).toContain("test ! -d /app/node_modules/.pnpm/node_modules/@sdar");
    expect(up).toContain("test -f /app/scripts/ugv-simulation/preflight.mjs");
    expect(compose).not.toContain("../../scripts/ugv-simulation:/app/scripts/ugv-simulation");
  });

  it("excludes evidence, task inputs, env files, and secrets from the Docker context", () => {
    const ignore = readFileSync(join(root, ".dockerignore"), "utf8").split(/\r?\n/);
    expect(ignore).toEqual(
      expect.arrayContaining([
        "reports",
        ".codex",
        ".env",
        "**/.env",
        ".env.*",
        "**/.env.*",
        "*.log",
        "**/*.log",
        "*.tsbuildinfo",
        "**/*.tsbuildinfo",
        "deploy/ugv-simulation/secrets",
      ]),
    );
    for (const script of ["up.sh", "smoke.sh"]) {
      const body = readFileSync(join(root, "deploy", "ugv-simulation", script), "utf8");
      expect(body).toContain("validate-deployment.mjs");
      expect(body).not.toMatch(/(?:^|\s)(?:source|\.)\s+["']?\$?env_file/m);
    }
  });
});

function temporaryDirectory() {
  const path = mkdtempSync(join(tmpdir(), "sdar-ugv-deployment-security-"));
  temporaryDirectories.push(path);
  return path;
}

function initializedRepository() {
  const repository = temporaryDirectory();
  git(repository, "init", "--quiet");
  writeFileSync(join(repository, "source.txt"), "committed\n");
  git(repository, "add", "source.txt");
  commit(repository, "fixture");
  return repository;
}

function commit(repository, message) {
  git(
    repository,
    "-c",
    "user.name=SDAR Test",
    "-c",
    "user.email=sdar-test@example.invalid",
    "commit",
    "--quiet",
    "-m",
    message,
  );
}

function git(repository, ...argumentsValue) {
  execFileSync("git", ["-C", repository, ...argumentsValue], { stdio: "pipe" });
}

function expectQualificationCode(action, code) {
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({ name: "QualificationError", code });
    return;
  }
  throw new Error(`Expected QualificationError ${code}`);
}

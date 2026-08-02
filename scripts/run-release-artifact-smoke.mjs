import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";

const project = process.env.RELEASE_ARTIFACT_PROJECT ?? "sdar-release-artifacts-ci";
const fixtureRoot = resolve(tmpdir(), project);
const revision = command("git", ["rev-parse", "HEAD"]).trim();
const images = Object.freeze({
  runtime: "sdar/runtime:0.1.0-rc",
  api: "sdar/pms-api:0.1.0-rc",
  worker: "sdar/pms-worker:0.1.0-rc",
  web: "sdar/pms-web:0.1.0-rc",
});
const environment = {
  ...process.env,
  RELEASE_ARTIFACT_PROJECT: project,
  RELEASE_ARTIFACT_FIXTURE_ROOT: fixtureRoot,
};

cleanup();
try {
  for (const [target, image] of Object.entries(images)) {
    command("docker", [
      "build",
      "--provenance=false",
      "--target",
      target === "runtime" ? "runtime" : `pms-${target}`,
      "--build-arg",
      `VCS_REF=${revision}`,
      "--tag",
      image,
      ".",
    ]);
  }
  await createFixtures();
  assignFixtureOwnershipToRuntimeUser();
  try {
    command(
      "docker",
      [
        "compose",
        "-p",
        project,
        "-f",
        "deploy/release-compose.yml",
        "up",
        "--detach",
        "--wait",
        "--wait-timeout",
        "120",
      ],
      { env: environment },
    );
  } catch {
    const diagnostics = redact(
      compose("logs", "--no-color", "--tail", "20", "pms-api", "pms-worker", "pms-web"),
    );
    throw new Error(`RELEASE_ARTIFACT_COMPOSE_START_FAILED\n${diagnostics}`);
  }
  composeExec("pms-web", [
    "node",
    "-e",
    String.raw`fetch("http://127.0.0.1:8080/").then(async r=>{const html=await r.text();if(!r.ok||!html.includes("http://pms-api:8090")||r.headers.get("x-content-type-options")!=="nosniff")throw Error("web");const assets=[...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(m=>m[1]);if(!assets.some(p=>p.endsWith(".js"))||!assets.some(p=>p.endsWith(".css")))throw Error("assets");await Promise.all([...assets,"/providers/one","/health/live","/health/ready"].map(async p=>{const a=await fetch("http://127.0.0.1:8080"+p);if(!a.ok)throw Error(p)}));return fetch("http://pms-api:8090/health/ready")}).then(r=>{if(!r.ok)process.exit(1)})`,
  ]);
  const workerId = compose("ps", "-q", "pms-worker").trim();
  assert(workerId.length > 0, "RELEASE_ARTIFACT_WORKER_CONTAINER_MISSING");
  assert(
    JSON.parse(command("docker", ["inspect", "--format", "{{json .State.Running}}", workerId])),
    "RELEASE_ARTIFACT_WORKER_EXITED",
  );
  if (process.env.RELEASE_ARTIFACT_INJECT_FAILURE === "after-compose") {
    throw new Error("RELEASE_ARTIFACT_INJECTED_FAILURE");
  }

  const artifacts = {};
  for (const [name, image] of Object.entries(images)) {
    const inspection = JSON.parse(command("docker", ["image", "inspect", image]))[0];
    validateImage(name, image, inspection);
    artifacts[name] = {
      image,
      imageId: inspection.Id,
      digest: inspection.RepoDigests?.[0] ?? inspection.Id,
      sizeBytes: inspection.Size,
      uid: inspection.Config.User,
      labels: redactLabels(inspection.Config.Labels ?? {}),
    };
  }
  const report = {
    schemaVersion: "1.0",
    status: "pass",
    revision,
    artifacts,
    compose: {
      apiReady: true,
      workerRunning: true,
      webReadyAndApiReachable: true,
    },
    policy: {
      dependencySourceMapsAbsent: true,
      licensePolicyPassed: true,
      filesystemWhitelistPassed: true,
      testSecretsAbsent: true,
    },
    secretsIncluded: false,
  };
  await mkdir("reports/ci", { recursive: true });
  await writeFile("reports/ci/release-artifacts.json", `${JSON.stringify(report, null, 2)}\n`);
  assert(
    !/release-ci-only|management-ci-token|runtime-ci-token|postgresql:\/\//i.test(
      await readFile("reports/ci/release-artifacts.json", "utf8"),
    ),
    "RELEASE_ARTIFACT_REPORT_SECRET",
  );
  process.stdout.write("RELEASE_ARTIFACT_SMOKE_OK\n");
} finally {
  cleanup();
}

async function createFixtures() {
  const api = resolve(fixtureRoot, "api");
  const worker = resolve(fixtureRoot, "worker");
  const workerState = resolve(fixtureRoot, "worker-state");
  const release = resolve(fixtureRoot, "runtime-releases", "2.0.0-rc.1");
  await Promise.all([
    mkdir(api, { recursive: true, mode: 0o700 }),
    mkdir(resolve(worker, "credentials"), { recursive: true, mode: 0o700 }),
    mkdir(release, { recursive: true, mode: 0o700 }),
    ...["secrets", "cache", "pm2"].map((directory) =>
      mkdir(resolve(workerState, directory), { recursive: true, mode: 0o700 }),
    ),
  ]);
  await Promise.all([
    secret(resolve(api, "database-url"), "postgresql://sdar:release-ci-only@postgres:5432/sdar"),
    secret(resolve(api, "management.token"), "management-ci-token"),
    secret(resolve(api, "runtime.token"), "runtime-ci-token"),
    secret(resolve(worker, "database-url"), "postgresql://sdar:release-ci-only@postgres:5432/sdar"),
    secret(
      resolve(worker, "provisioning.json"),
      JSON.stringify({
        clusterRef: "release-ci-postgres",
        adminSecretRef: "file/release/ci",
        adminDatabaseUrl: "postgresql://sdar:release-ci-only@postgres:5432/sdar",
        runtimePassword: "release-ci-runtime-password",
      }),
    ),
  ]);
  await secret(
    resolve(api, "management.json"),
    JSON.stringify({
      management: {
        administrator: [
          {
            subjectId: "release-ci-admin",
            tokenFile: "/run/release/api/management.token",
          },
        ],
      },
    }),
  );
  const identity = {
    providerId: "release-ci-provider",
    deploymentId: "release-ci-deployment",
    instanceId: "release-ci-instance",
    runtimeVersion: "2.0.0-rc.1",
    protocolVersion: "2026-07-28",
    tokenFile: "/run/release/api/runtime.token",
  };
  await secret(
    resolve(api, "runtime.json"),
    JSON.stringify({
      runtimeConfig: [
        {
          ...identity,
          subjectId: "release-ci-config",
          environment: "test",
          scopes: ["runtime:config:read", "runtime:config:watch", "runtime:config:ack"],
        },
      ],
      runtimeRegistration: [
        {
          ...identity,
          subjectId: "release-ci-registration",
          scopes: ["runtime:register", "runtime:heartbeat"],
        },
      ],
    }),
  );
  const extraction = `${project}-runtime-extract`;
  command("docker", ["create", "--name", extraction, images.runtime]);
  for (const directory of ["dist", "proto", "migrations"]) {
    command("docker", ["cp", `${extraction}:/app/${directory}/.`, resolve(release, directory)]);
  }
  command("docker", ["rm", extraction]);
  await writeFile(
    resolve(fixtureRoot, "runtime-releases", "runtime-releases.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      releases: [{ version: "2.0.0-rc.1", directory: "2.0.0-rc.1" }],
    })}\n`,
    { mode: 0o600 },
  );
}

function validateImage(name, image, inspection) {
  assert(inspection.Config.User === "node", `${name.toUpperCase()}_ROOT_USER`);
  const allowed = {
    runtime: ["dist", "migrations", "node_modules", "proto"],
    api: ["dist", "migrations", "node_modules", "packages", "provider-packages"],
    worker: ["dist", "migrations", "node_modules", "packages", "proto", "provider-packages"],
    web: ["web"],
  }[name];
  const actual = lines(
    command("docker", [
      "run",
      "--rm",
      "--entrypoint",
      "sh",
      image,
      "-lc",
      "find /app -mindepth 1 -maxdepth 1 -printf '%f\\n' | sort",
    ]),
  );
  assert(JSON.stringify(actual) === JSON.stringify(allowed), `${name.toUpperCase()}_FILESYSTEM`);
  command("docker", [
    "run",
    "--rm",
    "--entrypoint",
    "sh",
    image,
    "-lc",
    "(test ! -d /app/node_modules || test -z \"$(find /app/node_modules -type f -name '*.map' -print -quit)\") && test -z \"$(find /app -type f -exec grep -a -E -l 'release-ci-only|management-ci-token|runtime-ci-token' {} +)\"",
  ]);
  if (name !== "runtime") {
    assert(
      inspection.Config.Labels?.["org.opencontainers.image.revision"] === revision,
      `${name.toUpperCase()}_REVISION`,
    );
    assert(
      inspection.Config.Labels?.["org.opencontainers.image.licenses"] === "Apache-2.0",
      `${name.toUpperCase()}_LICENSE`,
    );
  }
}

function redactLabels(labels) {
  return Object.fromEntries(
    Object.entries(labels)
      .filter(([key]) => key.startsWith("org.opencontainers.image."))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function redact(value) {
  return value
    .replaceAll(/postgres(?:ql)?:\/\/[^\s]+/gi, "<redacted-database-url>")
    .replaceAll(/(?:management|runtime)-ci-token/gi, "<redacted-token>")
    .slice(-8_192);
}

async function secret(path, value) {
  await writeFile(path, value, { mode: 0o600 });
}

function assignFixtureOwnershipToRuntimeUser() {
  const uid = command("docker", [
    "run",
    "--rm",
    "--entrypoint",
    "id",
    images.runtime,
    "-u",
    "node",
  ]).trim();
  const gid = command("docker", [
    "run",
    "--rm",
    "--entrypoint",
    "id",
    images.runtime,
    "-g",
    "node",
  ]).trim();
  assert(/^[1-9][0-9]*$/.test(uid) && /^[1-9][0-9]*$/.test(gid), "RUNTIME_USER_INVALID");
  command("docker", [
    "run",
    "--rm",
    "--user",
    "0:0",
    "--volume",
    `${fixtureRoot}:/fixtures`,
    "--entrypoint",
    "chown",
    images.runtime,
    "-R",
    `${uid}:${gid}`,
    "/fixtures",
  ]);
}

function compose(...args) {
  return command(
    "docker",
    ["compose", "-p", project, "-f", "deploy/release-compose.yml", ...args],
    { env: environment },
  );
}

function composeExec(service, args) {
  compose("exec", "-T", service, ...args);
}

function cleanup() {
  command("node", ["scripts/cleanup-release-artifact-ci.mjs"], {
    env: environment,
    ignoreFailure: true,
  });
}

function command(file, args, options = {}) {
  try {
    return execFileSync(file, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", options.ignoreFailure ? "ignore" : "pipe"],
    });
  } catch (error) {
    if (options.ignoreFailure) return "";
    throw error;
  }
}

function lines(value) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

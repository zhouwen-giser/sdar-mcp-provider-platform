import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { createGzip } from "node:zlib";

const images = {
  api: "sdar/pms-api:0.1.0-rc",
  worker: "sdar/pms-worker:0.1.0-rc",
  web: "sdar/pms-web:0.1.0-rc",
};
const revision = command("git", ["rev-parse", "HEAD"]).trim();
const suffix = randomUUID().slice(0, 8);
const network = `sdar-release-${suffix}`;
const postgres = `sdar-release-postgres-${suffix}`;
const containers = [];

try {
  command("docker", ["network", "create", network]);
  runDetached(postgres, [
    "--network",
    network,
    "--network-alias",
    "postgres",
    "-e",
    "POSTGRES_USER=sdar",
    "-e",
    "POSTGRES_PASSWORD=release-test-only",
    "-e",
    "POSTGRES_DB=sdar",
    "postgres:17-alpine",
  ]);
  waitFor(() => command("docker", ["exec", postgres, "pg_isready", "-U", "sdar", "-d", "sdar"]));

  const inspections = Object.fromEntries(
    Object.entries(images).map(([name, image]) => [name, inspect(image)]),
  );
  const compressedSizes = {};
  for (const [name, image] of Object.entries(images)) {
    compressedSizes[name] = await compressedImageSize(image);
  }
  process.stdout.write(`RELEASE_IMAGE_COMPRESSED_SIZES ${JSON.stringify(compressedSizes)}\n`);
  for (const [name, inspection] of Object.entries(inspections)) {
    assert(inspection.Config.User === "node", `${name.toUpperCase()}_IMAGE_ROOT_USER`);
    assert(
      inspection.Config.Labels?.["org.opencontainers.image.version"] === "0.1.0",
      `${name.toUpperCase()}_IMAGE_VERSION_LABEL`,
    );
    assert(
      inspection.Config.Labels?.["org.opencontainers.image.revision"] === revision,
      `${name.toUpperCase()}_IMAGE_REVISION_LABEL`,
    );
    for (const label of ["title", "source", "licenses"]) {
      assert(
        typeof inspection.Config.Labels?.[`org.opencontainers.image.${label}`] === "string",
        `${name.toUpperCase()}_IMAGE_${label.toUpperCase()}_LABEL`,
      );
    }
    const history = command("docker", [
      "history",
      "--no-trunc",
      "--format",
      "{{.CreatedBy}}",
      images[name],
    ]);
    assert(
      !/postgres(?:ql)?:\/\/|release-test-only|test-token/i.test(history),
      "IMAGE_SECRET_HISTORY",
    );
  }
  assert(compressedSizes.api < 450_000_000, "PMS_API_IMAGE_SIZE");
  assert(compressedSizes.worker < 475_000_000, "PMS_WORKER_IMAGE_SIZE");
  assert(compressedSizes.web < 175_000_000, "PMS_WEB_IMAGE_SIZE");

  filesystemSmoke();
  await apiSmoke();
  await workerSmoke();
  await webSmoke();
  recordPortableImageSizes(compressedSizes);

  process.stdout.write(
    `${JSON.stringify({
      status: "pass",
      revision,
      images: Object.fromEntries(
        Object.entries(inspections).map(([name, value]) => [
          name,
          {
            image: images[name],
            sizeBytes: compressedSizes[name],
            sizeMetric: "gzip-compressed docker save bytes",
            user: value.Config.User,
          },
        ]),
      ),
      apiHealth: true,
      workerCompositionStartStop: true,
      workerPackageAndMigrationSources: true,
      webAssetsSpaHealthAndHeaders: true,
      secretsInHistoryOrFilesystem: false,
    })}\n`,
  );
} finally {
  for (const container of containers.reverse()) {
    command("docker", ["rm", "-f", container], { ignoreFailure: true });
  }
  command("docker", ["network", "rm", network], { ignoreFailure: true });
}

async function compressedImageSize(image) {
  const docker = spawn("docker", ["save", image], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const gzip = createGzip({ level: 9 });
  let stderr = "";
  let size = 0;
  docker.stderr.setEncoding("utf8");
  docker.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-4_000);
  });
  docker.stdout.pipe(gzip);
  const output = (async () => {
    for await (const chunk of gzip) size += chunk.length;
  })();
  const completion = new Promise((resolveCompletion, rejectCompletion) => {
    docker.once("error", rejectCompletion);
    docker.once("close", (code) => {
      if (code === 0) resolveCompletion();
      else rejectCompletion(new Error(`DOCKER_IMAGE_SAVE_FAILED:${image}:${stderr}`));
    });
  });
  await Promise.all([output, completion]);
  return size;
}

function recordPortableImageSizes(sizes) {
  const path = "reports/ci/release-artifacts.json";
  const report = JSON.parse(readFileSync(path, "utf8"));
  for (const [name, sizeBytes] of Object.entries(sizes)) {
    if (report.artifacts?.[name] !== undefined) {
      report.artifacts[name].sizeBytes = sizeBytes;
      report.artifacts[name].sizeMetric = "gzip-compressed docker save bytes";
    }
  }
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}

function filesystemSmoke() {
  const checks = {
    [images.api]: [
      "test -f /app/dist/apps/pms-api/src/main.js",
      "test -d /app/migrations/pms",
      "test -f /app/provider-packages/ugv/provider-package.json",
      "test ! -e /app/tests",
      'test "$(stat -c %u /app/dist)" = 0',
      'test "$(stat -c %u /app/provider-packages)" = 0',
      "! grep -R -a -E 'release-test-only|management-test-token|runtime-test-token' /app",
    ],
    [images.worker]: [
      "test -f /app/dist/apps/pms-worker/src/main.js",
      "test -d /app/migrations/pms",
      "test -d /app/migrations/runtime",
      "test -d /app/provider-packages",
      "test -d /app/proto",
      "test ! -e /app/tests",
      'test "$(stat -c %u /app/provider-packages)" = 0',
      "! grep -R -a -E 'release-test-only|management-test-token|runtime-test-token' /app",
    ],
    [images.web]: [
      "test -f /app/web/index.html",
      "test -f /app/web/styles.css",
      "test -f /app/web/assets/main.js",
      "test -f /app/web/assets/server.js",
      "test ! -e /app/node_modules",
      'test "$(stat -c %u /app/web)" = 0',
      "! grep -R -a -E 'release-test-only|management-test-token|runtime-test-token' /app",
    ],
  };
  for (const [image, commands] of Object.entries(checks)) {
    command("docker", ["run", "--rm", "--entrypoint", "sh", image, "-lc", commands.join(" && ")]);
  }
}

async function apiSmoke() {
  const name = `sdar-release-api-${suffix}`;
  const bootstrap = String.raw`
    const fs = await import("node:fs");
    fs.mkdirSync("/tmp/sdar-api", { mode: 0o700 });
    const write = (name, value) => fs.writeFileSync("/tmp/sdar-api/" + name, value, { mode: 0o600 });
    write("database-url", "postgresql://sdar:release-test-only@postgres:5432/sdar");
    write("management.token", "management-test-token");
    write("runtime.token", "runtime-test-token");
    write("management.json", JSON.stringify({management:{administrator:[{subjectId:"release-admin",tokenFile:"/tmp/sdar-api/management.token"}]}}));
    const identity={providerId:"release-provider",deploymentId:"release-deployment",instanceId:"release-instance",runtimeVersion:"2.0.0-rc.1",protocolVersion:"2026-07-28",tokenFile:"/tmp/sdar-api/runtime.token"};
    write("runtime.json", JSON.stringify({
      runtimeConfig:[{...identity,subjectId:"release-config",environment:"test",scopes:["runtime:config:read","runtime:config:watch","runtime:config:ack"]}],
      runtimeRegistration:[{...identity,subjectId:"release-registration",scopes:["runtime:register","runtime:heartbeat"]}]
    }));
    Object.assign(process.env,{
      PMS_API_HOST:"0.0.0.0",PMS_API_PORT:"8090",
      PMS_DATABASE_URL_FILE:"/tmp/sdar-api/database-url",
      PMS_MANAGEMENT_CREDENTIAL_FILE:"/tmp/sdar-api/management.json",
      PMS_RUNTIME_CREDENTIAL_FILE:"/tmp/sdar-api/runtime.json"
    });
    await import("/app/dist/apps/pms-api/src/main.js");
  `;
  runDetached(name, [
    "--network",
    network,
    "--entrypoint",
    "node",
    images.api,
    "--input-type=module",
    "-e",
    bootstrap,
  ]);
  waitForContainer(name, () =>
    command("docker", [
      "exec",
      name,
      "node",
      "-e",
      "fetch('http://127.0.0.1:8090/health/ready').then(r=>{if(!r.ok)process.exit(1)})",
    ]),
  );
  stopCleanly(name);
}

async function workerSmoke() {
  const name = `sdar-release-worker-${suffix}`;
  const bootstrap = String.raw`
    const fs = await import("node:fs");
    const path = await import("node:path");
    const base="/tmp/sdar-worker";
    for (const directory of ["","releases","releases/2.0.0-rc.1","secrets","cache","credentials","pm2"]) fs.mkdirSync(path.resolve(base,directory),{recursive:true,mode:0o700});
    fs.cpSync("/app/dist",path.resolve(base,"releases/2.0.0-rc.1/dist"),{recursive:true});
    fs.cpSync("/app/proto",path.resolve(base,"releases/2.0.0-rc.1/proto"),{recursive:true});
    fs.cpSync("/app/migrations",path.resolve(base,"releases/2.0.0-rc.1/migrations"),{recursive:true});
    const write=(name,value)=>fs.writeFileSync(path.resolve(base,name),value,{mode:0o600});
    write("database-url","postgresql://sdar:release-test-only@postgres:5432/sdar");
    write("provisioning.json",JSON.stringify({clusterRef:"release-postgres",adminSecretRef:"file/release/admin",adminDatabaseUrl:"postgresql://sdar:release-test-only@postgres:5432/sdar",runtimePassword:"release-runtime-password"}));
    write("releases/runtime-releases.json",JSON.stringify({schemaVersion:1,releases:[{version:"2.0.0-rc.1",directory:"2.0.0-rc.1"}]}));
    const registry=await import("/app/dist/packages/provider-package-registry/src/index.js");
    if ((await registry.loadProviderPackageRegistry("/app")).list().length < 1) throw new Error("PACKAGE_SYNC_SOURCE_MISSING");
    const migrations=await import("/app/dist/packages/database-migration-runner/src/index.js");
    if ((await migrations.resolveMigrationSet("/app","pms")).length < 1 || (await migrations.resolveMigrationSet("/app","runtime")).length < 1) throw new Error("MIGRATION_SOURCE_MISSING");
    Object.assign(process.env,{
      PMS_DATABASE_URL_FILE:base+"/database-url",PMS_WORKER_ID:"release-worker",
      PMS_WORKER_POLL_INTERVAL_MS:"100",PMS_WORKER_LEASE_DURATION_MS:"1000",PMS_WORKER_CLAIM_LIMIT:"3",PMS_WORKER_RETRY_DELAY_MS:"100",
      PMS_WORKSPACE_ROOT:"/app",PMS_POSTGRES_PROVISIONING_CREDENTIAL_FILE:base+"/provisioning.json",
      PMS_RUNTIME_RELEASE_ROOT:base+"/releases",PMS_RUNTIME_SECRET_ROOT:base+"/secrets",PMS_RUNTIME_CONFIG_CACHE_ROOT:base+"/cache",
      PMS_RUNTIME_CONTROL_PLANE_URL:"http://127.0.0.1:8090",PMS_RUNTIME_CONTROL_PLANE_CREDENTIAL_ROOT:base+"/credentials",
      PMS_PM2_HOME:base+"/pm2",PMS_RUNTIME_RECONCILE_INTERVAL_MS:"1000",PMS_RUNTIME_RECONCILE_TIMEOUT_MS:"5000",PMS_RUNTIME_HEALTH_TIMEOUT_MS:"1000"
    });
    const {bootstrapPmsWorker}=await import("/app/dist/apps/pms-worker/src/bootstrap.js");
    const running=await bootstrapPmsWorker();
    process.once("SIGTERM",()=>void running.stop().then(()=>process.exit(0),error=>{console.error(error);process.exit(1)}));
    write("ready","ready");
  `;
  runDetached(name, [
    "--network",
    network,
    "--entrypoint",
    "node",
    images.worker,
    "--input-type=module",
    "-e",
    bootstrap,
  ]);
  waitFor(() => {
    const state = inspectContainer(name);
    assert(state.Running, "PMS_WORKER_SMOKE_EXITED");
    return command("docker", [
      "exec",
      name,
      "sh",
      "-lc",
      "test -f /tmp/sdar-worker/ready && node -e \"import('pg').then(async({default:pg})=>{const p=new pg.Pool({connectionString:'postgresql://sdar:release-test-only@postgres:5432/sdar'});const r=await p.query(\\\"select to_regclass('pms_schema_migration') is not null as ready\\\");await p.end();if(!r.rows[0].ready)process.exit(1)})\"",
    ]);
  });
  stopCleanly(name);
}

async function webSmoke() {
  const name = `sdar-release-web-${suffix}`;
  runDetached(name, [
    "--network",
    network,
    "-e",
    "PMS_WEB_API_BASE=https://pms.example.test/api",
    images.web,
  ]);
  waitFor(() =>
    command("docker", [
      "exec",
      name,
      "node",
      "-e",
      String.raw`Promise.all(["/","/assets/main.js","/styles.css","/providers/one","/health/live","/health/ready"].map(async p=>{const r=await fetch("http://127.0.0.1:8080"+p);if(!r.ok)throw Error(p);if(p==="/"){const t=await r.text();if(!t.includes("https://pms.example.test/api")||r.headers.get("x-content-type-options")!=="nosniff")throw Error("web")}}))`,
    ]),
  );
  stopCleanly(name);
}

function runDetached(name, args) {
  containers.push(name);
  command("docker", ["run", "--detach", "--name", name, ...args]);
}

function stopCleanly(name) {
  command("docker", ["stop", "--time", "15", name]);
  const state = inspectContainer(name);
  if (state.ExitCode !== 0) {
    throw new Error(
      `CONTAINER_EXIT_${name}: ${containerLogs(name) || `exit code ${state.ExitCode}`}`,
    );
  }
  command("docker", ["rm", name]);
  containers.splice(containers.indexOf(name), 1);
}

function inspect(image) {
  return JSON.parse(command("docker", ["image", "inspect", image]))[0];
}

function inspectContainer(name) {
  return JSON.parse(command("docker", ["inspect", "--format", "{{json .State}}", name]));
}

function waitFor(operation, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      return operation();
    } catch (error) {
      last = error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
  throw last ?? new Error("RELEASE_IMAGE_WAIT_TIMEOUT");
}

function waitForContainer(name, operation, timeoutMs = 30_000) {
  return waitFor(() => {
    const state = inspectContainer(name);
    if (!state.Running) {
      const logs = containerLogs(name);
      throw new Error(`CONTAINER_EXIT_${name}: ${logs || `exit code ${state.ExitCode}`}`);
    }
    return operation();
  }, timeoutMs);
}

function containerLogs(name) {
  const result = spawnSync("docker", ["logs", name], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}

function command(file, args, options = {}) {
  try {
    return execFileSync(file, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", options.ignoreFailure ? "ignore" : "pipe"],
    });
  } catch (error) {
    if (options.ignoreFailure) return "";
    throw error;
  }
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

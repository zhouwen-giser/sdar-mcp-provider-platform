import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { spawnSync } from "node:child_process";

const dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(dir, "../../..");
const definitions = {
  RUNTIME: ["runtime.bootstrap", "runtime.observability", "runtime.workerEvents"],
  ADAPTER: ["provider.ugv"],
};
const schemas = Object.fromEntries(
  Object.entries(definitions).map(([side, names]) => [
    side,
    Object.assign(
      {},
      ...names.map(
        (name) =>
          JSON.parse(readFileSync(resolve(root, `schemas/config/${name}.schema.json`))).properties,
      ),
    ),
  ]),
);
const defaults = Object.fromEntries(
  Object.entries(definitions).map(([side, names]) => [
    side,
    Object.assign(
      {},
      ...names.map(
        (name) =>
          JSON.parse(readFileSync(resolve(root, `schemas/config/${name}.defaults.json`))).values,
      ),
    ),
  ]),
);
// Bootstrap registration/identity fields are outside the runtime configuration-center groups.
Object.assign(schemas.RUNTIME, {
  PMS_RUNTIME_REGISTRATION_URL: { type: "string", format: "uri" },
  PMS_RUNTIME_REGISTRATION_TOKEN_FILE: { type: "string", minLength: 1, writeOnly: true },
  PMS_RUNTIME_HEARTBEAT_INTERVAL_MS: { type: "integer", minimum: 100, maximum: 120000 },
  PMS_DEPLOYMENT_ID: { type: "string", minLength: 1 },
  PMS_INSTANCE_ID: { type: "string", minLength: 1 },
  RUNTIME_DEPLOYMENT_ID: { type: "string", minLength: 1 },
  RUNTIME_INSTANCE_ID: { type: "string", minLength: 1 },
  SDAR_BUILD_REVISION: { type: "string", minLength: 1 },
});
// Deployment identity is intentionally outside public operation/config-center schemas.
for (const side of Object.keys(schemas))
  Object.assign(schemas[side], {
    SMPP_STORAGE_MODE: { type: "string", enum: ["standalone", "gowm-shared"] },
    SMPP_SERVICE_KEY: { type: "string", minLength: 1 },
    SMPP_ALLOWED_DEVICE_IDS: { type: "string", minLength: 1 },
    SMPP_GOWM_BINDING_ID: { type: "string", minLength: 1 },
    SMPP_SOURCE_SESSION_KEY: { type: "string", minLength: 1 },
    GOWM_DATABASE_URL_FILE: { type: "string", minLength: 1, writeOnly: true },
  });
const overrides = {
  RUNTIME: {
    PROVIDER_ID: "isr.vehicle.ugv.ugv1",
    DATABASE_URL: "postgresql://ugv_runtime:development-runtime@runtime-db:5432/ugv_runtime",
    ADAPTER_ENDPOINT: "adapter:7010",
    AUTH_MODE: "development",
    SIMULATOR_CREDENTIAL_FREE: true,
    INTERNAL_ENDPOINTS_ENABLED: true,
    SMPP_DIAGNOSTICS_ENABLED: true,
    BUSINESS_EVENTS_ENABLED: true,
    HOST: "0.0.0.0",
    PORT: 8080,
  },
  ADAPTER: {
    UGV_ADAPTER_DATABASE_URL:
      "postgresql://ugv_adapter:development-adapter@adapter-db:5432/ugv_adapter",
    SIMULATOR_CREDENTIAL_FREE: true,
    UGV_DIAGNOSTICS_ENABLED: true,
    UGV_EXECUTION_MODE: "live",
    UGV_FIRE_ENABLED: true,
    UGV_MQTT_WIRE_MODE: "ros_bridge_json",
    UGV_MQTT_SESSION_MODE: "clean",
    UGV_DEVICE_MCP_CONTRACT_REPORT_PATH: "/var/lib/sdar/contracts/capture.json",
  },
};
const settings = {
  DEPLOY_PROJECT: "smpp-development",
  DEPLOY_BUILD_IMAGES: "true",
  GOWM_EXTERNAL_NETWORK: "",
  DEPLOY_BIND_ADDRESS: "0.0.0.0",
  DEPLOY_PORT: "19100",
  DEPLOY_STAGE: "development_debug",
  DEPLOY_WAIT_SECONDS: "180",
  POSTGRES_IMAGE: "postgres:17-alpine",
  NODE_BASE_IMAGE: "node:22-bookworm-slim",
};
function template() {
  let out =
    "# 仅隔离纯软件仿真网络；所有阶段免调用凭证。修改任意项后重新运行 up。\n# 不含真实凭据。数据库默认密码仅开发用途；同时修改对应 DATABASE_URL。\n# RUNTIME__/ADAPTER__ 是目标服务前缀，启动时去除；注释项不传入进程。\n";
  for (const [key, value] of Object.entries(settings))
    out += `\n# 部署参数 ${key}；默认 ${value}；阶段可选 development_debug/integration_candidate/qualification。\n${key}=${value}\n`;
  for (const side of Object.keys(schemas))
    for (const [key, schema] of Object.entries(schemas[side]).sort()) {
      const value = overrides[side][key] ?? defaults[side][key];
      const rules = JSON.stringify(schema);
      out += `\n# ${side} ${key}；规则 ${rules}；重启生效。${key.endsWith("_MS") ? "单位毫秒。" : ""}${schema.writeOnly ? "敏感配置；不要提交实际值。" : ""}\n`;
      out +=
        value === undefined
          ? `# ${side}__${key}=\n`
          : `${side}__${key}=${JSON.stringify(String(value))}\n`;
    }
  return out;
}
function run(args) {
  const p = spawnSync("docker", args, { stdio: "inherit" });
  if (p.status !== 0) throw Error(`docker ${args.slice(0, 2).join(" ")} failed`);
}
const action = process.argv[2] ?? "up";
if (action === "generate-template") {
  writeFileSync(resolve(dir, ".env.example"), template());
  process.exit(0);
}
if (action === "check-template") {
  if (readFileSync(resolve(dir, ".env.example"), "utf8") !== template())
    throw Error("ENV_TEMPLATE_DRIFT");
  console.log("ENV_TEMPLATE_COVERAGE_PASS");
  process.exit(0);
}
if (!["up", "status", "logs", "down", "config"].includes(action))
  throw Error("Usage: node package.mjs up|status|logs|down|config [env-file]");
const siteProfile =
  existsSync(resolve(root, "DEPLOYMENT_PROFILE")) &&
  readFileSync(resolve(root, "DEPLOYMENT_PROFILE"), "utf8").trim() === "sz-gowm";
const envPath = resolve(process.argv[3] ?? resolve(dir, ".env"));
if (!existsSync(envPath))
  writeFileSync(
    envPath,
    readFileSync(resolve(dir, siteProfile ? ".env.gowm.example" : ".env.example")),
    { mode: 0o600, flag: "wx" },
  );
const env = parseEnv(readFileSync(envPath, "utf8"));
for (const key of Object.keys(env))
  if (
    !(key in settings) &&
    !Object.entries(schemas).some(
      ([side, keys]) => key.startsWith(`${side}__`) && key.slice(side.length + 2) in keys,
    )
  )
    throw Error(`UNKNOWN_CONFIGURATION:${key}`);
const cfg = {
  ...settings,
  ...Object.fromEntries(Object.entries(env).filter(([key]) => key in settings)),
};
if (!["development_debug", "integration_candidate", "qualification"].includes(cfg.DEPLOY_STAGE))
  throw Error("INVALID_STAGE");
if (!/^[a-z0-9][a-z0-9_-]*$/.test(cfg.DEPLOY_PROJECT)) throw Error("INVALID_PROJECT");
if (!/^\d+$/.test(cfg.DEPLOY_PORT) || +cfg.DEPLOY_PORT < 1 || +cfg.DEPLOY_PORT > 65535)
  throw Error("INVALID_PORT");
if (!/^\d+$/.test(cfg.DEPLOY_WAIT_SECONDS) || +cfg.DEPLOY_WAIT_SECONDS < 1)
  throw Error("INVALID_WAIT_SECONDS");
const state = resolve(dir, "state");
mkdirSync(state, { recursive: true, mode: 0o700 });
const configDirectory = resolve(dir, "config");
mkdirSync(configDirectory, { recursive: true, mode: 0o700 });
const values = {};
for (const side of Object.keys(schemas)) {
  values[side] = Object.fromEntries(
    Object.entries(env)
      .filter(([key]) => key.startsWith(`${side}__`))
      .map(([key, value]) => [key.slice(side.length + 2), value]),
  );
  for (const [key, value] of Object.entries(values[side])) {
    const s = schemas[side][key];
    if (s.enum && !s.enum.includes(value)) throw Error(`INVALID_ENUM:${side}__${key}`);
    if (s.type === "boolean" && !["true", "false", "1", "0"].includes(value))
      throw Error(`INVALID_BOOLEAN:${key}`);
    if (
      ["integer", "number"].includes(s.type) &&
      (!Number.isFinite(Number(value)) ||
        (s.type === "integer" && !Number.isInteger(Number(value))) ||
        (s.minimum !== undefined && +value < s.minimum) ||
        (s.maximum !== undefined && +value > s.maximum))
    )
      throw Error(`INVALID_NUMBER:${key}`);
  }
}
const shared = values.RUNTIME.SMPP_STORAGE_MODE === "gowm-shared";
if (siteProfile && !shared) throw Error("SZ_GOWM_PROFILE_REQUIRES_SHARED_STORAGE");
if (shared !== (values.ADAPTER.SMPP_STORAGE_MODE === "gowm-shared"))
  throw Error("GOWM_MODE_MISMATCH");
if (shared) {
  const bindingFile = resolve(configDirectory, "gowm-binding.json");
  const binding = existsSync(bindingFile)
    ? JSON.parse(readFileSync(bindingFile, "utf8"))
    : undefined;
  const ids = JSON.parse(values.RUNTIME.SMPP_ALLOWED_DEVICE_IDS ?? "null");
  if (!Array.isArray(ids) || ids.length !== 1 || typeof ids[0] !== "string" || !ids[0].trim())
    throw Error("GOWM_DEVICE_SCOPE_REQUIRED");
  for (const side of Object.keys(values)) {
    if (binding) {
      if (
        binding.smppServiceKey !== values[side].SMPP_SERVICE_KEY ||
        JSON.stringify([binding.deviceId]) !== values[side].SMPP_ALLOWED_DEVICE_IDS ||
        binding.providerId !== values.RUNTIME.PROVIDER_ID ||
        binding.resourceId !== values.ADAPTER.UGV_RESOURCE_ID
      )
        throw Error("GOWM_SITE_BINDING_MISMATCH");
      values[side].SMPP_GOWM_BINDING_ID ??= binding.bindingId;
    }
    if (
      values[side].DATABASE_URL ||
      values[side].UGV_ADAPTER_DATABASE_URL ||
      values[side].DATABASE_URL_FILE
    )
      throw Error("GOWM_LEGACY_CONNECTION_FORBIDDEN");
    if (
      !values[side].GOWM_DATABASE_URL_FILE ||
      !values[side].SMPP_ALLOWED_DEVICE_IDS ||
      !values[side].SMPP_SERVICE_KEY
    )
      throw Error("GOWM_CONFIGURATION_REQUIRED");
    if (action === "up" && !values[side].SMPP_GOWM_BINDING_ID)
      throw Error("Run prepare-gowm.mjs before up");
  }
  for (const key of [
    "GOWM_DATABASE_URL_FILE",
    "SMPP_SERVICE_KEY",
    "SMPP_ALLOWED_DEVICE_IDS",
    "SMPP_GOWM_BINDING_ID",
    "SMPP_SOURCE_SESSION_KEY",
  ])
    if (values.RUNTIME[key] !== values.ADAPTER[key]) throw Error(`GOWM_IDENTITY_MISMATCH:${key}`);
}
values.ADAPTER.UGV_DELIVERY_STAGE = cfg.DEPLOY_STAGE;
// The deployment stage is deliberately independent of runtime auth/environment.
const revision = existsSync(resolve(root, "SOURCE_REVISION"))
  ? readFileSync(resolve(root, "SOURCE_REVISION"), "utf8").trim()
  : spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
const service = (side, target) => ({
  image: `${cfg.DEPLOY_PROJECT}/${side.toLowerCase()}:${revision}`,
  build: {
    context: root,
    dockerfile: "Dockerfile",
    target,
    args: { VCS_REF: revision, NODE_BASE_IMAGE: cfg.NODE_BASE_IMAGE },
  },
  environment: values[side],
  restart: "unless-stopped",
  init: true,
  volumes: [
    `${side.toLowerCase()}-state:/var/lib/sdar`,
    { type: "bind", source: configDirectory, target: "/run/config", read_only: true },
  ],
});
const db = (side) => {
  const url = new URL(
    values[side][side === "RUNTIME" ? "DATABASE_URL" : "UGV_ADAPTER_DATABASE_URL"],
  );
  return {
    image: cfg.POSTGRES_IMAGE,
    environment: {
      POSTGRES_USER: decodeURIComponent(url.username),
      POSTGRES_PASSWORD: decodeURIComponent(url.password),
      POSTGRES_DB: url.pathname.slice(1),
    },
    volumes: [`${side.toLowerCase()}-db:/var/lib/postgresql/data`],
    restart: "unless-stopped",
    healthcheck: {
      test: ["CMD-SHELL", 'pg_isready -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'],
      interval: "2s",
      timeout: "3s",
      retries: 30,
    },
  };
};
const compose = {
  name: cfg.DEPLOY_PROJECT,
  services: {
    ...(!shared ? { "runtime-db": db("RUNTIME"), "adapter-db": db("ADAPTER") } : {}),
    adapter: {
      ...service("ADAPTER", "ugv-real-adapter"),
      command: [
        "sh",
        "-c",
        "node dist/apps/ugv-provider-adapter/src/migrate.js && exec node dist/apps/ugv-provider-adapter/src/main.js",
      ],
      depends_on: { "adapter-db": { condition: "service_healthy" } },
    },
    runtime: {
      ...service("RUNTIME", "ugv-real-runtime"),
      ports: [`${cfg.DEPLOY_BIND_ADDRESS}:${cfg.DEPLOY_PORT}:${values.RUNTIME.PORT ?? 8080}`],
      depends_on: {
        "runtime-db": { condition: "service_healthy" },
        adapter: { condition: "service_started" },
      },
    },
  },
  volumes: { "runtime-db": {}, "adapter-db": {}, "runtime-state": {}, "adapter-state": {} },
};
if (shared) {
  delete compose.services["runtime-db"];
  delete compose.services["adapter-db"];
  delete compose.volumes["runtime-db"];
  delete compose.volumes["adapter-db"];
  delete compose.services.adapter.depends_on;
  delete compose.services.runtime.depends_on["runtime-db"];
  if (!cfg.GOWM_EXTERNAL_NETWORK) throw Error("GOWM_EXTERNAL_NETWORK_REQUIRED");
  compose.networks = { default: {}, gowm: { external: true, name: cfg.GOWM_EXTERNAL_NETWORK } };
  for (const side of ["runtime", "adapter"]) compose.services[side].networks = ["default", "gowm"];
}
const file = resolve(state, "compose.json");
// Compose interpolates dollar signs even in JSON. Preserve literal env values.
for (const svc of Object.values(compose.services)) {
  svc.environment = Object.fromEntries(
    Object.entries(svc.environment).map(([key, value]) => [
      key,
      String(value).replaceAll("$", "$$"),
    ]),
  );
}
compose.services.runtime.command = [
  "sh",
  "-c",
  "node dist/apps/runtime/src/migrate.js && exec node dist/apps/runtime/src/main.js",
];
writeFileSync(file, JSON.stringify(compose, null, 2), { mode: 0o600 });
const base = ["compose", "-f", file];
if (action === "config") {
  console.log("CONFIG_COVERAGE_VALID (values redacted)");
  process.exit(0);
}
if (action === "up") {
  if (cfg.DEPLOY_BUILD_IMAGES === "true") run([...base, "build"]);
  else if (cfg.DEPLOY_BUILD_IMAGES === "false") {
    for (const svc of Object.values(compose.services)) {
      if (!svc.build) continue;
      const r = spawnSync("docker", ["image", "inspect", svc.image], { encoding: "utf8" });
      if (
        r.status !== 0 ||
        JSON.parse(r.stdout)[0].Config.Labels["org.opencontainers.image.revision"] !== revision
      )
        throw Error("PREBUILT_IMAGE_REVISION_MISMATCH");
    }
  } else throw Error("INVALID_DEPLOY_BUILD_IMAGES");
  // Load the real application configuration before starting services; these commands have no southbound clients.
  run([
    ...base,
    "run",
    "--rm",
    "--no-deps",
    "--entrypoint",
    "node",
    "runtime",
    "--input-type=module",
    "-e",
    "import {loadRuntimeConfig} from './dist/apps/runtime/src/config.js'; loadRuntimeConfig(process.env); console.log('RUNTIME_CONFIG_PASS')",
  ]);
  run([
    ...base,
    "run",
    "--rm",
    "--no-deps",
    "--entrypoint",
    "node",
    "adapter",
    "--input-type=module",
    "-e",
    "import {loadUgvProviderConfig} from './dist/apps/ugv-provider-adapter/src/config.js'; loadUgvProviderConfig(process.env); console.log('ADAPTER_CONFIG_PASS')",
  ]);
  run([...base, "up", "-d"]);
  const until = Date.now() + Number(cfg.DEPLOY_WAIT_SECONDS) * 1000;
  let ready = false;
  while (Date.now() < until) {
    try {
      const r = await fetch(`http://127.0.0.1:${cfg.DEPLOY_PORT}/health/ready`, {
        signal: globalThis.AbortSignal.timeout(2000),
      });
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Startup may still be in progress; bounded by the deadline. */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) throw Error("READINESS_TIMEOUT: inspect logs; services/data preserved");
  const ids = spawnSync("docker", [...base, "ps", "-q"], { encoding: "utf8" })
    .stdout.trim()
    .split(/\s+/);
  const inspect = spawnSync("docker", ["inspect", ...ids], { encoding: "utf8" });
  if (inspect.status !== 0) throw Error("IDENTITY_INSPECT_FAILED");
  writeFileSync(
    resolve(state, "identity.json"),
    JSON.stringify(
      {
        revision,
        stage: cfg.DEPLOY_STAGE,
        instances: JSON.parse(inspect.stdout).map((c) => ({
          name: c.Name,
          image: c.Image,
          startedAt: c.State.StartedAt,
          restartCount: c.RestartCount,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`READY: http://127.0.0.1:${cfg.DEPLOY_PORT}/mcp (no control probes)`);
} else
  run([
    ...base,
    ...(action === "status" ? ["ps"] : action === "logs" ? ["logs", "--tail", "100"] : ["down"]),
  ]);

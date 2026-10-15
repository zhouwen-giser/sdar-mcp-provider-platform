import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";

const root = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.join(root, ".runtime");
const server = path.join(root, "smpp/deploy/development/server");
const envFile = path.join(server, ".env");
let manifest, upstreamRoot, upstreamValues, smppValues;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0)
    throw Error(`COMMAND_FAILED:${path.basename(command)} (exit ${result.status})`);
  return result.stdout;
}

function readEnv(file) {
  return parseEnv(fs.readFileSync(file, "utf8"));
}

function saveEnv(file, updates) {
  if (fs.lstatSync(file).isSymbolicLink()) throw Error("CONFIGURATION_SYMLINK_UNEXPECTED");
  let text = fs.readFileSync(file, "utf8");
  for (const [key, value] of Object.entries(updates)) {
    const raw = String(value);
    if (/[\r\n\0']/.test(raw)) throw Error("INVALID_MANAGED_VALUE:" + key);
    const line = `${key}='${raw}'`;
    const pattern = new RegExp("^" + key + "=.*$", "m");
    text = pattern.test(text) ? text.replace(pattern, () => line) : text + "\n" + line + "\n";
  }
  fs.writeFileSync(file, text, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function alias(name, target) {
  const file = path.join(root, name);
  if (fs.lstatSync(file, { throwIfNoEntry: false })) {
    if (!fs.lstatSync(file).isSymbolicLink() || fs.realpathSync(file) !== fs.realpathSync(target))
      throw Error("CONFIGURATION_ALIAS_CONFLICT:" + name);
  } else fs.symlinkSync(path.relative(root, target), file);
}

function smppCommand(command, capture = false) {
  return run(process.execPath, [path.join(server, "package.mjs"), command], { capture });
}

function upstreamCommand(command) {
  run("bash", [path.join(upstreamRoot, "deploy"), command]);
}

function verify() {
  run("sha256sum", ["--quiet", "-c", "SHA256SUMS"], { capture: true });
  manifest = JSON.parse(fs.readFileSync(path.join(root, "UNION.json"), "utf8"));
  if (manifest.schemaVersion !== 2 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(manifest.wsgsUnion.root))
    throw Error("JOINT_MANIFEST_INVALID");
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(runtime).isSymbolicLink()) throw Error("RUNTIME_SYMLINK_UNEXPECTED");
  const directory = path.join(runtime, "wsgs-united");
  upstreamRoot = path.join(directory, manifest.wsgsUnion.root);
  if (!fs.existsSync(upstreamRoot))
    run("python3", [
      path.join(root, "extract.py"),
      path.join(root, manifest.wsgsUnion.path),
      directory,
    ]);
  if (fs.lstatSync(upstreamRoot).isSymbolicLink()) throw Error("UPSTREAM_SYMLINK_UNEXPECTED");
  run("sha256sum", ["--quiet", "-c", "SHA256SUMS"], { cwd: upstreamRoot, capture: true });
  run(process.execPath, [path.join(root, "deploy.mjs"), "verify"]);
  if (
    fs.readFileSync(path.join(root, "smpp/SOURCE_REVISION"), "utf8").trim() !==
    manifest.smpp.revision
  )
    throw Error("SMPP_SOURCE_REVISION_MISMATCH");
  console.log("JOINT_ARCHIVE_PASS");
}

function init() {
  verify();
  upstreamCommand("init");
  upstreamValues = readEnv(path.join(upstreamRoot, "upstream.env"));
  const network = upstreamValues.COMPOSE_PROJECT_NAME + "_default";
  const created = !fs.existsSync(envFile);
  if (created) fs.copyFileSync(path.join(server, ".env.gowm.example"), envFile);
  const updates = {
    GOWM_EXTERNAL_NETWORK: network,
    RUNTIME__SDAR_BUILD_REVISION: manifest.smpp.revision,
  };
  if (created) {
    const project = upstreamValues.COMPOSE_PROJECT_NAME + "-smpp";
    Object.assign(updates, {
      DEPLOY_PROJECT: project,
      RUNTIME__RUNTIME_DEPLOYMENT_ID: project,
      ADAPTER__UGV_MQTT_CLIENT_ID: project + "-ugv",
      RUNTIME__SMPP_SOURCE_SESSION_KEY: project + "-ugv-mqtt",
      ADAPTER__SMPP_SOURCE_SESSION_KEY: project + "-ugv-mqtt",
    });
  }
  saveEnv(envFile, updates);
  smppValues = readEnv(envFile);
  const siteFile = path.join(server, "gowm-site.json");
  const site = JSON.parse(fs.readFileSync(siteFile, "utf8"));
  const deviceId = upstreamValues.GOWM_DEVICE_ID || `ugv:${upstreamValues.UGV_DEVICE_ID || "ugv"}`;
  const scope = upstreamValues.UGV_DATA_SCOPE_KEY || "airport-sim-ugv-01";
  if (
    fs.existsSync(path.join(server, "config/gowm-binding.json")) &&
    (site.deviceId !== deviceId || site.dataScopeKey !== scope)
  )
    throw Error("EXISTING_DEVICE_BINDING_IDENTITY_DIFFERS");
  Object.assign(site, {
    deviceId,
    dataScopeKey: scope,
    network,
    serviceKey: smppValues.RUNTIME__SMPP_SERVICE_KEY,
    providerId: smppValues.RUNTIME__PROVIDER_ID,
    resourceId: smppValues.ADAPTER__UGV_RESOURCE_ID,
    sourceSessionKey: smppValues.RUNTIME__SMPP_SOURCE_SESSION_KEY,
    mqttUrl: smppValues.ADAPTER__UGV_MQTT_URL,
    deviceMcpUrl: smppValues.ADAPTER__UGV_DEVICE_MCP_URL,
    observedGowmPackageSha256: manifest.gowm.sha256,
  });
  fs.writeFileSync(siteFile, JSON.stringify(site, null, 2) + "\n");
  saveEnv(envFile, {
    RUNTIME__SMPP_ALLOWED_DEVICE_IDS: JSON.stringify([deviceId]),
    ADAPTER__SMPP_ALLOWED_DEVICE_IDS: JSON.stringify([deviceId]),
  });
  smppValues = readEnv(envFile);
  alias("upstream.env", path.join(upstreamRoot, "upstream.env"));
  alias("wsgs.env", path.join(upstreamRoot, "wsgs.env"));
  alias("smpp.env", envFile);
  console.log("JOINT_INITIALIZED: upstream.env, wsgs.env, smpp.env; no containers started");
}

function check() {
  upstreamCommand("config-check");
  smppCommand("config");
  const compose = JSON.parse(
    run(
      "docker",
      ["compose", "-f", path.join(server, "state/compose.json"), "config", "--format", "json"],
      { capture: true },
    ),
  );
  if (
    Object.keys(compose.services).sort().join(",") !== "adapter,runtime" ||
    compose.networks.gowm.name !== upstreamValues.COMPOSE_PROJECT_NAME + "_default"
  )
    throw Error("SMPP_SHARED_DEPLOYMENT_MAPPING_DIFFERS");
  const wsgs = readEnv(path.join(upstreamRoot, "wsgs.env"));
  if (Number(wsgs.WSGS_API_PORT || 8080) === Number(smppValues.DEPLOY_PORT || 19100))
    throw Error("WSGS_SMPP_PORT_CONFLICT");
  console.log(
    "JOINT_CONFIGURATION_PASS: shared GOWM network and separate API ports; no containers started",
  );
}

function baseRoot() {
  return path.join(upstreamRoot, ".runtime/upstream", manifest.baseRoot);
}

function smoke() {
  const port = smppValues.DEPLOY_PORT || "19100";
  if (!/^\d+$/.test(port) || +port < 1 || +port > 65535) throw Error("INVALID_SMPP_PORT");
  run(process.execPath, [
    "--input-type=module",
    "-e",
    "for (const p of ['live','ready']) { const r=await fetch(new URL('/health/'+p, process.argv[1]), {signal:AbortSignal.timeout(5000)}); if(!r.ok)throw Error('SMPP_HEALTH_FAILED:'+p); }",
    `http://127.0.0.1:${port}`,
  ]);
  upstreamCommand("smoke");
  console.log("JOINT_SMOKE_PASS: health and capability checks; no device control probes");
}

function main() {
  if (Number(process.versions.node.split(".")[0]) !== 22) throw Error("NODE_22_REQUIRED");
  const [command = "status", ...args] = process.argv.slice(2);
  if (
    ![
      "verify",
      "init",
      "config-check",
      "doctor",
      "build-images",
      "up",
      "status",
      "logs",
      "smoke",
      "down",
    ].includes(command)
  )
    throw Error(
      "Usage: ./deploy verify|init|config-check|doctor|build-images|up [--prebuilt] [--backup-scope full|smpp]|status|logs [smpp|wsgs|upstream]|smoke|down",
    );
  let prebuilt = false,
    backupScope = "full";
  if (command === "up") {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--prebuilt") prebuilt = true;
      else if (args[i] === "--backup-scope" && ["full", "smpp"].includes(args[i + 1]))
        backupScope = args[++i];
      else throw Error("INVALID_UP_ARGUMENT");
    }
  } else if (command === "logs") {
    if (args.length > 1 || (args[0] && !["smpp", "wsgs", "upstream"].includes(args[0])))
      throw Error("INVALID_LOG_SCOPE");
  } else if (args.length) throw Error("UNEXPECTED_ARGUMENT");
  if (command === "verify") return verify();
  init();
  if (command === "init") return;
  if (command === "config-check") return check();
  if (command === "doctor") {
    check();
    upstreamCommand("doctor");
    return;
  }
  if (command === "build-images") {
    check();
    upstreamCommand("build-images");
    run(process.execPath, [path.join(root, "deploy.mjs"), "build-images"]);
    return;
  }
  if (command === "up") {
    check();
    if (upstreamValues.UGV_MQTT_INGEST_ENABLED !== "true")
      throw Error("SMPP_REQUIRES_GOWM_UGV_INGEST_AND_DEVICE_BOOTSTRAP");
    const lock = path.join(runtime, "joint-up.lock");
    const fd = fs.openSync(lock, "wx", 0o600);
    try {
      fs.writeSync(fd, String(process.pid));
      upstreamCommand("up");
      run(process.execPath, [
        path.join(root, "deploy.mjs"),
        "up",
        "--base-root",
        baseRoot(),
        "--backup-scope",
        backupScope,
        ...(prebuilt ? ["--prebuilt"] : []),
      ]);
      smoke();
      fs.writeFileSync(
        path.join(runtime, "joint-deployment.json"),
        JSON.stringify(
          {
            status: "READY",
            deployedAt: new Date().toISOString(),
            upstreamSha256: manifest.wsgsUnion.sha256,
            smppRevision: manifest.smpp.revision,
            smppProject: smppValues.DEPLOY_PROJECT,
            upstreamProject: upstreamValues.COMPOSE_PROJECT_NAME,
            backupScope,
            businessAcceptance: "NOT_RUN",
            deviceControlProbes: false,
          },
          null,
          2,
        ) + "\n",
        { mode: 0o600 },
      );
      console.log("JOINT_DEPLOYMENT_READY");
    } finally {
      fs.closeSync(fd);
      fs.unlinkSync(lock);
    }
    return;
  }
  if (command === "status") {
    smppCommand("status");
    upstreamCommand("status");
  } else if (command === "logs") {
    if (!args[0] || args[0] === "smpp") smppCommand("logs");
    else if (args[0] === "wsgs") upstreamCommand("logs");
    else
      run("bash", [path.join(baseRoot(), "deploy"), "logs"], {
        env: { ...process.env, ANALYSIS_DEV_ENV_FILE: path.join(upstreamRoot, "upstream.env") },
      });
  } else if (command === "smoke") smoke();
  else if (command === "down") {
    smppCommand("down");
    upstreamCommand("down");
  }
}

try {
  main();
} catch (error) {
  console.error("[joint] " + error.message);
  process.exitCode = 1;
}

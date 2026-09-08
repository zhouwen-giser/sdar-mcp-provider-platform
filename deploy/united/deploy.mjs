import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parseEnv } from "node:util";
const root = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "UNION.json")));
const [action = "status", ...args] = process.argv.slice(2);
if (!["verify", "build-images", "up", "status", "logs"].includes(action))
  throw Error(
    "Usage: node deploy.mjs verify|build-images|up|status|logs [--prebuilt] [--base-root DIRECTORY]",
  );
let baseRoot = "/mnt/data/gowm-analysis-current",
  prebuilt = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--prebuilt") prebuilt = true;
  else if (args[i] === "--base-root" && args[i + 1]) baseRoot = args[++i];
  else throw Error("Invalid argument");
}
const sha = (b) => createHash("sha256").update(b).digest("hex");
for (const line of fs.readFileSync(path.join(root, "SHA256SUMS"), "utf8").trim().split("\n")) {
  const match = /^([a-f0-9]{64}) {2}(.+)$/.exec(line);
  if (!match || match[2].includes("..") || path.isAbsolute(match[2]))
    throw Error("INVALID_INVENTORY");
  if (sha(fs.readFileSync(path.join(root, match[2]))) !== match[1])
    throw Error("PACKAGE_HASH_MISMATCH:" + match[2]);
}
const state = path.join(root, ".runtime");
fs.mkdirSync(state, { recursive: true, mode: 0o700 });
function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { cwd: root, stdio: "inherit", ...opts });
  if (r.status !== 0) throw Error("COMMAND_FAILED:" + cmd);
  return r.stdout;
}
const smpp = path.join(root, "smpp");
if (!fs.existsSync(smpp))
  run("python3", [path.join(root, "extract.py"), path.join(root, "upstream/smpp.tar.gz"), smpp]);
const server = path.join(smpp, "deploy/development/server");
if (action === "verify") {
  console.log("UNION_ARCHIVE_PASS");
  process.exit(0);
}
if (action === "build-images") {
  for (const [side, target] of [
    ["runtime", "ugv-real-runtime"],
    ["adapter", "ugv-real-adapter"],
  ])
    run("docker", [
      "build",
      "--build-arg",
      "VCS_REF=" + manifest.smpp.revision,
      "--target",
      target,
      "-t",
      `smpp-gowm/${side}:${manifest.smpp.revision}`,
      smpp,
    ]);
  process.exit(0);
}
baseRoot = fs.realpathSync(baseRoot);
if (
  sha(fs.readFileSync(path.join(baseRoot, "deployment/SOURCE.json"))) !== manifest.baseSourceSha256
)
  throw Error(
    "BASE_PACKAGE_MISMATCH: deploy the pinned upstream union with its own reviewed data-preserving procedure first",
  );
const owner = JSON.parse(fs.readFileSync(path.join(baseRoot, ".runtime/owner.json")));
const containers = JSON.parse(
  run(
    "docker",
    [
      "inspect",
      ...run(
        "docker",
        ["ps", "-q", "--filter", "label=com.docker.compose.project=" + owner.project],
        { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
      )
        .trim()
        .split(/\s+/),
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ),
);
const db = containers.find((c) => c.Config.Labels["com.docker.compose.service"] === "postgres");
const app = containers.find(
  (c) => c.Config.Labels["com.docker.compose.service"] === "ugv-mqtt-ingest",
);
if (!db || !app) throw Error("UPSTREAM_NOT_READY");
const databaseId = run(
  "docker",
  [
    "exec",
    db.Id,
    "psql",
    "-U",
    "gowm",
    "-d",
    "gowm",
    "-At",
    "-c",
    "SELECT system_identifier::text FROM pg_control_system()",
  ],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
).trim();
if (databaseId !== owner.databaseId) throw Error("DATABASE_IDENTITY_MISMATCH");
const configs = [];
function find(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) find(p);
    else if (f.isFile() && f.name === "business-connections.env") configs.push(p);
  }
}
find(path.join(baseRoot, ".runtime"));
if (configs.length !== 1) throw Error("BUSINESS_CONNECTION_FILE_AMBIGUOUS");
const credentials = parseEnv(fs.readFileSync(configs[0], "utf8"));
const url = new URL(credentials.SMPP_DATABASE_URL);
if (
  url.username !== "ugv_smpp_app" ||
  url.pathname !== "/gowm" ||
  url.hostname !== "postgres" ||
  !url.password
)
  throw Error("GOWM_BUSINESS_CREDENTIAL_MISMATCH");
const config = path.join(server, "config");
fs.mkdirSync(config, { recursive: true, mode: 0o755 });
const secret = path.join(config, "gowm.url");
if (fs.existsSync(secret) && fs.readFileSync(secret, "utf8").trim() !== url.href)
  throw Error("EXISTING_SMPP_SECRET_DIFFERS_NO_ROTATION");
if (!fs.existsSync(secret)) fs.writeFileSync(secret, url.href + "\n", { mode: 0o600, flag: "wx" });
run("chown", ["1000:1000", secret]);
const site = JSON.parse(fs.readFileSync(path.join(server, "gowm-site.json")));
site.applicationContainer = app.Name.slice(1);
site.databaseContainer = db.Name.slice(1);
site.network = owner.project + "_default";
site.loginRole = "ugv_smpp_app";
fs.writeFileSync(path.join(server, "gowm-site.json"), JSON.stringify(site, null, 2) + "\n");
const envFile = path.join(server, ".env");
if (!fs.existsSync(envFile)) fs.copyFileSync(path.join(server, ".env.gowm.example"), envFile);
let env = fs.readFileSync(envFile, "utf8");
for (const [k, v] of Object.entries({
  GOWM_EXTERNAL_NETWORK: site.network,
  DEPLOY_BUILD_IMAGES: prebuilt ? "false" : "true",
})) {
  const line = k + "=" + JSON.stringify(v);
  env = new RegExp("^" + k + "=.*$", "m").test(env)
    ? env.replace(new RegExp("^" + k + "=.*$", "m"), line)
    : env + "\n" + line + "\n";
}
fs.writeFileSync(envFile, env, { mode: 0o600 });
fs.chmodSync(envFile, 0o600);
if (action === "up") {
  const lock = path.join(state, "up.lock");
  const fd = fs.openSync(lock, "wx", 0o600);
  fs.writeSync(fd, String(process.pid));
  try {
    fs.writeFileSync(
      path.join(state, "before.json"),
      JSON.stringify(
        containers.map((c) => ({ id: c.Id, name: c.Name, startedAt: c.State.StartedAt })),
        null,
        2,
      ),
    );
    const backup = path.join(state, "before-smpp.dump");
    if (!fs.existsSync(backup)) {
      const out = fs.openSync(backup, "wx", 0o600);
      try {
        run("docker", ["exec", db.Id, "pg_dump", "-U", "gowm", "-d", "gowm", "-Fc"], {
          stdio: ["ignore", out, "inherit"],
        });
      } finally {
        fs.closeSync(out);
      }
    }
    run("node", [path.join(server, "prepare-gowm.mjs"), "--apply"]);
    run("bash", [path.join(server, "deploy.sh"), "up"]);
    const after = JSON.parse(
      run("docker", ["inspect", ...containers.map((c) => c.Id)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      }),
    );
    if (after.some((c, i) => c.State.StartedAt !== containers[i].State.StartedAt))
      throw Error("UPSTREAM_CONTAINER_CHANGED_DURING_DEPLOYMENT");
    fs.writeFileSync(
      path.join(state, "deployment.json"),
      JSON.stringify(
        {
          status: "PASS",
          deployedAt: new Date().toISOString(),
          baseRoot,
          baseSha256: manifest.base.sha256,
          gowmSha256: manifest.gowm.sha256,
          smppRevision: manifest.smpp.revision,
          databaseId,
          account: url.username,
          upstreamContainersPreserved: after.length,
          credentialSource: configs[0],
        },
        null,
        2,
      ),
    );
    console.log("UNITED_DEPLOYMENT_READY");
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
} else run("bash", [path.join(server, "deploy.sh"), action]);

import { validateEdgeSubnet } from "./network-policy.mjs";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomBytes, scryptSync, createHash } from "node:crypto";
import { networkInterfaces, hostname, homedir } from "node:os";
const docker = (args, input) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    ...(input === undefined ? {} : { input }),
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
const runtime =
  process.env.UGV_CONSOLE_RUNTIME_CONTAINER ?? "gowm-analysis-dev-f3dc6f4b8e-smpp-runtime-1";
const postgres =
  process.env.UGV_CONSOLE_POSTGRES_CONTAINER ?? "gowm-analysis-dev-f3dc6f4b8e-postgres-1";
const image = process.env.UGV_CONSOLE_IMAGE;
if (!image) throw Error("UGV_CONSOLE_IMAGE_REQUIRED");
const stateDir = resolve(
  process.env.UGV_CONSOLE_STATE_DIR ?? join(homedir(), ".smpp-debug", "ugv-control-console"),
);
mkdirSync(stateDir, { recursive: true, mode: 0o700 });
chmodSync(stateDir, 0o700);
const inspect = (name) => JSON.parse(docker(["inspect", name]))[0];
const r = inspect(runtime),
  p = inspect(postgres);
const network = Object.keys(r.NetworkSettings.Networks).find(
  (name) => name in p.NetworkSettings.Networks,
);
if (!network) throw Error("RUNTIME_DATABASE_SHARED_NETWORK_REQUIRED");
const edgeSubnet = process.env.UGV_CONSOLE_EDGE_SUBNET ?? "10.252.244.0/24";
const edgeName = "smpp-ugv-console_edge";
const networkIds = docker(["network", "ls", "-q"]).split(/\s+/).filter(Boolean);
const networks = networkIds.length ? JSON.parse(docker(["network", "inspect", ...networkIds])) : [];
const previousEdge = networks.find((n) => n.Name === edgeName);
const ignoredBridge = previousEdge ? `br-${previousEdge.Id.slice(0, 12)}` : "";
const allocated = networks
  .filter((n) => n.Name !== edgeName)
  .flatMap((n) => (n.IPAM.Config ?? []).map((c) => c.Subnet).filter(Boolean))
  .filter((c) => !c.includes(":"));
const routes = JSON.parse(
  execFileSync("ip", ["-j", "-4", "route", "show", "table", "main"], { encoding: "utf8" }),
)
  .filter((r) => r.dev !== ignoredBridge)
  .map((r) => r.dst)
  .filter(Boolean);
validateEdgeSubnet(
  edgeSubnet,
  [...allocated, ...routes],
  (process.env.UGV_CONSOLE_PROTECTED_ADDRESSES ?? "192.168.2.63").split(",").filter(Boolean),
);
if (previousEdge && (previousEdge.IPAM.Config ?? []).some((c) => c.Subnet !== edgeSubnet)) {
  if (
    Object.values(previousEdge.Containers ?? {}).some((c) => c.Name !== "smpp-ugv-control-console")
  )
    throw Error("EDGE_NETWORK_HAS_OTHER_OWNERS");
  const previousFile = join(stateDir, "compose.json");
  if (!existsSync(previousFile)) throw Error("PREVIOUS_CONSOLE_COMPOSE_REQUIRED");
  docker(["compose", "-p", "smpp-ugv-console", "-f", previousFile, "down"]);
}
const raw = docker(["exec", runtime, "sh", "-c", 'cat "$GOWM_DATABASE_URL_FILE"']);
const source = new URL(raw),
  database = source.pathname.slice(1);
if (!/^[a-zA-Z0-9_]+$/.test(database)) throw Error("DATABASE_NAME_INVALID");
const credentialsFile = join(stateDir, "credentials.json"),
  dbFile = join(stateDir, "database-url"),
  dbPasswordFile = join(stateDir, "database-password");
if (!existsSync(credentialsFile)) {
  const username = process.env.UGV_CONSOLE_OPERATOR ?? "operator",
    password = process.env.UGV_CONSOLE_INITIAL_PASSWORD ?? randomBytes(18).toString("base64url"),
    salt = randomBytes(24).toString("hex");
  if (password.length < 12) throw Error("PASSWORD_MINIMUM_12_CHARACTERS");
  writeFileSync(
    credentialsFile,
    JSON.stringify({
      username,
      salt,
      passwordHash: scryptSync(password, salt, 64).toString("hex"),
      sessionSecret: randomBytes(48).toString("hex"),
    }),
    { mode: 0o600 },
  );
  writeFileSync(
    join(stateDir, "operator-login.txt"),
    `账号: ${username}\n初始密码: ${password}\n`,
    { mode: 0o600 },
  );
}
const psql = (sql) =>
  docker(
    [
      "exec",
      "-i",
      postgres,
      "sh",
      "-c",
      'exec psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d "$1"',
      "sh",
      database,
    ],
    sql,
  );
if (!existsSync(dbPasswordFile)) {
  const found = psql("SELECT count(*) FROM pg_roles WHERE rolname='ugv_console_operator';");
  if (!/\b0\b/.test(found)) throw Error("CONSOLE_DATABASE_ROLE_EXISTS_WITHOUT_LOCAL_SECRET");
  const password = randomBytes(32).toString("hex");
  psql(
    `CREATE ROLE ugv_console_operator LOGIN PASSWORD '${password}';\nGRANT CONNECT ON DATABASE "${database}" TO ugv_console_operator;\nCREATE SCHEMA ugv_control_console AUTHORIZATION ugv_console_operator;\n`,
  );
  writeFileSync(dbPasswordFile, password, { mode: 0o600 });
}
const dbPassword = readFileSync(dbPasswordFile, "utf8").trim();
const dbUrl = new URL(
  `postgresql://ugv_console_operator:${dbPassword}@${postgres}:5432/${database}`,
);
writeFileSync(dbFile, dbUrl.toString(), { mode: 0o600 });
const addresses = Object.entries(networkInterfaces())
  .filter(([name]) => !/^(lo|docker|br-|veth|Cord)/.test(name))
  .flatMap(([, values]) =>
    (values ?? []).filter((v) => v.family === "IPv4" && !v.internal).map((v) => v.address),
  );
const hosts = [
  ...new Set([
    "localhost",
    "127.0.0.1",
    hostname(),
    ...addresses,
    ...(process.env.UGV_CONSOLE_PUBLIC_HOSTS ?? "").split(",").filter(Boolean),
  ]),
];
if (hosts.some((value) => !/^([a-zA-Z0-9_.-]+)$/.test(value))) throw Error("PUBLIC_HOST_INVALID");
const keyFile = process.env.UGV_CONSOLE_TLS_KEY_FILE ?? join(stateDir, "tls.key"),
  certFile = process.env.UGV_CONSOLE_TLS_CERT_FILE ?? join(stateDir, "tls.crt");
if (!existsSync(keyFile) || !existsSync(certFile)) {
  if (process.env.UGV_CONSOLE_TLS_KEY_FILE || process.env.UGV_CONSOLE_TLS_CERT_FILE)
    throw Error("CONFIGURED_TLS_FILES_REQUIRED");
  const san = hosts
    .map((value) => (/^\d+\.\d+\.\d+\.\d+$/.test(value) ? `IP:${value}` : `DNS:${value}`))
    .join(",");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:3072",
      "-sha256",
      "-days",
      "365",
      "-nodes",
      "-subj",
      "/CN=UGV Control Console",
      "-addext",
      `subjectAltName=${san}`,
      "-keyout",
      keyFile,
      "-out",
      certFile,
    ],
    { stdio: "ignore" },
  );
  chmodSync(keyFile, 0o600);
  chmodSync(certFile, 0o644);
}
const upstreamAuthFile = process.env.UGV_CONSOLE_UPSTREAM_AUTHORIZATION_FILE;
const compose = {
  services: {
    console: {
      image,
      container_name: "smpp-ugv-control-console",
      init: true,
      restart: "unless-stopped",
      read_only: true,
      cap_drop: ["ALL"],
      security_opt: ["no-new-privileges:true"],
      tmpfs: ["/tmp:rw,noexec,nosuid,size=16m"],
      ports: ["0.0.0.0:19101:19101"],
      environment: {
        UGV_CONSOLE_HOST: "0.0.0.0",
        UGV_CONSOLE_PORT: "19101",
        UGV_CONSOLE_MCP_URL: `http://${runtime}:8080/mcp`,
        UGV_CONSOLE_ORIGINS: hosts.map((h) => `https://${h}:19101`).join(","),
        UGV_CONSOLE_CREDENTIALS_FILE: "/run/secrets/credentials.json",
        UGV_CONSOLE_DATABASE_URL_FILE: "/run/secrets/database-url",
        UGV_CONSOLE_TLS_KEY_FILE: "/run/secrets/tls.key",
        UGV_CONSOLE_TLS_CERT_FILE: "/run/secrets/tls.crt",
        ...(upstreamAuthFile
          ? { UGV_CONSOLE_UPSTREAM_AUTHORIZATION_FILE: "/run/secrets/upstream-auth" }
          : {}),
      },
      volumes: [
        `${credentialsFile}:/run/secrets/credentials.json:ro`,
        `${dbFile}:/run/secrets/database-url:ro`,
        `${keyFile}:/run/secrets/tls.key:ro`,
        `${certFile}:/run/secrets/tls.crt:ro`,
        ...(upstreamAuthFile ? [`${resolve(upstreamAuthFile)}:/run/secrets/upstream-auth:ro`] : []),
      ],
      networks: ["edge", "station"],
    },
  },
  networks: {
    station: { external: true, name: network },
    edge: { driver: "bridge", ipam: { config: [{ subnet: edgeSubnet }] } },
  },
};
const composeFile = join(stateDir, "compose.json");
if (existsSync(composeFile)) {
  const previous = JSON.parse(readFileSync(composeFile, "utf8"));
  if (previous.services.console.image !== image)
    writeFileSync(
      join(stateDir, "previous-compose.json"),
      JSON.stringify(previous, null, 2) + "\n",
      { mode: 0o600 },
    );
}
writeFileSync(composeFile, JSON.stringify(compose, null, 2) + "\n", { mode: 0o600 });
console.log(
  docker(["compose", "-p", "smpp-ugv-console", "-f", composeFile, "up", "-d", "--no-build"]),
);
const receipt = {
  image,
  runtime,
  postgres,
  network,
  composeFile,
  urls: hosts.map((h) => `https://${h}:19101`),
  loginFile: join(stateDir, "operator-login.txt"),
  certificate: certFile,
  certificateSha256: createHash("sha256").update(readFileSync(certFile)).digest("hex"),
};
writeFileSync(join(stateDir, "deployment.json"), JSON.stringify(receipt, null, 2) + "\n", {
  mode: 0o600,
});
console.log(JSON.stringify(receipt));

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const dir = dirname(fileURLToPath(import.meta.url));
const apply = process.argv.includes("--apply");
if (process.argv.includes("--help")) {
  console.log(
    "On sz-gowm: node prepare-gowm.mjs [--apply]. Default: read-only preflight. --apply: GOWM SMPP installer + scoped login/grants + existing device binding; no application startup or old database deletion.",
  );
  process.exit(0);
}
if (process.argv.slice(2).some((x) => x !== "--apply")) throw Error("INVALID_ARGUMENT");
const site = JSON.parse(readFileSync(resolve(dir, "gowm-site.json"), "utf8"));
const inspect = spawnSync(
  "docker",
  ["inspect", site.applicationContainer, site.databaseContainer],
  { encoding: "utf8" },
);
if (inspect.status !== 0) throw Error("GOWM_CONTAINERS_UNAVAILABLE");
for (const c of JSON.parse(inspect.stdout))
  if (!c.State.Running || !c.NetworkSettings.Networks[site.network])
    throw Error("GOWM_NETWORK_MISMATCH");
const config = resolve(dir, "config");
const secret = resolve(config, "gowm.url");
const credentialExists = existsSync(secret);
const connection = new URL(
  credentialExists
    ? readFileSync(secret, "utf8").trim()
    : `postgresql://${site.loginRole}@${site.databaseHost}:${site.databasePort}/${site.database}`,
);
if (
  connection.username !== site.loginRole ||
  connection.hostname !== site.databaseHost ||
  connection.pathname !== `/${site.database}` ||
  Number(connection.port) !== site.databasePort
)
  throw Error("GOWM_SECRET_IDENTITY_MISMATCH");
if (!credentialExists)
  throw Error(
    "GOWM_MANAGED_CONNECTION_FILE_REQUIRED: import SMPP_DATABASE_URL from the GOWM business-connections.env",
  );
if (!connection.password) throw Error("GOWM_PASSWORD_REQUIRED");
const contract = JSON.parse(
  readFileSync(resolve(dir, "../../../contracts/gowm-shared-storage/current/source.json"), "utf8"),
);
const input = {
  site,
  contract,
  password: decodeURIComponent(connection.password),
  credentialExists,
  apply,
};
// Persist before creating the role so interrupted initialization can reuse the same credential.
if (apply) {
  mkdirSync(config, { recursive: true, mode: 0o755 });
  chmodSync(config, 0o755);
  if (!credentialExists) writeFileSync(secret, connection.href + "\n", { flag: "wx", mode: 0o600 });
}
const script =
  "const deploymentInput=" +
  JSON.stringify(input) +
  ";\n" +
  readFileSync(resolve(dir, "gowm-bootstrap.mjs"), "utf8");
const result = spawnSync(
  "docker",
  ["exec", "-i", "-w", "/app", site.applicationContainer, "node", "--input-type=module"],
  { input: script, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
);
if (result.status !== 0) {
  console.error(result.stderr);
  throw Error("GOWM_PREPARE_FAILED: local credential retained for retry");
}
const output = JSON.parse(result.stdout.trim().split("\n").at(-1));
if (apply) {
  // Mount only this file read-only for UID 1000; never make its contents world-readable.
  const owner = spawnSync("chown", ["1000:1000", secret], { encoding: "utf8" });
  if (owner.status !== 0 && process.getuid?.() !== 1000)
    throw Error("Run prepare with sudo to assign secret to container UID 1000");
  writeFileSync(resolve(config, "gowm-binding.json"), JSON.stringify(output, null, 2) + "\n", {
    mode: 0o644,
  });
}
console.log(
  JSON.stringify({
    status: apply ? "PREPARED" : "PREFLIGHT_PASS",
    deviceId: site.deviceId,
    role: site.loginRole,
    schema: "ugv_smpp",
    ...(apply
      ? { bindingId: output.bindingId }
      : { schemaInstalled: output.schemaInstalled, roleExists: output.roleExists }),
  }),
);

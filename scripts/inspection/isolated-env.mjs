import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [action, ...args] = process.argv.slice(2);
const file = process.env.SMPP_INSPECTION_TEST_CONFIG_FILE;
const owner = "inspection-area-v1";
if (!file) throw Error("INSPECTION_TEST_CONFIG_REQUIRED");
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8" }).trim();
if (action === "create") {
  const root = file.slice(0, file.lastIndexOf("/"));
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const suffix = randomBytes(6).toString("hex"),
    password = randomBytes(24).toString("hex");
  const env = join(root, "postgres.env"),
    conf = join(root, "mosquitto.conf");
  writeFileSync(
    env,
    `POSTGRES_DB=inspection_test\nPOSTGRES_USER=inspection_test\nPOSTGRES_PASSWORD=${password}\n`,
    { mode: 0o600 },
  );
  writeFileSync(conf, "listener 1883 0.0.0.0\nallow_anonymous true\npersistence false\n", {
    mode: 0o600,
  });
  const containers = [];
  try {
    const postgres = docker(
      "run",
      "-d",
      "--name",
      `inspection-pg-${suffix}`,
      "--label",
      `codex.owner=${owner}`,
      "--env-file",
      env,
      "-p",
      "127.0.0.1::5432",
      process.env.SMPP_INSPECTION_TEST_POSTGRES_IMAGE ??
        "sdar/postgres-pgvector:17.10-0.8.5-alpine3.23",
    );
    containers.push(postgres);
    const broker = docker(
      "run",
      "-d",
      "--name",
      `inspection-mqtt-${suffix}`,
      "--label",
      `codex.owner=${owner}`,
      "-p",
      "127.0.0.1::1883",
      "--mount",
      `type=bind,source=${conf},target=/mosquitto/config/mosquitto.conf,readonly`,
      "eclipse-mosquitto:2.1.2-alpine",
    );
    containers.push(broker);
    const inspect = (id) => JSON.parse(docker("inspect", id))[0];
    const pgPort = inspect(postgres).NetworkSettings.Ports["5432/tcp"][0].HostPort;
    const mqttPort = inspect(broker).NetworkSettings.Ports["1883/tcp"][0].HostPort;
    writeFileSync(
      file,
      JSON.stringify(
        {
          owner,
          containers,
          postgres,
          broker,
          databaseUrl: `postgresql://inspection_test:${password}@127.0.0.1:${pgPort}/inspection_test`,
          brokerUrl: `mqtt://127.0.0.1:${mqttPort}`,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    chmodSync(file, 0o600);
    console.log(
      JSON.stringify({
        status: "created",
        owner,
        containers,
        pgPort,
        mqttPort,
        configurationFile: file,
      }),
    );
  } catch (error) {
    for (const id of containers) docker("rm", "-f", id);
    throw error;
  }
} else {
  const config = JSON.parse(readFileSync(file, "utf8"));
  for (const id of config.containers) {
    const actual = JSON.parse(docker("inspect", id))[0];
    if (actual.Config.Labels["codex.owner"] !== owner)
      throw Error("TASK_OWNED_INFRASTRUCTURE_REQUIRED");
  }
  const db = new URL(config.databaseUrl);
  if (
    db.hostname !== "127.0.0.1" ||
    db.pathname !== "/inspection_test" ||
    !config.brokerUrl.startsWith("mqtt://127.0.0.1:")
  )
    throw Error("LOOPBACK_TEST_INFRASTRUCTURE_REQUIRED");
  if (action === "remove") {
    for (const id of config.containers) docker("rm", "-f", id);
    console.log(JSON.stringify({ status: "removed", owner, containers: config.containers }));
  } else if (action === "exec") {
    const [command, ...commandArgs] = args;
    if (!command) throw Error("ISOLATED_COMMAND_REQUIRED");
    const child = spawn(command, commandArgs, {
      stdio: "inherit",
      env: {
        ...process.env,
        TEST_DATABASE_URL: config.databaseUrl,
        SMPP_GOWM_BUSINESS_TEMPLATE_TEST_URL: config.databaseUrl,
        SMPP_GOWM_BUSINESS_TEMPLATE_TEST_ENABLE: "true",
        SMPP_GOWM_BUSINESS_DEPLOY_TEST_URL: config.databaseUrl,
      },
    });
    child.on("error", () => {
      process.exitCode = 1;
    });
    child.on("exit", (code, signal) => {
      process.exitCode = signal ? 1 : (code ?? 1);
    });
  } else throw Error("ISOLATED_ACTION_INVALID");
}

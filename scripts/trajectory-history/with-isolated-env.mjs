import { readFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
const [command, ...args] = process.argv.slice(2);
const file = process.env.SMPP_TRAJECTORY_TEST_CONFIG_FILE;
if (!command || !file) throw Error("ISOLATED_TRAJECTORY_CONFIG_AND_COMMAND_REQUIRED");
const config = JSON.parse(readFileSync(file, "utf8"));
const database = new URL(config.databaseUrl);
const inspected = JSON.parse(
  execFileSync("docker", ["inspect", config.containerId], { encoding: "utf8" }),
)[0];
if (
  database.hostname !== "127.0.0.1" ||
  !database.pathname.includes("test") ||
  inspected.Config.Labels["codex.owner"] !== "trajectory-history-authority" ||
  !inspected.NetworkSettings.Ports["5432/tcp"].some(
    (port) => port.HostPort === database.port && port.HostIp === "127.0.0.1",
  )
)
  throw Error("TASK_OWNED_LOOPBACK_DATABASE_REQUIRED");
const env = {
  ...process.env,
  TEST_DATABASE_URL: config.databaseUrl,
  SMPP_GOWM_BUSINESS_TEMPLATE_TEST_URL: config.databaseUrl,
  SMPP_GOWM_BUSINESS_TEMPLATE_TEST_ENABLE: "true",
  SMPP_GOWM_BUSINESS_DEPLOY_TEST_URL: config.databaseUrl,
};
const child = spawn(command, args, { env, stdio: "inherit" });
child.on("error", () => {
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});

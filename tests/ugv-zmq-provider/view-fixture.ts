import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import type { ViewBackendSettings } from "../../packages/vehicle-zmq-control/src/simulation-view-contract.js";
export async function viewFixture() {
  const root = await mkdtemp(join(tmpdir(), "smpp-view-isolated-"));
  const tokenFile = join(root, "token");
  await writeFile(tokenFile, "SIMULATED-view-" + randomUUID(), { mode: 0o600 });
  const config = {
    resourceId: "vehicle:SIMULATED",
    viewId: "isolated-view",
    ownershipId: randomUUID(),
    apiVersion: "isolated-api",
    worldId: "7",
    parentActorId: 1,
    parentRoleName: "isolated-vehicle",
    carlaHost: "127.0.0.1",
    carlaPort: 2000,
    stateDir: join(root, "state"),
    tokenFile,
    port: 19107,
    transform: { x: 0, y: 0, z: 1.5, pitch: 0, yaw: 0, roll: 0 },
    width: 128,
    height: 72,
    minFovDeg: 5,
    maxFovDeg: 160,
  };
  await writeFile(join(root, "config.json"), JSON.stringify(config));
  const child = spawn(
    "python3",
    [resolve("tests/simulation-view/http_fixture.py"), "--root", root],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
  );
  let error = "";
  child.stderr.on("data", (chunk: Buffer) => {
    error = (error + chunk.toString()).slice(-4000);
  });
  const lines = createInterface({ input: child.stdout });
  const first = await Promise.race([
    once(lines, "line").then(([line]) => String(line)),
    once(child, "exit").then(() => {
      throw Error("SIMULATED_VIEW_START_FAILED:" + error);
    }),
  ]);
  lines.close();
  const port = (JSON.parse(first) as { port: number }).port;
  const settings: ViewBackendSettings = {
    endpoint: `http://127.0.0.1:${port}/`,
    tokenFile,
    viewId: config.viewId,
    ownershipId: config.ownershipId,
    apiVersion: config.apiVersion,
    worldId: "7",
    parentActorId: 1,
    parentRoleName: config.parentRoleName,
    minFovDeg: 5,
    maxFovDeg: 160,
    exchangeTimeoutMs: 1000,
  };
  return {
    settings,
    root,
    configure: async (value: Record<string, unknown>) =>
      writeFile(join(root, "control.json"), JSON.stringify(value)),
    count: async () => {
      try {
        return (JSON.parse(await readFile(join(root, "counts.json"), "utf8")) as { spawns: number })
          .spawns;
      } catch {
        return 0;
      }
    },
    close: async () => {
      const exit = once(child, "exit");
      child.kill("SIGTERM");
      await exit;
      await rm(root, { recursive: true, force: true });
    },
  };
}

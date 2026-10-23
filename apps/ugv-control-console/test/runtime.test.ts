import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect, describe } from "vitest";
import { Pool } from "pg";
import { testDb } from "./fixture.js";
import { Store } from "../server/store.js";
import { Service } from "../server/service.js";
import { Mcp } from "../server/mcp.js";
import { array, record, text, classifyTask, type Command } from "../shared/model.js";
let child: ChildProcess,
  service: Service,
  pool: Pool,
  store: Store,
  failure = "";
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
async function fixture(action: string, mode?: string) {
  const id = randomUUID();
  const response = new Promise<unknown>((resolve, reject) => pending.set(id, { resolve, reject }));
  child.send?.({ id, action, mode });
  return response;
}
async function until(test: () => Promise<boolean>) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await test()) return;
    await new Promise((r) => setTimeout(r, 80));
  }
  throw Error("REAL_RUNTIME_WAIT_TIMEOUT: " + failure.slice(-1000));
}
beforeAll(async () => {
  child = spawn(process.execPath, ["--import", "tsx", "scripts/inspection/provider-harness.ts"], {
    cwd: resolve(import.meta.dirname, "../../.."),
    env: process.env,
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  child.stderr?.on("data", (b) => {
    failure += String(b);
  });
  const endpoint = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("FIXTURE_READY_TIMEOUT: " + failure.slice(-2000))),
      40000,
    );
    child.once("exit", () => {
      clearTimeout(timer);
      reject(Error("FIXTURE_EXIT: " + failure.slice(-2000)));
    });
    child.on("message", (value) => {
      const data = record(value);
      if (data.kind === "ready") {
        clearTimeout(timer);
        resolve(text(data.endpoint));
      }
      if (data.id) {
        const waiter = pending.get(text(data.id));
        if (waiter) {
          pending.delete(text(data.id));
          if (data.error) waiter.reject(Error(text(data.error)));
          else waiter.resolve(data.result);
        }
      }
    });
  });
  pool = new Pool({ connectionString: testDb(), max: 4 });
  store = new Store(pool, randomUUID());
  await store.migrate();
  service = new Service(
    new Mcp(endpoint, {
      "x-sdar-execution-mode": "simulation",
      "x-sdar-simulation-id": "inspection-public-isolated",
    }),
    store,
    "operator",
  );
}, 50000);
afterAll(async () => {
  if (child?.connected) await fixture("close");
  else child?.kill("SIGTERM");
  if (pool) {
    for (const table of ["audit", "command", "task", "session"])
      await pool.query(`DELETE FROM ugv_control_console.${table} WHERE domain=$1`, [store.domain]);
    await pool.end();
  }
}, 30000);
const region = {
  resourceId: "vehicle:ugv1",
  area: {
    boundary: [
      { x: 116, y: 39 },
      { x: 117, y: 39 },
      { x: 117, y: 40 },
      { x: 116, y: 40 },
    ],
  },
};
async function start(tool = "vehicle_inspect_area", args = region) {
  const catalog = await service.catalog();
  const request: Command = {
    commandId: randomUUID(),
    kind: "tool",
    tool,
    arguments: args,
    catalogHash: catalog.catalogHash,
    timing: { start: { mode: "immediate", startToleranceMs: 30000 }, maxElapsedMs: 300000 },
  };
  const command = await service.execute(request);
  expect(command, JSON.stringify(command)).toMatchObject({ status: "accepted" });
  const taskId = command?.taskId;
  if (!taskId) throw Error("TASK_ID_REQUIRED");
  await until(async () => array(await fixture("probe")).some((v) => !!record(v).missionId));
  return taskId;
}
describe("console → formal MCP Runtime → gRPC adapter → PostgreSQL + isolated MQTT/device MCP", () => {
  it.each(["full", "findings", "missing", "partial", "failed"])(
    "retains %s inspection evidence and report identity",
    async (mode) => {
      await fixture("reset");
      const taskId = await start();
      await fixture("observe", mode);
      await until(async () => text((await service.task(taskId)).status) === "completed");
      const task = await service.task(taskId),
        output = record(record(task.result).structuredContent),
        snapshot = await service.business(taskId);
      expect(record(snapshot.context.identity)).toMatchObject({
        taskId,
        operationName: "vehicle_inspect_area",
      });
      expect(snapshot.complete).toBe(true);
      expect(record(output.inspectionReport).completion).toBe(
        mode === "missing"
          ? "unavailable"
          : mode === "partial" || mode === "failed"
            ? "partial"
            : "complete",
      );
      if (mode === "findings") expect(array(output.anomalies)).toHaveLength(1);
      if (mode === "missing" || mode === "partial") expect(classifyTask(task).tone).toBe("warning");
      if (mode === "failed") expect(classifyTask(task).tone).toBe("error");
      const artifacts = snapshot.objects.filter((v) => v.kind === "artifact");
      expect(artifacts.length).toBeGreaterThan(0);
      for (const object of artifacts) {
        const v = record(object.value);
        expect(
          (await service.artifact(taskId, text(v.artifactId), Number(v.revision))).artifact,
        ).toMatchObject({ artifactId: v.artifactId, revision: v.revision });
      }
    },
    30000,
  );
  it("preserves the original cancellation Task until the device confirms cancellation", async () => {
    await fixture("reset");
    const taskId = await start();
    await fixture("control_observation", "running");
    await until(async () =>
      array(await fixture("probe")).some((v) => record(v).state === "RUNNING"),
    );
    await until(async () => {
      const task = await service.task(taskId);
      const p = record(record(task._meta)["io.sdar/taskExecution"]);
      failure = JSON.stringify({
        stage: "before_cancel",
        taskStatus: task.status,
        substate: p.substate,
        probe: await fixture("probe"),
      });
      return p.substate === "running";
    });
    const c = await service.catalog();
    const result = await service.execute({
      commandId: randomUUID(),
      kind: "cancel",
      taskId,
      arguments: {},
      catalogHash: c.catalogHash,
    });
    expect(result?.status).toBe("accepted");
    await until(async () =>
      (async () => {
        const probe = await fixture("probe");
        failure = JSON.stringify({
          stage: "after_cancel",
          probe,
          task: await service.task(taskId),
        });
        return array(probe).some((v) => record(v).state === "STOPPING");
      })(),
    );
    await fixture("control_observation", "cancelled");
    await until(async () => text((await service.task(taskId)).status) === "cancelled");
    expect((await store.task(taskId))?.taskId).toBe(taskId);
  }, 30000);
});

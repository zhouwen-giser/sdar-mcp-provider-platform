import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
let child: ChildProcess, endpoint: string;
let failure = "";
const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
async function fixture(action: string, mode?: string) {
  const id = randomUUID();
  const result = new Promise<unknown>((resolve, reject) => pending.set(id, { resolve, reject }));
  child.send({ id, action, mode });
  return result;
}
beforeAll(async () => {
  child = spawn(process.execPath, ["--import", "tsx", "scripts/inspection/provider-harness.ts"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  child.stderr?.on("data", (b) => {
    failure += String(b);
  });
  endpoint = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("FIXTURE_READY_TIMEOUT: " + failure)), 30000);
    child.once("exit", () => {
      clearTimeout(timer);
      reject(Error("FIXTURE_EXIT: " + failure));
    });
    child.on("message", (value) => {
      const data = value as {
        kind?: string;
        endpoint?: string;
        id?: string;
        error?: string;
        result?: unknown;
      };
      if (data.kind === "ready" && data.endpoint) {
        clearTimeout(timer);
        resolve(data.endpoint);
      }
      if (data.id) {
        const waiter = pending.get(data.id);
        if (waiter) {
          pending.delete(data.id);
          if (data.error) waiter.reject(Error(data.error));
          else waiter.resolve(data.result);
        }
      }
    });
  });
}, 40000);
afterAll(async () => {
  if (child?.connected) await fixture("close");
  else child?.kill("SIGTERM");
});
async function rpc(
  method: string,
  params: Record<string, unknown>,
  name?: string,
  expectedStatus = 200,
) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...(name ? { "mcp-name": name } : {}),
      "x-sdar-execution-mode": "simulation",
      "x-sdar-simulation-id": "inspection-public-isolated",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "inspection-public-test", version: "1.0" },
          "io.modelcontextprotocol/clientCapabilities": {
            extensions: {
              "io.modelcontextprotocol/tasks": {},
              "io.sdar/taskBusiness": { profileVersion: "1.0-rc2" },
            },
          },
          ...((params._meta as Record<string, unknown>) ?? {}),
        },
      },
    }),
  });
  const body = await response.text();
  expect(response.status, body).toBe(expectedStatus);
  return JSON.parse(body) as { result?: Record<string, unknown>; error?: unknown };
}
async function until(test: () => Promise<boolean>) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (await test()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("INSPECTION_PUBLIC_WAIT_TIMEOUT: " + failure);
}
const input = {
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
describe("ISOLATED formal MCP Task -> gRPC -> PostgreSQL adapter -> MQTT/device MCP", () => {
  it.each(["full", "findings", "missing", "partial"])(
    "retains honest %s inspection results and exact task identity",
    async (mode) => {
      await fixture("reset");
      const call = await rpc(
        "tools/call",
        {
          name: "vehicle_inspect_area",
          arguments: input,
          _meta: {
            "io.sdar/taskExecution": {
              profileVersion: "1.0",
              idempotencyKey: randomUUID(),
              timing: {
                start: { mode: "immediate", startToleranceMs: 30000 },
                maxElapsedMs: 300000,
              },
            },
          },
        },
        "vehicle_inspect_area",
      );
      expect(call.error).toBeUndefined();
      expect(call.result?.resultType).toBe("task");
      const taskId = String(call.result?.taskId);
      await until(async () => {
        const active = await fixture("probe");
        if (!Array.isArray(active) || active.length !== 1) return false;
        const run = active[0] as Record<string, unknown>;
        return (
          ["STARTING", "RUNNING"].includes(String(run.state)) && typeof run.missionId === "string"
        );
      });
      await fixture("observe", mode);
      await until(
        async () => (await rpc("tasks/get", { taskId }, taskId)).result?.status === "completed",
      );
      const output = (await rpc("tasks/get", { taskId }, taskId)).result?.result as Record<
        string,
        unknown
      >;
      expect(output?.structuredContent).toMatchObject({
        resourceId: input.resourceId,
        status: "completed",
        inspectionReport: {
          completion:
            mode === "missing" ? "unavailable" : mode === "partial" ? "partial" : "complete",
        },
      });
      expect(
        (output?._meta as Record<string, { items: { evidenceType: string }[] }>)?.[
          "io.sdar/evidence"
        ]?.items.some((item) => item.evidenceType === "inspection.report"),
      ).toBe(true);
      if (mode === "findings")
        expect((output?.structuredContent as { anomalies: unknown[] }).anomalies).toHaveLength(1);
      const context = (
        await rpc("io.sdar/taskBusiness/context/get", { taskId, maxPageBytes: 16384 }, taskId)
      ).result;
      expect(context?.snapshot).toMatchObject({
        context: { identity: { taskId, operationName: "vehicle_inspect_area" } },
      });
    },
    30000,
  );
  it("rejects illegal geometry before any physical task starts", async () => {
    await fixture("reset");
    const before = await fixture("probe");
    const result = await rpc(
      "tools/call",
      {
        name: "vehicle_inspect_area",
        arguments: { ...input, area: { ...input.area, frame: "LOCAL" } },
        _meta: { "io.sdar/taskExecution": { profileVersion: "1.0", idempotencyKey: randomUUID() } },
      },
      "vehicle_inspect_area",
      400,
    );
    expect(result.error ?? result.result?.isError).toBeTruthy();
    expect(await fixture("probe")).toEqual(before);
  });
  it("retains a business failure as an error result and finalized Context", async () => {
    await fixture("reset");
    const call = await rpc(
      "tools/call",
      {
        name: "vehicle_inspect_area",
        arguments: input,
        _meta: {
          "io.sdar/taskExecution": {
            profileVersion: "1.0",
            idempotencyKey: randomUUID(),
            timing: { start: { mode: "immediate", startToleranceMs: 1000 }, maxElapsedMs: 300000 },
          },
        },
      },
      "vehicle_inspect_area",
    );
    const taskId = String(call.result?.taskId);
    await until(async () =>
      ((await fixture("probe")) as { missionId?: string }[]).some((e) => Boolean(e.missionId)),
    );
    await fixture("observe", "failed");
    await until(
      async () => (await rpc("tasks/get", { taskId }, taskId)).result?.status === "completed",
    );
    const terminal = (await rpc("tasks/get", { taskId }, taskId)).result;
    expect(terminal?.result).toMatchObject({
      isError: true,
      structuredContent: {
        outcome: "business_failure",
        resourceId: input.resourceId,
        status: "failed",
        anomalies: [],
        inspectionReport: { completion: "partial" },
        missingEvidence: ["INSPECTION_SCAN_NOT_COMPLETED"],
      },
    });
    const context = (
      await rpc("io.sdar/taskBusiness/context/get", { taskId, maxPageBytes: 262144 }, taskId)
    ).result;
    expect(context?.snapshot).toMatchObject({
      context: {
        summary: {
          properties: { inspectionResult: { resourceId: input.resourceId, status: "failed" } },
        },
      },
    });
  }, 30000);
});

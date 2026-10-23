import { beforeAll, afterAll, it, expect, describe } from "vitest";
import { randomUUID } from "node:crypto";
import { makeFixture, password } from "./fixture.js";
import type { Command } from "../shared/model.js";
import { array, record } from "../shared/model.js";
import { Service } from "../server/service.js";
import { createApp } from "../server/app.js";
let f: Awaited<ReturnType<typeof makeFixture>>, cookie: string;
const headers = () => ({ host: "127.0.0.1:0", origin: "http://127.0.0.1:0", cookie });
const command = (tool = "vehicle_navigate"): Command => ({
  commandId: randomUUID(),
  kind: "tool",
  tool,
  arguments: { resourceId: "vehicle:ugv" },
  catalogHash: "fixture-manifest",
  timing: { start: { mode: "immediate", startToleranceMs: 60000 }, maxElapsedMs: 300000 },
});
beforeAll(async () => {
  f = await makeFixture();
  const response = await f.app.inject({
    method: "POST",
    url: "/api/session/login",
    headers: { host: "127.0.0.1:0", origin: "http://127.0.0.1:0" },
    payload: { username: "operator", password },
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers["set-cookie"]).toContain("ugv_session_http=");
  expect(response.headers["set-cookie"]).toContain("HttpOnly; SameSite=Strict");
  expect(response.headers["set-cookie"]).not.toContain("; Secure");
  cookie = String(response.headers["set-cookie"]).split(";")[0];
});
afterAll(async () => f?.close());
describe("durable, authenticated console API with real PostgreSQL", () => {
  it("requires login and guards origin and host before dispatch", async () => {
    expect(
      (await f.app.inject({ method: "GET", url: "/api/device", headers: { host: "127.0.0.1:0" } }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/commands",
          headers: { ...headers(), origin: "https://evil.invalid" },
          payload: command(),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await f.app.inject({
          method: "GET",
          url: "/api/device",
          headers: { ...headers(), host: "evil.invalid" },
        })
      ).statusCode,
    ).toBe(403);
    const d = await f.app.inject({ method: "GET", url: "/api/device", headers: headers() });
    expect(d.statusCode).toBe(200);
    expect(record(d.json()).resourceId).toBe("vehicle:ugv");
  });
  it("shares in-flight status reads across browsers without stale receipt timestamps", async () => {
    const viewer = new Service(f.fake.mcp, f.store, "operator");
    const before = f.fake.requests.filter(
      (r) => r.method === "tools/call" && r.params.name === "vehicle_get_state",
    ).length;
    const results = await Promise.all(Array.from({ length: 5 }, () => viewer.state()));
    expect(results.every((v) => v.receivedAt === results[0].receivedAt)).toBe(true);
    const after = f.fake.requests.filter(
      (r) => r.method === "tools/call" && r.params.name === "vehicle_get_state",
    ).length;
    expect(after - before).toBe(1);
  });
  it("dispatches once across concurrent clients and conflicts on changed content", async () => {
    const request = command(),
      before = f.fake.calls;
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        f.app.inject({
          method: "POST",
          url: "/api/commands",
          headers: headers(),
          payload: request,
        }),
      ),
    );
    expect(results.every((r) => r.statusCode === 202)).toBe(true);
    expect(f.fake.calls - before).toBe(1);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/commands",
          headers: headers(),
          payload: { ...request, arguments: { resourceId: "vehicle:ugv", changed: true } },
        })
      ).statusCode,
    ).toBe(409);
  });
  it("preserves unknown receipts across restart and never automatically replays", async () => {
    const request = command(),
      before = f.fake.calls;
    f.fake.uncertain = true;
    expect((await f.service.execute(request))?.status).toBe("unknown");
    f.fake.uncertain = false;
    const restarted = new Service(f.fake.mcp, f.store, "operator");
    await f.store.recover();
    expect((await restarted.execute(request))?.status).toBe("unknown");
    expect(f.fake.calls - before).toBe(1);
    const pending = command();
    await f.store.reserve(pending);
    await f.store.recover();
    expect((await f.store.command(pending.commandId))?.status).toBe("unknown");
  });
  it("rejects stale availability, unapproved tools and catalog changes without dispatch", async () => {
    const before = f.fake.calls;
    f.fake.unavailable = true;
    const rejected = await f.service.execute(command());
    expect(rejected?.status).toBe("rejected");
    expect(record(rejected?.response).reasonCode).toBe("UGV_STATE_STALE");
    f.fake.unavailable = false;
    expect((await f.service.execute({ ...command(), tool: "vehicle_fire_weapon" }))?.status).toBe(
      "rejected",
    );
    expect((await f.service.execute({ ...command(), catalogHash: "wrong" }))?.status).toBe(
      "rejected",
    );
    expect(f.fake.calls).toBe(before);
    const result = await f.app.inject({
      method: "POST",
      url: "/api/commands",
      headers: headers(),
      payload: { ...command(), mcpUrl: "http://evil.invalid" },
    });
    expect(result.statusCode).toBe(400);
  });
  it("rejects a changed task profile", async () => {
    const tool = f.fake.tools.find((t) => t.name === "vehicle_track_target");
    if (!tool) throw Error("TOOL_MISSING");
    const previous = tool._meta;
    tool._meta = { "io.sdar/taskExecution": { taskBehavior: "synchronous_only" } };
    expect(
      record((await f.service.execute(command("vehicle_track_target")))?.response).reasonCode,
    ).toBe("MCP_TASK_PROFILE_MISMATCH");
    tool._meta = previous;
  });
  it("lets stop proceed while another ordinary command is awaiting upstream", async () => {
    f.fake.delay = 200;
    const slow = f.service.execute(command());
    await new Promise((r) => setTimeout(r, 40));
    const stop = await f.service.execute(command("vehicle_emergency_stop"));
    expect(stop?.status).toBe("accepted");
    await slow;
    f.fake.delay = 0;
  });
  it("pauses/resumes/cancels the original Task and does not replace it", async () => {
    const created = await f.service.execute(command());
    const taskId = created?.taskId;
    if (!taskId) throw Error("TASK_MISSING");
    const before = f.fake.calls;
    for (const kind of ["pause", "resume", "cancel"] as const) {
      const result = await f.service.execute({
        commandId: randomUUID(),
        kind,
        taskId,
        arguments: {},
        catalogHash: "fixture-manifest",
      });
      expect(result?.status).toBe("accepted");
    }
    expect((await f.service.task(taskId)).status).toBe("cancelled");
    expect(f.fake.calls).toBe(before);
  });
  it("answers only the exact live observation request with its real key and revision", async () => {
    const created = await f.service.execute(command("vehicle_area_recon"));
    const taskId = created?.taskId;
    if (!taskId) throw Error("TASK_REQUIRED");
    const task = f.fake.tasks.get(taskId);
    if (!task) throw Error("TASK_REQUIRED");
    task.status = "input_required";
    task.inputRequests = { decision_key: { title: "继续观察" } };
    const identity = {
      taskId,
      executionId: "fixture-execution",
      resourceId: "vehicle:ugv",
      operationName: "vehicle_area_recon",
      providerId: "fixture-ugv",
      simulationId: null,
    };
    const request = {
      requestId: "decision-request",
      requestKey: "decision_key",
      revision: 1,
      state: "pending",
      inputType: "target.disposition_decision",
      identity,
      deadlineAt: new Date(Date.now() + 30000).toISOString(),
      inputSchema: {
        type: "object",
        properties: { decision: { const: "continue_observation" } },
        required: ["decision"],
        additionalProperties: false,
      },
    };
    f.fake.businessObjects.push({ kind: "input_request", value: request });
    const answer: Command = {
      commandId: randomUUID(),
      kind: "input",
      taskId,
      arguments: { requestKey: "decision_key", requestRevision: 1, action: "accept" },
      catalogHash: "fixture-manifest",
    };
    const result = await f.service.execute(answer);
    expect(result?.status).toBe("accepted");
    const sent = f.fake.requests.filter((r) => r.method === "tasks/update").at(-1);
    expect(sent?.params.inputResponses).toEqual({
      decision_key: { action: "accept", content: { decision: "continue_observation" } },
    });
    request.revision = 2;
    expect((await f.service.execute({ ...answer, commandId: randomUUID() }))?.status).toBe(
      "rejected",
    );
    expect(f.fake.requests.filter((r) => r.method === "tasks/update")).toHaveLength(1);
    f.fake.businessObjects.length = 0;
  });
  it("uses exact navigation intervention and plan guards, never announces application from ack", async () => {
    const created = await f.service.execute(command());
    const taskId = created?.taskId;
    if (!taskId) throw Error("TASK_REQUIRED");
    const identity = {
      taskId,
      executionId: "fixture-execution",
      resourceId: "vehicle:ugv",
      operationName: "vehicle_navigate",
      providerId: "fixture-ugv",
      simulationId: null,
    };
    f.fake.businessObjects.push({
      kind: "intervention",
      value: {
        interventionId: "adjust-route",
        interventionType: "navigation.adjust_plan",
        revision: 3,
        state: "available",
        identity,
        inputSchema: {
          type: "object",
          properties: { waypoints: { type: "array" } },
          required: ["waypoints"],
          additionalProperties: false,
        },
      },
    });
    const adjust: Command = {
      commandId: randomUUID(),
      kind: "intervention",
      taskId,
      arguments: {
        interventionId: "adjust-route",
        interventionRevision: 3,
        effectivePlanRevision: 1,
        input: { waypoints: [{ longitude: 106.8, latitude: 29.7 }] },
      },
      catalogHash: "fixture-manifest",
    };
    expect((await f.service.execute(adjust))?.status).toBe("accepted");
    expect(
      f.fake.requests.filter((r) => r.method === "io.sdar/taskBusiness/interventions/apply").at(-1)
        ?.params,
    ).toMatchObject({
      commandId: adjust.commandId,
      executionId: "fixture-execution",
      guard: {
        mode: "semantic",
        expectedInterventionRevision: 3,
        expectedEffectivePlanRevision: 1,
      },
    });
    expect(
      (
        await f.service.execute({
          ...adjust,
          commandId: randomUUID(),
          arguments: { ...adjust.arguments, effectivePlanRevision: 0 },
        })
      )?.response,
    ).toMatchObject({ reasonCode: "PLAN_REVISION_CONFLICT" });
    f.fake.businessObjects.length = 0;
  });
  it("limits brute-force login and keeps credentials out of API responses", async () => {
    for (let i = 0; i < 5; i++)
      expect(
        (
          await f.app.inject({
            method: "POST",
            url: "/api/session/login",
            headers: { host: "127.0.0.1:0", origin: "http://127.0.0.1:0" },
            payload: { username: "operator", password: "wrong" },
          })
        ).statusCode,
      ).toBe(401);
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/session/login",
          headers: { host: "127.0.0.1:0", origin: "http://127.0.0.1:0" },
          payload: { username: "operator", password: "wrong" },
        })
      ).statusCode,
    ).toBe(429);
    expect(
      (await f.app.inject({ method: "GET", url: "/api/commands", headers: headers() })).body,
    ).not.toContain(password);
  });
  it("shares tasks after app restart without a tools/call", async () => {
    const before = f.fake.calls,
      app = createApp(f.config, new Service(f.fake.mcp, f.store, "operator"));
    const response = await app.inject({ method: "GET", url: "/api/tasks", headers: headers() });
    expect(response.statusCode).toBe(200);
    expect(array(response.json()).length).toBeGreaterThan(0);
    expect(f.fake.calls).toBe(before);
    await app.close();
  });
  it("revokes the server-side session on logout", async () => {
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/session/logout",
          headers: headers(),
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await f.app.inject({ method: "GET", url: "/api/session", headers: headers() })).statusCode,
    ).toBe(401);
  });
});

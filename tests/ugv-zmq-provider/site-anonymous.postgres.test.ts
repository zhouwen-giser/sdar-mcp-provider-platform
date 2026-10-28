import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { controlSiteFixture } from "./site-control-fixture.js";
import { until } from "../ugv-zmq-control-postgres/harness.js";
import { Mcp } from "../../apps/ugv-control-console/server/mcp.js";
const file = process.env.SMPP_ZMQ_TEST_CONFIG_FILE;
let f: Awaited<ReturnType<typeof controlSiteFixture>>;
describe.skipIf(!file)("site anonymous real Runtime/PostgreSQL with isolated native device", () => {
  beforeAll(async () => {
    const cfg = JSON.parse(readFileSync(file ?? "", "utf8")) as { databaseUrl: string };
    f = await controlSiteFixture(cfg.databaseUrl, "site_anonymous");
    await until(
      () =>
        f.provider.engine.availability({
          name: "camera.zoom",
          params: { zoom_ratio: 2, zoom_timeout_ms: 1000 },
        }).available,
    );
  }, 30000);
  afterAll(async () => {
    await f?.close();
  });
  it("discovers anonymously, rejects supplied invalid credentials and retains admin isolation", async () => {
    const anonymous = new Mcp(f.mcp.url, {});
    expect((await anonymous.rpc("tools/list")).tools).toHaveLength(13);
    expect(await anonymous.rpc("server/discover")).toBeDefined();
    for (const authorization of ["", "Basic forged", "Bearer forged"])
      await expect(new Mcp(f.mcp.url, { authorization }).rpc("tools/list")).rejects.toThrow();
    const admin = await fetch(new URL("/internal/provider-identity", f.mcp.url));
    expect([401, 403, 404]).toContain(admin.status);
  });
  it("uses the retained historical domain for anonymous execution and JWT history reads, ignoring spoofed identity", async () => {
    const anonymous = new Mcp(f.mcp.url, {
      "x-sdar-subject": "forged",
      "x-sdar-tenant": "forged",
      "x-sdar-actor-type": "operator",
    });
    const accepted = await anonymous.rpc("tools/call", {
      name: "vehicle_zmq_camera",
      arguments: {
        resourceId: f.resourceId,
        operation: { name: "camera.zoom", params: { zoom_ratio: 2, zoom_timeout_ms: 1000 } },
      },
      _meta: {
        "io.sdar/taskExecution": {
          profileVersion: "1.0",
          idempotencyKey: randomUUID(),
          timing: { start: { mode: "immediate", startToleranceMs: 60000 }, maxElapsedMs: 10000 },
        },
      },
    });
    expect(accepted.taskId).toBeTypeOf("string");
    await until(
      async () =>
        (await f.mcp.rpc("tasks/get", { taskId: accepted.taskId })).status === "completed",
    );
    expect(
      (await new Mcp(f.mcp.url, {}).rpc("tasks/get", { taskId: accepted.taskId })).status,
    ).toBe("completed");
    expect(f.devices.commands.filter((v) => v.request.method === "TeleControl")).toHaveLength(1);
  });
});

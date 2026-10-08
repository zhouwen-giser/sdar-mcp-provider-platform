import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  runUgvManualAcceptance,
  type UgvManualAcceptanceManifest,
} from "../../scripts/task-business/manual-acceptance.js";

const catalog = JSON.parse(
  readFileSync("protocol/task-business/v1/examples/positive-catalog.json", "utf8"),
) as {
  context: Record<string, unknown>;
  artifacts: Record<string, unknown>[];
  action: Record<string, unknown>;
  requiredInput: Record<string, unknown>;
  intervention: Record<string, unknown>;
};
const manifest: UgvManualAcceptanceManifest = {
  schema: "sdar.ugv-manual-acceptance/v1",
  mcpUrl: "http://127.0.0.1:1/mcp",
  taskId: "task-catalog-1",
  snapshotOnly: true,
  expectedTools: ["vehicle_area_recon"],
};

function fixture(methods: string[], scenario = "normal"): typeof fetch {
  let page = 0;
  return async (_url, init) => {
    if (typeof init?.body !== "string") throw new Error("TEST_BODY_REQUIRED");
    const rpc = JSON.parse(init.body) as {
      id: string;
      method: string;
      params: Record<string, unknown>;
    };
    methods.push(rpc.method);
    expect(init?.redirect).toBe("error");
    let result: Record<string, unknown>;
    if (rpc.method === "tools/list") {
      page += 1;
      result = {
        tools:
          scenario === "empty"
            ? []
            : [
                {
                  name: page === 1 ? "vehicle_area_recon" : "vehicle_get_state",
                  inputSchema: { type: "object", properties: {} },
                },
              ],
        ...((scenario === "pages" && page === 1) || scenario === "cursor-loop"
          ? { nextCursor: "next" }
          : {}),
      };
    } else if (rpc.method === "io.sdar/taskBusiness/context/get") {
      const route = catalog.artifacts.find((item) => item.artifactId === "route-line");
      const newestAction = {
        ...catalog.action,
        revision: 2,
        state: "cancelled",
        endedAt: "2026-09-23T00:01:00Z",
        endReason: "CANCELLED",
      };
      result = {
        snapshot: {
          context: {
            ...catalog.context,
            ...(scenario === "stale-action"
              ? {
                  activeRefs: {},
                  actionRefs: [
                    { kind: "action", id: "lock-1", revision: 1 },
                    { kind: "action", id: "lock-1", revision: 2 },
                  ],
                }
              : {}),
          },
          contextRevision: 4,
          objects: [
            { kind: "artifact", value: route },
            { kind: "action", value: catalog.action },
            { kind: "input_request", value: catalog.requiredInput },
            { kind: "intervention", value: catalog.intervention },
            ...(scenario === "stale-action" ? [{ kind: "action", value: newestAction }] : []),
          ],
          objectDescriptors: [],
        },
        resumeFrom: { streamId: "synthetic-stream", afterSequence: "1" },
      };
    } else throw new Error(`UNEXPECTED_WRITE_OR_METHOD:${rpc.method}`);
    return Response.json({
      jsonrpc: "2.0",
      id: scenario === "wrong-id" ? "foreign" : rpc.id,
      result,
    });
  };
}

describe("UGV manual acceptance public harness", () => {
  it("discovers first, is read-only by default, and checks all four object kinds", async () => {
    const methods: string[] = [];
    const lines: Record<string, unknown>[] = [];
    await runUgvManualAcceptance({
      manifest: {
        ...manifest,
        expectations: [
          {
            kind: "artifact",
            type: "navigation.route",
            active: true,
            match: { properties: { adoption: "adopted" } },
          },
          { kind: "action", type: "sensor.visual_lock", match: { state: "requested" } },
          {
            kind: "input_request",
            type: "target.disposition_decision",
            match: { state: "pending" },
          },
          {
            kind: "intervention",
            type: "navigation.adjust_plan",
            match: { blocking: false, state: "available" },
          },
        ],
      },
      fetchImpl: fixture(methods),
      emit: (line) => {
        lines.push(line);
      },
    });
    expect(methods).toEqual(["tools/list", "io.sdar/taskBusiness/context/get"]);
    expect(lines.at(-1)).toMatchObject({
      status: "ASSERTIONS_PASSED",
      qualificationComplete: false,
    });
  });

  it("consumes tools/list pagination before any public task read", async () => {
    const methods: string[] = [];
    await runUgvManualAcceptance({
      manifest,
      fetchImpl: fixture(methods, "pages"),
      emit: () => undefined,
    });
    expect(methods).toEqual(["tools/list", "tools/list", "io.sdar/taskBusiness/context/get"]);
  });

  it.each(["empty", "wrong-id", "cursor-loop"])(
    "fails closed on discovery %s",
    async (scenario) => {
      const methods: string[] = [];
      await expect(
        runUgvManualAcceptance({
          manifest,
          fetchImpl: fixture(methods, scenario),
          emit: () => undefined,
        }),
      ).rejects.toThrow("UGV_ACCEPTANCE_");
      expect(methods.every((method) => method === "tools/list")).toBe(true);
    },
  );

  it("does not satisfy a current action assertion with an older object version", async () => {
    const methods: string[] = [];
    await expect(
      runUgvManualAcceptance({
        manifest: {
          ...manifest,
          expectations: [
            { kind: "action", type: "sensor.visual_lock", match: { state: "requested" } },
          ],
        },
        fetchImpl: fixture(methods, "stale-action"),
        emit: () => undefined,
      }),
    ).rejects.toThrow("UGV_ACCEPTANCE_EXPECTATION_FAILED");
  });

  it("does not treat an ACK/requested lock as an active Provider policy lock", async () => {
    await expect(
      runUgvManualAcceptance({
        manifest: {
          ...manifest,
          expectations: [
            {
              kind: "action",
              type: "sensor.visual_lock",
              match: { state: "active", triggerOrigin: "provider_policy" },
            },
          ],
        },
        fetchImpl: fixture([]),
        emit: () => undefined,
      }),
    ).rejects.toThrow("UGV_ACCEPTANCE_EXPECTATION_FAILED");
  });

  const inputWrite = {
    kind: "input" as const,
    manifest: {
      schema: "sdar.ugv-manual-input-probe/v1" as const,
      mcpUrl: manifest.mcpUrl,
      taskId: manifest.taskId,
      authorizationRef: "synthetic-authorization",
      sceneInstanceId: "synthetic-scene",
      executionId: "synthetic-execution",
      providerId: "synthetic-provider",
      resourceId: "vehicle:synthetic",
      requestId: "synthetic-input",
      requestKey: "synthetic-key",
      requestRevision: 1,
      deadlineAt: "2026-09-29T00:00:00Z",
      lockSessionId: "synthetic-lock",
      targetId: "synthetic-target",
      decision: "continue_observation" as const,
    },
  };

  it("requires the explicit write flag before even making a network call", async () => {
    const methods: string[] = [];
    await expect(
      runUgvManualAcceptance({
        manifest: { ...manifest, write: inputWrite },
        fetchImpl: fixture(methods),
        emit: () => undefined,
      }),
    ).rejects.toThrow("UGV_ACCEPTANCE_WRITES_DISABLED");
    expect(methods).toEqual([]);
  });

  it("rejects write manifests aimed at another endpoint or task", async () => {
    for (const override of [{ taskId: "foreign-task" }, { mcpUrl: "http://foreign.invalid/mcp" }]) {
      const methods: string[] = [];
      await expect(
        runUgvManualAcceptance({
          manifest: {
            ...manifest,
            write: { ...inputWrite, manifest: { ...inputWrite.manifest, ...override } },
          },
          allowWrites: true,
          bearerToken: "synthetic-token",
          fetchImpl: fixture(methods),
          emit: () => undefined,
        }),
      ).rejects.toThrow("UGV_ACCEPTANCE_WRITE_BINDING_MISMATCH");
      expect(methods).toEqual([]);
    }
  });

  it("keeps the existing manual input binding checks when writes are enabled", async () => {
    const methods: string[] = [];
    await expect(
      runUgvManualAcceptance({
        manifest: { ...manifest, write: inputWrite },
        allowWrites: true,
        bearerToken: "synthetic-token",
        fetchImpl: fixture(methods),
        emit: () => undefined,
      }),
    ).rejects.toThrow("UGV_INPUT_PROBE_PUBLIC_REQUEST_MISSING");
    expect(methods).toEqual(["tools/list", "io.sdar/taskBusiness/context/get"]);
  });

  it("has no arbitrary device tool or weapon dispatch input", async () => {
    const methods: string[] = [];
    await expect(
      runUgvManualAcceptance({
        manifest: {
          ...manifest,
          write: { kind: "tool", name: "ugv_area_recon_attack_confirm" },
        } as unknown as UgvManualAcceptanceManifest,
        allowWrites: true,
        fetchImpl: fixture(methods),
        emit: () => undefined,
      }),
    ).rejects.toThrow();
    expect(methods).toEqual([]);
  });
});

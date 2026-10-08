import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  runUgvInterventionProbe,
  type UgvInterventionProbeManifest,
} from "../../scripts/task-business/intervention-probe.js";
import { parsePublicInterventionApply } from "../../packages/mcp-protocol/src/sep2663/task-business.js";
import { TaskBusinessContextSchema } from "../../packages/vehicle-provider-core/src/task-business-contract.js";
import { TaskArtifactSchema } from "../../packages/vehicle-provider-core/src/task-business-artifact.js";
import { RuntimeInterventionSchema } from "../../packages/vehicle-provider-core/src/task-business-interaction.js";

const catalog = JSON.parse(
  readFileSync("protocol/task-business/v1/examples/positive-catalog.json", "utf8"),
) as {
  context: Record<string, unknown>;
  intervention: Record<string, unknown>;
  artifacts: Record<string, unknown>[];
};
const identity = {
  taskId: "synthetic-intervention-task",
  executionId: "synthetic-execution",
  providerId: "synthetic-provider",
  resourceId: "vehicle:synthetic-ugv",
  operationName: "vehicle_navigate",
  simulationId: "synthetic-isolated-scene",
};
const offered = RuntimeInterventionSchema.parse({ ...catalog.intervention, identity });
const manifest: UgvInterventionProbeManifest = {
  schema: "sdar.ugv-intervention-probe/v1",
  mcpUrl: "http://127.0.0.1:1/mcp",
  authorizationRef: "synthetic-explicit-authorization",
  sceneInstanceId: identity.simulationId,
  taskId: identity.taskId,
  executionId: identity.executionId,
  providerId: identity.providerId,
  resourceId: identity.resourceId,
  interventionId: offered.interventionId,
  interventionRevision: 1,
  effectivePlanRevision: 2,
  commandId: "synthetic-command",
  input: { viaPoints: [[116.1, 39.1]] },
  submitBefore: "2026-09-29T00:00:00Z",
  maxPolls: 2,
  pollIntervalMs: 100,
};
interface FixtureOptions {
  providerState?: "submitted" | "failed" | "applied";
  wrongCommand?: boolean;
  candidateRoute?: boolean;
  stalePlan?: boolean;
  missingResult?: boolean;
  loseResponse?: boolean;
  optimisticReceipt?: boolean;
  taskStatus?: string;
  wrongRpcId?: boolean;
  omitSceneIdentity?: boolean;
}

function fixture(methods: string[], options: FixtureOptions = {}): typeof fetch {
  const actualIdentity = {
    ...identity,
    ...(options.omitSceneIdentity ? { simulationId: undefined } : {}),
  };
  let written = false;
  let polls = 0;
  return async (_url, init) => {
    if (typeof init?.body !== "string") throw new Error("TEST_REQUEST_BODY_REQUIRED");
    const rpc = JSON.parse(init.body) as {
      id: string;
      method: string;
      params: Record<string, unknown>;
    };
    methods.push(rpc.method);
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-token");
    let result: Record<string, unknown>;
    if (rpc.method === "io.sdar/taskBusiness/context/get") {
      if (written) polls += 1;
      const state = !written
        ? "available"
        : polls === 1
          ? "submitted"
          : (options.providerState ?? "applied");
      const applied = state === "applied";
      const route = TaskArtifactSchema.parse({
        ...catalog.artifacts.find((item) => item.artifactId === "route-line"),
        identity: actualIdentity,
        revision: applied ? 2 : 1,
        properties: {
          adoption: options.candidateRoute && applied ? "candidate" : "adopted",
          purpose: "navigation",
          routeSource: "test_double",
        },
      });
      const routeRef = {
        kind: "artifact" as const,
        id: route.artifactId,
        revision: route.revision,
      };
      const entry = RuntimeInterventionSchema.parse({
        ...offered,
        identity: actualIdentity,
        state,
        revision: !written ? 1 : applied || state === "failed" ? 4 : 2,
        ...(written
          ? { acceptedCommandId: options.wrongCommand ? "foreign-command" : manifest.commandId }
          : {}),
        ...(applied
          ? {
              resultRefs: [
                { ...routeRef, id: options.missingResult ? "missing-route" : routeRef.id },
              ],
            }
          : {}),
      });
      const entryRef = {
        kind: "intervention" as const,
        id: entry.interventionId,
        revision: entry.revision,
      };
      const context = TaskBusinessContextSchema.parse({
        ...catalog.context,
        identity: actualIdentity,
        contextRevision: written ? 6 + polls : 4,
        effectivePlanRevision: applied && !options.stalePlan ? 3 : 2,
        activeRefs: {
          route: routeRef,
          ...(["available", "submitted"].includes(state) ? { intervention: entryRef } : {}),
        },
        artifactRefs: [routeRef],
        interventionRefs: [entryRef],
        actionRefs: [],
        requiredInputRefs: [],
      });
      result = {
        snapshot: {
          context,
          contextRevision: context.contextRevision,
          objects: [
            { kind: "artifact", value: route },
            { kind: "intervention", value: entry },
          ],
          objectDescriptors: [],
        },
        resumeFrom: { streamId: "synthetic-stream", afterSequence: written ? "2" : "1" },
      };
    } else if (rpc.method === "tasks/get") {
      result = { taskId: identity.taskId, status: options.taskStatus ?? "working" };
    } else if (rpc.method === "io.sdar/taskBusiness/interventions/apply") {
      const parsed = parsePublicInterventionApply(rpc.params);
      expect(parsed.command).toMatchObject({
        commandId: manifest.commandId,
        taskId: identity.taskId,
        executionId: identity.executionId,
        guard: {
          mode: "semantic",
          expectedInterventionRevision: 1,
          expectedEffectivePlanRevision: 2,
        },
        input: manifest.input,
      });
      expect(parsed.claimed).toEqual({
        externalExecutionId: identity.executionId,
        resourceId: identity.resourceId,
        executionMode: "simulation",
        simulationId: identity.simulationId,
      });
      expect(rpc.params).not.toHaveProperty("responder");
      expect(written).toBe(false);
      written = true;
      if (options.loseResponse) throw new Error("TEST_RESPONSE_LOST");
      result = {
        resultType: "complete",
        profileVersion: "1.0-rc2",
        receipt: {
          commandId: manifest.commandId,
          commandSequence: 1,
          commandState: "PENDING",
          durablyAccepted: true,
          businessApplied: options.optimisticReceipt ?? false,
          duplicate: false,
        },
      };
    } else if (rpc.method === "tasks/cancel") {
      expect(written).toBe(true);
      expect(rpc.params.taskId).toBe(identity.taskId);
      result = { resultType: "complete" };
    } else throw new Error(`UNEXPECTED_METHOD:${rpc.method}`);
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: options.wrongRpcId && rpc.method === "tasks/get" ? "foreign-id" : rpc.id,
        result,
      }),
      {
        headers: { "content-type": "application/json" },
      },
    );
  };
}

function run(
  methods: string[],
  lines: Record<string, unknown>[],
  options: FixtureOptions = {},
  overrides: Partial<UgvInterventionProbeManifest> = {},
) {
  return runUgvInterventionProbe({
    manifest: { ...manifest, ...overrides },
    bearerToken: "test-token",
    fetchImpl: fixture(methods, options),
    now: () => new Date("2026-09-28T00:00:00Z"),
    wait: async () => {
      await Promise.resolve();
    },
    emit: (line) => {
      lines.push(line);
    },
  });
}

describe("explicit UGV navigation intervention probe (synthetic public fixture)", () => {
  it("sends one guarded command and hydrates the adopted result without claiming device effect", async () => {
    const methods: string[] = [];
    const lines: Record<string, unknown>[] = [];
    await run(methods, lines);
    expect(methods).toEqual([
      "io.sdar/taskBusiness/context/get",
      "tasks/get",
      "io.sdar/taskBusiness/interventions/apply",
      "io.sdar/taskBusiness/context/get",
      "io.sdar/taskBusiness/context/get",
      "tasks/get",
    ]);
    expect(lines.map((line) => line.type)).toEqual([
      "preflight",
      "runtimeAccepted",
      "providerState",
      "providerState",
      "businessAppliedConfirmed",
    ]);
    expect(lines[1]).toMatchObject({ businessApplied: false, receipt: { durablyAccepted: true } });
    expect(lines.at(-1)).toMatchObject({
      qualification: "runtime_wire_only",
      deviceEffectConfirmed: false,
      effectivePlanRevision: 3,
      results: [{ value: { artifactType: "navigation.route", revision: 2 } }],
    });
    expect(JSON.stringify(lines)).not.toContain("test-token");
  });

  it("authorizes the scene in HTTP headers when optional public identity metadata is absent", async () => {
    const methods: string[] = [];
    const lines: Record<string, unknown>[] = [];
    const delegate = fixture(methods, { omitSceneIdentity: true });
    await runUgvInterventionProbe({
      manifest,
      bearerToken: "test-token",
      fetchImpl: (url, init) => {
        const headers = new Headers(init?.headers);
        expect(headers.get("x-sdar-execution-mode")).toBe("simulation");
        expect(headers.get("x-sdar-simulation-id")).toBe(manifest.sceneInstanceId);
        return delegate(url, init);
      },
      now: () => new Date("2026-09-28T00:00:00Z"),
      wait: async () => {
        await Promise.resolve();
      },
      emit: (line) => {
        lines.push(line);
      },
    });
    expect(lines.at(-1)?.type).toBe("businessAppliedConfirmed");
  });

  for (const [options, reason] of [
    [{ providerState: "submitted" }, "APPLIED_NOT_CONFIRMED"],
    [{ providerState: "failed" }, "PROVIDER_FAILED"],
    [{ wrongCommand: true }, "COMMAND_MISMATCH"],
    [{ candidateRoute: true }, "APPLIED_RESULT_INVALID"],
    [{ stalePlan: true }, "APPLIED_RESULT_INVALID"],
    [{ missingResult: true }, "APPLIED_RESULT_INVALID"],
    [{ optimisticReceipt: true }, "RECEIPT_INVALID"],
  ] as const) {
    it(`rejects ${reason} without reporting applied success`, async () => {
      const methods: string[] = [];
      const lines: Record<string, unknown>[] = [];
      await expect(run(methods, lines, options)).rejects.toThrow(reason);
      expect(lines.some((line) => line.type === "businessAppliedConfirmed")).toBe(false);
      expect(methods.filter((method) => method.endsWith("interventions/apply"))).toHaveLength(1);
      expect(methods).not.toContain("tasks/cancel");
    });
  }

  it("uses only the named Task cleanup policy after an uncertain write and never retries", async () => {
    const methods: string[] = [];
    const lines: Record<string, unknown>[] = [];
    await expect(
      run(methods, lines, { loseResponse: true }, { cleanupTaskAfter: true }),
    ).rejects.toThrow("TEST_RESPONSE_LOST");
    expect(methods).toEqual([
      "io.sdar/taskBusiness/context/get",
      "tasks/get",
      "io.sdar/taskBusiness/interventions/apply",
      "tasks/cancel",
    ]);
    expect(lines.at(-1)).toMatchObject({ type: "cleanupRequested", physicalStopConfirmed: false });
  });

  for (const [options, overrides, reason] of [
    [{}, { sceneInstanceId: "foreign-scene" }, "BINDING_MISMATCH"],
    [{}, { interventionRevision: 2 }, "ENTRY_NOT_ACTIVE"],
    [{}, { effectivePlanRevision: 3 }, "BINDING_MISMATCH"],
    [{}, { input: { viaPoints: "invalid" } }, "INVALID_INTERVENTION_INPUT"],
    [{}, { submitBefore: "2026-09-27T00:00:00Z" }, "SUBMISSION_EXPIRED"],
    [{ taskStatus: "input_required" }, {}, "TASK_NOT_RUNNING"],
    [{ wrongRpcId: true }, {}, "RPC_FAILED"],
  ] as const) {
    it(`performs no write or cleanup after ${reason}`, async () => {
      const methods: string[] = [];
      await expect(
        run(methods, [], options, { ...overrides, cleanupTaskAfter: true }),
      ).rejects.toThrow(reason);
      expect(methods).not.toContain("io.sdar/taskBusiness/interventions/apply");
      expect(methods).not.toContain("tasks/cancel");
    });
  }
});

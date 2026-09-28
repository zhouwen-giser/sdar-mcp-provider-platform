import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runUgvManualInputProbe } from "../../scripts/task-business/manual-input-probe.js";
import { TaskBusinessContextSchema } from "../../packages/vehicle-provider-core/src/task-business-contract.js";
import {
  BusinessActionSchema,
  RequiredInputSchema,
} from "../../packages/vehicle-provider-core/src/task-business-interaction.js";

const catalog = JSON.parse(
  readFileSync("protocol/task-business/v1/examples/positive-catalog.json", "utf8"),
) as {
  context: Record<string, unknown>;
  action: Record<string, unknown>;
  requiredInput: Record<string, unknown>;
};
const identity = {
  taskId: "task-input-probe",
  executionId: "execution-input-probe",
  providerId: "provider-a",
  resourceId: "vehicle:ugv1",
  operationName: "vehicle_area_recon",
  simulationId: "sim-isolated-a",
};
const action = BusinessActionSchema.parse({ ...catalog.action, identity });
const pending = RequiredInputSchema.parse({
  ...catalog.requiredInput,
  identity,
  requestId: "request-probe-1",
  requestKey: "target-decision:lock-1",
  subjectBinding: {
    kind: "visual_lock",
    targetId: "7",
    lockSessionId: action.actionId,
    actionRef: { kind: "action", id: action.actionId, revision: action.revision },
  },
  deadlineAt: "2026-09-27T00:00:00Z",
});
const answer = RequiredInputSchema.parse({
  ...pending,
  revision: 2,
  state: "answered",
  resolvedAt: "2026-09-26T00:00:01Z",
  reasonCode: "TARGET_OBSERVATION_CONTINUES",
  responseCommandId: "command-probe-1",
  response: { action: "accept", value: { decision: "continue_observation" } },
});
const declined = RequiredInputSchema.parse({
  ...pending,
  revision: 2,
  state: "declined",
  resolvedAt: "2026-09-26T00:00:01Z",
  reasonCode: "TARGET_OBSERVATION_DECLINED",
  responseCommandId: "command-probe-2",
  response: { action: "decline" },
});
const dismissed = RequiredInputSchema.parse({
  ...pending,
  revision: 2,
  state: "cancelled",
  resolvedAt: "2026-09-26T00:00:01Z",
  reasonCode: "TARGET_OBSERVATION_DISMISSED",
  responseCommandId: "command-probe-3",
  response: { action: "cancel" },
});
const actionRef = { kind: "action" as const, id: action.actionId, revision: action.revision };
const inputRef = { kind: "input_request" as const, id: pending.requestId, revision: 1 };
const before = TaskBusinessContextSchema.parse({
  ...catalog.context,
  identity,
  activeRefs: { "visualLock:mission-1": actionRef, "input:visualLock": inputRef },
  artifactRefs: [],
  actionRefs: [actionRef],
  requiredInputRefs: [inputRef],
  interventionRefs: [],
});
const after = TaskBusinessContextSchema.parse({
  ...before,
  contextRevision: before.contextRevision + 1,
  activeRefs: { "visualLock:mission-1": actionRef },
  requiredInputRefs: [...before.requiredInputRefs, { ...inputRef, revision: 2 }],
  updatedAt: "2026-09-26T00:00:01Z",
});
const manifest = {
  schema: "sdar.ugv-manual-input-probe/v1" as const,
  mcpUrl: "http://127.0.0.1:1/mcp",
  authorizationRef: "test-user-run-authorization",
  sceneInstanceId: identity.simulationId,
  taskId: identity.taskId,
  executionId: identity.executionId,
  providerId: identity.providerId,
  resourceId: identity.resourceId,
  requestId: pending.requestId,
  requestKey: pending.requestKey,
  requestRevision: pending.revision,
  deadlineAt: pending.deadlineAt ?? "",
  lockSessionId: action.actionId,
  targetId: "7",
  decision: "continue_observation" as const,
  cleanupTaskAfter: true,
  maxPolls: 1,
  pollIntervalMs: 100,
};

function fixtureFetch(
  methods: string[],
  applyAnswer = true,
  loseUpdateResponse = false,
  decision: "continue_observation" | "decline" | "cancel" = "continue_observation",
): typeof fetch {
  let updated = false;
  let updateIssued = false;
  const resolved = decision === "decline" ? declined : decision === "cancel" ? dismissed : answer;
  return async (_url, init) => {
    if (typeof init?.body !== "string") throw new Error("TEST_BODY_INVALID");
    const envelope = JSON.parse(init.body) as {
      id: string;
      method: string;
      params: Record<string, unknown>;
    };
    methods.push(envelope.method);
    let result: Record<string, unknown>;
    if (envelope.method === "io.sdar/taskBusiness/context/get") {
      const context = updated ? after : before;
      result = {
        resultType: "complete",
        profileVersion: "1.0-rc2",
        snapshot: {
          contextRevision: context.contextRevision,
          context,
          objects: [
            { kind: "action", value: action },
            { kind: "input_request", value: pending },
            ...(updated ? [{ kind: "input_request", value: resolved }] : []),
          ],
          objectDescriptors: [],
        },
        resumeFrom: { streamId: "stream-input-probe", afterSequence: updated ? "2" : "1" },
      };
    } else if (envelope.method === "tasks/get") {
      result = updated
        ? { resultType: "complete", taskId: identity.taskId, status: "working" }
        : {
            resultType: "complete",
            taskId: identity.taskId,
            status: "input_required",
            inputRequests: {
              [pending.requestKey]: {
                method: "elicitation/create",
                params: {
                  _meta: {
                    "io.sdar/taskBusiness": {
                      requestId: pending.requestId,
                      requestKey: pending.requestKey,
                      revision: pending.revision,
                      deadlineAt: pending.deadlineAt,
                    },
                  },
                },
              },
            },
          };
    } else if (envelope.method === "tasks/update") {
      expect(envelope.params.inputResponses).toEqual({
        [pending.requestKey]:
          decision === "continue_observation"
            ? { action: "accept", content: { decision: "continue_observation" } }
            : { action: decision },
      });
      updateIssued = true;
      updated = applyAnswer;
      if (loseUpdateResponse) throw new Error("TEST_UPDATE_RESPONSE_LOST");
      result = { resultType: "complete" };
    } else if (envelope.method === "tasks/cancel") {
      expect(updateIssued).toBe(true);
      expect(envelope.params.taskId).toBe(identity.taskId);
      result = { resultType: "complete" };
    } else {
      throw new Error(`UNEXPECTED_METHOD:${envelope.method}`);
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: envelope.id, result }), {
      headers: { "content-type": "application/json" },
    });
  };
}

describe("UGV manual input public probe", () => {
  it("binds the public request and confirms the Provider answer after one Runtime update", async () => {
    const methods: string[] = [];
    const lines: Record<string, unknown>[] = [];
    await runUgvManualInputProbe({
      manifest,
      bearerToken: "test-token",
      fetchImpl: fixtureFetch(methods),
      now: () => new Date("2026-09-26T00:00:00Z"),
      wait: async () => {
        await Promise.resolve();
      },
      emit: (line) => {
        lines.push(line);
      },
    });
    expect(methods).toEqual([
      "io.sdar/taskBusiness/context/get",
      "tasks/get",
      "tasks/update",
      "io.sdar/taskBusiness/context/get",
      "tasks/get",
      "tasks/cancel",
    ]);
    expect(lines.map((line) => line.type)).toEqual([
      "preflight",
      "runtimeAccepted",
      "businessAnswerConfirmed",
      "cleanupRequested",
    ]);
    expect(lines.at(-2)).toMatchObject({
      qualification: "runtime_wire_only",
      deviceEffectConfirmed: false,
    });
    expect(lines.at(-1)).toMatchObject({ type: "cleanupRequested", physicalStopConfirmed: false });
  });

  for (const decision of ["decline", "cancel"] as const) {
    it(`confirms ${decision} as an input decision without cancelling the Task`, async () => {
      const methods: string[] = [];
      const lines: Record<string, unknown>[] = [];
      await runUgvManualInputProbe({
        manifest: { ...manifest, decision, cleanupTaskAfter: false },
        bearerToken: "test-token",
        fetchImpl: fixtureFetch(methods, true, false, decision),
        now: () => new Date("2026-09-26T00:00:00Z"),
        wait: async () => {
          await Promise.resolve();
        },
        emit: (line) => {
          lines.push(line);
        },
      });
      expect(methods).toEqual([
        "io.sdar/taskBusiness/context/get",
        "tasks/get",
        "tasks/update",
        "io.sdar/taskBusiness/context/get",
        "tasks/get",
      ]);
      expect(lines.at(-1)).toMatchObject({
        type: "businessAnswerConfirmed",
        taskStatus: "working",
        qualification: "runtime_wire_only",
        deviceEffectConfirmed: false,
        request: { state: decision === "decline" ? "declined" : "cancelled" },
      });
    });
  }

  it("refuses a mismatched lock session before sending any write", async () => {
    const methods: string[] = [];
    await expect(
      runUgvManualInputProbe({
        manifest: { ...manifest, lockSessionId: "another-lock" },
        bearerToken: "test-token",
        fetchImpl: fixtureFetch(methods),
        now: () => new Date("2026-09-26T00:00:00Z"),
        emit: (line) => {
          void line;
        },
      }),
    ).rejects.toThrow("UGV_INPUT_PROBE_BINDING_MISMATCH");
    expect(methods).toEqual(["io.sdar/taskBusiness/context/get"]);
  });

  it("requests cleanup of only the named Task when the answer remains unconfirmed", async () => {
    const methods: string[] = [];
    await expect(
      runUgvManualInputProbe({
        manifest,
        bearerToken: "test-token",
        fetchImpl: fixtureFetch(methods, false),
        now: () => new Date("2026-09-26T00:00:00Z"),
        wait: async () => {
          await Promise.resolve();
        },
        emit: (line) => {
          void line;
        },
      }),
    ).rejects.toThrow("UGV_INPUT_PROBE_BUSINESS_ANSWER_NOT_CONFIRMED");
    expect(methods.at(-1)).toBe("tasks/cancel");
    expect(methods.filter((method) => method === "tasks/update")).toHaveLength(1);
  });

  it("requests named Task cleanup after an uncertain update response", async () => {
    const methods: string[] = [];
    const lines: Record<string, unknown>[] = [];
    await expect(
      runUgvManualInputProbe({
        manifest,
        bearerToken: "test-token",
        fetchImpl: fixtureFetch(methods, false, true),
        now: () => new Date("2026-09-26T00:00:00Z"),
        emit: (line) => {
          lines.push(line);
        },
      }),
    ).rejects.toThrow("TEST_UPDATE_RESPONSE_LOST");
    expect(methods.at(-1)).toBe("tasks/cancel");
    expect(methods.filter((method) => method === "tasks/update")).toHaveLength(1);
    expect(lines.map((line) => line.type)).toEqual(["preflight", "cleanupRequested"]);
  });

  it("does not write or cancel if the deadline passes during preflight", async () => {
    const methods: string[] = [];
    let clockReads = 0;
    await expect(
      runUgvManualInputProbe({
        manifest,
        bearerToken: "test-token",
        fetchImpl: fixtureFetch(methods),
        now: () => new Date(clockReads++ === 0 ? "2026-09-26T00:00:00Z" : manifest.deadlineAt),
        emit: (line) => {
          void line;
        },
      }),
    ).rejects.toThrow("UGV_INPUT_PROBE_DEADLINE_EXPIRED_BEFORE_UPDATE");
    expect(methods).toEqual(["io.sdar/taskBusiness/context/get", "tasks/get"]);
  });
});

import { describe, expect, it } from "vitest";
import { parseTaskInputResponses } from "../../packages/mcp-protocol/src/index.js";

describe("frozen MRTR inputResponses", () => {
  it("C-018 accepts a partial tasks/update with exact keyed elicitation responses", () => {
    expect(
      parseTaskInputResponses({
        taskId: "task-1",
        inputResponses: {
          approval: { action: "accept", content: { approved: true } },
          optional: { action: "decline" },
        },
        _meta: {},
      }),
    ).toEqual({
      approval: { action: "accept", content: { approved: true } },
      optional: { action: "decline" },
    });
  });

  it.each([
    ["shape", { taskId: "task-1", inputResponses: [], _meta: {} }, "INPUT_RESPONSES_INVALID"],
    [
      "action",
      { taskId: "task-1", inputResponses: { approval: { action: "approve" } }, _meta: {} },
      "INPUT_RESPONSE_ACTION_INVALID",
    ],
    [
      "unknown-field",
      {
        taskId: "task-1",
        inputResponses: { approval: { action: "accept", extra: true } },
        _meta: {},
      },
      "UNKNOWN_TASK_FIELD",
    ],
    [
      "legacy-field",
      { taskId: "task-1", inputs: { approval: true }, inputResponses: {}, _meta: {} },
      "UNKNOWN_TASK_FIELD",
    ],
  ])("%s rejects non-frozen inputResponses", (_caseId, params, code) => {
    expect(() => parseTaskInputResponses(params)).toThrow(code);
  });
});

import { InvalidParamsError } from "../../../domain/src/index.js";

export interface FrozenInputResponse {
  action: "accept" | "decline" | "cancel";
  content?: unknown;
}

export function parseTaskId(params: Record<string, unknown>): string {
  const taskId = params.taskId;
  if (typeof taskId !== "string" || taskId.length < 1) {
    throw new InvalidParamsError("TASK_ID_INVALID");
  }
  return taskId;
}

export function parseTaskReference(params: Record<string, unknown>): string {
  assertOnlyKeys(params, new Set(["taskId", "_meta"]));
  return parseTaskId(params);
}

export function parseTaskInputResponses(
  params: Record<string, unknown>,
): Record<string, FrozenInputResponse> {
  assertOnlyKeys(params, new Set(["taskId", "inputResponses", "_meta"]));
  const responses = params.inputResponses;
  if (responses === null || typeof responses !== "object" || Array.isArray(responses)) {
    throw new InvalidParamsError("INPUT_RESPONSES_INVALID");
  }
  return Object.fromEntries(
    Object.entries(responses).map(([key, value]) => {
      if (key.length < 1 || key.length > 128) {
        throw new InvalidParamsError("INPUT_RESPONSE_KEY_INVALID");
      }
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new InvalidParamsError("INPUT_RESPONSE_INVALID");
      }
      const response = value as Record<string, unknown>;
      assertOnlyKeys(response, new Set(["action", "content"]));
      if (!new Set(["accept", "decline", "cancel"]).has(String(response.action))) {
        throw new InvalidParamsError("INPUT_RESPONSE_ACTION_INVALID");
      }
      return [
        key,
        {
          action: response.action as FrozenInputResponse["action"],
          ...("content" in response ? { content: response.content } : {}),
        },
      ];
    }),
  );
}

export function parseTaskObservations(params: Record<string, unknown>): {
  taskId: string;
  cursor?: number;
  limit: number;
} {
  assertOnlyKeys(params, new Set(["taskId", "cursor", "limit", "_meta"]));
  const taskId = parseTaskId(params);
  const cursorValue = params.cursor;
  let cursor: number | undefined;
  if (cursorValue !== undefined) {
    if (typeof cursorValue !== "string" || !/^[1-9][0-9]*$/.test(cursorValue)) {
      throw new InvalidParamsError("OBSERVATION_CURSOR_INVALID");
    }
    cursor = Number(cursorValue);
    if (!Number.isSafeInteger(cursor)) {
      throw new InvalidParamsError("OBSERVATION_CURSOR_INVALID");
    }
  }
  const limit = params.limit ?? 100;
  if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 100) {
    throw new InvalidParamsError("OBSERVATION_PAGE_SIZE_INVALID");
  }
  return { taskId, ...(cursor === undefined ? {} : { cursor }), limit: limit as number };
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new InvalidParamsError("UNKNOWN_TASK_FIELD");
  }
}

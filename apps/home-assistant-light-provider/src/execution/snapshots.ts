import { jsonToProtoStruct } from "../../../../packages/adapter-protocol/src/index.js";
import type { LightExecution } from "../types.js";

export function snapshot(x: LightExecution): Record<string, unknown> {
  const completedResult = x.state === "SUCCEEDED" ? result(x) : undefined;
  return {
    taskId: x.taskId,
    externalExecutionId: x.externalExecutionId,
    operationName: x.operationName,
    argumentHash: x.argumentHash,
    executionContext: x.executionContext,
    state:
      x.state === "PENDING_SIDE_EFFECT"
        ? "ACCEPTED"
        : x.state === "CONFIRMING"
          ? "RUNNING"
          : x.state,
    revision: String(x.revision),
    reasonCode:
      x.state === "SUCCEEDED"
        ? "HOME_ASSISTANT_STATE_CONFIRMED"
        : x.state === "TECHNICAL_FAILED"
          ? "HOME_ASSISTANT_STATE_CONFIRMATION_TIMEOUT"
          : x.state === "CONFIRMING"
            ? "HOME_ASSISTANT_CONFIRMING"
            : "EXECUTION_PERSISTED",
    message:
      x.state === "SUCCEEDED"
        ? "Desired light state confirmed."
        : x.state === "TECHNICAL_FAILED"
          ? "Light state confirmation timed out."
          : "Waiting for observed Home Assistant light state.",
    ...(completedResult === undefined
      ? {}
      : { result: jsonToProtoStruct(completedResult), evidence: [completionEvidence(x)] }),
    retryable: x.state === "TECHNICAL_FAILED",
    observedAt: timestamp(x.updatedAt),
  };
}

function result(x: LightExecution): Record<string, unknown> {
  const confirmed = x.confirmedState;
  if (confirmed === undefined) throw new Error("CONFIRMED_LIGHT_STATE_MISSING");
  if (x.desiredState.type === "power")
    return {
      resourceId: x.resourceId,
      power: confirmed.power,
      confirmed: true,
      observedAt: confirmed.observedAt,
    };
  return {
    resourceId: x.resourceId,
    brightnessPercent: confirmed.brightnessPercent,
    confirmed: true,
    observedAt: confirmed.observedAt,
  };
}

function completionEvidence(x: LightExecution): Record<string, unknown> {
  const confirmed = x.confirmedState;
  if (confirmed === undefined) throw new Error("CONFIRMED_LIGHT_STATE_MISSING");
  const brightness = x.desiredState.type === "brightness";
  return {
    evidenceId: `home-assistant-light-${x.taskId}-${String(x.revision)}`,
    evidenceType: brightness ? "light.brightness.observation" : "light.state.observation",
    observedAt: confirmed.observedAt,
    subjectRef: `resource:${x.resourceId}`,
    payloadRef: {
      kind: "structured_content",
      jsonPointer: brightness ? "/brightnessPercent" : "/power",
    },
    producer: ["home-assistant"],
  };
}

export function timestamp(value: string): { seconds: string; nanos: number } {
  const milliseconds = Date.parse(value);
  return { seconds: String(Math.floor(milliseconds / 1000)), nanos: (milliseconds % 1000) * 1e6 };
}

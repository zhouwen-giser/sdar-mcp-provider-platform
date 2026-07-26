import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { providerTelemetryExampleEvents } from "../../examples/mock-adapter-typescript/src/provider-telemetry.js";

describe("dual-language Provider telemetry examples", () => {
  it("typescript_provider_telemetry_conformance", () => {
    const events = providerTelemetryExampleEvents({
      taskId: "task-example",
      externalExecutionId: "execution-example",
      operationName: "durable_task",
    });
    expect(events.map((event) => event.eventType)).toEqual([
      "RESOURCE_STATE",
      "RESOURCE_METRIC",
      "RESOURCE_HEALTH",
      "EXECUTION_PROGRESS",
    ]);
    expect(new Set(events.map((event) => event.providerEventId)).size).toBe(4);
    expect(events[3]).toMatchObject({
      taskId: "task-example",
      externalExecutionId: "execution-example",
      operationName: "durable_task",
    });
  });

  it("python_provider_telemetry_conformance", () => {
    expect(() =>
      execFileSync(process.platform === "win32" ? "python" : "python3", [
        "-m",
        "py_compile",
        "examples/mock-adapter-python/provider_telemetry.py",
      ]),
    ).not.toThrow();
  });
});

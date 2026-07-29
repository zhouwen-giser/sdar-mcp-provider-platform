import { describe, expect, it } from "vitest";
import { advanceOperation, createOperation } from "../src/prototype/operations.js";

describe("PrototypeOperation", () => {
  it("advances deterministically and clearly reports mock-only completion", () => {
    const operation = createOperation(
      { label: "模拟发布", steps: ["校验", "发布"] },
      { id: () => "fixed" },
    );
    const running = advanceOperation(operation);
    const second = advanceOperation(running);
    const third = advanceOperation(second);

    expect(operation.operationId).toBe("prototype-fixed");
    expect(running.steps[0]?.status).toBe("RUNNING");
    expect(second.steps[1]?.status).toBe("RUNNING");
    expect(third.status).toBe("COMPLETED");
    expect(third.resultMessage).toContain("未执行任何真实生产变更");
  });

  it("models a deterministic failed step", () => {
    const operation = createOperation({ label: "模拟恢复", steps: ["检查"] }, { id: () => "1" });
    expect(advanceOperation(operation, 0).status).toBe("FAILED");
  });
});

import type {
  PrototypeOperation,
  PrototypeOperationStep,
  SimulatedOperationInput,
} from "../data/types.js";

export interface PrototypeClock {
  id(): string;
}

export const browserPrototypeClock: PrototypeClock = {
  id: () => crypto.randomUUID(),
};

export function createOperation(
  input: SimulatedOperationInput,
  clock: PrototypeClock,
): PrototypeOperation {
  if (input.steps.length === 0) throw new Error("PROTOTYPE_OPERATION_STEPS_REQUIRED");
  return {
    operationId: `prototype-${clock.id()}`,
    label: input.label,
    simulated: true,
    status: "PENDING",
    steps: input.steps.map((label, index) => ({
      id: `step-${String(index + 1)}`,
      label,
      status: "PENDING",
    })),
  };
}

export function advanceOperation(
  operation: PrototypeOperation,
  failAtStep?: number,
): PrototypeOperation {
  if (operation.status === "COMPLETED" || operation.status === "FAILED") return operation;
  const current = operation.steps.findIndex(
    (step) => step.status === "RUNNING" || step.status === "PENDING",
  );
  if (current < 0) return operation;
  if (failAtStep === current) {
    return {
      ...operation,
      status: "FAILED",
      steps: replaceStep(operation.steps, current, "FAILED"),
      resultMessage: "模拟操作失败；未影响真实环境。",
    };
  }
  const wasRunning = operation.steps[current]?.status === "RUNNING";
  if (!wasRunning) {
    return {
      ...operation,
      status: "RUNNING",
      steps: replaceStep(operation.steps, current, "RUNNING"),
    };
  }
  const nextSteps = replaceStep(operation.steps, current, "COMPLETED");
  const complete = current === nextSteps.length - 1;
  return {
    ...operation,
    status: complete ? "COMPLETED" : "RUNNING",
    steps: complete ? nextSteps : replaceStep(nextSteps, current + 1, "RUNNING"),
    ...(complete ? { resultMessage: "模拟操作已完成；未执行任何真实生产变更。" } : {}),
  };
}

function replaceStep(
  steps: readonly PrototypeOperationStep[],
  index: number,
  status: PrototypeOperationStep["status"],
): readonly PrototypeOperationStep[] {
  return steps.map((step, stepIndex) => (stepIndex === index ? { ...step, status } : step));
}

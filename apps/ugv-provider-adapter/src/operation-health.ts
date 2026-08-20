import type {
  DeviceToolHealthSnapshot,
  UgvDeviceToolName,
} from "../../../packages/vehicle-device-mcp-client/src/index.js";
import { UgvOperationQualificationService } from "../../../packages/vehicle-device-mcp-client/src/index.js";

export type UgvOperationHealthState = "HEALTHY" | "DEGRADED" | "OPEN" | "RECOVERING";

export interface UgvOperationHealthSnapshot {
  operationName: string;
  state: UgvOperationHealthState;
  consecutiveFailures: number;
  recoverySuccesses: number;
  reasonCode: string;
}

export class UgvOperationHealthTracker {
  readonly #tools = new Map<UgvDeviceToolName, DeviceToolHealthSnapshot<UgvDeviceToolName>>();
  readonly #operations = new Map<string, UgvOperationHealthSnapshot>();
  readonly #dependencies = new Map<string, readonly UgvDeviceToolName[]>();

  constructor(
    readonly thresholds: {
      degradedThreshold: number;
      openThreshold: number;
      recoverySuccessThreshold: number;
    },
    qualification = new UgvOperationQualificationService(),
  ) {
    for (const { operationName } of qualification.profiles) {
      this.#dependencies.set(operationName, qualification.inventoryTools(operationName));
      this.#operations.set(operationName, healthy(operationName));
    }
  }

  recordToolHealth(
    health: DeviceToolHealthSnapshot<UgvDeviceToolName>,
  ): readonly { previous: UgvOperationHealthSnapshot; current: UgvOperationHealthSnapshot }[] {
    this.#tools.set(health.toolName, structuredClone(health));
    const transitions: {
      previous: UgvOperationHealthSnapshot;
      current: UgvOperationHealthSnapshot;
    }[] = [];
    for (const [operationName, dependencies] of this.#dependencies) {
      if (!dependencies.includes(health.toolName)) continue;
      const previous = this.snapshot(operationName);
      const current = this.#evaluate(operationName, previous);
      this.#operations.set(operationName, current);
      if (previous.state !== current.state || previous.reasonCode !== current.reasonCode)
        transitions.push({ previous, current: structuredClone(current) });
    }
    return transitions;
  }

  snapshot(operationName: string): UgvOperationHealthSnapshot {
    return structuredClone(this.#operations.get(operationName) ?? healthy(operationName));
  }

  snapshots(): readonly UgvOperationHealthSnapshot[] {
    return [...this.#operations.values()].map((value) => structuredClone(value));
  }

  #evaluate(
    operationName: string,
    previous: UgvOperationHealthSnapshot,
  ): UgvOperationHealthSnapshot {
    const dependencies = this.#dependencies.get(operationName) ?? [];
    const observed = dependencies.flatMap((tool) => {
      const health = this.#tools.get(tool);
      return health === undefined ? [] : [health];
    });
    const failures = observed.reduce(
      (maximum, health) => Math.max(maximum, health.consecutiveFailures),
      0,
    );
    const open = observed.some(
      (health) => health.state === "open" || health.state === "unavailable",
    );
    if (open || failures >= this.thresholds.openThreshold)
      return {
        operationName,
        state: "OPEN",
        consecutiveFailures: failures,
        recoverySuccesses: 0,
        reasonCode: "UGV_OPERATION_FAILURE_BUDGET_OPEN",
      };
    if (failures >= this.thresholds.degradedThreshold)
      return {
        operationName,
        state: "DEGRADED",
        consecutiveFailures: failures,
        recoverySuccesses: 0,
        reasonCode: "PUBLIC_AVAILABILITY_DEGRADED_REPRESENTATION_GAP",
      };
    if (
      previous.state === "OPEN" ||
      previous.state === "DEGRADED" ||
      previous.state === "RECOVERING"
    ) {
      const recoverySuccesses = previous.recoverySuccesses + 1;
      if (recoverySuccesses < this.thresholds.recoverySuccessThreshold)
        return {
          operationName,
          state: "RECOVERING",
          consecutiveFailures: failures,
          recoverySuccesses,
          reasonCode: "UGV_OPERATION_RECOVERY_STABILIZING",
        };
    }
    return healthy(operationName);
  }
}

function healthy(operationName: string): UgvOperationHealthSnapshot {
  return {
    operationName,
    state: "HEALTHY",
    consecutiveFailures: 0,
    recoverySuccesses: 0,
    reasonCode: "UGV_OPERATION_HEALTHY",
  };
}

import type { ProviderExecutionState } from "../../provider-adapter-kit/src/index.js";
import type { VehicleTaskState } from "./types.js";

export interface MappedTaskState {
  state: ProviderExecutionState | "RECONCILE";
  reasonCode: string;
}

export function mapVehicleTaskState(
  state: VehicleTaskState,
  hasActiveExecution: boolean,
  reasonPrefix = "UGV",
): MappedTaskState {
  switch (state) {
    case 0:
      return { state: "STARTING", reasonCode: `${reasonPrefix}_WAITING_START_CONFIRMATION` };
    case 1:
      return { state: "RUNNING", reasonCode: `${reasonPrefix}_DEVICE_TASK_RUNNING` };
    case 2:
      return { state: "PAUSED", reasonCode: `${reasonPrefix}_DEVICE_TASK_PAUSED` };
    case 3:
      return { state: "CANCELLED", reasonCode: `${reasonPrefix}_DEVICE_TASK_CANCELLED` };
    case 4:
      return { state: "SUCCEEDED", reasonCode: `${reasonPrefix}_DEVICE_TASK_COMPLETED` };
    case 5:
      return { state: "BUSINESS_FAILED", reasonCode: `${reasonPrefix}_DEVICE_TASK_FAILED` };
    case -1:
      return hasActiveExecution
        ? { state: "RECONCILE", reasonCode: "UNCERTAIN_EXECUTION_STATE" }
        : { state: "ACCEPTED", reasonCode: `${reasonPrefix}_DEVICE_IDLE` };
    case "unknown":
      return { state: "RECONCILE", reasonCode: "UNCERTAIN_EXECUTION_STATE" };
  }
}

export function monotonicProgress(previous: number | undefined, next: unknown): number | undefined {
  if (typeof next !== "number" || !Number.isFinite(next) || next < 0 || next > 100) return previous;
  return previous === undefined ? next : Math.max(previous, next);
}

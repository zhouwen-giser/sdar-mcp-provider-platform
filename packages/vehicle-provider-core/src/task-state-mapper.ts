import type { ProviderExecutionState } from "../../provider-adapter-kit/src/index.js";
import type { ReconMotionStatus, VehicleTaskState } from "./types.js";

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

export function mapReconMotionStatus(
  status: ReconMotionStatus,
  hasActiveExecution: boolean,
  reasonPrefix = "UGV",
): MappedTaskState {
  switch (status) {
    case 1:
      return hasActiveExecution
        ? { state: "RECONCILE", reasonCode: `${reasonPrefix}_RECON_IDLE_UNCONFIRMED` }
        : { state: "ACCEPTED", reasonCode: `${reasonPrefix}_RECON_IDLE` };
    case 2:
      return { state: "STARTING", reasonCode: `${reasonPrefix}_RECON_CONFIGURING` };
    case 3:
      return { state: "STARTING", reasonCode: `${reasonPrefix}_RECON_READY` };
    case 4:
      return { state: "STARTING", reasonCode: `${reasonPrefix}_RECON_STARTING` };
    case 5:
      return { state: "RUNNING", reasonCode: `${reasonPrefix}_RECON_RUNNING` };
    case 6:
      return { state: "RESUMING", reasonCode: `${reasonPrefix}_RECON_RECOVERING` };
    case 7:
      return { state: "RUNNING", reasonCode: `${reasonPrefix}_RECON_PAUSING` };
    case 8:
      return { state: "PAUSED", reasonCode: `${reasonPrefix}_RECON_PAUSED` };
    case 9:
      return { state: "CANCELLED", reasonCode: `${reasonPrefix}_RECON_TERMINATED` };
    case 10:
      return { state: "BUSINESS_FAILED", reasonCode: `${reasonPrefix}_RECON_FAILED` };
    case 11:
      return { state: "SUCCEEDED", reasonCode: `${reasonPrefix}_RECON_FINISHED` };
    case 12:
      return { state: "STOPPING", reasonCode: `${reasonPrefix}_RECON_STOPPING` };
    case 13:
      return { state: "RECONCILE", reasonCode: `${reasonPrefix}_RECON_MANUAL_INTERVENTION` };
    case 99:
    case "unknown":
      return { state: "RECONCILE", reasonCode: "UNCERTAIN_EXECUTION_STATE" };
  }
}

export function projectReconMotionStatus(status: ReconMotionStatus): VehicleTaskState {
  switch (status) {
    case 1:
      return -1;
    case 2:
    case 3:
    case 4:
      return 0;
    case 5:
    case 6:
    case 7:
    case 12:
      return 1;
    case 8:
      return 2;
    case 9:
      return 3;
    case 10:
      return 5;
    case 11:
      return 4;
    case 13:
    case 99:
    case "unknown":
      return "unknown";
  }
}

export function monotonicProgress(previous: number | undefined, next: unknown): number | undefined {
  if (typeof next !== "number" || !Number.isFinite(next) || next < 0 || next > 100) return previous;
  return previous === undefined ? next : Math.max(previous, next);
}

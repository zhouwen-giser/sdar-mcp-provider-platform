import type { RuntimeDeploymentDesiredState } from "./model.js";
import type { RuntimeInfrastructureProcessState } from "./ports/runtime-infrastructure-adapter.js";

export class RuntimeDatabaseSwitchGuardError extends Error {
  readonly code = "RUNTIME_DATABASE_SWITCH_REQUIRES_ALL_STOPPED";

  constructor(
    readonly details: Readonly<{
      desiredState: RuntimeDeploymentDesiredState;
      desiredReplicas: number;
      processCount: number;
      stoppedProcessCount: number;
    }>,
  ) {
    super("RUNTIME_DATABASE_SWITCH_REQUIRES_ALL_STOPPED");
    this.name = "RuntimeDatabaseSwitchGuardError";
  }
}

export interface RuntimeDatabaseSwitchGuardInput {
  readonly currentDatabaseProfileId: string;
  readonly targetDatabaseProfileId: string;
  readonly desiredState: RuntimeDeploymentDesiredState;
  readonly desiredReplicas: number;
  readonly processStates: readonly RuntimeInfrastructureProcessState[];
}

export type RuntimeDatabaseSwitchGuardResult =
  | { readonly outcome: "unchanged"; readonly allStopRequired: false }
  | { readonly outcome: "allowed"; readonly allStopRequired: true };

export function guardRuntimeDatabaseSwitch(
  input: RuntimeDatabaseSwitchGuardInput,
): RuntimeDatabaseSwitchGuardResult {
  if (input.currentDatabaseProfileId === input.targetDatabaseProfileId) {
    return Object.freeze({ outcome: "unchanged", allStopRequired: false });
  }
  const allStopped = input.processStates.every((state) => ["missing", "stopped"].includes(state));
  if (input.desiredState !== "stopped" || input.desiredReplicas !== 0 || !allStopped) {
    throw new RuntimeDatabaseSwitchGuardError(
      Object.freeze({
        desiredState: input.desiredState,
        desiredReplicas: input.desiredReplicas,
        processCount: input.processStates.length,
        stoppedProcessCount: input.processStates.filter((state) =>
          ["missing", "stopped"].includes(state),
        ).length,
      }),
    );
  }
  return Object.freeze({ outcome: "allowed", allStopRequired: true });
}

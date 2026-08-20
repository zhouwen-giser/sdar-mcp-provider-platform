import type {
  DeviceToolHealthSnapshot,
  UgvDeviceToolName,
  VehicleOperationPhase,
} from "../../../packages/vehicle-device-mcp-client/src/index.js";
import {
  isAllowedUgvDeviceTool,
  requiredDeviceToolsForVehicleOperation,
  resolveVehicleOperationVariant,
  UgvOperationQualificationService,
  vehicleOperationProfile,
} from "../../../packages/vehicle-device-mcp-client/src/index.js";

export type UgvOperationHealthState = "HEALTHY" | "DEGRADED" | "OPEN" | "RECOVERING";

export interface UgvOperationHealthSnapshot {
  operationName: string;
  phase: VehicleOperationPhase;
  variant?: string;
  requiredTools: readonly UgvDeviceToolName[];
  state: UgvOperationHealthState;
  consecutiveFailures: number;
  recoverySuccesses: number;
  reasonCode: string;
}

interface HealthContext {
  key: string;
  operationName: string;
  phase: VehicleOperationPhase;
  variant?: string;
  requiredTools: readonly UgvDeviceToolName[];
}

export class UgvOperationHealthTracker {
  readonly #tools = new Map<UgvDeviceToolName, DeviceToolHealthSnapshot<UgvDeviceToolName>>();
  readonly #contexts = new Map<string, HealthContext>();
  readonly #snapshots = new Map<string, UgvOperationHealthSnapshot>();

  constructor(
    readonly thresholds: {
      degradedThreshold: number;
      openThreshold: number;
      recoverySuccessThreshold: number;
    },
    readonly qualification = new UgvOperationQualificationService(),
  ) {}

  recordToolHealth(
    health: DeviceToolHealthSnapshot<UgvDeviceToolName>,
  ): readonly { previous: UgvOperationHealthSnapshot; current: UgvOperationHealthSnapshot }[] {
    this.#tools.set(health.toolName, structuredClone(health));
    const transitions: {
      previous: UgvOperationHealthSnapshot;
      current: UgvOperationHealthSnapshot;
    }[] = [];
    for (const context of this.#contexts.values()) {
      if (!context.requiredTools.includes(health.toolName)) continue;
      const previous = this.#snapshots.get(context.key) ?? healthy(context);
      const current = this.#evaluate(context, previous, true);
      this.#snapshots.set(context.key, current);
      if (previous.state !== current.state || previous.reasonCode !== current.reasonCode)
        transitions.push({
          previous: structuredClone(previous),
          current: structuredClone(current),
        });
    }
    return transitions;
  }

  snapshot(
    operationName: string,
    argumentsValue: Readonly<Record<string, unknown>> = {},
    phase?: VehicleOperationPhase,
  ): UgvOperationHealthSnapshot {
    const context = this.#context(operationName, argumentsValue, phase);
    const previous = this.#snapshots.get(context.key) ?? healthy(context);
    const current = this.#evaluate(context, previous, false);
    this.#snapshots.set(context.key, current);
    return structuredClone(current);
  }

  snapshots(): readonly UgvOperationHealthSnapshot[] {
    return [...this.#snapshots.values()].map((value) => structuredClone(value));
  }

  #context(
    operationName: string,
    argumentsValue: Readonly<Record<string, unknown>>,
    requestedPhase?: VehicleOperationPhase,
  ): HealthContext {
    const profile = vehicleOperationProfile(operationName, this.qualification.profiles);
    const phase =
      requestedPhase ?? (profile?.execution === "SYNCHRONOUS" ? "read" : ("start" as const));
    const variant =
      profile === undefined
        ? undefined
        : resolveVehicleOperationVariant(profile, argumentsValue)?.variant;
    const key = `${operationName}\0${phase}\0${variant ?? ""}`;
    const existing = this.#contexts.get(key);
    if (existing !== undefined) return existing;
    const requiredTools = requiredDeviceToolsForVehicleOperation(
      operationName,
      argumentsValue,
      phase,
      this.qualification.profiles,
    ).filter(isAllowedUgvDeviceTool);
    const context: HealthContext = {
      key,
      operationName,
      phase,
      ...(variant === undefined ? {} : { variant }),
      requiredTools,
    };
    this.#contexts.set(key, context);
    return context;
  }

  #evaluate(
    context: HealthContext,
    previous: UgvOperationHealthSnapshot,
    advanceRecovery: boolean,
  ): UgvOperationHealthSnapshot {
    const observed = context.requiredTools.flatMap((tool) => {
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
      return unhealthy(context, "OPEN", failures, 0, "UGV_OPERATION_FAILURE_BUDGET_OPEN");
    if (failures >= this.thresholds.degradedThreshold)
      return unhealthy(
        context,
        "DEGRADED",
        failures,
        0,
        "PUBLIC_AVAILABILITY_DEGRADED_REPRESENTATION_GAP",
      );
    if (
      previous.state === "OPEN" ||
      previous.state === "DEGRADED" ||
      previous.state === "RECOVERING"
    ) {
      const recoverySuccesses = previous.recoverySuccesses + (advanceRecovery ? 1 : 0);
      if (recoverySuccesses < this.thresholds.recoverySuccessThreshold)
        return unhealthy(
          context,
          "RECOVERING",
          failures,
          recoverySuccesses,
          "UGV_OPERATION_RECOVERY_STABILIZING",
        );
    }
    return healthy(context);
  }
}

function healthy(context: HealthContext): UgvOperationHealthSnapshot {
  return {
    operationName: context.operationName,
    phase: context.phase,
    ...(context.variant === undefined ? {} : { variant: context.variant }),
    requiredTools: [...context.requiredTools],
    state: "HEALTHY",
    consecutiveFailures: 0,
    recoverySuccesses: 0,
    reasonCode: "UGV_OPERATION_HEALTHY",
  };
}

function unhealthy(
  context: HealthContext,
  state: UgvOperationHealthState,
  consecutiveFailures: number,
  recoverySuccesses: number,
  reasonCode: string,
): UgvOperationHealthSnapshot {
  return {
    ...healthy(context),
    state,
    consecutiveFailures,
    recoverySuccesses,
    reasonCode,
  };
}

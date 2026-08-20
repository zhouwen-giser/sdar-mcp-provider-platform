import { describe, expect, it } from "vitest";
import {
  UGV_OPERATION_PROFILES,
  UgvOperationQualificationService,
  mockUgvToolContracts,
  type CapturedToolContract,
  type DeviceToolHealthSnapshot,
  type UgvDeviceToolName,
} from "../../packages/vehicle-device-mcp-client/src/index.js";

describe("UGV operation qualification matrix", () => {
  const contracts = mockUgvToolContracts("2026-08-20T00:00:00.000Z");

  it("selects navigation variants and lifecycle phases from one operation profile", () => {
    const service = new UgvOperationQualificationService();
    expect(
      service.qualify({
        operationName: "vehicle_navigate",
        arguments: { mission: { type: "point" } },
        contracts,
        executionMode: "simulation",
      }),
    ).toMatchObject({
      qualified: true,
      variant: "point",
      phase: "start",
      resultPolicyId: "ugv.navigation.v1",
      requiredTools: ["ugv_path_follow_mission", "ugv_mission_control"],
      reasonCodes: ["UGV_OPERATION_QUALIFIED"],
    });
    expect(
      service.qualify({
        operationName: "vehicle_navigate",
        arguments: { mission: { type: "distance" } },
        contracts,
        executionMode: "live",
      }),
    ).toMatchObject({
      qualified: true,
      executionMode: "live",
      variant: "distance",
      requiredTools: ["ugv_move_distance", "ugv_mission_control"],
    });
    expect(
      service.qualify({
        operationName: "vehicle_navigate",
        arguments: { mission: { type: "route" } },
        phase: "resume",
        contracts,
        executionMode: "simulation",
      }),
    ).toMatchObject({
      qualified: true,
      variant: "route",
      phase: "resume",
      requiredTools: ["ugv_mission_control"],
    });
  });

  it("generates the bounded qualification report and broad health inventory from the same profiles", () => {
    const service = new UgvOperationQualificationService();
    const matrix = service.matrix({
      contracts: contracts.map((contract) => {
        const withoutOutput = { ...contract };
        delete withoutOutput.outputSchema;
        return withoutOutput;
      }),
      executionMode: "simulation",
    });
    expect(
      matrix
        .filter(({ operationName }) => operationName === "vehicle_navigate")
        .map(({ variant }) => variant),
    ).toEqual(["point", "route", "distance", "return_home"]);
    expect(
      matrix
        .filter(({ operationName }) => operationName === "vehicle_area_recon")
        .map(({ variant }) => variant),
    ).toEqual(["area", "circular"]);
    expect(matrix.every(({ qualified }) => qualified)).toBe(true);
    expect(service.inventoryTools("vehicle_navigate")).toEqual([
      "ugv_path_follow_mission",
      "ugv_return_home",
      "ugv_move_distance",
      "ugv_mission_control",
    ]);
  });

  it("accepts undeclared output only with runtime validation and preserves exact diagnostics", () => {
    const outputUndeclared = withoutOutputSchema(contracts, "ugv_path_follow_mission");
    const service = new UgvOperationQualificationService();
    const accepted = service.qualify({
      operationName: "vehicle_navigate",
      arguments: { mission: { type: "point" } },
      contracts: outputUndeclared,
      executionMode: "simulation",
    });
    expect(accepted).toMatchObject({
      qualified: true,
      reasonCodes: [
        "UGV_OPERATION_QUALIFIED",
        "UGV_TOOL_OUTPUT_SCHEMA_UNDECLARED_RUNTIME_VALIDATED",
      ],
    });
    expect(accepted.tools[0]).toMatchObject({
      toolName: "ugv_path_follow_mission",
      compatibility: "PRESENT_INPUT_COMPATIBLE_OUTPUT_UNDECLARED",
      usable: true,
      reasonCodes: ["UGV_TOOL_OUTPUT_SCHEMA_UNDECLARED_RUNTIME_VALIDATED"],
    });

    const profilesWithoutValidation = UGV_OPERATION_PROFILES.map((profile) =>
      profile.operationName === "vehicle_navigate"
        ? {
            ...profile,
            resultPolicy: { ...profile.resultPolicy, runtimeValidation: false },
          }
        : profile,
    );
    expect(
      new UgvOperationQualificationService(profilesWithoutValidation).qualify({
        operationName: "vehicle_navigate",
        arguments: { mission: { type: "point" } },
        contracts: outputUndeclared,
        executionMode: "simulation",
      }),
    ).toMatchObject({
      qualified: false,
      reasonCodes: ["UGV_TOOL_RESULT_POLICY_UNVERIFIED"],
    });
  });

  it("fails closed for missing, input-drifted, output-drifted and unverified tools", () => {
    const service = new UgvOperationQualificationService();
    expect(
      qualifyPoint(
        service,
        contracts.filter(({ name }) => name !== "ugv_path_follow_mission"),
      ),
    ).toMatchObject({ qualified: false, reasonCodes: ["UGV_TOOL_MISSING"] });

    const inputDrift = contracts.map((contract) =>
      contract.name === "ugv_path_follow_mission"
        ? { ...contract, inputSchema: { type: "object", properties: {} } }
        : contract,
    );
    expect(qualifyPoint(service, inputDrift)).toMatchObject({
      qualified: false,
      reasonCodes: ["UGV_TOOL_INPUT_SCHEMA_MISMATCH"],
    });

    const outputDrift = contracts.map((contract) =>
      contract.name === "ugv_path_follow_mission"
        ? { ...contract, outputSchema: { type: "object", properties: {} } }
        : contract,
    );
    expect(qualifyPoint(service, outputDrift)).toMatchObject({
      qualified: false,
      reasonCodes: ["UGV_TOOL_OUTPUT_SCHEMA_MISMATCH"],
    });

    expect(
      service.qualify({
        operationName: "vehicle_navigate",
        arguments: { mission: { type: "point" } },
        contracts,
        externallyVerified: false,
        executionMode: "simulation",
      }),
    ).toMatchObject({
      qualified: false,
      reasonCodes: ["UGV_TOOL_EXTERNAL_VERIFICATION_REQUIRED"],
    });
  });

  it("combines contract facts with per-tool health without rejecting degraded tools", () => {
    const service = new UgvOperationQualificationService();
    expect(
      qualifyPoint(service, contracts, [health("ugv_path_follow_mission", "degraded")]),
    ).toMatchObject({
      qualified: true,
    });
    expect(
      qualifyPoint(service, contracts, [health("ugv_path_follow_mission", "open")]),
    ).toMatchObject({
      qualified: false,
      reasonCodes: ["UGV_TOOL_CIRCUIT_OPEN"],
    });
    expect(
      qualifyPoint(service, contracts, [health("ugv_path_follow_mission", "unavailable")]),
    ).toMatchObject({
      qualified: false,
      reasonCodes: ["UGV_TOOL_UNAVAILABLE"],
    });
  });

  it("fails an unknown operation without inventing tools", () => {
    expect(
      new UgvOperationQualificationService().qualify({
        operationName: "vehicle_unknown",
        contracts,
        executionMode: "simulation",
      }),
    ).toEqual({
      operationName: "vehicle_unknown",
      executionMode: "simulation",
      phase: "start",
      requiredTools: [],
      tools: [],
      qualified: false,
      reasonCodes: ["UGV_OPERATION_UNSUPPORTED"],
    });
  });
});

function qualifyPoint(
  service: UgvOperationQualificationService,
  contracts: readonly CapturedToolContract[],
  toolHealth: readonly DeviceToolHealthSnapshot<UgvDeviceToolName>[] = [],
) {
  return service.qualify({
    operationName: "vehicle_navigate",
    arguments: { mission: { type: "point" } },
    contracts,
    toolHealth,
    executionMode: "simulation",
  });
}

function withoutOutputSchema(
  contracts: readonly CapturedToolContract[],
  toolName: string,
): CapturedToolContract[] {
  return contracts.map((contract) => {
    if (contract.name !== toolName) return contract;
    const withoutOutput = { ...contract };
    delete withoutOutput.outputSchema;
    return withoutOutput;
  });
}

function health(
  toolName: UgvDeviceToolName,
  state: DeviceToolHealthSnapshot<UgvDeviceToolName>["state"],
): DeviceToolHealthSnapshot<UgvDeviceToolName> {
  return { toolName, state, consecutiveFailures: state === "healthy" ? 0 : 1 };
}

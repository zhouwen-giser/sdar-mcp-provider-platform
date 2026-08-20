import { describe, expect, it } from "vitest";
import { UgvOperationHealthTracker } from "../../apps/ugv-provider-adapter/src/operation-health.js";
import {
  buildUgvCompatibilityProfile,
  isUgvToolCompatibilityUsable,
  mockUgvToolContracts,
  UGV_OPERATION_PROFILES,
  type VehicleOperationProfile,
} from "../../packages/vehicle-device-mcp-client/src/index.js";
import {
  authoritativeVehiclePosition,
  capturePhysicalDispatchBaseline,
  createUgvSnapshot,
  navigationPhysicalConfirmation,
  navigationTerminalFacts,
  reconTerminalFacts,
  stationaryPhysicalConfirmation,
  vehiclePositionDisplacementM,
  type PhysicalObservationAuthority,
} from "../../packages/vehicle-provider-core/src/index.js";

const freshness = { chassis: 3_000, mission: 3_000, health: 5_000, target: 3_000, payload: 3_000 };

describe("UGV pre-simulator hardening", () => {
  it("qualifies compatible, missing, mismatched, undeclared-output, and unverified contracts", () => {
    const contracts = mockUgvToolContracts("2026-08-17T00:00:00.000Z");
    expect(operation(contracts, "vehicle_navigate").status).toBe("PRESENT_COMPATIBLE");

    const missingRequired = contracts.filter(({ name }) => name !== "ugv_move_distance");
    expect(operation(missingRequired, "vehicle_navigate").status).toBe("MISSING_REQUIRED");

    const mismatched = contracts.map((contract) =>
      contract.name === "ugv_move_distance"
        ? { ...contract, outputSchema: { type: "object", properties: {} } }
        : contract,
    );
    expect(operation(mismatched, "vehicle_navigate").status).toBe("PRESENT_OUTPUT_SCHEMA_MISMATCH");

    const inputDrift = contracts.map((contract) =>
      contract.name === "ugv_mission_control"
        ? { ...contract, inputSchema: { type: "object", properties: {} } }
        : contract,
    );
    const navigationWithInputDrift = operation(inputDrift, "vehicle_navigate");
    expect(navigationWithInputDrift.status).toBe("PRESENT_INPUT_SCHEMA_MISMATCH");
    expect(
      navigationWithInputDrift.tools.find(({ toolName }) => toolName === "ugv_mission_control"),
    ).toMatchObject({
      taskControl: true,
      missionIdSemantics: "controls",
      missingInputProperties: ["action", "mission_id"],
    });

    const outputUndeclared = contracts.map((contract) => {
      if (contract.name !== "ugv_move_distance") return contract;
      const withoutOutputSchema = { ...contract };
      delete withoutOutputSchema.outputSchema;
      return withoutOutputSchema;
    });
    const navigationWithUndeclaredOutput = operation(outputUndeclared, "vehicle_navigate");
    expect(navigationWithUndeclaredOutput.status).toBe(
      "PRESENT_INPUT_COMPATIBLE_OUTPUT_UNDECLARED",
    );
    expect(
      navigationWithUndeclaredOutput.tools.find(({ toolName }) => toolName === "ugv_move_distance"),
    ).toMatchObject({
      status: "PRESENT_INPUT_COMPATIBLE_OUTPUT_UNDECLARED",
      outputSchemaDeclared: false,
      runtimeResultValidation: true,
      missingOutputProperties: ["mission_id", "state", "state_label", "message"],
    });
    expect(isUgvToolCompatibilityUsable(navigationWithUndeclaredOutput.status)).toBe(true);

    const profilesWithoutRuntimeValidation = UGV_OPERATION_PROFILES.map((profile) =>
      profile.operationName === "vehicle_navigate"
        ? {
            ...profile,
            resultPolicy: { ...profile.resultPolicy, runtimeValidation: false },
          }
        : profile,
    );
    expect(
      operation(outputUndeclared, "vehicle_navigate", true, profilesWithoutRuntimeValidation)
        .status,
    ).toBe("PRESENT_OUTPUT_SCHEMA_MISMATCH");

    const noLaser = contracts.filter(({ name }) => name !== "ugv_laser_range");
    expect(operation(noLaser, "vehicle_laser_range").status).toBe("MISSING_OPTIONAL");
    expect(operation(noLaser, "vehicle_get_state").status).toBe("PRESENT_COMPATIBLE");
    expect(operation(contracts, "vehicle_navigate", false).status).toBe("UNVERIFIED_EXTERNAL");
  });

  it("requires post-dispatch mission, position, and speed authority for navigation", () => {
    const now = Date.parse("2026-08-17T00:00:02.000Z");
    const before = snapshot("2026-08-17T00:00:00.000Z", 30, 114, 4);
    const baselineAuthorities = authorities("2026-08-17T00:00:00.000Z", 1);
    const baseline = capturePhysicalDispatchBaseline(
      before,
      baselineAuthorities,
      "2026-08-17T00:00:01.000Z",
    );
    const after = snapshot("2026-08-17T00:00:02.000Z", 30.0001, 114.0001, 0);
    after.chassis.mission = {
      id: "7",
      state: 4,
      progress: 100,
      observedAt: "2026-08-17T00:00:02.000Z",
    };

    const stale = navigationPhysicalConfirmation({
      snapshot: after,
      baseline,
      missionId: "7",
      currentAuthorities: baselineAuthorities,
      freshness,
      stationarySpeedThresholdKmh: 0.1,
      now,
    });
    expect(stale).toMatchObject({
      confirmed: false,
      reasonCode: "UGV_PHYSICAL_OBSERVATION_NOT_NEW",
    });

    const confirmed = navigationPhysicalConfirmation({
      snapshot: after,
      baseline,
      missionId: "7",
      currentAuthorities: authorities("2026-08-17T00:00:02.000Z", 2),
      freshness,
      stationarySpeedThresholdKmh: 0.1,
      now,
    });
    expect(confirmed).toMatchObject({
      confirmed: true,
      correlation: "STRICT_CORRELATED",
      positionFresh: true,
      speedFresh: true,
      stationary: true,
    });
    expect(
      navigationTerminalFacts({
        snapshot: after,
        baseline,
        currentAuthorities: authorities("2026-08-17T00:00:02.000Z", 2),
        missionId: "7",
        requestedDistanceM: 10,
        confirmation: confirmed,
      }),
    ).toMatchObject({
      requestedDistanceM: 10,
      startPosition: {
        type: "geodetic",
        latitude: 30,
        longitude: 114,
        crs: "EPSG:4326",
      },
      endPosition: {
        type: "geodetic",
        latitude: 30.0001,
        longitude: 114.0001,
        crs: "EPSG:4326",
      },
      positionAuthority: {
        field: "chassis.position.geodetic",
        topic: "/ugv/gnss",
      },
      stationaryAtCompletion: true,
      correlationStrength: "STRICT_CORRELATED",
      observationAuthority: "post_dispatch",
    });
  });

  it("computes displacement only for compatible geodetic or local authorities", () => {
    const geodetic = vehiclePositionDisplacementM(
      { type: "geodetic", latitude: 30, longitude: 114, crs: "EPSG:4326" },
      { type: "geodetic", latitude: 30.0001, longitude: 114.0001, crs: "EPSG:4326" },
    );
    expect(geodetic).toBeGreaterThan(14);
    expect(geodetic).toBeLessThan(15);

    expect(
      vehiclePositionDisplacementM(
        { type: "local", x: 1, y: 2, frame: "carla_world", unit: "m" },
        { type: "local", x: 4, y: 6, frame: "carla_world", unit: "m" },
      ),
    ).toBe(5);
    expect(
      vehiclePositionDisplacementM(
        { type: "local", x: 1, y: 2, frame: "carla_world", unit: "m" },
        { type: "local", x: 4, y: 6, frame: "map", unit: "m" },
      ),
    ).toBeUndefined();
    expect(
      vehiclePositionDisplacementM(
        { type: "geodetic", latitude: 30, longitude: 114, crs: "EPSG:4326" },
        { type: "local", x: 4, y: 6, frame: "carla_world", unit: "m" },
      ),
    ).toBeUndefined();

    const value = snapshot("2026-08-17T00:00:02.000Z", 30, 114, 0);
    value.chassis.navigation = { positionX: 3, positionY: 4, positionZ: 5 };
    const selected = authoritativeVehiclePosition(value, [
      requiredAuthority(authorities("2026-08-17T00:00:01.000Z", 1), "chassis.position.geodetic"),
      {
        field: "chassis.position.local",
        topic: "/ugv/nav_state",
        observedAt: "2026-08-17T00:00:02.000Z",
        timeAuthority: "source",
        sourceSequence: "2",
        ingestSequence: 2,
        payloadHash: "2".padStart(64, "0"),
        cursor: "local:2",
      },
    ]);
    expect(selected).toMatchObject({
      observation: {
        type: "local",
        x: 3,
        y: 4,
        z: 5,
        frame: "carla_world",
        unit: "m",
      },
      authority: { field: "chassis.position.local", topic: "/ugv/nav_state" },
    });
  });

  it("does not let a new speed observation refresh position or vice versa", () => {
    const baselineAuthorities = authorities("2026-08-17T00:00:00.000Z", 1);
    const baseline = capturePhysicalDispatchBaseline(
      snapshot("2026-08-17T00:00:00.000Z", 30, 114, 1),
      baselineAuthorities,
      "2026-08-17T00:00:01.000Z",
    );
    const after = snapshot("2026-08-17T00:00:04.000Z", 30.0001, 114.0001, 0);
    after.chassis.mission = {
      id: "7",
      state: 4,
      observedAt: "2026-08-17T00:00:04.000Z",
    };
    const updated = authorities("2026-08-17T00:00:04.000Z", 2);

    const newSpeedOldPosition = navigationPhysicalConfirmation({
      snapshot: after,
      baseline,
      missionId: "7",
      currentAuthorities: updated.map((authority) =>
        authority.field === "chassis.position.geodetic"
          ? requiredAuthority(baselineAuthorities, authority.field)
          : authority,
      ),
      freshness,
      stationarySpeedThresholdKmh: 0.1,
      now: Date.parse("2026-08-17T00:00:04.000Z"),
    });
    expect(newSpeedOldPosition).toMatchObject({
      confirmed: false,
      observationIsNew: false,
      positionFresh: false,
      speedFresh: true,
    });

    const newPositionOldSpeed = navigationPhysicalConfirmation({
      snapshot: after,
      baseline,
      missionId: "7",
      currentAuthorities: updated.map((authority) =>
        authority.field === "chassis.speed"
          ? requiredAuthority(baselineAuthorities, authority.field)
          : authority,
      ),
      freshness,
      stationarySpeedThresholdKmh: 0.1,
      now: Date.parse("2026-08-17T00:00:04.000Z"),
    });
    expect(newPositionOldSpeed).toMatchObject({
      confirmed: false,
      observationIsNew: false,
      positionFresh: true,
      speedFresh: false,
      stationary: null,
    });
  });

  it("never treats missing, stale, or nonzero speed as stopped", () => {
    const now = Date.parse("2026-08-17T00:00:02.000Z");
    const baselineSnapshot = snapshot("2026-08-17T00:00:00.000Z", 30, 114, 1);
    const baseline = capturePhysicalDispatchBaseline(
      baselineSnapshot,
      authorities("2026-08-17T00:00:00.000Z", 1),
      "2026-08-17T00:00:01.000Z",
    );
    const missing = snapshot("2026-08-17T00:00:02.000Z", 30, 114, undefined);
    expect(
      stationaryPhysicalConfirmation({
        snapshot: missing,
        baseline,
        currentAuthorities: authorities("2026-08-17T00:00:02.000Z", 2),
        freshness,
        stationarySpeedThresholdKmh: 0.1,
        now,
      }),
    ).toMatchObject({ confirmed: false, reasonCode: "UGV_STOP_SPEED_UNCONFIRMED" });

    const moving = snapshot("2026-08-17T00:00:02.000Z", 30, 114, 0.2);
    expect(
      stationaryPhysicalConfirmation({
        snapshot: moving,
        baseline,
        currentAuthorities: authorities("2026-08-17T00:00:02.000Z", 2),
        freshness,
        stationarySpeedThresholdKmh: 0.1,
        now,
      }),
    ).toMatchObject({ confirmed: false, stationary: false });

    const stale = snapshot("2026-08-16T23:59:55.000Z", 30, 114, 0);
    expect(
      stationaryPhysicalConfirmation({
        snapshot: stale,
        baseline,
        currentAuthorities: authorities("2026-08-16T23:59:55.000Z", 2),
        freshness,
        stationarySpeedThresholdKmh: 0.1,
        now,
      }),
    ).toMatchObject({ confirmed: false, speedFresh: false, stationary: null });

    const stopped = snapshot("2026-08-17T00:00:02.000Z", 30, 114, 0);
    expect(
      stationaryPhysicalConfirmation({
        snapshot: stopped,
        baseline,
        currentAuthorities: authorities("2026-08-17T00:00:02.000Z", 2),
        freshness,
        stationarySpeedThresholdKmh: 0.1,
        now,
      }),
    ).toMatchObject({ confirmed: true, stationary: true });
  });

  it("rejects missing position, mission mismatch, and older source authority", () => {
    const now = Date.parse("2026-08-17T00:00:02.000Z");
    const baseline = capturePhysicalDispatchBaseline(
      snapshot("2026-08-17T00:00:00.000Z", 30, 114, 1),
      authorities("2026-08-17T00:00:00.000Z", 5),
      "2026-08-17T00:00:01.000Z",
    );
    const missingPosition = createUgvSnapshot(undefined, "2026-08-17T00:00:02.000Z");
    missingPosition.chassis.speedKmh = 0;
    missingPosition.chassis.mission = {
      id: "7",
      state: 4,
      progress: 100,
      observedAt: "2026-08-17T00:00:02.000Z",
    };
    missingPosition.freshness.chassisObservedAt = "2026-08-17T00:00:02.000Z";
    expect(
      navigationPhysicalConfirmation({
        snapshot: missingPosition,
        baseline,
        missionId: "7",
        currentAuthorities: authorities("2026-08-17T00:00:02.000Z", 6),
        freshness,
        stationarySpeedThresholdKmh: 0.1,
        now,
      }),
    ).toMatchObject({ confirmed: false, reasonCode: "UGV_TERMINAL_POSITION_UNCONFIRMED" });

    const terminal = snapshot("2026-08-17T00:00:02.000Z", 30.1, 114.1, 0);
    terminal.chassis.mission = {
      id: "8",
      state: 4,
      progress: 100,
      observedAt: "2026-08-17T00:00:02.000Z",
    };
    expect(
      navigationPhysicalConfirmation({
        snapshot: terminal,
        baseline,
        missionId: "7",
        currentAuthorities: authorities("2026-08-17T00:00:02.000Z", 6),
        freshness,
        stationarySpeedThresholdKmh: 0.1,
        now,
      }),
    ).toMatchObject({ confirmed: false, correlation: "MISMATCH" });
    expect(
      navigationPhysicalConfirmation({
        snapshot: terminal,
        baseline,
        missionId: "8",
        currentAuthorities: authorities("2026-08-16T23:59:59.000Z", 4),
        freshness,
        stationarySpeedThresholdKmh: 0.1,
        now,
      }),
    ).toMatchObject({ confirmed: false, observationIsNew: false });
  });

  it("projects rich Recon facts without inventing a missing downstream correlation id", () => {
    const value = snapshot("2026-08-17T00:00:02.000Z", 30, 114, 0);
    value.payload.reconnaissance = {
      state: 4,
      motionStatus: 11,
      scanMode: 2,
      progress: 100,
      progressAuthoritative: true,
      coverage: { coveragePercent: 87, incomplete: false },
      coverability: { coverable: "full", coverableLabel: "qualified_fixture" },
      cameraFault: false,
      outOfRange: true,
      lastException: {
        kind: "equipment",
        reason: "fixture_exception",
        observedAt: value.observedAt,
      },
    };
    value.payload.targets = [
      { targetId: "target-1", source: "mqtt_area_recon", observedAt: value.observedAt },
    ];
    const facts = reconTerminalFacts({
      snapshot: value,
      expectedMissionId: "42",
      baseline: capturePhysicalDispatchBaseline(
        snapshot("2026-08-17T00:00:00.000Z", 30, 114, 0),
        authorities("2026-08-17T00:00:00.000Z", 1),
        "2026-08-17T00:00:01.000Z",
      ),
      currentAuthority: firstAuthority(authorities("2026-08-17T00:00:02.000Z", 2)),
    });
    expect(facts).toMatchObject({
      missionId: null,
      scanMode: 2,
      progress: 100,
      coverage: { coveragePercent: 87, incomplete: false },
      observedTargetCount: 1,
      terminalMotionStatus: 11,
      cameraFault: false,
      outOfRange: true,
      exception: { kind: "equipment", reason: "fixture_exception" },
      correlationStrength: "WEAK_UNCORRELATED",
      observationIsNew: true,
    });
  });

  it("uses failure thresholds and recovery hysteresis without flapping", () => {
    const tracker = new UgvOperationHealthTracker({
      degradedThreshold: 2,
      openThreshold: 3,
      recoverySuccessThreshold: 2,
    });
    const distanceArguments = { mission: { type: "distance" } };
    const pointArguments = { mission: { type: "point" } };
    tracker.snapshot("vehicle_navigate", distanceArguments);
    tracker.snapshot("vehicle_navigate", pointArguments);
    tracker.recordToolHealth({
      toolName: "ugv_move_distance",
      state: "degraded",
      consecutiveFailures: 2,
    });
    expect(tracker.snapshot("vehicle_navigate", distanceArguments)).toMatchObject({
      state: "DEGRADED",
      phase: "start",
      variant: "distance",
      requiredTools: ["ugv_move_distance", "ugv_mission_control"],
    });
    expect(tracker.snapshot("vehicle_navigate", pointArguments)).toMatchObject({
      state: "HEALTHY",
      variant: "point",
      requiredTools: ["ugv_path_follow_mission", "ugv_mission_control"],
    });
    tracker.recordToolHealth({
      toolName: "ugv_move_distance",
      state: "open",
      consecutiveFailures: 3,
    });
    expect(tracker.snapshot("vehicle_navigate", distanceArguments)).toMatchObject({
      state: "OPEN",
    });
    tracker.recordToolHealth({
      toolName: "ugv_move_distance",
      state: "healthy",
      consecutiveFailures: 0,
    });
    expect(tracker.snapshot("vehicle_navigate", distanceArguments)).toMatchObject({
      state: "RECOVERING",
      recoverySuccesses: 1,
    });
    expect(tracker.snapshot("vehicle_navigate", distanceArguments)).toMatchObject({
      state: "RECOVERING",
      recoverySuccesses: 1,
    });
    tracker.recordToolHealth({
      toolName: "ugv_move_distance",
      state: "healthy",
      consecutiveFailures: 0,
    });
    expect(tracker.snapshot("vehicle_navigate", distanceArguments)).toMatchObject({
      state: "HEALTHY",
    });
  });

  it("isolates lifecycle-phase health from the navigation start variant", () => {
    const tracker = new UgvOperationHealthTracker({
      degradedThreshold: 2,
      openThreshold: 3,
      recoverySuccessThreshold: 2,
    });
    const pointArguments = { mission: { type: "point" } };
    tracker.snapshot("vehicle_navigate", pointArguments, "pause");
    tracker.recordToolHealth({
      toolName: "ugv_path_follow_mission",
      state: "open",
      consecutiveFailures: 3,
    });
    expect(tracker.snapshot("vehicle_navigate", pointArguments, "pause")).toMatchObject({
      state: "HEALTHY",
      phase: "pause",
      requiredTools: ["ugv_mission_control"],
    });
    tracker.recordToolHealth({
      toolName: "ugv_mission_control",
      state: "open",
      consecutiveFailures: 3,
    });
    expect(tracker.snapshot("vehicle_navigate", pointArguments, "pause")).toMatchObject({
      state: "OPEN",
    });
  });
});

function operation(
  contracts: ReturnType<typeof mockUgvToolContracts>,
  operationName: string,
  externallyVerified = true,
  profiles: readonly VehicleOperationProfile[] = UGV_OPERATION_PROFILES,
) {
  const value = buildUgvCompatibilityProfile(contracts, externallyVerified, profiles).find(
    (candidate) => candidate.operationName === operationName,
  );
  if (value === undefined) throw new Error("UGV_TEST_OPERATION_MISSING");
  return value;
}

function snapshot(
  observedAt: string,
  latitude: number,
  longitude: number,
  speedKmh: number | undefined,
) {
  const value = createUgvSnapshot(undefined, observedAt);
  value.chassis.position = { latitude, longitude };
  if (speedKmh !== undefined) value.chassis.speedKmh = speedKmh;
  value.freshness.chassisObservedAt = observedAt;
  value.observedAt = observedAt;
  return value;
}

function authorities(observedAt: string, sequence: number): PhysicalObservationAuthority[] {
  return (
    [
      ["/ugv/mission_state", "chassis.mission"],
      ["/ugv/gnss", "chassis.position.geodetic"],
      ["/ugv/speed", "chassis.speed"],
    ] satisfies readonly [string, NonNullable<PhysicalObservationAuthority["field"]>][]
  ).map(([topic, field]) => ({
    field,
    topic,
    observedAt,
    timeAuthority: "source",
    sourceSequence: String(sequence),
    ingestSequence: sequence,
    payloadHash: String(sequence).padStart(64, "0"),
    cursor: `legacy-safe:${observedAt}:${String(sequence)}`,
  }));
}

function firstAuthority(values: PhysicalObservationAuthority[]): PhysicalObservationAuthority {
  const value = values[0];
  if (value === undefined) throw new Error("UGV_TEST_AUTHORITY_MISSING");
  return value;
}

function requiredAuthority(
  values: readonly PhysicalObservationAuthority[],
  field: NonNullable<PhysicalObservationAuthority["field"]>,
): PhysicalObservationAuthority {
  const value = values.find((authority) => authority.field === field);
  if (value === undefined) throw new Error("UGV_TEST_AUTHORITY_MISSING");
  return value;
}

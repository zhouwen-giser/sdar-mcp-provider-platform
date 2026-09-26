import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ugvManifest } from "../../apps/ugv-provider-adapter/src/manifest.js";
import {
  adapterServiceDefinition,
  protoStructToJson,
  TaskBusinessOperationProfileSchema,
  taskBusinessOperationProfileJsonSchema,
  TASK_BUSINESS_OPERATION_PROFILE_SCHEMA_VERSION,
  type ProviderManifest,
} from "../../packages/adapter-protocol/src/index.js";
import { OperationRegistry } from "../../packages/operation-registry/src/index.js";
import { MemoryProviderStore } from "../../packages/provider-adapter-kit/src/index.js";
import { mockUgvToolContracts } from "../../packages/vehicle-device-mcp-client/src/index.js";
import { TASK_BUSINESS_PROFILE_VERSION } from "../../packages/vehicle-provider-core/src/task-business-contract.js";

const qualifiedFixture = TaskBusinessOperationProfileSchema.parse({
  schemaVersion: TASK_BUSINESS_OPERATION_PROFILE_SCHEMA_VERSION,
  profileVersion: TASK_BUSINESS_PROFILE_VERSION,
  availability: "available",
  source: {
    sourceId: "vehicle.business",
    deliverySemantics: "durable_at_least_once",
    replaySupported: true,
  },
  artifactTypes: ["navigation.destination", "navigation.route", "navigation.trajectory"],
  actionTypes: ["navigation.replan"],
  requiredInputTypes: [],
  interventionTypes: ["navigation.adjust_plan"],
  methods: {
    contextGet: "io.sdar/taskBusiness/context/get",
    artifactGet: "io.sdar/taskBusiness/artifacts/get",
    eventsListen: "io.sdar/businessEvents/listen",
    contentGet: true,
    inputUpdate: false,
    interventionApply: true,
  },
  semantics: {
    artifact: ["requested", "planned", "observed"],
    coordinateFrames: ["OGC:CRS84", "sim-map-1"],
    observationClockDomains: ["utc", "simulator_relative"],
  },
  limits: { maxInlineArtifactBytes: 65_536, maxWaitMs: 300_000, trajectoryMinSamples: 2 },
  policy: {
    visualLockOwner: "disabled",
    decisionMode: "none",
    onExpire: "release_and_resume_scan",
    onDismiss: "release_and_resume_scan",
    footprintMode: "disabled",
    coverageMode: "disabled",
  },
  qualification: {
    routeAdoption: "qualified",
    footprint: "not_supported",
    automaticVisualLock: "not_supported",
    runtimeReplan: "qualified",
  },
});

function manifest(profile?: typeof qualifiedFixture): ProviderManifest {
  return ugvManifest(
    "isr.vehicle.ugv.ugv1",
    "1.0.0",
    new MemoryProviderStore(),
    "vehicle:ugv1",
    { contracts: mockUgvToolContracts("2026-09-23T00:00:00Z"), executionMode: "simulation" },
    profile === undefined ? undefined : { vehicle_navigate: profile },
  ) as unknown as ProviderManifest;
}

describe("operation-scoped task business discovery", () => {
  it("keeps snapshot-part support optional and accepts only the declared method", () => {
    expect(qualifiedFixture.methods.snapshotPartGet).toBeUndefined();
    const supported = TaskBusinessOperationProfileSchema.parse({
      ...qualifiedFixture,
      methods: {
        ...qualifiedFixture.methods,
        snapshotPartGet: "io.sdar/taskBusiness/snapshotParts/get",
      },
    });
    expect(supported.methods.snapshotPartGet).toBe("io.sdar/taskBusiness/snapshotParts/get");
    expect(
      TaskBusinessOperationProfileSchema.safeParse({
        ...qualifiedFixture,
        methods: { ...qualifiedFixture.methods, snapshotPartGet: "unrelated/part/get" },
      }).success,
    ).toBe(false);
  });

  it("generates a stable schema and omits the extension by default", () => {
    expect(
      JSON.parse(readFileSync("protocol/task-business/v1/operation-profile.schema.json", "utf8")),
    ).toEqual({
      profileVersion: TASK_BUSINESS_PROFILE_VERSION,
      source: "packages/adapter-protocol/src/task-business-profile.ts",
      schema: taskBusinessOperationProfileJsonSchema(),
    });
    const defaultManifest = manifest();
    expect(
      defaultManifest.operations.every(
        (operation) => operation.businessFeedbackProfile === undefined,
      ),
    ).toBe(true);
    expect(
      new OperationRegistry()
        .validate(defaultManifest)
        .operations.every(
          (operation) => operation.tool._meta["io.sdar/taskBusiness"] === undefined,
        ),
    ).toBe(true);
  });

  it("carries a synthetic qualified profile through Proto and only the named Operation", () => {
    const source = {
      sourceId: "vehicle.business",
      sourceStreamId: "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a1004",
      deliverySemantics: "durable_at_least_once" as const,
      replaySupported: true,
      sourceRetentionMs: "604800000",
      maxEventBytes: "65536",
      maxPayloadDepth: 16,
      maxPayloadNodes: 4096,
      maxPayloadStringBytes: "16384",
    };
    const original = manifest(qualifiedFixture);
    original.businessEventSources = [...(original.businessEventSources ?? []), source];
    const describe = adapterServiceDefinition().DescribeProvider;
    if (!describe) throw new Error("DESCRIBE_PROVIDER_MISSING");
    const decoded = describe.responseDeserialize(
      describe.responseSerialize(original),
    ) as ProviderManifest;
    const rawNavigate = decoded.operations.find(
      (operation) => operation.name === "vehicle_navigate",
    );
    expect(protoStructToJson(rawNavigate?.businessFeedbackProfile)).toEqual(qualifiedFixture);
    expect(
      decoded.operations.find((operation) => operation.name === "vehicle_area_recon")
        ?.businessFeedbackProfile,
    ).toBeNull();
    const validated = new OperationRegistry().validate(decoded);
    expect(
      validated.operations.find((operation) => operation.name === "vehicle_navigate")?.tool._meta[
        "io.sdar/taskBusiness"
      ],
    ).toEqual(qualifiedFixture);
    expect(
      validated.operations.find((operation) => operation.name === "vehicle_area_recon")?.tool._meta[
        "io.sdar/taskBusiness"
      ],
    ).toBeUndefined();
    const navigation = validated.operations.find(
      (operation) => operation.name === "vehicle_navigate",
    );
    if (!navigation) throw new Error("NAVIGATION_OPERATION_MISSING");
    const restored = new OperationRegistry().validateStoredDefinition(navigation.definition, {
      providerId: validated.providerId,
      providerVersion: validated.providerVersion,
      manifestHash: validated.manifestHash,
    });
    expect(restored.tool._meta["io.sdar/taskBusiness"]).toEqual(qualifiedFixture);
  });

  it("refuses false qualification and a missing durable source", () => {
    expect(
      TaskBusinessOperationProfileSchema.safeParse({
        ...qualifiedFixture,
        qualification: { ...qualifiedFixture.qualification, routeAdoption: "not_supported" },
      }).success,
    ).toBe(false);
    expect(
      TaskBusinessOperationProfileSchema.safeParse({
        ...qualifiedFixture,
        qualification: { ...qualifiedFixture.qualification, runtimeReplan: "not_supported" },
      }).success,
    ).toBe(false);
    expect(() => new OperationRegistry().validate(manifest(qualifiedFixture))).toThrow(
      "TASK_BUSINESS_SOURCE_NOT_DURABLE",
    );
    expect(
      TaskBusinessOperationProfileSchema.safeParse({ ...qualifiedFixture, profileVersion: "2.0" })
        .success,
    ).toBe(false);
  });
});

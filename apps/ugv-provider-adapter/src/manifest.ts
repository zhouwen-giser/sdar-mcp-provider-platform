import type { ProviderStore } from "../../../packages/provider-adapter-kit/src/index.js";
import type { UgvQualificationMatrixInput } from "../../../packages/vehicle-device-mcp-client/src/index.js";
import {
  vehicleProviderManifest,
  type VehicleManifestProfile,
} from "../../../packages/vehicle-provider-core/src/index.js";
import { qualifyUgvCapabilities } from "./capabilities.js";
import {
  HISTORY_QUERY_OPERATION,
  HISTORY_EVIDENCE_OPERATION,
  trajectoryHistorySchemas,
} from "../../../packages/trajectory-history/src/contract.js";
import { jsonToProtoStruct } from "../../../packages/adapter-protocol/src/index.js";
import type { TrajectoryHistoryReader } from "../../../packages/trajectory-history/src/reader.js";
import { historyKeyId } from "../../../packages/trajectory-history/src/proof.js";

export function ugvManifest(
  providerId: string,
  version: string,
  store: ProviderStore,
  resourceId: string,
  qualificationContext: UgvQualificationMatrixInput,
  businessFeedbackProfiles?: VehicleManifestProfile["businessFeedbackProfiles"],
  trajectoryHistory?: TrajectoryHistoryReader,
): Record<string, unknown> {
  const support = qualifyUgvCapabilities({
    contracts: qualificationContext.contracts,
    executionMode: qualificationContext.executionMode,
    ...(qualificationContext.externallyVerified === undefined
      ? {}
      : { externallyVerified: qualificationContext.externallyVerified }),
  }).support;
  const manifest = vehicleProviderManifest(
    {
      providerId,
      providerType: "isr.vehicle.ugv",
      providerVersion: version,
      resourceId,
      displayKind: "UGV",
      navigationSupport: support.navigation,
      supportsScanModes: support.reconnaissance.area,
      supportsCircularEoScan: support.reconnaissance.circular,
      supportsCapabilityQuery: support.capabilityQuery,
      supportsBusinessSemantics: true,
      supportsTargetTracking: support.targetTracking,
      supportsGimbalControl: support.gimbal,
      supportsNavigationPlanning: support.navigation.point,
      supportsFire: support.fire,
      supportsEmergencyStop: support.emergencyStop,
      supportsLaserRange: support.laserRange,
      supportsFireCancellationBeforeDispatch: support.fire,
      supportsFireCommandRejectedOutput: support.fire,
      supportsReconCoverageOutput: support.reconnaissance.area,
      circularScanOmitsArea: true,
      ...(businessFeedbackProfiles === undefined ? {} : { businessFeedbackProfiles }),
    },
    store,
  );
  if (trajectoryHistory) {
    const schemas = trajectoryHistorySchemas();
    const input = {
      ...schemas.query,
      properties: {
        ...schemas.query.properties,
        resourceId: { type: "string", const: resourceId },
      },
    };
    const operations = manifest.operations as Record<string, unknown>[];
    operations.push({
      name: HISTORY_QUERY_OPERATION,
      description: `Read trajectory reception history v1.0. Provider retained ranges are distinct from device-generation history. Pin Ed25519 key ${historyKeyId(trajectoryHistory.publicKey)} separately.`,
      execution: "SYNCHRONOUS",
      inputSchema: jsonToProtoStruct(input),
      outputSchema: jsonToProtoStruct(schemas.page),
      resourceBinding: { mode: "ARGUMENT_REFERENCE", resourceIdJsonPointer: "/resourceId" },
      capabilities: {
        availability: true,
        scheduling: false,
        maxElapsed: false,
        cancel: false,
        pauseResume: false,
        inputRequired: false,
        idempotency: true,
        observations: false,
      },
    });
    if (businessFeedbackProfiles)
      operations.push({
        name: HISTORY_EVIDENCE_OPERATION,
        description: `Read version 1.0 immutable coordinate-to-reception evidence for an authorized navigation Artifact. Legacy point times remain unknown. Pin Ed25519 key ${historyKeyId(trajectoryHistory.publicKey)} separately.`,
        execution: "SYNCHRONOUS",
        inputSchema: jsonToProtoStruct({
          ...schemas.evidenceQuery,
          properties: {
            ...schemas.evidenceQuery.properties,
            resourceId: { type: "string", const: resourceId },
          },
        }),
        outputSchema: jsonToProtoStruct(schemas.evidence),
        resourceBinding: { mode: "ARGUMENT_REFERENCE", resourceIdJsonPointer: "/resourceId" },
        capabilities: {
          availability: true,
          scheduling: false,
          maxElapsed: false,
          cancel: false,
          pauseResume: false,
          inputRequired: false,
          idempotency: true,
          observations: false,
        },
      });
  }
  return manifest;
}

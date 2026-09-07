export const SMPP_DIAGNOSTIC_SOURCE_COMMIT =
  process.env.SDAR_BUILD_REVISION ?? "acc65fe13f8aa61caacc6bd18cca08eed98ece40";

export const SMPP_CAPABILITY_IDS = [
  "SMPP-TASK-IDENTITY-CLOSURE",
  "SMPP-TASK-IDEMPOTENCY",
  "SMPP-DISPATCH-UNCERTAINTY",
  "SMPP-TASK-RECONCILIATION",
  "SMPP-PROVIDER-EVIDENCE",
  "SMPP-BUSINESS-TERMINAL",
  "SMPP-MISSION-RELATION",
] as const;

export type SmppCapabilityId = (typeof SMPP_CAPABILITY_IDS)[number];

export interface SmppExternalCapabilityV1 {
  schemaVersion: "sdar.external-capability/v1";
  capabilityId: SmppCapabilityId;
  status: "available" | "degraded" | "unavailable" | "conflict";
  readOnlyProbe: true;
  implementationKind: "production";
  component: "smpp-mcp-tasks-runtime";
  sourceCommit: string;
  qualification: {
    status: "passed" | "partial" | "failed" | "not_run";
    evidenceRefs: string[];
  };
  reasonCodes: string[];
  details: {
    authority: string;
    providerIndependent: true;
    claimsGoalSuccess: false;
  };
}

const definitions: Readonly<
  Record<SmppCapabilityId, Omit<SmppExternalCapabilityV1, "capabilityId">>
> = Object.freeze({
  "SMPP-TASK-IDENTITY-CLOSURE": capability(
    "TaskRepository+SmppDiagnosticRepository",
    "reports/smpp-ugv-diagnostic/phase-s2/report.md",
  ),
  "SMPP-TASK-IDEMPOTENCY": capability(
    "TaskEngine+IdempotencyRepository",
    "reports/smpp-ugv-diagnostic/phase-s3/report.md",
  ),
  "SMPP-DISPATCH-UNCERTAINTY": capability(
    "TaskEngine+TaskRepository",
    "reports/smpp-ugv-diagnostic/phase-s4/report.md",
  ),
  "SMPP-TASK-RECONCILIATION": capability(
    "TaskEngine+RecoveryManager",
    "reports/smpp-ugv-diagnostic/phase-s6/report.md",
  ),
  "SMPP-PROVIDER-EVIDENCE": capability(
    "ProviderTelemetryIngress+SmppDiagnosticRepository",
    "reports/smpp-ugv-diagnostic/phase-s9/report.md",
  ),
  "SMPP-BUSINESS-TERMINAL": capability(
    "TaskRepository+SmppDiagnosticRepository",
    "reports/smpp-ugv-diagnostic/phase-s8/report.md",
  ),
  "SMPP-MISSION-RELATION": capability(
    "ProviderTelemetryIngress+SmppDiagnosticRepository",
    "reports/smpp-ugv-diagnostic/phase-s13/report.md",
  ),
});

export function listSmppCapabilities(): SmppExternalCapabilityV1[] {
  return SMPP_CAPABILITY_IDS.map((capabilityId) => getSmppCapability(capabilityId));
}

export function getSmppCapability(capabilityId: SmppCapabilityId): SmppExternalCapabilityV1 {
  return structuredClone({ capabilityId, ...definitions[capabilityId] });
}

export function isSmppCapabilityId(value: string): value is SmppCapabilityId {
  return (SMPP_CAPABILITY_IDS as readonly string[]).includes(value);
}

function capability(
  authority: string,
  evidenceRef: string,
  options: {
    status?: SmppExternalCapabilityV1["status"];
    qualificationStatus?: SmppExternalCapabilityV1["qualification"]["status"];
    reasonCodes?: string[];
  } = {},
): Omit<SmppExternalCapabilityV1, "capabilityId"> {
  return Object.freeze({
    schemaVersion: "sdar.external-capability/v1",
    status: options.status ?? "available",
    readOnlyProbe: true,
    implementationKind: "production",
    component: "smpp-mcp-tasks-runtime",
    sourceCommit: SMPP_DIAGNOSTIC_SOURCE_COMMIT,
    qualification: {
      status: options.qualificationStatus ?? "passed",
      evidenceRefs: [evidenceRef],
    },
    reasonCodes: options.reasonCodes ?? [],
    details: {
      authority,
      providerIndependent: true as const,
      claimsGoalSuccess: false as const,
    },
  });
}

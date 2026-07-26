export interface RuntimeProviderIdentityEvidence {
  readonly bootstrapProviderId: string;
  readonly adapterManifestProviderId: string;
  readonly describeProviderObserved: boolean;
}

export type ProviderIdentityMismatchRelation =
  "pms_bootstrap" | "pms_adapter_manifest" | "bootstrap_adapter_manifest";

export type ProviderIdentityVerification =
  | {
      readonly valid: true;
      readonly reasonCode: "PROVIDER_ID_VERIFIED";
      readonly mismatchRelations: readonly ProviderIdentityMismatchRelation[];
      readonly retryable: false;
    }
  | {
      readonly valid: false;
      readonly reasonCode: "PROVIDER_ID_MISMATCH";
      readonly mismatchRelations: readonly ProviderIdentityMismatchRelation[];
      readonly retryable: true;
    };

export function verifyProviderIdentity(
  pmsProviderId: string,
  evidence: RuntimeProviderIdentityEvidence,
): ProviderIdentityVerification {
  assertProviderId(pmsProviderId);
  assertProviderId(evidence.bootstrapProviderId);
  assertProviderId(evidence.adapterManifestProviderId);
  if (!evidence.describeProviderObserved) {
    throw new ProviderIdentityEvidenceError("PROVIDER_IDENTITY_EVIDENCE_INVALID");
  }
  const mismatches: ProviderIdentityMismatchRelation[] = [];
  if (pmsProviderId !== evidence.bootstrapProviderId) mismatches.push("pms_bootstrap");
  if (pmsProviderId !== evidence.adapterManifestProviderId) {
    mismatches.push("pms_adapter_manifest");
  }
  if (evidence.bootstrapProviderId !== evidence.adapterManifestProviderId) {
    mismatches.push("bootstrap_adapter_manifest");
  }
  if (mismatches.length === 0) {
    return Object.freeze({
      valid: true,
      reasonCode: "PROVIDER_ID_VERIFIED",
      mismatchRelations: Object.freeze([]),
      retryable: false,
    });
  }
  return Object.freeze({
    valid: false,
    reasonCode: "PROVIDER_ID_MISMATCH",
    mismatchRelations: Object.freeze(mismatches),
    retryable: true,
  });
}

export class ProviderIdentityEvidenceError extends Error {
  constructor(readonly code: "PROVIDER_IDENTITY_EVIDENCE_INVALID") {
    super(code);
    this.name = "ProviderIdentityEvidenceError";
  }
}

function assertProviderId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new ProviderIdentityEvidenceError("PROVIDER_IDENTITY_EVIDENCE_INVALID");
  }
}

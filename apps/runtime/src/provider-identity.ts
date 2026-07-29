const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type RuntimeProviderIdentitySnapshot =
  | {
      readonly state: "pending";
      readonly bootstrapProviderId: string;
      readonly describeProviderObserved: false;
    }
  | {
      readonly state: "verified" | "mismatch";
      readonly reasonCode: "PROVIDER_ID_VERIFIED" | "PROVIDER_ID_MISMATCH";
      readonly bootstrapProviderId: string;
      readonly adapterManifestProviderId: string;
      readonly describeProviderObserved: true;
    };

export class RuntimeProviderIdentityError extends Error {
  constructor(readonly code: "PROVIDER_ID_MISMATCH" | "PROVIDER_IDENTITY_EVIDENCE_INVALID") {
    super(code);
    this.name = "RuntimeProviderIdentityError";
  }
}

export function pendingRuntimeProviderIdentity(
  bootstrapProviderId: string,
): RuntimeProviderIdentitySnapshot {
  requireProviderId(bootstrapProviderId);
  return Object.freeze({
    state: "pending",
    bootstrapProviderId,
    describeProviderObserved: false,
  });
}

export function verifyRuntimeProviderIdentity(
  bootstrapProviderId: string,
  adapterManifestProviderId: string,
): RuntimeProviderIdentitySnapshot {
  requireProviderId(bootstrapProviderId);
  requireProviderId(adapterManifestProviderId);
  return Object.freeze({
    state: bootstrapProviderId === adapterManifestProviderId ? "verified" : "mismatch",
    reasonCode:
      bootstrapProviderId === adapterManifestProviderId
        ? "PROVIDER_ID_VERIFIED"
        : "PROVIDER_ID_MISMATCH",
    bootstrapProviderId,
    adapterManifestProviderId,
    describeProviderObserved: true,
  });
}

export function assertRuntimeProviderIdentity(
  snapshot: RuntimeProviderIdentitySnapshot,
): asserts snapshot is Extract<RuntimeProviderIdentitySnapshot, { state: "verified" }> {
  if (snapshot.state !== "verified") {
    throw new RuntimeProviderIdentityError(
      snapshot.state === "mismatch" ? "PROVIDER_ID_MISMATCH" : "PROVIDER_IDENTITY_EVIDENCE_INVALID",
    );
  }
}

function requireProviderId(value: string): void {
  if (!PROVIDER_ID.test(value)) {
    throw new RuntimeProviderIdentityError("PROVIDER_IDENTITY_EVIDENCE_INVALID");
  }
}

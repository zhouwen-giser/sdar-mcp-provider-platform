export type HostingMode = "vendor_managed" | "platform_managed";

export interface ProviderSummary {
  readonly providerId: string;
  readonly providerTypeId: string;
  readonly packageId?: string;
  readonly packageVersion?: string;
  readonly hostingMode: HostingMode;
  readonly status: "draft" | "active" | "degraded" | "disabled" | "retired";
}

export interface ProviderPackageSummary {
  readonly packageId: string;
  readonly packageVersion: string;
  readonly providerType: string;
  readonly hostingModes: readonly HostingMode[];
  readonly compatibleRuntimeVersion: string;
  readonly protocolMode: string;
  readonly qualification: {
    readonly componentStatus: "passed" | "partial" | "pending" | "failed";
    readonly realResourceStatus: "qualified" | "pending" | "failed" | "not_applicable";
  };
}

export interface ResourceSummary {
  readonly environment: string;
  readonly resourceId: string;
  readonly resourceType: string;
  readonly status: "available" | "unavailable" | "retired";
}

export interface CreateProviderInput {
  readonly providerId: string;
  readonly providerTypeId: string;
  readonly packageId?: string;
  readonly packageVersion?: string;
  readonly hostingMode: HostingMode;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
}

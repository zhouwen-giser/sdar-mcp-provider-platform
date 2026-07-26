import type {
  ComponentQualificationStatus,
  ProviderPackage,
  RealResourceQualificationStatus,
} from "./model.js";

export interface ProviderQualificationProjection {
  readonly packageId: string;
  readonly packageVersion: string;
  readonly componentStatus: ComponentQualificationStatus;
  readonly realResourceStatus: RealResourceQualificationStatus;
  readonly evidenceRefs: readonly string[];
}

export function projectProviderQualification(
  providerPackage: ProviderPackage,
): ProviderQualificationProjection {
  return {
    packageId: providerPackage.packageId,
    packageVersion: providerPackage.packageVersion,
    componentStatus: providerPackage.qualification.componentStatus,
    realResourceStatus: providerPackage.qualification.realResourceStatus,
    evidenceRefs: [...(providerPackage.qualification.evidenceRefs ?? [])],
  };
}

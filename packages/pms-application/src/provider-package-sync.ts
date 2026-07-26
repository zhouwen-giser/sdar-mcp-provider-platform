import { createHash, randomUUID } from "node:crypto";
import {
  auditEventId,
  createAuditEvent,
  createProviderPackage,
  createProviderType,
  providerPackageId,
  providerTypeId,
  type JsonObject,
  type PmsUnitOfWork,
  type ProviderPackage as DomainProviderPackage,
} from "../../pms-domain/src/index.js";
import {
  loadProviderPackageRegistry,
  validateProviderPackage,
  type ProviderPackage as RegistryProviderPackage,
} from "../../provider-package-registry/src/index.js";

export interface PackageSyncAuditContext {
  readonly actorId: string;
  readonly correlationId: string;
}

export interface ProviderPackageSyncResult {
  readonly inserted: number;
  readonly updated: number;
  readonly unchanged: number;
}

interface PackageProjection {
  readonly value: DomainProviderPackage;
}

export class ProviderPackageSynchronizer {
  constructor(private readonly unitOfWork: PmsUnitOfWork) {}

  async synchronize(
    inputs: readonly unknown[],
    context: PackageSyncAuditContext,
  ): Promise<ProviderPackageSyncResult> {
    requireAuditContext(context);
    const projections = inputs.map(projectPackage);

    return this.unitOfWork.transaction(async (repositories) => {
      let inserted = 0;
      let updated = 0;
      let unchanged = 0;
      for (const { value } of projections) {
        const existingType = await repositories.providerTypes.get(value.providerTypeId);
        if (existingType === null) {
          await repositories.providerTypes.save(
            createProviderType({
              providerTypeId: value.providerTypeId,
              displayName: value.providerTypeId,
              status: "active",
            }),
            { mode: "insert" },
          );
        }

        const key = {
          packageId: value.packageId,
          packageVersion: value.packageVersion,
        };
        const existing = await repositories.providerPackages.get(key);
        if (existing?.checksum === value.checksum) {
          unchanged += 1;
          continue;
        }

        if (existing === null) {
          await repositories.providerPackages.save(value, { mode: "insert" });
          inserted += 1;
        } else {
          if (existing.updatedAt === undefined) {
            throw new Error("PMS_PROVIDER_PACKAGE_UPDATED_AT_MISSING");
          }
          await repositories.providerPackages.save(value, {
            mode: "update",
            expectedUpdatedAt: existing.updatedAt,
          });
          updated += 1;
        }
        await repositories.audit.append(
          createAuditEvent({
            auditEventId: auditEventId(randomUUID()),
            action: existing === null ? "provider_package.imported" : "provider_package.updated",
            actorId: context.actorId,
            correlationId: context.correlationId,
            subjectType: "provider_package",
            subjectId: `${value.packageId}@${value.packageVersion}`,
            occurredAt: new Date(),
            metadata: { checksum: value.checksum },
          }),
        );
      }
      return Object.freeze({ inserted, updated, unchanged });
    });
  }
}

export async function synchronizeWorkspaceProviderPackages(
  unitOfWork: PmsUnitOfWork,
  context: PackageSyncAuditContext,
  workspaceRoot = process.cwd(),
): Promise<ProviderPackageSyncResult> {
  const registry = await loadProviderPackageRegistry(workspaceRoot);
  return new ProviderPackageSynchronizer(unitOfWork).synchronize(registry.list(), context);
}

function projectPackage(input: unknown): PackageProjection {
  const providerPackage = validateProviderPackage(input);
  const sourceDocument = JSON.parse(canonicalJson(providerPackage)) as JsonObject;
  const checksum = createHash("sha256").update(canonicalJson(sourceDocument)).digest("hex");
  return {
    value: createProviderPackage({
      packageId: providerPackageId(providerPackage.packageId),
      packageVersion: providerPackage.packageVersion,
      providerTypeId: providerTypeId(providerPackage.providerType),
      hostingModes: providerPackage.hostingModes,
      checksum,
      status: packageStatus(providerPackage),
      sourceDocument,
    }),
  };
}

function packageStatus(providerPackage: RegistryProviderPackage): DomainProviderPackage["status"] {
  return providerPackage.qualification.componentStatus === "failed" ? "quarantined" : "available";
}

function canonicalJson(value: unknown): string {
  if (value === undefined) throw new TypeError("PMS_PACKAGE_DOCUMENT_UNDEFINED");
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

function requireAuditContext(context: PackageSyncAuditContext): void {
  if (context.actorId.trim().length === 0 || context.correlationId.trim().length === 0) {
    throw new RangeError("PMS_PACKAGE_SYNC_AUDIT_CONTEXT_INVALID");
  }
}

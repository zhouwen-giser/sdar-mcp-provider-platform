import { createHash } from "node:crypto";
import { canonicalize } from "./canonical.js";
import type { CatalogTool, DiscoveredCatalog, RuntimeDiscovery } from "./model.js";

export interface CatalogSnapshotDocument {
  readonly discovery: RuntimeDiscovery;
  readonly tools: readonly CatalogTool[];
}

export interface CatalogSnapshot {
  readonly providerId: string;
  readonly revision: number;
  readonly checksum: string;
  readonly document: CatalogSnapshotDocument;
  readonly discoveredAt: Date;
  readonly createdAt: Date;
}

export interface PublishCatalogSnapshot {
  readonly providerId: string;
  readonly catalog: DiscoveredCatalog;
  readonly actorId: string;
  readonly correlationId: string;
  readonly discoveredAt: Date;
}

export interface CatalogSnapshotPublication {
  readonly created: boolean;
  readonly snapshot: CatalogSnapshot;
}

export interface CatalogToolChange {
  readonly name: string;
  readonly before?: CatalogTool;
  readonly after?: CatalogTool;
}

export interface CatalogSnapshotDiff {
  readonly providerId: string;
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly added: readonly CatalogTool[];
  readonly removed: readonly CatalogTool[];
  readonly changed: readonly CatalogToolChange[];
}

export interface CatalogSnapshotRepository {
  publish(input: PublishCatalogSnapshot): Promise<CatalogSnapshotPublication>;
  active(providerId: string): Promise<CatalogSnapshot | null>;
  get(providerId: string, revision: number): Promise<CatalogSnapshot | null>;
  history(providerId: string, limit?: number): Promise<readonly CatalogSnapshot[]>;
  diff(providerId: string, fromRevision: number, toRevision: number): Promise<CatalogSnapshotDiff>;
}

export function catalogDocument(catalog: DiscoveredCatalog): CatalogSnapshotDocument {
  return {
    discovery: catalog.discovery,
    tools: catalog.tools,
  };
}

export function catalogChecksum(document: CatalogSnapshotDocument): string {
  return createHash("sha256").update(canonicalize(document)).digest("hex");
}

export function diffCatalogSnapshots(
  from: CatalogSnapshot,
  to: CatalogSnapshot,
): CatalogSnapshotDiff {
  if (from.providerId !== to.providerId) throw new Error("CATALOG_DIFF_PROVIDER_MISMATCH");
  const before = new Map(from.document.tools.map((tool) => [tool.name, tool]));
  const after = new Map(to.document.tools.map((tool) => [tool.name, tool]));
  const added: CatalogTool[] = [];
  const removed: CatalogTool[] = [];
  const changed: CatalogToolChange[] = [];
  for (const [name, tool] of after) {
    const previous = before.get(name);
    if (previous === undefined) {
      added.push(tool);
    } else if (canonicalize(previous) !== canonicalize(tool)) {
      changed.push({ name, before: previous, after: tool });
    }
  }
  for (const [name, tool] of before) {
    if (!after.has(name)) removed.push(tool);
  }
  const byName = <T extends { readonly name: string }>(left: T, right: T): number =>
    left.name.localeCompare(right.name);
  return {
    providerId: from.providerId,
    fromRevision: from.revision,
    toRevision: to.revision,
    added: added.sort(byName),
    removed: removed.sort(byName),
    changed: changed.sort(byName),
  };
}

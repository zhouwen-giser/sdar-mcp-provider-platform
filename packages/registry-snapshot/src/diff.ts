import { canonicalize } from "../../catalog-manager/src/index.js";
import type {
  RegistryProviderChange,
  RegistryProviderProjection,
  RegistrySnapshot,
  RegistrySnapshotDiff,
} from "./model.js";

export function diffRegistrySnapshots(
  from: RegistrySnapshot,
  to: RegistrySnapshot,
): RegistrySnapshotDiff {
  if (from.environment !== to.environment) throw new Error("REGISTRY_DIFF_ENVIRONMENT_MISMATCH");
  const before = new Map(
    from.document.providers.map((provider) => [provider.providerId, provider]),
  );
  const after = new Map(to.document.providers.map((provider) => [provider.providerId, provider]));
  const added: RegistryProviderProjection[] = [];
  const removed: RegistryProviderProjection[] = [];
  const changed: RegistryProviderChange[] = [];
  for (const [providerId, provider] of after) {
    const previous = before.get(providerId);
    if (previous === undefined) {
      added.push(provider);
    } else if (canonicalize(previous) !== canonicalize(provider)) {
      changed.push({ providerId, before: previous, after: provider });
    }
  }
  for (const [providerId, provider] of before) {
    if (!after.has(providerId)) removed.push(provider);
  }
  const byProvider = <T extends { readonly providerId: string }>(left: T, right: T): number =>
    left.providerId.localeCompare(right.providerId);
  return {
    environment: from.environment,
    fromRevision: from.revision,
    toRevision: to.revision,
    added: added.sort(byProvider),
    removed: removed.sort(byProvider),
    changed: changed.sort(byProvider),
  };
}

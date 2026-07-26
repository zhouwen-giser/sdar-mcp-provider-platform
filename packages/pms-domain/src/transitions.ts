import type { ConfigRevision, ConfigRevisionStatus, Provider, ProviderStatus } from "./entities.js";
import { PmsDomainError } from "./errors.js";

const ProviderTransitions: Readonly<Record<ProviderStatus, readonly ProviderStatus[]>> = {
  draft: ["active", "disabled", "retired"],
  active: ["degraded", "disabled", "retired"],
  degraded: ["active", "disabled", "retired"],
  disabled: ["active", "retired"],
  retired: [],
};

const ConfigRevisionTransitions: Readonly<
  Record<ConfigRevisionStatus, readonly ConfigRevisionStatus[]>
> = {
  draft: ["validated", "rejected"],
  validated: ["published", "rejected"],
  published: ["superseded"],
  superseded: [],
  rejected: [],
};

export function transitionProvider(provider: Provider, target: ProviderStatus): Provider {
  assertTransition("Provider", provider.status, target, ProviderTransitions[provider.status]);
  return Object.freeze({ ...provider, status: target });
}

export function transitionConfigRevision(
  revision: ConfigRevision,
  target: ConfigRevisionStatus,
): ConfigRevision {
  assertTransition(
    "ConfigRevision",
    revision.status,
    target,
    ConfigRevisionTransitions[revision.status],
  );
  return Object.freeze({ ...revision, status: target });
}

function assertTransition(
  aggregate: string,
  current: string,
  target: string,
  allowed: readonly string[],
): void {
  if (!allowed.includes(target)) {
    throw new PmsDomainError(
      "INVALID_STATE_TRANSITION",
      `Invalid ${aggregate} state transition: ${current} -> ${target}`,
      { aggregate, current, target },
    );
  }
}

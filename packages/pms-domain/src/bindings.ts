import type { EnvironmentId, ProviderId, ResourceId } from "./ids.js";
import { PmsDomainError } from "./errors.js";

export interface ProviderResourceBinding {
  readonly providerId: ProviderId;
  readonly environment: EnvironmentId;
  readonly resourceId: ResourceId;
  readonly boundAt: Date;
}

export class ProviderResourceBindings {
  readonly #bindings = new Map<string, ProviderResourceBinding>();

  constructor(initial: readonly ProviderResourceBinding[] = []) {
    for (const binding of initial) this.bind(binding);
  }

  bind(input: ProviderResourceBinding): ProviderResourceBinding {
    const key = bindingKey(input.providerId, input.environment, input.resourceId);
    if (this.#bindings.has(key)) {
      throw new PmsDomainError("DUPLICATE_RESOURCE_BINDING", "Provider resource binding exists", {
        providerId: input.providerId,
        environment: input.environment,
        resourceId: input.resourceId,
      });
    }
    if (!Number.isFinite(input.boundAt.getTime())) {
      throw new PmsDomainError("INVALID_DOMAIN_VALUE", "Invalid binding boundAt", {
        field: "boundAt",
      });
    }
    const binding = Object.freeze({ ...input, boundAt: new Date(input.boundAt) });
    this.#bindings.set(key, binding);
    return binding;
  }

  unbind(providerId: ProviderId, environment: EnvironmentId, resourceId: ResourceId): void {
    if (!this.#bindings.delete(bindingKey(providerId, environment, resourceId))) {
      throw new PmsDomainError(
        "RESOURCE_BINDING_NOT_FOUND",
        "Provider resource binding not found",
        { providerId, environment, resourceId },
      );
    }
  }

  forProvider(providerId: ProviderId): readonly ProviderResourceBinding[] {
    return [...this.#bindings.values()].filter((binding) => binding.providerId === providerId);
  }

  forResource(
    environment: EnvironmentId,
    resourceId: ResourceId,
  ): readonly ProviderResourceBinding[] {
    return [...this.#bindings.values()].filter(
      (binding) => binding.environment === environment && binding.resourceId === resourceId,
    );
  }

  all(): readonly ProviderResourceBinding[] {
    return [...this.#bindings.values()];
  }
}

function bindingKey(
  providerId: ProviderId,
  environment: EnvironmentId,
  resourceId: ResourceId,
): string {
  return `${providerId}\u0000${environment}\u0000${resourceId}`;
}

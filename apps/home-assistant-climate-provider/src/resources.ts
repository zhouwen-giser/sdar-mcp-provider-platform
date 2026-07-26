import { readFileSync } from "node:fs";
import { z } from "zod";
import { ClimateProviderError } from "./errors.js";
import type { ClimateResourceConfig } from "./types.js";

const resource = z
  .object({
    resourceId: z.string().min(1).max(128),
    entityId: z.string().regex(/^climate\.[a-z0-9_]+$/),
    displayName: z.string().min(1).max(256),
    enabled: z.boolean().default(true),
    temperatureRange: z.object({ minimum: z.number(), maximum: z.number() }),
    allowedHvacModes: z.array(z.string().min(1)).min(1),
  })
  .refine((v) => v.temperatureRange.minimum < v.temperatureRange.maximum, {
    message: "TEMPERATURE_RANGE_INVALID",
  });
export function loadClimateResources(path: string): ClimateResourceConfig[] {
  const value = z
    .object({ resources: z.array(resource).min(1) })
    .parse(JSON.parse(readFileSync(path, "utf8"))).resources;
  unique(
    value.map((v) => v.resourceId),
    "DUPLICATE_RESOURCE_ID",
  );
  unique(
    value.map((v) => v.entityId),
    "DUPLICATE_ENTITY_ID",
  );
  return value;
}
function unique(values: string[], reason: string): void {
  if (new Set(values).size !== values.length) throw new Error(reason);
}
export class ClimateResourceRegistry {
  readonly #resources = new Map<string, ClimateResourceConfig>();
  readonly #entities = new Map<string, ClimateResourceConfig>();
  constructor(resources: ClimateResourceConfig[]) {
    for (const item of resources) {
      this.#resources.set(item.resourceId, item);
      this.#entities.set(item.entityId, item);
    }
  }
  list(): ClimateResourceConfig[] {
    return [...this.#resources.values()];
  }
  entityIds(): Set<string> {
    return new Set(this.#entities.keys());
  }
  fromEntity(id: string): ClimateResourceConfig | undefined {
    return this.#entities.get(id);
  }
  require(id: string): ClimateResourceConfig {
    const item = this.#resources.get(id);
    if (item === undefined) throw new ClimateProviderError("RESOURCE_NOT_CONFIGURED", false);
    if (!item.enabled) throw new ClimateProviderError("RESOURCE_DISABLED", false);
    return item;
  }
}

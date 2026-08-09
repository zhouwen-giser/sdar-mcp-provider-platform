import { readFileSync } from "node:fs";
import { z } from "zod";
import { LightProviderError } from "./errors.js";
import type { LightResourceConfig } from "./types.js";

const resource = z.object({
  resourceId: z.string().min(1).max(128),
  entityId: z.string().regex(/^light\.[a-z0-9_]+$/),
  displayName: z.string().min(1).max(256),
  enabled: z.boolean().default(true),
});

export function loadLightResources(path: string): LightResourceConfig[] {
  const value = z
    .object({ resources: z.array(resource).min(1) })
    .parse(JSON.parse(readFileSync(path, "utf8"))).resources;
  unique(
    value.map((item) => item.resourceId),
    "DUPLICATE_RESOURCE_ID",
  );
  unique(
    value.map((item) => item.entityId),
    "DUPLICATE_ENTITY_ID",
  );
  return value;
}

function unique(values: string[], reason: string): void {
  if (new Set(values).size !== values.length) throw new Error(reason);
}

export class LightResourceRegistry {
  readonly #resources = new Map<string, LightResourceConfig>();
  readonly #entities = new Map<string, LightResourceConfig>();
  constructor(resources: LightResourceConfig[]) {
    for (const item of resources) {
      this.#resources.set(item.resourceId, item);
      this.#entities.set(item.entityId, item);
    }
  }
  list(): LightResourceConfig[] {
    return [...this.#resources.values()];
  }
  entityIds(): Set<string> {
    return new Set(this.#entities.keys());
  }
  fromEntity(id: string): LightResourceConfig | undefined {
    return this.#entities.get(id);
  }
  require(id: string): LightResourceConfig {
    const item = this.#resources.get(id);
    if (item === undefined) throw new LightProviderError("RESOURCE_NOT_CONFIGURED", false);
    if (!item.enabled) throw new LightProviderError("RESOURCE_DISABLED", false);
    return item;
  }
}

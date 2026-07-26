const FORBIDDEN = new Set([
  "hit",
  "miss",
  "destroyed",
  "damage",
  "remaining_hp",
  "remaininghp",
  "friendly_fire",
  "hp",
  "alive",
  "camp",
  "referee",
  "verdict",
]);

export interface SanitizedResult {
  value: unknown;
  strippedFields: number;
}

export function sanitizeFireResult(value: unknown): SanitizedResult {
  let strippedFields = 0;
  const walk = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(walk);
    if (current !== null && typeof current === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(current)) {
        if (FORBIDDEN.has(key.toLowerCase())) {
          strippedFields++;
          continue;
        }
        result[key] = walk(child);
      }
      return result;
    }
    return current;
  };
  return { value: walk(value), strippedFields };
}

export function containsForbiddenFireField(value: unknown): boolean {
  return sanitizeFireResult(value).strippedFields > 0;
}

import type { Page } from "../gateways/contracts/index.js";
import { dataMode } from "../gateways/factory.js";

const PRODUCT_ENVIRONMENTS = ["production", "staging"] as const;

export async function collectCursorPages<T>(
  load: (cursor: string | undefined) => Promise<Page<T>>,
): Promise<readonly T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < 1_000; pageNumber += 1) {
    const page = await load(cursor);
    items.push(...page.items);
    if (page.nextCursor === undefined) return items;
    if (page.nextCursor.length === 0 || seen.has(page.nextCursor)) {
      throw new Error("PMS_PAGINATION_CURSOR_INVALID");
    }
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new Error("PMS_PAGINATION_LIMIT_EXCEEDED");
}

export function currentEnvironmentScope(): readonly string[] {
  if (dataMode() === "mock") return PRODUCT_ENVIRONMENTS;
  const locationValue = (globalThis as { readonly location?: { readonly search: string } })
    .location;
  if (locationValue === undefined) return [];
  return [...new Set(new URLSearchParams(locationValue.search).getAll("environment"))].filter(
    (value) => value.trim().length > 0,
  );
}

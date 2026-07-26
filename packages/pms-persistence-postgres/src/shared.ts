import type { Pool, PoolClient } from "pg";
import { PmsRepositoryError, type Page, type PageRequest } from "../../pms-domain/src/index.js";

export type PmsSqlClient = Pool | PoolClient;

export function pageLimit(page: PageRequest): number {
  if (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 500) {
    throw new RangeError("PMS_PAGE_LIMIT_INVALID");
  }
  return page.limit;
}

export function pageOffset(page: PageRequest): number {
  if (page.cursor === undefined) return 0;
  const value = Number(page.cursor);
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("PMS_PAGE_CURSOR_INVALID");
  return value;
}

export function toPage<T>(rows: readonly T[], page: PageRequest): Page<T> {
  const limit = pageLimit(page);
  const offset = pageOffset(page);
  const hasMore = rows.length > limit;
  return {
    items: rows.slice(0, limit),
    ...(hasMore ? { nextCursor: String(offset + limit) } : {}),
  };
}

export function json(value: unknown): string {
  return JSON.stringify(value);
}

export function isDatabaseError(error: unknown): error is { readonly code: string } {
  return typeof error === "object" && error !== null && "code" in error;
}

export function mapWriteError(error: unknown, aggregate: string): never {
  if (isDatabaseError(error) && error.code === "23505") {
    throw new PmsRepositoryError(
      "ENTITY_ALREADY_EXISTS",
      `${aggregate} already exists`,
      { aggregate },
      { cause: error },
    );
  }
  throw error;
}

export function concurrencyConflict(aggregate: string): PmsRepositoryError {
  return new PmsRepositoryError(
    "OPTIMISTIC_CONCURRENCY_CONFLICT",
    `${aggregate} changed or does not exist`,
    { aggregate },
  );
}

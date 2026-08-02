import inventory from "./route-inventory.json" with { type: "json" };

export const PMS_CONSOLE_API_BASE_PATH = "/api/console/v1" as const;

export interface ConsoleRouteInventoryEntry {
  readonly operationId: string;
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
}

export const CONSOLE_ROUTE_INVENTORY = Object.freeze(
  inventory.map((entry) =>
    Object.freeze({
      operationId: entry.operationId,
      method: entry.method as ConsoleRouteInventoryEntry["method"],
      path: entry.path,
    }),
  ),
) as readonly ConsoleRouteInventoryEntry[];

export function fastifyConsolePath(path: string): string {
  return path.replaceAll(/\{([^}]+)\}/g, ":$1");
}

export function assertCompleteHandlerInventory(handlerIds: readonly string[]): void {
  const expected = new Set(CONSOLE_ROUTE_INVENTORY.map(({ operationId }) => operationId));
  const actual = new Set(handlerIds);
  const missing = [...expected].filter((operationId) => !actual.has(operationId));
  const extra = [...actual].filter((operationId) => !expected.has(operationId));
  if (missing.length > 0 || extra.length > 0 || actual.size !== handlerIds.length) {
    throw new Error(
      `PMS_CONSOLE_HANDLER_INVENTORY_MISMATCH missing=${missing.join(
        ",",
      )} extra=${extra.join(",")}`,
    );
  }
}

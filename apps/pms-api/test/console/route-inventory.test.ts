import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONSOLE_ROUTE_INVENTORY, frozenConsoleOperations } from "../../src/console/index.js";

describe("PMS Console API route inventory", () => {
  it("contains every frozen operation and no contract-external operation", () => {
    const frozen = frozenConsoleOperations().map(({ operationId, method, path }) => ({
      operationId,
      method,
      path,
    }));
    expect(CONSOLE_ROUTE_INVENTORY).toEqual(frozen);
    expect(new Set(CONSOLE_ROUTE_INVENTORY.map(({ operationId }) => operationId)).size).toBe(36);
  });

  it("keeps the checked-in JSON inventory parseable", () => {
    const path = resolve(import.meta.dirname, "../../src/console/route-inventory.json");
    expect(JSON.parse(readFileSync(path, "utf8"))).toHaveLength(36);
  });
});

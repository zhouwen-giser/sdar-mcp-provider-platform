import { describe, expect, it } from "vitest";
import { APP_ROUTES, matchRoute } from "../src/router.js";

describe("prototype route map", () => {
  it("contains every formal route exactly once", () => {
    expect(APP_ROUTES).toHaveLength(29);
    expect(new Set(APP_ROUTES.map((route) => route.path)).size).toBe(APP_ROUTES.length);
  });

  it("matches parameterized details", () => {
    expect(matchRoute("/providers/provider-ha-east")?.path).toBe("/providers/:providerId");
    expect(matchRoute("/catalog/provider-ha-east/set_temperature")?.path).toBe(
      "/catalog/:providerId/:operationName",
    );
  });
});

import { describe, expect, it } from "vitest";
import { APP_ROUTES, matchRoute } from "../src/router.js";

describe("formal product route inventory", () => {
  it("contains all unique public and internal routes", () => {
    expect(APP_ROUTES).toHaveLength(123);
    expect(new Set(APP_ROUTES.map(route => route.path)).size).toBe(APP_ROUTES.length);
    expect(APP_ROUTES.filter(route => route.level === "internal")).toHaveLength(2);
  });

  it("matches deep parameterized routes", () => {
    expect(matchRoute("/providers/ugv-prod-001/deployments")?.path).toBe("/providers/:providerId/deployments");
    expect(matchRoute("/runtime/deployments/ugv-prod-001/deploy-001/reconciliation")?.path).toBe("/runtime/deployments/:providerId/:deploymentId/reconciliation");
    expect(matchRoute("/configuration/draft-001/revisions/3/rollback")?.path).toBe("/configuration/:profileId/revisions/:revision/rollback");
  });
});

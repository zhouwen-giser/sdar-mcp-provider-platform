import { describe, expect, it } from "vitest";
import { APP_ROUTES, matchRoute } from "../src/router.js";
import { preserveNavigationContext } from "../src/app/navigation.js";

const browserHistory = (
  globalThis as unknown as {
    readonly history: {
      replaceState(data: unknown, unused: string, url?: string | URL | null): void;
    };
  }
).history;

describe("formal product route inventory", () => {
  it("contains all unique public and internal routes", () => {
    expect(APP_ROUTES).toHaveLength(123);
    expect(new Set(APP_ROUTES.map((route) => route.path)).size).toBe(APP_ROUTES.length);
    expect(APP_ROUTES.filter((route) => route.level === "internal")).toHaveLength(2);
  });

  it("matches deep parameterized routes", () => {
    expect(matchRoute("/providers/ugv-prod-001/deployments")?.path).toBe(
      "/providers/:providerId/deployments",
    );
    expect(matchRoute("/runtime/deployments/ugv-prod-001/deploy-001/reconciliation")?.path).toBe(
      "/runtime/deployments/:providerId/:deploymentId/reconciliation",
    );
    expect(matchRoute("/configuration/draft-001/revisions/3/rollback")?.path).toBe(
      "/configuration/:profileId/revisions/:revision/rollback",
    );
  });

  it("preserves environment and scenario scope across product navigation", () => {
    browserHistory.replaceState(
      {},
      "",
      "/providers?environment=field%2Fnorth&scenario=slow-network",
    );
    expect(preserveNavigationContext("/runtime/deployments?status=ACTIVE")).toBe(
      "/runtime/deployments?status=ACTIVE&scenario=slow-network&environment=field%2Fnorth",
    );
    expect(preserveNavigationContext("/resources?environment=lab-west")).toBe(
      "/resources?environment=lab-west&scenario=slow-network",
    );
  });
});

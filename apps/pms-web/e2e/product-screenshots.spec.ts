import { expect, test } from "@playwright/test";

const shots = [
  ["dashboard", "/dashboard"], ["provider-list", "/providers"], ["provider-create", "/providers/new"],
  ["provider-detail", "/providers/ugv-prod-001"], ["runtime-deployment-list", "/runtime/deployments"],
  ["runtime-deployment-create", "/runtime/deployments/new"], ["runtime-deployment-detail", "/runtime/deployments/ugv-prod-001/deploy-001"],
  ["runtime-process-detail", "/runtime/processes/ugv-prod-001/runtime-001"], ["configuration-draft", "/configuration/draft-001"],
  ["configuration-compare", "/configuration/draft-001/compare"],
  ["configuration-rollback", "/configuration/draft-001/revisions/223e4567-e89b-42d3-a456-426614174000/rollback"],
  ["resource-detail", "/resources/production/ugv-01"], ["catalog-operation", "/catalog/providers/ugv-prod-001/io.sdar%2Fnavigation%2FnavigateTo"],
  ["registry-diff", "/registry/compare"], ["operations-jobs", "/operations/jobs"],
  ["incident-detail", "/operations/incidents/incident-runtime-001"], ["change-review", "/changes/change-001/review"],
  ["audit", "/audit"], ["deferred-runtime-release", "/runtime/releases/new"], ["system-settings", "/system/general"], ["404", "/404"],
] as const;

test("capture required product review screenshots", async ({ page }) => {
  for (const [name, path] of shots) {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
      await page.setViewportSize(viewport);
      await page.goto(path);
      await expect(page.locator("h1").first()).toBeVisible();
      await expect(page.locator(".route-skeleton")).toHaveCount(0);
      const suffix = viewport.width === 1440 ? "" : `-${viewport.width}x${viewport.height}`;
      await page.screenshot({ path: `../../docs/design/pms-web-complete/screenshots/${name}${suffix}.png`, fullPage: true });
    }
  }
});

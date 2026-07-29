import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const output = path.resolve("../../docs/design/pms-web/screenshots");

test("captures the required 1440 and 1280 review set", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await capture(page, "/dashboard", "dashboard-healthy-1440.png");
  await capture(page, "/providers", "provider-list-1440.png");
  await capture(page, "/providers/new", "provider-onboarding-1440.png");
  await capture(
    page,
    "/runtime/deployments/deploy-ha-primary",
    "runtime-deployment-active-1440.png",
  );
  await capture(
    page,
    "/runtime/deployments/deploy-ha-primary?scenario=runtime-stale",
    "runtime-deployment-drift-1440.png",
  );
  await capture(page, "/configuration/provider-runtime", "config-editor-1440.png");
  await page.getByRole("button", { name: "Impact" }).click();
  await screenshot(page, "config-impact-analysis-1440.png");
  await capture(
    page,
    "/configuration/provider-runtime?scenario=config-drift",
    "runtime-ack-1440.png",
  );
  await capture(
    page,
    "/catalog/provider-ha-east/set_temperature?scenario=catalog-breaking",
    "catalog-breaking-diff-1440.png",
  );
  await page.getByRole("button", { name: "Catalog Diff" }).click();
  await screenshot(page, "catalog-breaking-diff-1440.png");
  await capture(
    page,
    "/operations/incidents/inc-runtime-drift-042?scenario=incident-active",
    "incident-timeline-1440.png",
  );
  await capture(page, "/operations/jobs?scenario=worker-backlog", "worker-job-detail-1440.png");
  await page.getByRole("button", { name: "job-reconcile-backlog" }).click();
  await screenshot(page, "worker-job-detail-1440.png");
  await capture(page, "/audit", "audit-list-1440.png");

  await page.setViewportSize({ width: 1280, height: 720 });
  await capture(page, "/dashboard", "dashboard-1280.png");
  await capture(
    page,
    "/runtime/deployments/deploy-ha-primary?scenario=runtime-stale",
    "runtime-deployment-1280.png",
  );
  await capture(page, "/configuration/provider-runtime", "config-editor-1280.png");
});

async function capture(page: Page, url: string, file: string) {
  await page.goto(url);
  await expect(page.getByText("PROTOTYPE / MOCK DATA")).toBeVisible();
  await screenshot(page, file);
}

async function screenshot(page: Page, file: string) {
  await page.screenshot({ path: path.join(output, file), fullPage: false });
}

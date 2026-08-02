import { expect, test, type Page } from "@playwright/test";
import { APP_ROUTES } from "../src/router.js";

const samples: Record<string, string> = {
  providerId: "ugv-prod-001",
  packageId: "ugv-provider",
  version: "1.0.0",
  deploymentId: "deploy-001",
  runtimeId: "runtime-001",
  processId: "runtime-001",
  releaseId: "runtime-2.0.0-rc.1",
  profileId: "draft-001",
  revision: "4",
  secretRef: encodeURIComponent("secret://runtime/ugv-prod/db"),
  environment: "production",
  resourceId: "ugv-01",
  operationName: encodeURIComponent("io.sdar/navigation/navigateTo"),
  runId: "run-local-001",
  operationId: "operation-runtime-001",
  jobId: "job-runtime-003",
  incidentId: "incident-runtime-001",
  changeId: "change-001",
  auditId: "audit-001",
  environmentId: "production",
  roleId: "administrator",
};
function materialize(path: string) {
  return path.replace(/:([A-Za-z]+)/g, (_, key: string) => samples[key] ?? `sample-${key}`);
}
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}

test("all public routes render a heading without unhandled errors", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watch(page);
  for (const route of APP_ROUTES.filter((item) => item.level !== "internal")) {
    await page.goto(materialize(route.path));
    await expect(page.locator("#main-content")).toBeVisible();
    await expect(page.locator("h1").first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("browser history and deep-link refresh preserve routes", async ({ page }) => {
  await page.goto("/providers");
  await page.goto("/runtime/deployments/ugv-prod-001/deploy-001");
  await page.goBack();
  await expect(page).toHaveURL(/\/providers$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/runtime\/deployments\/ugv-prod-001\/deploy-001$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "deploy-001" })).toBeVisible();
});

test("unknown route renders 404 instead of dashboard fallback", async ({ page }) => {
  await page.goto("/definitely-not-a-product-route");
  await expect(page.getByRole("heading", { name: /404|页面不存在/ })).toBeVisible();
});

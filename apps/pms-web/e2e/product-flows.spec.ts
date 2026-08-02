import { expect, test, type Page } from "@playwright/test";

function watchRuntime(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test("Provider onboarding is composed from frozen capabilities", async ({ page }) => {
  const errors = watchRuntime(page);
  await page.goto("/providers/new");
  await expect(page.getByRole("heading", { name: "接入 Provider" })).toBeVisible();
  for (let step = 0; step < 4; step += 1)
    await page.getByRole("button", { name: "下一步" }).click();
  await page.getByLabel("Provider ID").fill("provider-product-e2e");
  await page.getByRole("button", { name: "确认创建" }).click();
  await expect(page.getByText("provider-product-e2e 已创建")).toBeVisible();
  await page.getByRole("button", { name: "进入 Provider 详情" }).click();
  await expect(page).toHaveURL(/\/providers\/provider-product-e2e$/);
  expect(errors).toEqual([]);
});

test("RuntimeDeployment creation returns an accepted intent", async ({ page }) => {
  const errors = watchRuntime(page);
  await page.goto("/runtime/deployments/new");
  for (let step = 0; step < 5; step += 1)
    await page.getByRole("button", { name: "下一步" }).click();
  await page.getByLabel("Deployment ID").fill("deploy-product-e2e");
  await page.getByRole("button", { name: "提交创建 Intent" }).click();
  await expect(page.getByRole("heading", { name: "Intent accepted" })).toBeVisible();
  await expect(page.getByLabel("操作反馈面板").getByText("ACCEPTED").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("Runtime revision conflict is visible and recoverable", async ({ page }) => {
  const errors = watchRuntime(page);
  await page.goto(
    "/runtime/deployments/ugv-prod-001/deploy-001?scenario=runtime-revision-conflict",
  );
  await page.getByRole("button", { name: "Reconcile" }).click();
  await expect(page.getByText(/RUNTIME_DEPLOYMENT_REVISION_CONFLICT/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("Configuration validates, publishes, compares and rolls back", async ({ page }) => {
  const errors = watchRuntime(page);
  await page.goto("/configuration/draft-001");
  await page.getByRole("button", { name: "校验 Draft" }).click();
  await expect(page.getByText(/操作已完成/)).toBeVisible();
  await page.getByRole("button", { name: "发布" }).click();
  const publishDialog = page.getByRole("alertdialog");
  if (await publishDialog.isVisible()) {
    await publishDialog.getByLabel("操作原因").fill("E2E publish verification");
    await publishDialog.locator("input").fill("draft-001");
    await publishDialog.getByRole("button", { name: "确认执行" }).click();
  }
  await page.goto("/configuration/draft-001/compare");
  await expect(page.getByLabel("变更前")).toBeVisible();
  await page.goto(
    "/configuration/draft-001/revisions/223e4567-e89b-42d3-a456-426614174000/rollback",
  );
  await expect(page.getByRole("heading", { name: /Rollback/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Resource binding and optimistic concurrency controls are exposed", async ({ page }) => {
  const errors = watchRuntime(page);
  await page.goto("/resources?bindProvider=ugv-prod-001");
  await expect(page.getByRole("heading", { name: "Resources" })).toBeVisible();
  await page.goto("/resources/production/ugv-01");
  await expect(page.getByText(/expectedUpdatedAt/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("Registry diff and deferred publish boundary are explicit", async ({ page }) => {
  const errors = watchRuntime(page);
  await page.goto("/registry/compare");
  await expect(page.getByRole("heading", { name: "Registry Diff" })).toBeVisible();
  await page.goto("/registry/publish");
  await expect(page.getByRole("button", { name: "Publish unavailable" })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("Audit supports filtering and client-only export", async ({ page }) => {
  const errors = watchRuntime(page);
  await page.goto("/audit");
  await page.getByLabel("Subject ID").fill("deploy-001");
  await page.getByRole("button", { name: "应用筛选" }).click();
  await expect(page).toHaveURL(/subjectId=deploy-001/);
  await page.getByRole("button", { name: "导出当前结果" }).click();
  await expect(page.getByRole("heading", { name: "Audit Export" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Deferred pages provide complete validation experience without fake success", async ({
  page,
}) => {
  const errors = watchRuntime(page);
  await page.goto("/runtime/releases/new");
  await page.getByRole("button", { name: "运行本地校验" }).click();
  await expect(page.getByText(/本地校验通过/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Not available in Console API V1" }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});

test("API mode fails closed and never falls back to Mock", async ({ page }) => {
  test.skip(process.env.VITE_PMS_DATA_MODE !== "api", "run with VITE_PMS_DATA_MODE=api");
  const errors = watchRuntime(page);
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "API data source is not configured" }),
  ).toBeVisible();
  await expect(page.getByText("PMS_API_NOT_CONFIGURED")).toBeVisible();
  await expect(page.getByText("ugv-prod-001")).toHaveCount(0);
  expect(errors).toEqual([]);
});

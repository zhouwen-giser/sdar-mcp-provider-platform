import { expect, test, type Page } from "@playwright/test";

const scenarios = [
  "healthy",
  "empty",
  "loading",
  "partial-data",
  "network-error",
  "degraded",
  "runtime-stale",
  "config-drift",
  "catalog-breaking",
  "worker-backlog",
  "incident-active",
  "pending-approval",
  "read-only",
  "permission-denied",
] as const;

const routes = [
  "/dashboard",
  "/providers",
  "/providers/new",
  "/providers/provider-ha-east",
  "/provider-packages",
  "/resources",
  "/resources/climate-east-7f",
  "/runtime/deployments",
  "/runtime/deployments/new",
  "/runtime/deployments/deploy-ha-primary",
  "/runtime/processes",
  "/runtime/releases",
  "/databases",
  "/configuration",
  "/configuration/provider-runtime",
  "/catalog",
  "/catalog/provider-ha-east/set_temperature",
  "/registry",
  "/conformance",
  "/mcp-explorer",
  "/operations/health",
  "/operations/jobs",
  "/operations/incidents",
  "/operations/incidents/inc-runtime-drift-042?scenario=incident-active",
  "/changes",
  "/audit",
  "/system/settings",
  "/_prototype/components",
  "/_prototype/scenarios",
] as const;

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const activeRequests: string[] = [];
  page.on("request", (request) => {
    if (["xhr", "fetch", "websocket", "eventsource"].includes(request.resourceType()))
      activeRequests.push(`${request.resourceType()}:${request.url()}`);
    expect(new URL(request.url()).hostname).toBe("127.0.0.1");
  });
  await page.goto("/dashboard");
  await expect(page.getByText("PROTOTYPE / MOCK DATA")).toBeVisible();
  (page as Page & { __prototypeErrors?: string[]; __activeRequests?: string[] }).__prototypeErrors =
    errors;
  (page as Page & { __activeRequests?: string[] }).__activeRequests = activeRequests;
});

test.afterEach(async ({ page }) => {
  const tracked = page as Page & {
    __prototypeErrors?: string[];
    __activeRequests?: string[];
  };
  expect(tracked.__prototypeErrors).toEqual([]);
  expect(tracked.__activeRequests).toEqual([]);
});

test("provider onboarding completes entirely in Mock Data", async ({ page }) => {
  await page.goto("/providers/new");
  await page.getByLabel("显示名称").fill("产品评审 Provider");
  await page.getByLabel("Provider ID").fill("provider-product-review");
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: "运行 Mock Adapter 检查" }).click();
  await expect(page.getByText("模拟 Adapter 握手")).toBeVisible();
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByLabel("Database Profile").selectOption("db-profile-production-shared");
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByLabel("Runtime Release").selectOption("@sdar/runtime@2.0.0-rc.1");
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: "执行 Mock 预检查" }).click();
  await expect(page.getByText("模拟依赖、配置、放置和命名检查通过")).toBeVisible();
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: "提交模拟接入" }).click();
  await expect(page).toHaveURL(/\/providers\/provider-product-review/);
  await expect(page.getByText("Prototype Operations")).toBeVisible();
});

test("runtime deployment creation reaches ACTIVE with synchronized operation", async ({
  page,
}) => {
  await page.goto("/runtime/deployments/new");
  for (let index = 0; index < 5; index += 1)
    await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: "提交模拟创建" }).click();
  await expect(page).toHaveURL(/\/runtime\/deployments\/deploy-ha-east-prototype-1/);
  await advanceLatestOperation(page);
  await expect(page.getByText("revision 1", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("无", { exact: true })).toBeVisible();
});

test("configuration draft validates, diffs, analyses impact and collects ACK", async ({
  page,
}) => {
  await page.goto("/configuration/provider-runtime");
  await expect(page.getByText("Schema validation")).toBeVisible();
  await page.getByRole("button", { name: "JSON" }).click();
  await expect(page.getByText("secretref://pms/provider-ha-east/database")).toBeVisible();
  await page.getByRole("button", { name: "Diff" }).click();
  await expect(page.getByLabel("变更前")).toBeVisible();
  await page.getByRole("button", { name: "Impact" }).click();
  await expect(page.getByText("HOT_RELOAD", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "模拟发布 Revision" }).click();
  await advanceLatestOperation(page);
  await expect(page.getByText("APPLIED", { exact: true })).toBeVisible();
  await expect(page.getByText("RESTART_REQUIRED", { exact: true })).toBeVisible();
});

test("incident recovery traverses deployment, process, job and reconcile", async ({ page }) => {
  await page.goto("/operations/incidents?scenario=incident-active");
  await page.getByRole("button", { name: "Runtime observed revision 持续落后" }).click();
  await expect(page.getByText("runtime-oncall-mock")).toBeVisible();
  await page.getByRole("button", { name: "查看受影响 Deployment" }).click();
  await page.getByRole("button", { name: "副本" }).click();
  await page.getByRole("button", { name: "process-ha-01" }).click();
  await expect(page.getByText("PM2 online 不等于 ACTIVE 或已注册")).toBeVisible();
  await page.getByRole("button", { name: "关闭详情" }).click();
  await page.getByRole("button", { name: "模拟 Reconcile" }).click();
  await advanceLatestOperation(page);
  await page.getByRole("button", { name: "Incidents", exact: true }).click();
  await page.getByRole("button", { name: "Runtime observed revision 持续落后" }).click();
  await expect(page.getByRole("button", { name: "模拟关闭 Incident" })).toBeEnabled();
  await page.getByRole("button", { name: "模拟关闭 Incident" }).click();
  await advanceLatestOperation(page);
  await expect(page.getByText("CLOSED", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Worker Jobs", exact: true }).click();
  await page.getByRole("button", { name: /job-reconcile/ }).first().click();
  await expect(page.getByText("Fence token")).toBeVisible();
});

test("catalog breaking change is classified, diffed and blocked", async ({ page }) => {
  await page.goto("/catalog?scenario=catalog-breaking");
  await page.getByRole("button", { name: "set_temperature" }).click();
  await expect(page.getByText("BREAKING · Registry 发布已阻断")).toBeVisible();
  await page.getByRole("button", { name: "Catalog Diff" }).click();
  await expect(page.getByLabel("变更后")).toContainText("safetyApproval");
  await expect(page.getByRole("button", { name: "模拟发布 Registry" })).toBeDisabled();
  await page.getByRole("button", { name: "模拟重新发现" }).click();
  await expect(page.getByText("Prototype Operations")).toBeVisible();
});

test("all routes and all scenarios render without real data requests", async ({ page }) => {
  for (const route of routes) {
    await page.goto(route);
    await expect(page.getByText("PROTOTYPE / MOCK DATA")).toBeVisible();
  }
  for (const scenario of scenarios) {
    await page.goto(`/dashboard?scenario=${scenario}`);
    await expect(page.locator(".scenario-switcher select")).toHaveValue(scenario);
    await expect(page.locator("#main-content")).toBeVisible();
  }
});

async function advanceLatestOperation(page: Page) {
  const operation = page.locator(".operation-panel article").first();
  const advance = operation.getByRole("button", { name: "推进模拟步骤" });
  for (let step = 0; step < 8 && (await advance.isVisible()); step += 1) await advance.click();
  await expect(operation.locator(".status-completed")).toBeVisible();
}

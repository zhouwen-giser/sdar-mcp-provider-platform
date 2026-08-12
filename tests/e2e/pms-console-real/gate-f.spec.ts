import { createRequire } from "node:module";
import type { Page, Request } from "../../../apps/pms-web/node_modules/@playwright/test/index.js";
import type * as PlaywrightTestModule from "../../../apps/pms-web/node_modules/@playwright/test/index.js";
import { PMS_CONSOLE_REAL_E2E } from "./support.js";

const { expect, test } = createRequire(import.meta.url)(
  "../../../apps/pms-web/node_modules/@playwright/test",
) as unknown as typeof PlaywrightTestModule;

const fixture = PMS_CONSOLE_REAL_E2E;
const webOrigin = `http://${fixture.webHost}:${String(fixture.webPort)}`;
const consoleBase = "/api/console/v1";
const allowedWritePath = `${consoleBase}/providers/${fixture.providerId}/status`;
const forbiddenRequestContent = /(?:ugv|mqtt|device[-_/ ]?mcp|recon|gimbal|effector)/iu;
const mockProviderIds = ["ugv-prod-001", "ha-east-001", "npc-training-001"] as const;

test("Gate F: production Web uses the real Console API and isolated PMS database", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const guard = installNetworkGuard(page);

  await page.goto("/dashboard?environment=production");
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await expect(page.getByText(fixture.deploymentId).first()).toBeVisible();
  await expect(page.getByText("4", { exact: true }).first()).toBeVisible();
  await assertNoMockProviders(page);

  await page.goto("/providers?environment=production");
  await expect(page.getByRole("heading", { name: "Provider 列表" })).toBeVisible();
  await expect(page.getByText(fixture.providerId).first()).toBeVisible();
  await assertNoMockProviders(page);

  await page.goto("/resources?environment=production");
  await expect(page.getByRole("heading", { name: "Resources" })).toBeVisible();
  await expect(page.getByText(fixture.resourceId).first()).toBeVisible();

  await page.goto("/runtime/deployments?environment=production");
  await expect(page.getByRole("heading", { name: "Runtime Deployments" })).toBeVisible();
  await expect(page.getByText(fixture.deploymentId).first()).toBeVisible();
  await expect(page.getByText("● STOPPED").first()).toBeVisible();

  const latestRegistryResponsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === `${consoleBase}/registry/production/latest`,
  );
  await page.goto("/registry?environment=production");
  const latestRegistryResponse = await latestRegistryResponsePromise;
  expect(latestRegistryResponse.status()).toBe(200);
  const latestRegistry = (await latestRegistryResponse.json()) as {
    readonly revision: number;
    readonly document: {
      readonly providers: readonly { readonly providerId: string }[];
    };
  };
  expect(latestRegistry).toMatchObject({
    revision: 4,
    document: { providers: [{ providerId: fixture.providerId }] },
  });
  await expect(page.getByRole("heading", { name: "Registry", exact: true })).toBeVisible();
  const latestPanel = page.locator("section.panel").filter({
    has: page.getByRole("heading", { name: "Latest" }),
  });
  await expect(latestPanel.getByText("4", { exact: true })).toBeVisible();
  await expect(latestPanel.getByText("1", { exact: true })).toBeVisible();

  await page.goto(`/audit?environment=production&correlationId=${fixture.registryCorrelationId}`);
  await expect(page.getByRole("heading", { name: "Audit" })).toBeVisible();
  await expect(page.getByText("registry.snapshot.published").first()).toBeVisible();
  await expect(page.getByText(fixture.registryCorrelationId).first()).toBeVisible();

  await page.goto(`/configuration/${fixture.configurationDraftId}?environment=production`);
  await expect(
    page.getByRole("heading", { name: fixture.configurationDraftId, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(fixture.configurationDefinitionId).first()).toBeVisible();

  const writeResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === allowedWritePath &&
      response.request().method() === "PATCH",
  );
  await page.goto(`/providers/${fixture.providerId}/edit?environment=production`);
  await page.getByRole("button", { name: "设为 active", exact: true }).click();
  const writeResponse = await writeResponsePromise;
  expect(writeResponse.status()).toBe(200);
  expect(writeResponse.request().headers()["x-actor-id"]).toBe("pms-web-local-operator");
  expect(writeResponse.request().headers()["x-correlation-id"]).toMatch(/^corr-web-\d+$/u);
  await expect(page.getByRole("status").getByText(/操作已完成/u)).toBeVisible();
  const persistedProviderResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${consoleBase}/providers/${fixture.providerId}` &&
      response.request().method() === "GET",
  );
  await page.reload();
  const persistedProviderResponse = await persistedProviderResponsePromise;
  expect(persistedProviderResponse.status()).toBe(200);
  expect(await persistedProviderResponse.json()).toMatchObject({ status: "active" });
  await expect(page.getByRole("button", { name: "设为 active", exact: true })).toBeDisabled();

  const missingPath = `${consoleBase}/providers/pms-e2e-missing`;
  const missingResponsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === missingPath,
  );
  await page.goto("/providers/pms-e2e-missing?environment=production");
  const missingResponse = await missingResponsePromise;
  expect(missingResponse.status()).toBe(404);
  expect(missingResponse.headers()["content-type"]).toContain("application/problem+json");
  const problem = (await missingResponse.json()) as {
    readonly code: string;
    readonly title: string;
    readonly detail: string;
    readonly correlationId: string;
    readonly status: number;
  };
  expect(problem).toMatchObject({ code: "ENTITY_NOT_FOUND", status: 404 });
  await expect(page.getByText(`${problem.code} · ${problem.title}`)).toBeVisible();
  await expect(page.getByText(problem.detail)).toBeVisible();
  await expect(page.getByText(problem.correlationId)).toBeVisible();

  const machineBoundary = await page.evaluate(async (deploymentId) => {
    const response = await fetch(
      `/api/v1/runtime-registration/deployments/${deploymentId}/instances/pms-e2e-instance/register`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      body: (await response.json()) as { readonly code?: string },
    };
  }, fixture.deploymentId);
  expect(machineBoundary).toMatchObject({
    status: 404,
    body: { code: "PMS_WEB_API_ROUTE_NOT_ALLOWED" },
  });
  expect(machineBoundary.contentType).toContain("application/problem+json");

  await page.waitForLoadState("networkidle");
  guard.assertClean();
});

function installNetworkGuard(page: Page): {
  assertClean(): void;
} {
  const violations: string[] = [];
  let safeWrites = 0;
  page.on("request", (request) => inspectRequest(request, violations, () => (safeWrites += 1)));
  page.on("pageerror", (error) => violations.push(`PAGE_ERROR:${error.message}`));
  return {
    assertClean() {
      expect(violations).toEqual([]);
      expect(safeWrites).toBe(1);
    },
  };
}

async function assertNoMockProviders(page: Page): Promise<void> {
  for (const providerId of mockProviderIds) {
    await expect(page.getByText(providerId, { exact: true })).toHaveCount(0);
  }
}

function inspectRequest(request: Request, violations: string[], recordSafeWrite: () => void): void {
  const url = new URL(request.url());
  if (!["http:", "https:"].includes(url.protocol)) return;
  if (url.origin !== webOrigin) {
    violations.push(`BROWSER_LEFT_WEB_ORIGIN:${url.origin}`);
    return;
  }

  const requestContent = `${decodeURIComponent(url.pathname)} ${url.search} ${request.postData() ?? ""}`;
  if (forbiddenRequestContent.test(requestContent)) {
    violations.push(`FORBIDDEN_REAL_RESOURCE_REFERENCE:${request.method()}:${url.pathname}`);
  }
  for (const providerId of mockProviderIds) {
    if (requestContent.includes(providerId)) {
      violations.push(`MOCK_PROVIDER_SCOPE:${request.method()}:${providerId}`);
    }
  }

  if (url.pathname.startsWith(`${consoleBase}/runtime-deployments`) && request.method() !== "GET") {
    violations.push(`RUNTIME_CONTROL_WRITE:${request.method()}:${url.pathname}`);
  }

  if (url.pathname.startsWith(consoleBase) && !["GET", "HEAD"].includes(request.method())) {
    if (request.method() === "PATCH" && url.pathname === allowedWritePath) {
      recordSafeWrite();
    } else {
      violations.push(`UNEXPECTED_CONSOLE_WRITE:${request.method()}:${url.pathname}`);
    }
  }
}

import { test, expect } from "@playwright/test";
import { password } from "../test/fixture.js";
const start = "lon: 106.81179574200504, lat: 29.71859535009951";
const destination = "lon: 106.81312524254402, lat: 29.71859535009951";
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入控制台 →" }).click();
  await expect(page.getByRole("heading", { name: "设备观测与路线预览" })).toBeVisible();
});
test("keeps the read-only stop status visible at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const stop = page.getByRole("button", { name: "■ 停止不可用 · 只读模式" });
  await expect(stop).toBeDisabled();
  await expect(stop).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const bounds = await stop.boundingBox();
  expect(bounds).not.toBeNull();
  expect((bounds?.x ?? 390) + (bounds?.width ?? 1)).toBeLessThanOrEqual(390);
});
test("previews a real fixture planner route, downloads provenance and keeps controls disabled", async ({
  page,
}) => {
  await expect(page.getByRole("button", { name: "■ 停止不可用 · 只读模式" })).toBeDisabled();
  for (const label of ["导航", "区域侦察", "环视", "云台", "区域检查", "仿真效果交互"])
    await expect(page.getByRole("button", { name: label, exact: true })).toBeDisabled();
  await page.getByLabel("预览起点").fill(start);
  await page.getByLabel("预览目的地与途经点").fill(destination);
  await page.getByRole("button", { name: "预览路线", exact: true }).click();
  await expect(page.getByText("路线预览已生成 · 尚未采用", { exact: true })).toBeVisible();
  await expect(page.getByText("规划路线预览 · 尚未采用", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载预览报告" }).click();
  expect((await download).suggestedFilename()).toBe("ugv-route-preview.json");
  await expect(page.getByText("预览完成", { exact: false }).first()).toBeVisible();
});
test("preserves login, same-origin checks, rejected mutations and shared history after refresh", async ({
  page,
  context,
}) => {
  const result = await page.evaluate(async () => {
    const r = await fetch("/api/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commandId: crypto.randomUUID(),
        kind: "cancel",
        taskId: crypto.randomUUID(),
        arguments: {},
        catalogHash: "invalid",
      }),
    });
    return r.status;
  });
  expect(result).toBe(409);
  const other = await context.newPage();
  await other.goto("/");
  await expect(other.getByRole("heading", { name: "设备观测与路线预览" })).toBeVisible();
  await expect(other.getByText("规划与命令记录", { exact: true })).toBeVisible();
  await other.reload();
  await expect(other.getByRole("button", { name: "■ 停止不可用 · 只读模式" })).toBeDisabled();
  await other.close();
});
test("explains a nested MCP planner rejection without drawing a replacement route", async ({
  page,
}) => {
  await page.route("**/api/commands", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        status: "rejected",
        response: {
          isError: true,
          structuredContent: { reasonCode: "UGV_PLANNER_TIMEOUT" },
        },
      }),
    });
  });
  await page.getByLabel("预览起点").fill(start);
  await page.getByLabel("预览目的地与途经点").fill(destination);
  await page.getByRole("button", { name: "预览路线", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("三秒内未收到匹配起点及途经点的路线");
  await expect(page.getByRole("alert")).toContainText("UGV_PLANNER_TIMEOUT");
  await expect(page.getByRole("button", { name: "下载预览报告" })).toBeDisabled();
  await expect(page.getByText("规划路线预览 · 尚未采用", { exact: true })).toHaveCount(0);
});

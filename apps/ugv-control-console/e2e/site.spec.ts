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

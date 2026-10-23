import { test, expect } from "@playwright/test";
import { password } from "../test/fixture.js";
test("operator login, coordinate preview, shared task and original-task lifecycle", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("账号", { exact: true }).fill("operator");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入控制台" }).click();
  await expect(page.getByRole("heading", { name: /设备工作台/ })).toBeVisible();
  await page.getByLabel("WGS84 坐标", { exact: true }).fill("lon: 106.81307318, lat: 29.71952521");
  await page.getByRole("button", { name: "检查可用性" }).click();
  await expect(page.getByText("当前可用", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "执行导航", exact: true }).click();
  await expect(page.getByRole("heading", { name: /任务详情/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "暂停", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(page.getByText("已暂停", { exact: true }).first()).toBeVisible();
  await page.screenshot({
    path: process.env.UGV_CONSOLE_SCREENSHOT ?? "/tmp/ugv-control-console-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.getByText("已暂停", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /导航.*已暂停/ }).click();
  await page.getByRole("button", { name: "恢复", exact: true }).click();
  await expect(page.getByText("执行中", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "取消任务", exact: true }).click();
  await expect(page.getByText("已取消", { exact: true }).first()).toBeVisible();
  const other = await browser.newContext();
  const second = await other.newPage();
  await second.goto("/");
  await second.getByLabel("账号", { exact: true }).fill("operator");
  await second.getByLabel("密码", { exact: true }).fill(password);
  await second.getByRole("button", { name: "进入控制台" }).click();
  await expect(second.getByText("已取消", { exact: true }).first()).toBeVisible();
  await other.close();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/ugv-control-console-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
test("polygon validation rejects a self-intersection before a control call", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("账号", { exact: true }).fill("operator");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入控制台" }).click();
  await page.getByRole("tab", { name: "区域检查", exact: true }).click();
  await page.getByLabel("WGS84 坐标", { exact: true }).fill("0,0\n1,1\n0,1\n1,0");
  let controlCalls = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/commands") && r.method() === "POST") controlCalls++;
  });
  await page.getByRole("button", { name: "执行区域检查" }).click();
  await expect(page.getByRole("alert")).toContainText("自交");
  expect(controlCalls).toBe(0);
});

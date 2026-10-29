import { test, expect } from "@playwright/test";
import { password } from "../test/fixture.js";
test("project-owned FOV form, acknowledgement and real backend evidence thumbnail", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入控制台 →" }).click();
  await page.getByLabel("控制能力").selectOption("simulation_adjust_view");
  await expect(page.getByLabel("水平视场角（度）")).toHaveValue("60");
  await expect(page.getByRole("button", { name: "提交控制任务", exact: true })).toBeDisabled();
  await page.getByLabel("确认创建或重建本项目专属相机", { exact: true }).check();
  await expect(page.getByRole("button", { name: "提交控制任务", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "提交控制任务", exact: true }).click();
  await page.getByRole("button", { name: /^仿真视场（专属相机） ·/ }).click();
  await expect(page.getByLabel("仿真视场结果")).toContainText("实际水平视场角：60°");
  await expect(page.getByAltText("仿真新视场取证帧")).toBeVisible();
  await expect(page.getByLabel("仿真视场结果")).toContainText("本项目专属仿真视图");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

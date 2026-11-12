import { test, expect } from "@playwright/test";
import { password } from "../test/fixture.js";
test("HTTP login, exact original frame, download and archive health", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入控制台 →" }).click();
  await expect(page.getByLabel("观测归档与准入")).toContainText("正常写入");
  await page
    .getByRole("button", { name: /^查看原图 · eo · test-frame-/ })
    .first()
    .click();
  const image = page.getByRole("img", { name: /^光电原图 test-frame-/ });
  await expect(image).toBeVisible();
  await expect(page.getByText("曝光 UTC：未知（上游未提供）")).toBeVisible();
  await expect(page.getByText("fixture-detection · 像素 (8, 7) · 有检测框")).toBeVisible();
  await expect(page.getByLabel("同帧检测框与像素位置").locator("rect")).toHaveCount(1);
  expect(await image.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(20);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载本次原图" }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/^test-frame-.*\.jpg$/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { password } from "../test/fixture.js";
import { array, record } from "../shared/model.js";
test("native ZMQ console preserves timeout, shows late miss and exports immutable result versions", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("账号", { exact: true }).fill("operator");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入控制台" }).click();
  await expect(page.getByText("ZMQ 观测视图", { exact: false })).toBeVisible();
  await page.getByRole("tab", { name: "ZMQ 区域检查", exact: true }).click();
  await page
    .getByLabel("WGS84 坐标", { exact: true })
    .fill("106,29\n106.001,29\n106.001,29.001\n106,29.001");
  await page.getByRole("button", { name: "执行ZMQ 区域检查", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("椭球高");
  await page.getByRole("tab", { name: "仿真效果", exact: true }).click();
  await expect(page.getByLabel("仿真观测").locator("option")).not.toHaveCount(1);
  await page.getByLabel("仿真观测").selectOption({ index: 1 });
  await page.getByText("执行时序", { exact: true }).click();
  await page.getByLabel("最大执行时间 s", { exact: true }).fill("1");
  await page.getByRole("button", { name: "检查可用性", exact: true }).click();
  await expect(page.getByText("当前可用", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "执行仿真效果", exact: true }).click();
  await expect(page.getByRole("heading", { name: /任务详情/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "取消任务", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "暂停", exact: true })).toBeDisabled();
  await expect(page.getByText("已收到迟到结果", { exact: false })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("虚拟未命中", { exact: true })).toBeVisible();
  await expect(page.getByText("DEADLINE_EXCEEDED", { exact: true }).first()).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载完整报告", exact: true }).click();
  const file = await download,
    path = await file.path();
  if (!path) throw Error("BROWSER_DOWNLOAD_REQUIRED");
  const payload = record(JSON.parse(await readFile(path, "utf8")) as unknown);
  expect(record(payload.task).status).toBe("failed");
  const latest = record(array(record(payload.supplementalResults).pages)[0]);
  expect(record(record(latest.latest).nativeTask).effect).toBe("miss");
  expect(record(latest.latest).late).toBe(true);
  expect(latest.occupancy).toBe("released");
  expect(record(record(latest.originalTask).result).effect).toBe("unknown");
  if (process.env.SMPP_ZMQ_BROWSER_REPORT_FILE)
    await writeFile(
      process.env.SMPP_ZMQ_BROWSER_REPORT_FILE,
      JSON.stringify(payload, null, 2) + "\n",
    );
  await page.screenshot({
    path: process.env.UGV_ZMQ_BROWSER_SCREENSHOT ?? "/tmp/ugv-zmq-phase4-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/ugv-zmq-phase4-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
test("native navigation validates the published JSON and dispatches one bounded command", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("账号", { exact: true }).fill("operator");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入控制台" }).click();
  await page.getByRole("tab", { name: "ZMQ 导航", exact: true }).click();
  await page.getByLabel("ZMQ 原生参数").fill("[]");
  await page.getByRole("button", { name: "执行ZMQ 导航", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("JSON 对象");
  const operation = {
    name: "navigation.point",
    params: {
      destination: { longitude: 106.001, latitude: 29 },
      speedLimitMps: 1,
      obstacleAvoidance: true,
    },
  };
  await page.getByLabel("ZMQ 原生参数").fill(JSON.stringify({ operation }));
  await page.getByText("执行时序", { exact: true }).click();
  await page.getByLabel("最大执行时间 s", { exact: true }).fill("1");
  await page.getByRole("button", { name: "检查可用性", exact: true }).click();
  await expect(page.getByText("当前可用", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "执行ZMQ 导航", exact: true }).click();
  await expect(page.getByRole("heading", { name: /任务详情/ })).toBeVisible();
  await expect(page.getByText("DEADLINE_EXCEEDED", { exact: true }).first()).toBeVisible();
  const response = await page.request.get("/api/commands");
  expect(response.ok()).toBe(true);
  const commands = array(await response.json())
    .map((c) => record(record(c).request))
    .filter((c) => c.tool === "vehicle_zmq_navigate");
  expect(commands).toHaveLength(1);
  expect(record(commands[0]?.arguments).operation).toEqual(operation);
});

import { test, expect } from "@playwright/test";
import { password } from "../test/fixture.js";
import { array, record } from "../shared/model.js";
test("1.3.0 Chinese defaults, km/h conversion and durable raw/effective audit", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入控制台 →" }).click();
  await expect(page.getByLabel("速度上限（km/h）")).toHaveValue("60");
  await page.getByLabel("控制坐标").fill("106.81312524254402,29.71859535009951");
  await expect(page.getByRole("button", { name: "提交控制任务", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "提交控制任务", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "任务已受理" })).toBeVisible();
  const commands = array(await (await page.request.get("/api/commands")).json()).map(record);
  const navigation = commands.find((c) => record(c.request).tool === "vehicle_zmq_navigate");
  expect(record(record(record(navigation?.request).arguments).operation).params).toMatchObject({
    speedLimitMps: 60 / 3.6,
    obstacleAvoidance: true,
  });
  await page.getByRole("button", { name: /停止已接管任务/ }).click();
  await page.getByLabel("控制能力").selectOption("vehicle_zmq_inspect_area");
  await page.getByLabel("控制坐标").fill("106,29\n106.001,29\n106.001,29.001\n106,29.001");
  await expect(page.getByLabel("椭球高（米，留空默认 0；非实测高度）")).toHaveValue("");
  await expect(page.getByRole("button", { name: "提交控制任务", exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("shows operation-specific unsupported optical zoom and retains position controls", async ({
  page,
}) => {
  await page.route("**/api/device", async (route) => {
    const response = await route.fetch();
    const device = record(await response.json());
    const data = record(device.data),
      caps = record(data.vehicle_get_capabilities);
    caps.operationSupport = array(caps.operationSupport)
      .map(record)
      .map((s) =>
        s.operation === "camera.zoom"
          ? {
              ...s,
              status: "unsupported",
              available: false,
              reasonCode: "ZMQ_OPTICAL_ZOOM_UNSUPPORTED",
              description: "当前仿真缺少光学镜头停止反馈",
            }
          : s,
      );
    data.vehicle_get_capabilities = caps;
    device.data = data;
    await route.fulfill({ response, json: device });
  });
  await page.goto("/");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入控制台 →" }).click();
  await page.getByLabel("控制能力").selectOption("vehicle_zmq_camera");
  await page.getByLabel("云台动作").selectOption("zoom");
  await expect(page.getByLabel("动作准入状态")).toContainText("不支持");
  await expect(page.getByLabel("动作准入状态")).toContainText("ZMQ_OPTICAL_ZOOM_UNSUPPORTED");
  await expect(page.getByRole("button", { name: "提交控制任务", exact: true })).toBeDisabled();
  await page.getByLabel("云台动作").selectOption("position");
  await expect(page.getByLabel("动作准入状态")).toContainText("已配置支持");
  await expect(page.getByRole("button", { name: "提交控制任务", exact: true })).toBeEnabled();
});

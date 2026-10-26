import { test, expect } from "@playwright/test";
import { password } from "../test/fixture.js";
import { array, record } from "../shared/model.js";
test("Chinese site forms submit one live camera task, manual provenance and route adoption", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入控制台 →" }).click();
  await expect(page.getByRole("heading", { name: "现场设备控制" })).toBeVisible();
  await page.getByLabel("控制能力").selectOption("vehicle_zmq_camera");
  await page.getByLabel("云台动作").selectOption("zoom");
  await page.getByLabel("缩放倍率").fill("2");
  await expect(page.getByRole("button", { name: "提交控制任务", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "提交控制任务", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "任务已受理" })).toBeVisible();
  await page.getByLabel("控制能力").selectOption("vehicle_zmq_inspect_area");
  await page.getByLabel("控制坐标").fill("106,29\n106.001,29\n106.001,29.001\n106,29.001");
  await expect(page.getByText("请提供已确认的 WGS84 椭球高，不能默认使用 0").first()).toBeVisible();
  await page.getByLabel("控制能力").selectOption("simulation_apply_effect");
  await page.getByLabel("目标来源").selectOption("manual");
  await page.getByLabel("目标标识").fill("object-1");
  await page.getByLabel("控制坐标").fill("106.001,29");
  await page.getByLabel("人工来源说明").fill("浏览器隔离测试人工选择");
  await expect(page.getByRole("button", { name: "提交控制任务", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "提交控制任务", exact: true }).click();
  await page.getByLabel("预览起点").fill("106.81179574200504,29.71859535009951");
  await page.getByLabel("预览目的地与途经点").fill("106.81312524254402,29.71859535009951");
  await page.getByRole("button", { name: "预览路线", exact: true }).click();
  await expect(page.getByRole("button", { name: "采用并导航", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "采用并导航", exact: true }).click();
  await page.getByRole("button", { name: /停止已接管任务/ }).click();
  await expect(
    page.getByText(/停止请求受理|停止中，等待设备确认|已确认停止|停止证据未确认/).first(),
  ).toBeVisible();
  const r = await page.request.get("/api/commands"),
    commands = array(await r.json()).map(record);
  const motion = commands.filter((c) => record(c.request).tool === "vehicle_zmq_navigate");
  expect(motion).toHaveLength(1);
  expect(typeof record(motion[0]?.request).previewCommandId).toBe("string");
  const second = await context.newPage();
  await second.goto("/");
  await expect(second.getByRole("heading", { name: "现场设备控制" })).toBeVisible();
  await second.close();
  await page.screenshot({ path: "/tmp/ugv-zmq-site-control-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/ugv-zmq-site-control-mobile.png", fullPage: true });
  const overflow = await page.evaluate(() =>
    Array.from(document.querySelectorAll("body *"))
      .filter(
        (e) => e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX === "visible",
      )
      .map((e) => ({
        tag: e.tagName,
        cls: e.className,
        scroll: e.scrollWidth,
        client: e.clientWidth,
        height: e.getBoundingClientRect().height,
        text: e.textContent.slice(0, 100),
      }))
      .slice(-20),
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    JSON.stringify(overflow),
  ).toBe(true);
  expect(errors).toEqual([]);
});

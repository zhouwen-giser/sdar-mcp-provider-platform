import { test, expect } from "@playwright/test";
import catalog from "../shared/zmq-v152-control-catalog.json" with { type: "json" };
import { nativeContract } from "../shared/zmq-native.js";
import { CommandSchema, record, type CommandRow, type Json } from "../shared/model.js";

test("adoption shows original task failure, blocks repeat clicks and only queries after reload", async ({
  page,
}) => {
  const resourceId = "vehicle:SIMULATED",
    taskId = "SIMULATED-navigation-task",
    catalogHash = "SIMULATED-catalog";
  const commands: CommandRow[] = [],
    faults: string[] = [];
  let navigationCalls = 0,
    taskReads = 0;
  const position = { longitude: 114.04776722593608, latitude: 22.505954785129326 };
  const device = {
    resourceId,
    catalogHash,
    receivedAt: new Date().toISOString(),
    tools: catalog.tools.map((t) => nativeContract(t.name, resourceId, catalog.profile)),
    data: {
      vehicle_get_state: {
        schemaVersion: "ugv.vehicle-observation-state/3.0",
        archive: { status: "running" },
        observations: [
          {
            component: "chassis",
            receiptFresh: true,
            observation: { key: "localization", position },
          },
        ],
      },
      vehicle_get_capabilities: {
        planner: { available: true, mapReference: { mapId: "yuan_qu" } },
      },
    },
  };
  const failed = {
    taskId,
    status: "completed",
    statusMessage: "ZMQ_MODE_ECHO_TIMEOUT",
    result: {
      isError: true,
      structuredContent: {
        outcome: "business_failure",
        reasonCode: "ZMQ_MODE_ECHO_TIMEOUT",
        missingEvidence: [
          "SOURCE_PRODUCER_EPOCH_UNATTESTED",
          "CHASSIS_INITIAL_MISSION_STATE_NOT_OBSERVED",
          "CHASSIS_FEEDBACK_UNCORRELATED",
          "MODE_PUBLICATION_ORDER_UNVERIFIED",
        ],
      },
    },
  };
  page.on("pageerror", (e) => faults.push(e.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname,
      now = new Date().toISOString();
    let data: unknown = {};
    if (path === "/api/session") data = { username: "SIMULATED-operator" };
    else if (path === "/api/device") data = device;
    else if (path === "/api/availability")
      data = {
        availability: "available",
        validUntil: new Date(Date.now() + 30000).toISOString(),
        catalogHash,
      };
    else if (path === "/api/tasks")
      data = navigationCalls
        ? [
            {
              taskId,
              operation: "vehicle_zmq_navigate",
              snapshot: failed,
              createdAt: now,
              updatedAt: now,
            },
          ]
        : [];
    else if (path === "/api/tasks/" + taskId) {
      taskReads++;
      data = taskReads === 1 ? { taskId, status: "working" } : failed;
    } else if (path === "/api/commands" && request.method() === "GET")
      data = [...commands].reverse();
    else if (path === "/api/commands" && request.method() === "POST") {
      const input = CommandSchema.parse(request.postDataJSON() as unknown);
      if (input.tool === "vehicle_zmq_plan_route") {
        const preview = {
          schemaVersion: "ugv.zmq-route-preview/3",
          adoption: "preview_only",
          resourceId,
          waypoints: [position, { longitude: 114.04791, latitude: 22.50664 }],
          sourceRecordId: "SIMULATED-source",
          createdAt: now,
          plannerAdmission: {
            degraded: true,
            runtimePhase: "DEGRADED",
            faultComponent: "dashboard",
            reason: "dashboard: SIMULATED watchdog timeout",
          },
          transform: { reference: { mapId: "yuan_qu" } },
        };
        const row: CommandRow = {
          commandId: input.commandId,
          status: "completed",
          request: input,
          taskId: null,
          response: { structuredContent: preview },
          createdAt: now,
          updatedAt: now,
        };
        commands.push(row);
        data = row;
      } else {
        expect(input.tool).toBe("vehicle_zmq_navigate");
        expect(input.previewCommandId).toBe(commands[0]?.commandId);
        navigationCalls++;
        await new Promise((resolve) => setTimeout(resolve, 150));
        const row: CommandRow = {
          commandId: input.commandId,
          status: "accepted",
          request: input,
          taskId,
          response: { taskId },
          createdAt: now,
          updatedAt: now,
        };
        commands.push(row);
        data = row;
      }
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  await page.goto("/");
  await page.getByRole("heading", { name: "7879 路线预览" }).waitFor();
  await page.getByRole("button", { name: "填入当前接收位置", exact: true }).click();
  await page.getByLabel("预览目的地与途经点").fill("114.04791,22.50664");
  await page.getByRole("button", { name: "预览路线", exact: true }).click();
  const adopt = page.getByRole("button", { name: "采用并导航", exact: true });
  await expect(adopt).toBeEnabled();
  await adopt.evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  const outcome = page.getByRole("status", { name: "本预览的导航结果", exact: true });
  await expect(outcome).toContainText("导航业务失败", { timeout: 10000 });
  await expect(outcome).toContainText("ZMQ_MODE_ECHO_TIMEOUT");
  await expect(outcome).toContainText("路线尚未下发");
  await expect(outcome).toContainText(taskId);
  await expect(
    page.getByRole("button", { name: "本预览已有导航请求", exact: true }),
  ).toBeDisabled();
  expect(navigationCalls).toBe(1);
  expect(record(record(commands[0]?.response).structuredContent).adoption).toBe("preview_only");
  await page.reload();
  await expect(page.getByRole("status", { name: "本预览的导航结果", exact: true })).toContainText(
    "导航业务失败",
  );
  await expect(
    page.getByRole("button", { name: "本预览已有导航请求", exact: true }),
  ).toBeDisabled();
  expect(navigationCalls).toBe(1);
  await expect(page.getByText("dashboard：dashboard:", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "查看导航任务详情", exact: true }).click();
  const conclusion = page.getByRole("status", { name: "任务执行结论", exact: true });
  await expect(conclusion).toContainText("业务失败");
  await expect(conclusion).toContainText("ZMQ_MODE_ECHO_TIMEOUT");
  await expect(conclusion).toContainText("路线尚未下发");
  const evidence = page.getByRole("note", { name: "报告证据说明", exact: true });
  await expect(evidence).toContainText("报告证据待核实 · 4 项");
  await expect(evidence).toContainText("设备来源纪元未认证");
  await expect(evidence).toContainText("受理时缺少设备任务状态基线");
  await expect(evidence).toContainText("底盘反馈与本次任务的关联不足");
  await expect(evidence).toContainText("模式回显的命令关联与顺序未核实");
  for (const code of failed.result.structuredContent.missingEvidence)
    await expect(evidence).toContainText(code);
  expect(navigationCalls).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(faults).toEqual([]);
  const result: Json = {
    scope: "mock_api_no_device_socket",
    navigationCalls,
    taskReads,
    completedBusinessFailureShown: true,
    previewUnchanged: true,
    reloadDidNotRedispatch: true,
    taskDetailSeparatesFailureAndEvidence: true,
  };
  await test.info().attach("preview-navigation-result", {
    body: JSON.stringify(result),
    contentType: "application/json",
  });
});

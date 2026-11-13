import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  navigationPresentation,
  plannerDegradationDetail,
  previewNavigations,
  recoverPreviewNavigation,
} from "../shared/preview-navigation.js";
import { PreviewNavigationView } from "../web/PreviewNavigation.js";
import type { CommandRow } from "../shared/model.js";

const command: CommandRow = {
  commandId: "navigation-command",
  status: "accepted",
  taskId: "original-task",
  createdAt: "2026-11-13T07:27:27Z",
  updatedAt: "2026-11-13T07:27:27Z",
  response: { taskId: "original-task" },
  request: {
    commandId: "navigation-command",
    kind: "tool",
    tool: "vehicle_zmq_navigate",
    arguments: {},
    catalogHash: "catalog",
    previewCommandId: "preview-command",
  },
};
const preview: CommandRow = {
  ...command,
  commandId: "preview-command",
  status: "completed",
  taskId: null,
  request: { ...command.request, tool: "vehicle_zmq_plan_route" },
  response: {
    structuredContent: {
      schemaVersion: "ugv.zmq-route-preview/3",
      resourceId: "vehicle:ugv",
      adoption: "preview_only",
    },
  },
};
const failed = {
  status: "completed",
  statusMessage: "ZMQ_MODE_ECHO_TIMEOUT",
  result: {
    isError: true,
    structuredContent: { outcome: "business_failure", reasonCode: "ZMQ_MODE_ECHO_TIMEOUT" },
  },
};
describe("preview navigation uses the separate original task", () => {
  it("shows the real mode-echo business failure despite MCP completed", () => {
    expect(navigationPresentation(command, failed)).toMatchObject({
      label: "导航业务失败",
      tone: "error",
      reasonCode: "ZMQ_MODE_ECHO_TIMEOUT",
    });
    const html = renderToStaticMarkup(
      createElement(PreviewNavigationView, { command, task: failed, onOpen: () => undefined }),
    );
    expect(html).toContain("导航业务失败");
    expect(html).toContain("路线尚未下发");
    expect(html).toContain("original-task");
    expect(html).toContain("查看导航任务详情");
  });
  it("does not turn command acceptance or empty completed results into business success", () => {
    expect(navigationPresentation(command).label).toContain("核实执行结果");
    expect(navigationPresentation(command, { status: "completed" }).tone).toBe("warning");
  });
  it.each([
    [{ status: "working" }, "执行中"],
    [{ status: "input_required" }, "等待人工答复"],
    [{ status: "cancelled" }, "已取消"],
  ])("keeps task lifecycle state %j", (task, label) => {
    expect(navigationPresentation(command, task).label).toContain(label);
  });
  it("keeps transport uncertainty visible without retrying the task", () => {
    expect(navigationPresentation({ ...command, status: "unknown", taskId: null }).tone).toBe(
      "warning",
    );
    const html = renderToStaticMarkup(
      createElement(PreviewNavigationView, {
        command,
        task: { status: "working" },
        error: Error("READ_TIMEOUT"),
        onOpen: () => undefined,
      }),
    );
    expect(html).toContain("导航结果未确认");
    expect(html).toContain("不会重新派发");
  });
  it("restores only related navigation attempts from the exact resource/catalog preview", () => {
    const rows = [
      command,
      preview,
      {
        ...command,
        commandId: "unrelated",
        request: { ...command.request, previewCommandId: "other" },
      },
    ];
    expect(previewNavigations(rows, "preview-command").map((r) => r.commandId)).toEqual([
      "navigation-command",
    ]);
    expect(recoverPreviewNavigation(rows, "vehicle:ugv", "catalog")?.commandId).toBe(
      "preview-command",
    );
    expect(recoverPreviewNavigation(rows, "vehicle:other", "catalog")).toBeUndefined();
    expect(recoverPreviewNavigation(rows, "vehicle:ugv", "changed-catalog")).toBeUndefined();
    expect(recoverPreviewNavigation([preview], "vehicle:ugv", "catalog")).toBeUndefined();
  });
  it("does not duplicate an already-prefixed upstream component reason", () => {
    expect(
      plannerDegradationDetail({
        faultComponent: "dashboard",
        reason: "dashboard: HTTP timed out",
      }),
    ).toBe("dashboard: HTTP timed out");
    expect(
      plannerDegradationDetail({ faultComponent: "dashboard", reason: "HTTP timed out" }),
    ).toBe("dashboard：HTTP timed out");
  });
});

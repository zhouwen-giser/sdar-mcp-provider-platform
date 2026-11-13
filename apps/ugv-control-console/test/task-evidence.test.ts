import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { classifyTask } from "../shared/model.js";
import { TaskEvidence, TaskExecutionConclusion } from "../web/TaskEvidence.js";

const missingEvidence = [
  "SOURCE_PRODUCER_EPOCH_UNATTESTED",
  "CHASSIS_INITIAL_MISSION_STATE_NOT_OBSERVED",
  "CHASSIS_FEEDBACK_UNCORRELATED",
  "MODE_PUBLICATION_ORDER_UNVERIFIED",
];
const result = {
  isError: true,
  structuredContent: {
    outcome: "business_failure",
    reasonCode: "ZMQ_MODE_ECHO_TIMEOUT",
    missingEvidence,
  },
};

describe("execution failure and report evidence", () => {
  it("prioritizes the actual business failure over missing-evidence warnings", () => {
    const task = { status: "completed", statusMessage: "UNHELPFUL_STATUS", result };
    const html = renderToStaticMarkup(createElement(TaskExecutionConclusion, { task }));
    expect(html).toContain('aria-label="任务执行结论"');
    expect(html).toContain('class="notice error"');
    expect(html).toContain("业务失败");
    expect(html).toContain("ZMQ_MODE_ECHO_TIMEOUT");
    expect(html).toContain("路线尚未下发");
    expect(html).not.toContain("UNHELPFUL_STATUS");
    expect(classifyTask(task).tone).toBe("error");
  });
  it("explains all four source limitations and retains original diagnostic codes", () => {
    const original = structuredClone(missingEvidence);
    const html = renderToStaticMarkup(createElement(TaskEvidence, { missing: missingEvidence }));
    expect(html).toContain("报告证据待核实 · 4 项");
    expect(html).toContain("设备来源纪元未认证");
    expect(html).toContain("受理时缺少设备任务状态基线");
    expect(html).toContain("底盘反馈与本次任务的关联不足");
    expect(html).toContain("模式回显的命令关联与顺序未核实");
    for (const code of original) expect(html).toContain(code);
    expect(missingEvidence).toEqual(original);
  });
  it("keeps successful execution with missing evidence incomplete", () => {
    const task = {
      status: "completed",
      result: { isError: false, structuredContent: { outcome: "success", missingEvidence } },
    };
    expect(classifyTask(task)).toMatchObject({ label: "部分完成 / 证据不足", tone: "warning" });
  });
  it("does not make an in-progress task fail because evidence is still missing", () => {
    const html = renderToStaticMarkup(
      createElement(TaskExecutionConclusion, {
        task: { status: "working", statusMessage: "ZMQ_PREPARING", result },
      }),
    );
    expect(html).toContain("执行中");
    expect(html).toContain("ZMQ_PREPARING");
    expect(html).not.toContain("ZMQ_MODE_ECHO_TIMEOUT");
    expect(html).not.toContain('class="notice error"');
  });
  it("retains unknown evidence codes and handles an absent result", () => {
    expect(
      renderToStaticMarkup(createElement(TaskEvidence, { missing: ["FUTURE_EVIDENCE_CODE"] })),
    ).toContain("FUTURE_EVIDENCE_CODE");
    expect(renderToStaticMarkup(createElement(TaskEvidence, { missing: undefined }))).toBe("");
    expect(renderToStaticMarkup(createElement(TaskExecutionConclusion, { task: {} }))).toBe("");
  });
});

import { GatewayProblem } from "../../gateways/contracts/index.js";

export interface UiProblem {
  readonly code: string;
  readonly title: string;
  readonly detail?: string;
  readonly retryable: boolean;
  readonly correlationId?: string;
  readonly status?: number;
}
export function toUiProblem(error: unknown): UiProblem {
  if (error instanceof GatewayProblem) {
    const source = error.problem;
    return {
      code: source.code,
      title: source.title,
      ...(source.detail === undefined ? {} : { detail: source.detail }),
      retryable: source.status >= 500,
      ...(source.correlationId === undefined ? {} : { correlationId: source.correlationId }),
      status: source.status,
    };
  }
  const message = error instanceof Error ? error.message : "UNEXPECTED_ERROR";
  if (message === "API_DATA_SOURCE_NOT_CONFIGURED")
    return {
      code: "PMS_API_NOT_CONFIGURED",
      title: "API data source is not configured",
      detail: "Console API V1 adapter 尚未配置；生产模式不会回退到 Mock。",
      retryable: false,
    };
  return {
    code: "PMS_UI_UNEXPECTED",
    title: "页面处理失败",
    detail: "未显示内部异常对象。请重试并使用关联 ID 排查。",
    retryable: true,
  };
}

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, describe } from "./api.js";
import { array, record, text, type Json } from "../shared/model.js";
import { EFFECT_APPLY } from "../shared/zmq.js";

const effectLabels: Record<string, string> = {
  hit: "虚拟命中",
  miss: "虚拟未命中",
  destroyed: "虚拟实体移除",
  unknown: "效果未知",
};
export function ZmqResults({ taskId, operation }: { taskId: string; operation: string }) {
  const [after, setAfter] = useState(0);
  useEffect(() => setAfter(0), [taskId]);
  const result = useQuery({
    queryKey: ["supplement", taskId, after],
    queryFn: () =>
      api<Json>(`/tasks/${encodeURIComponent(taskId)}/supplement?afterRevision=${after}`),
    refetchInterval: 3000,
  });
  const data = record(result.data),
    page = record(data.page),
    rows = array(page.records).map(record),
    latest = record(data.latest),
    native = record(latest.nativeTask),
    coverage = record(data.coverageEvidence);
  return (
    <section className="evidence-summary">
      <h3>{operation === EFFECT_APPLY ? "仿真裁判结果与附加版本" : "ZMQ 检查成果与已收报告"}</h3>
      <p className="field-help">
        只查询平台已保留的来源。终态后继续核实附加结果；原任务终态及已归档 Context 保持原值。
      </p>
      {result.error && <div className="notice warning">{describe(result.error)}</div>}
      {operation === EFFECT_APPLY ? (
        <>
          <div className="evidence-cards">
            <div>
              <small>动作状态</small>
              <strong>{text(native.state) || "尚无关联反馈"}</strong>
            </div>
            <div>
              <small>动作是否结束</small>
              <strong>
                {data.executionFinished === true
                  ? "已确认结束"
                  : data.executionFinished === false
                    ? "尚未结束"
                    : "未知"}
              </strong>
            </div>
            <div>
              <small>仿真效果</small>
              <strong>{effectLabels[text(native.effect)] ?? "效果未知"}</strong>
            </div>
            <div>
              <small>最新附加版本</small>
              <strong>{text(data.latestRevision) || "—"}</strong>
            </div>
          </div>
          {data.occupancy === "held" && (
            <div className="notice warning">
              仿真效果通道仍被占用。任务超时或停止等待不会撤销裁判动作。
            </div>
          )}
          {latest.late === true && (
            <div className="notice warning">
              已收到迟到结果。原任务结论保持不变，请结合本附加版本查看。
            </div>
          )}
          <p className="field-help">
            此服务不支持暂停、恢复或撤销已受理动作；执行成功与虚拟效果分别展示。
          </p>
        </>
      ) : (
        <>
          <div className="evidence-cards">
            <div>
              <small>逐帧观测项数</small>
              <strong>{text(data.observationCount) || "0"}</strong>
            </div>
            <div>
              <small>源端报告截断</small>
              <strong>{data.sourceTruncated === true ? "存在，无法补回" : "未报告截断"}</strong>
            </div>
            <div>
              <small>设备声明覆盖比例</small>
              <strong>
                {typeof coverage.ratio === "number" ? `${coverage.ratio * 100}%` : "未知"}
              </strong>
            </div>
            <div>
              <small>设备声明覆盖完成</small>
              <strong>
                {coverage.complete === true ? "是" : coverage.complete === false ? "否" : "未知"}
              </strong>
            </div>
          </div>
          <p className="notice warning">
            识别流完整性未验证；有效空帧不能证明整个区域没有发现。请求边界不代表扫描足迹。
          </p>
          {data.truncated === true && (
            <p className="notice warning">
              内联发现仅展示前 256 项，可分页读取或下载全部已收报告。
            </p>
          )}
        </>
      )}
      {array(data.missingEvidence).length > 0 && (
        <div className="notice warning">
          缺失证据：{array(data.missingEvidence).map(text).join("、")}
        </div>
      )}
      <div className="button-group">
        <button disabled={after === 0} onClick={() => setAfter(0)}>
          首个版本
        </button>
        <button
          disabled={page.hasMore !== true}
          onClick={() => setAfter(Number(page.nextRevision))}
        >
          下一页已收报告
        </button>
        <small>
          {rows.length} 条 · {text(page.historySource) || "等待结果"}
        </small>
      </div>
      {rows.map((row) => (
        <details className="json-view" key={text(row.revision)}>
          <summary>
            结果版本 {text(row.revision)} · {text(row.kind)} · {text(row.receivedAt)}
          </summary>
          <pre>{JSON.stringify(row, null, 2)}</pre>
        </details>
      ))}
    </section>
  );
}

# 区域检查工具 v1

`vehicle_inspect_area` 是 `TASK_REQUIRED` 工具。部署默认 `UGV_INSPECTION_ENABLED=false`；启用要求 PostgreSQL ProviderStore、TaskBusiness 及 Runtime BusinessEvents 链可用，并通过原有区域侦察南向工具资格检查。

## 输入与时序

`x` 是经度，`y` 是纬度；`frame` 只能为 WGS84 / EPSG:4326，省略表示 WGS84。调用者须提供已经处理排除区的合法子区域。非空 `excludedZones`、退化或自交多边形、重复顶点及跨日界线的未拆分环会在派发前拒绝；不执行地图裁剪或坐标猜测。

```json
{
  "name": "vehicle_inspect_area",
  "arguments": {
    "resourceId": "vehicle:ugv1",
    "area": {
      "frame": "WGS84",
      "boundary": [
        { "x": 116, "y": 39 },
        { "x": 117, "y": 39 },
        { "x": 117, "y": 40 },
        { "x": 116, "y": 40 }
      ]
    }
  },
  "_meta": {
    "io.sdar/taskExecution": {
      "profileVersion": "1.0",
      "idempotencyKey": "inspection-example-1",
      "timing": {
        "start": { "mode": "immediate", "startToleranceMs": 30000 },
        "maxElapsedMs": 300000
      }
    }
  }
}
```

一次检查固定一次区域扫描。TaskExecution 承载预约与更短期限；Provider 另有持久的 300 秒上限。超时请求停止后仍等待同 mission 的物理停止证据。已经请求的停止不重复派发；迟到的扫描完成不能覆盖超时结果。

## 报告与来源

通过冻结协议 `tasks/get` 的 `result.structuredContent` 读取完成及业务失败报告；技术失败在标准 `error.data` 中保留报告事实。Core 调度期限和开始窗口失败同样保留既有发现，将报告降级并列出时序缺失证据，且不暴露原始 protobuf 包。取消终态沿用冻结协议，完整报告可从 Context 的 `summary.properties.inspectionResult` 读取。完整来源对象可继续从 `io.sdar/taskBusiness/context/get`、`snapshotParts/get` 和 `artifacts/get` 读取。客户端应声明 `io.sdar/taskBusiness` profileVersion `1.0-rc2`。

报告包含 `anomalies`、`inspectionReport`、`coverage`、`correlationStrength`、`missingEvidence`，发现字段为扁平 JSON primitive。每项保留类型、来源引用、观察时间和已知 WGS84 位置。关联强度代表任务/设备/mission/时序关联，不代表来源的密码学认证。历史、retained、过期、冲突与无法关联的消息不能补齐本次检查证据。

只有本任务有效目标报告与有效完整覆盖报告齐备，才能报告完整检查及有效空发现。来源缺失、覆盖不足、超时或截断返回 `partial` / `unavailable`，并列出原因。最多内联 256 项，成功报告的发现部分另有 160 KiB 字节预算。失败、取消及超时报告使用 16 KiB 发现预算、最多 64 个内联来源引用，给冻结业务错误合同的 64 KiB 上限保留空间。超限保留全部 TaskBusiness 对象及 Context 中的事件事实，`truncated=true`，报告不宣称完整。

完成事件附带指向真实报告的 `inspection.report` 证据。采用新区域后，未带区域版本的覆盖计数不能证明原始检查区域完成，报告明确列出 `INSPECTION_EFFECTIVE_AREA_CHANGED` 和覆盖缺失。

## 生命周期、部署与回退

复用区域侦察的 EO 互斥、资格检查、命令日志、暂停/恢复/取消、RequiredInput 和恢复流程。执行记录、Context、事件和结果始终保留 `vehicle_inspect_area` 身份；新增事实仅写现有 JSONB 和业务对象，无新增表或冻结迁移变更。

隔离验证使用任务自有 PostgreSQL、MQTT 和 HTTP mock Device MCP；正式 MCP / gRPC 链测试也使用这些设施。验收命令、源码摘要、退出码及原始日志哈希见 `reports/inspection-area-v1/raw/`。本地发布须先确认空闲，并保留卷、绑定、轨迹签名密钥及 PMS 配置。回退撤回新增发布、恢复旧目录及镜像、关闭开关，保留报告和版本历史。现场巡逻执行另行验收，当前为 `NOT_RUN`。

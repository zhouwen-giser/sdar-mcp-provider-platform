# UGV 业务语义投影合同 v1

`businessSemantics` 是对已有 UGV 状态的纯投影，schema 为 `ugv.business-semantics/1`。它用于 Agent 和界面理解设备枚举，不参与任务状态转换，不授予业务权限，也不证明数据新鲜、关联成功或设备命令已经完成。

实现与 schema：[ugv-business-semantics.ts](../../packages/vehicle-provider-core/src/ugv-business-semantics.ts)。对外字段为增量扩展，原 `chassis.mission.state`、`reconnaissance.motionStatus/reconType/loadStatus/lock.stage` 等字段继续保留；投影的 `native` 也保留参与计算的原值。字段缺失记为 `null`，源明确报告的 `"unknown"` 保持为该字符串。合法但未知的整数不会被替换成已知码。

## 读取位置

- `vehicle_get_state`、`vehicle_get_payload_status`、`vehicle_get_targets`：`result.structuredContent.businessSemantics`。
- 侦察 TaskBusiness Context：`snapshot.context.summary.properties.businessSemantics`。
- `recon.motion_status_observed` 业务事件：`rawPayload.payload.data.businessSemantics`；同一事件的 `contextDelta.summary` 携带完整替换值。

三类查询使用同一个快照投影函数；侦察业务事件复用该函数所用的源模型与映射。Context 记录的是最近被归属到该 Execution 的状态样本，不等同于任意时刻的最新查询。只有源状态相同时投影值才应相同。新字段不改变 Context/对象 revision、公开 SSE 游标或既有 TaskBusiness Profile 版本。

在同一侦察阶段内，传感器模式、载荷健康等语义变化也会发布更新事件；相同源游标不重复发布。`STRICT_CORRELATED` 与 `INFERRED_CURRENT_EXECUTION` 继续使用原有字段，不由投影升级关联强度。

## 字段和映射依据

| 语义字段           | 原字段                                                          | 已确认映射                                                                                                                                                        | 实现依据                                                                                                                                 |
| ------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `missionTaskState` | `chassis.mission.state`                                         | -1 idle；0 starting；1 running；2 paused；3 cancelled；4 succeeded；5 failed                                                                                      | [task-state-mapper.ts](../../packages/vehicle-provider-core/src/task-state-mapper.ts)                                                    |
| `reconPhase`       | `reconnaissance.motionStatus`                                   | 1 idle；2 configuring；3 ready；4 starting；5 running；6 resuming；7 pausing；8 paused；9 cancelled；10 failed；11 completed；12 stopping；13 manual_intervention | 同上；99 和其他值为 unknown                                                                                                              |
| `visualLockState`  | `reconnaissance.lock.stage`                                     | 1 unlocked；2 locking；3 locked                                                                                                                                   | [native-lock-business-processor.ts](../../apps/ugv-provider-adapter/src/native-lock-business-processor.ts)；4 未获可靠语义，保持 unknown |
| `sensorMode`       | `reconnaissance.reconType`                                      | 1 adaptive；2 visible；3 infrared；4 dc                                                                                                                           | [tool-mapping.ts](../../packages/vehicle-device-mcp-client/src/tool-mapping.ts) 的既有设备参数映射                                       |
| `payloadLoadState` | `reconnaissance.loadStatus`                                     | 4 fault；其他值 unknown                                                                                                                                           | [airport-map-geometry.ts](../../apps/ugv-provider-adapter/src/airport-map-geometry.ts) 的既有故障判定；仓库没有完整载荷码表              |
| `payloadHealth`    | 上述载荷码、`cameraFault`、`online`、`health.components.sensor` | 按下述顺序组合已有明确事实                                                                                                                                        | 既有故障标志和组件健康归一化                                                                                                             |

`payloadHealth` 判定顺序：

1. `loadStatus=4`、`cameraFault=true` 或 `sensorHealth=fault`，输出 `fault`。
2. 否则 `online=false`，输出 `offline`。
3. 无未解释的载荷数字码，且 `online=true`、`cameraFault=false`、`sensorHealth=normal` 均已明确，输出 `normal`。
4. 其余输出 `unknown`。

`normal` 仅表达这些状态事实，不代表可以启动任意工具。仍需调用 `checkAvailability` 并通过服务端资源、锁定、任务绑定及时间守卫。

原生 label 保持为设备诊断文本，不将自由文本视为码表。`regionType`、`targetTypes` 不通过猜测映射为点/线/面或对象类别；请求和目标的既有原字段保持不变。未定义的枚举一律为 `unknown`，不同字段的数字不能互相解释。

## 示例

```json
{
  "schemaVersion": "ugv.business-semantics/1",
  "missionTaskState": "running",
  "reconPhase": "paused",
  "visualLockState": "locked",
  "sensorMode": "visible",
  "payloadHealth": "fault",
  "payloadLoadState": "fault",
  "native": {
    "missionTaskState": 1,
    "reconMotionStatus": 8,
    "lockStage": 3,
    "reconType": 2,
    "loadStatus": 4,
    "cameraFault": false,
    "online": true,
    "sensorHealth": "normal"
  }
}
```

这里 `cameraFault=false` 不覆盖已报告的 `loadStatus=4` 故障。若 `loadStatus=731`，保留 731，`payloadLoadState=unknown`；其他明确故障仍可使 `payloadHealth=fault`。若原生侦察状态是新整数，查询可读取该码与 `reconPhase=unknown`，业务状态机继续按 `RECONCILE` 处理，不能自动判定完成。

本扩展仅在 UGV manifest 开启，NPC Tank 的输出合同和原未知码准入规则保持不变。非枚举字段的类型、任务 ID 哨兵规则、时间、有效载荷大小和安全校验继续执行；对未知整数兼容不等于接受损坏的 JSON 或伪造的任务身份。

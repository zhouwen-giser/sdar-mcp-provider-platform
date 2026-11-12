# 光电系统对外 ZeroMQ 接口

- **版本号 V2.3**
- **修订时间 2026.11.06**
- **修订基线：V2.1 → V2.2 → V2.3；分版本改动项见第 8 章**

> 本文合并 [V2.2 协议](光电协议-V2.2.md) 与 [V2.3 变更与集成说明](光电协议-V2.3变更与集成说明.md)。按原始版本 V2.1 记录演进；本次合并前主文档页头已标为 V2.2，且已含部分 V2.2 内容，因此第 8 章区分参考稿修订摘要与本次实际补齐项，不将已有内容重复认定为新增。
>
> 本合并稿将信封及示例的 `protocol` 统一标为字符串 `"2.3"`。参考变更单未定义版本协商或旧版本兼容策略，联调时须确认双方支持的版本；文档更新不代表运行中的服务已实现这些变更。

## 1. 总体说明

### 1.1 对接目标与范围

外部上位机或整车系统下达区域搜索、周扫/扇扫任务，控制任务启动、暂停、继续、终止，以及遥控云台和相机变焦；光电端周期上报设备状态、任务状态、识别列表和跟踪列表。图像采集、检测、扫描规划、设备控制、坐标变换与定位在光电端完成。

本协议开放云台位置/速度遥控、相机光学变焦和任务暂停恢复；不开放算法参数、标定修改、内部扫描网格、视频传输。区域搜索限四点凸区域和部署约定的水平面，不支持任意地形。云台角限位、速度上限、扫描策略及相机配置由部署确定；外部请求必须满足这些物理约束，不能靠协议取值范围绕过限位。

### 1.2 接口清单

| 方向/通道 | method 或上报名称 | 作用 |
| --- | --- | --- |
| 外部 → 光电，REQ/REP | AreaSearch | 下达区域搜索，仅配置，不运动，生成 task_id |
| 外部 → 光电，REQ/REP | CircularSearch | 下达周扫/扇扫，仅配置，不运动，生成 task_id |
| 外部 → 光电，REQ/REP | TaskControl | 对指定 task_id 执行 start/pause/resume/stop/next_follow |
| 外部 → 光电，REQ/REP | TeleControl | 云台位置/速度遥控、相机变焦、停止遥控动作 |
| 光电 → 外部，PUB/SUB | DeviceStatus | 设备健康、实际角度、停止确认和遥控状态 |
| 光电 → 外部，PUB/SUB | TaskStatus | 当前或最近任务、进度和最近任务命令 |
| 光电 → 外部，PUB/SUB | TargetList | 同一图像帧的识别目标列表，含类别、置信度、威胁度和像素信息 |
| 光电 → 外部，PUB/SUB | TrackList | 单目标跟踪状态、像素、检测框、观测时间及可用地理位置 |

上报名称供文档阅读，不是请求 method；实际 topic 见 2.1。任务与遥控通道只支持上表四个 method，无原版旧方法别名；V2.3 视频与取帧辅助链路单列于第 5 章，不作为本表新增 method。

### 1.3 典型交互

```text
外部系统                                      光电系统
  ├── 建立 SUB ───────────────────────────────→ ┤
  │ ←──────── DeviceStatus / TaskStatus 周期快照 ┤
  ├── AreaSearch 或 CircularSearch ───────────→ ┤
  │ ←──────── accepted + task_id ───────────────┤
  │ ←──────── TaskStatus：ready ────────────────┤
  ├── TaskControl(task_id, start) ─────────────→ ┤
  │ ←──────── accepted ─────────────────────────┤
  │ ←──────── starting → searching / TargetList ┤
  ├── TaskControl(task_id, pause/resume/stop) ──→ ┤
  │ ←──────── 回执 + 后续 TaskStatus ────────────┤
```

REQ 回执仅确认请求接纳或拒绝，不等待物理动作完成。任务成功、命令成功和设备停稳须分别判断。

## 2. 公共通信约定

### 2.1 连接、topic 与分帧

| 通道 | 光电端 | 外部端 | 默认地址 |
| --- | --- | --- | --- |
| 指令 | REP，bind | REQ，connect | tcp://<光电IP>:5555 |
| 周期/事件上报 | PUB，bind | SUB，connect | tcp://<光电IP>:5556 |

- **请求和响应均为一帧 UTF-8 JSON**；REQ/REP 内部信封由 ZeroMQ 管理，应用不加空帧。

- **发布消息固定两帧 multipart：第一帧 UTF-8 topic，第二帧 UTF-8 JSON**

| 上报名称 | 第一帧完整 topic | 第二帧 JSON.topic |
| --- | --- | --- |
| DeviceStatus | isr/<device_id>/device_status | device_status |
| TaskStatus | isr/<device_id>/task_status | task_status |
| TargetList | isr/<device_id>/targetlist | targetlist |
| TrackList | isr/<device_id>/tracklist | tracklist |

SUB 可订阅 isr/<device_id>/ 前缀，随后须核对完整 topic、JSON.topic 和 device_id。每设备一个命令服务，一个 REQ 不同时连接多设备；REQ/REP/PUB/SUB socket 分别由所属线程使用。

单个 JSON 帧不超过 65536 字节，topic 不超过 128 字节。不支持请求数组批量命令。发布者必须在序列化后检查字节数。

REQ 严格 send→recv 交替；应答超时后销毁并重建 REQ，不能在原 socket 直接再次 send。服务端登记命令后及时回执，不能让 REP 等待搜索、暂停或停止完成。

建议参数：REQ 设置 IMMEDIATE=1、SNDTIMEO=1000ms、RCVTIMEO=2000ms、LINGER=0、SNDHWM/RCVHWM=32；PUB/SUB 设置 SNDHWM/RCVHWM=1000、LINGER=0；接收端 MAXMSGSIZE=65536。参数在 bind/connect 前配置。不使用 CONFLATE，本协议是 multipart。

PUB/SUB 是尽力实时分发，订阅建立、断线、积压可能丢消息。周期全量状态用于恢复最新状态；识别/跟踪列表无历史补发，不能作为完整成果存档。上述传输语义依据 [ZeroMQ socket 官方文档](https://libzmq.readthedocs.io/en/latest/zmq_socket.html)；CONFLATE 和超时选项依据 [socket 参数官方文档](https://libzmq.readthedocs.io/en/latest/zmq_setsockopt.html)。

### 2.2 通用类型与单位

所有字段按表必填；明确标为可省略的字段除外。可空字段用 null 表示未知/不适用，不用 0、空对象或上一条数据代替。禁止重复 JSON 键、未定义字段、NaN/Infinity，数值必须有限。方法名、字段名、枚举值均区分大小写。

| 项目 | 约定 |
| --- | --- |
| ID | 1～64 个 ASCII 字母、数字、下划线、点、冒号、连字符；首字符为字母或数字 |
| UTC 时间 | 毫秒整数，0 ≤ 值 < 2^53；无法可靠映射时仅允许在注明可空处填 null |
| 角度/角速度 | rad / rad/s；车体 FLU：前、左、上；yaw 正向从前向左，pitch 正向抬头 |
| yaw | 车体坐标下的云台视轴方位角，规范化到 [-π, π)；不是地理北向航向角 |
| pitch | 车体坐标下的视轴仰角，[-π/2, π/2]，仍须满足实际机械限位 |
| 距离 | 米；地理位置使用 WGS84 纬度、经度、椭球高 |
| 比率 | number，0～1；未知或不适用时 null |

载体运动时，周扫/扇扫与遥控角度随车体坐标定义；区域搜索则由光电端结合导航实时解算。

> [!IMPORTANT]
>
> **当前松灵小车上的光电设备，记录其设别ID【device_id】为 isr-01**

### 2.3 REQ请求信封【6】

| 字段 | 类型 / 必填 | 约定 |
| --- | --- | --- |
| protocol | string，是 | 固定 2.3 |
| kind | string，是 | 固定 request |
| device_id | string，是 | 目标设备编号，须与连接设备一致 |
| request_id | string，是 | 一次逻辑请求的全局唯一编号，重试不变 |
| method | string，是 | 1.2 的四个请求方法之一 |
| params | object，是 | 对应方法的业务参数 |

### 2.4 RES回执信封【8】

| 字段 | 类型 / 必填 | 约定 |
| --- | --- | --- |
| protocol | string，是 | 2.3 |
| kind | string，是 | 固定 response |
| device_id | string，是 | 设备编号 |
| response_id | string/null，是 | 等于请求 request_id；完全无法解析编号时 null |
| method | string/null，是 | 回显请求方法；无法解析时 null |
| ok | boolean，是 | true=接纳成功，false=拒绝。这里不代表执行的结果，只表示REQ接收结果 |
| command | object/null，是 | 动作成功返回 Command；拒绝时 null |
| error | object/null，是 | ok=true 时 null；拒绝时 {code,message} |

### 2.5 通用字段定义

#### 2.5.1 error

业务错误码

| 字段    | 类型   | 约定                                                         |
| :------ | :----- | :----------------------------------------------------------- |
| code    | string | 错误码，具体定义在 6.2 中                                    |
| message | string | 错误消息，一般和错误码相对应，具体内容由业务逻辑开发解释，这里没有强制内容定义 |

```json
{
   "error":{
      "code": "INVALID_STATE",
      "message": "任务 task-018 当前为 searching，不能执行 resume；请先暂停并确认 paused。"
   }
}
```

#### 2.5.2  command

Command 结构用于动作回执以及周期上报中的最近命令：

| 字段       | 类型        | 约定                          |
| :--------- | :---------- | :---------------------------- |
| request_id | string      | 原请求编号                    |
| method     | string      | 原请求方法                    |
| state      | string      | accepted / failed             |
| task_id    | string/null | 关联任务；TeleControl 为 null |
| reason     | string/null | 执行失败原因码；正常为 null   |

```json
{
    "command":{
       "request_id": "req-tele-pos-001",
       "method": "TeleControl",
       "state": "accepted" / "failed",
       "task_id": null,
       "reason": null,
    }
}
```

`command.state` 表示**某一条请求的执行状态，简单表示任务是否启动成功，和任务执行结果无关**；它与 `Task.state` 分别描述命令和整个任务。

| 状态       | 出现条件                                 | 示例                                           |
| ---------- | ---------------------------------------- | ---------------------------------------------- |
| `accepted` | 已接纳，任务回调已正常执行               | 收到 `start`，已接纳，任务回调已按计划启动执行 |
| `failed`   | 已接纳，但是因为某些原因任务回调执行失败 | 启动时设备故障；停止超时                       |

例如，启动命令完成后：

```
command.state = accepted   启动这件事已完成
TaskStatus.data.task.state = searching   搜索任务正在执行
```

此后搜索失败，更新的是任务状态；启动命令REP不再更新

另外，**请求直接被拒绝不属于 `command.failed`**。参数错误、设备忙、任务编号不存在等，在接纳前返回 `ok=false` 和 `error`，不生成已接纳命令。

#### 2.5.3 position

定义 WGS84 经纬度与椭球高，用于 4.4 的跟踪定位结果；4.3 识别列表不包含 position。区域搜索的 region_wgs84 顶点亦使用此结构。

| 字段               | 类型   | 约定       |
| :----------------- | :----- | :--------- |
| latitude_deg       | number | [-90,90]   |
| longitude_deg      | number | [-180,180) |
| ellipsoid_height_m | number | 单位米     |

```json
{
   "position": {
     "latitude_deg": 31.0005,
     "longitude_deg": 121.0005,
     "ellipsoid_height_m": 10
   }
}
```

####

## 3. 请求接口详述

### 3.1 AreaSearch：下达区域搜索

| params 字段 | 中文含义 | 类型 / 必填 | 约定 |
| --- | --- | --- | --- |
| region_wgs84 | 搜索区域顶点 | array，是 | 恰好四个 Position，沿边界顺序排列，不重复首点【V2.2 明确】 |
| task_timeout_ms | 任务总预算 | integer，是 | 1000～3600000ms，从首次 start 接纳起算 |
| search_strategy | 搜索策略 | string，是 | recognize 表示 仅识别(默认），track 表示 跟踪 |

区域边界点须严格凸、无重复、无自交，并满足部署约定的水平面高度容差、搜索距离、视线与机械条件；不能覆盖的请求明确拒绝，不静默改区域。禁止将任意地形近似结果宣称为精确地面定位。

本接口只校验、建档、规划准备，**不驱动云台搜索**。接纳即分配唯一 task_id，上报的TaskStatus 可暂为 preparing；

- **recognize** 识别模式上报 4.3 TargetList，包含类别、图像位置、置信度和威胁度，不含地理定位。
- **track** 跟踪模式按“扫描 → 逐帧检测 → 逐个确认（匹配限定目标类型）→ 锁定确认序列中从左到右的第一个目标 → 跟踪”执行，再测距和定位，上报 4.4 TrackList【V2.3 集成说明明确】。可用 TaskControl.next_follow 按确认顺序切换目标，但不能直接指定 target_id。限定类型的配置方式未在参考稿中定义，不新增请求参数。

请求示例：

```json
{
  "protocol": "2.3",
  "kind": "request",
  "device_id": "isr-01",
  "request_id": "req-area-001",
  "method": "AreaSearch",
  "params": {
    "search_strategy" : "recognize" / "track",
    "region_wgs84": [
      {
        "latitude_deg": 31,
        "longitude_deg": 121,
        "ellipsoid_height_m": 10
      },
      {
        "latitude_deg": 31,
        "longitude_deg": 121.001,
        "ellipsoid_height_m": 10
      },
      {
        "latitude_deg": 31.001,
        "longitude_deg": 121.001,
        "ellipsoid_height_m": 10
      },
      {
        "latitude_deg": 31.001,
        "longitude_deg": 121,
        "ellipsoid_height_m": 10
      }
    ],
    "task_timeout_ms": 120000
  }
}
```

需要改区域时先 stop 原任务，再以新 request_id 下达。

接纳回执：

```json
{
  "protocol": "2.3",
  "kind": "response",
  "device_id": "isr-01",
  "response_id": "req-area-001",
  "method": "AreaSearch",
  "ok": true,
  "command": {
    "request_id": "req-area-001",
    "method": "AreaSearch",
    "state": "accepted",
    "task_id": "task-018",
    "reason": null,
  },
  "error": null
}
```

### 3.2 CircularSearch：下达周扫/扇扫

| params 字段 | 中文含义 | 类型 / 必填 | 约定 |
| --- | --- | --- | --- |
| scan_mode | 扫描方式 | string，是 | circular=周扫；sector=扇扫 |
| yaw_center_rad | 扇区中心方位 | number/null，是 | sector 填 [-π,π)；circular 填 null |
| yaw_span_rad | 扇区角宽 | number/null，是 | sector 填 0 < 值 < 2π；circular 填 null |
| pitch_rad | 扫描固定仰角 | number，是 | [-π/2,π/2] 且在设备限位内 |
| yaw_speed_rad_s | 扫描角速度幅值 | number，是 | >0 且不超过部署上限；不是有符号方向 |
| cycle_count | 扫描循环数 | integer，是 | 1～10000；有限循环，不设无限扫描 |
| task_timeout_ms | 任务总预算 | integer，是 | 1000～3600000ms，从首次 start 接纳起算 |
| search_strategy | 搜索策略 | string，是 | recognize 表示 仅识别(默认），track 表示 跟踪 |

周扫：以启动时有效实际方位为起点，固定仰角，沿正 yaw 方向连续完成一圈 2π 计一次。只有支持所需整圈运动的设备可接纳；有限位设备不允许以瞬间跳角冒充周扫，不支持时返回 UNSUPPORTED。

扇扫：边界为中心±角宽/2，跨 ±π 时沿内部连续角度规划，不走长侧。先移至负向边界，再正向扫至另一边界并返回，计一个循环。到起点、加减速、稳定和暂停时间均纳入总预算，不能只以角宽/速度估算任务总时长。

任务配置与启动、互斥、所有者规则与 AreaSearch 相同。参数不可通过 resume 修改；希望更改扫描参数须终止后重新下达。周扫/扇扫不提交区域顶点，面积覆盖指标不适用。

扇扫请求示例（独立场景，设备无其他非终态任务）：

```json
{
  "protocol": "2.3",
  "kind": "request",
  "device_id": "isr-01",
  "request_id": "req-sector-001",
  "method": "CircularSearch",
  "params": {
    "search_strategy" : "recognize" / "track",
    "scan_mode": "sector",
    "yaw_center_rad": 0,
    "yaw_span_rad": 1.5707963268,
    "pitch_rad": -0.2,
    "yaw_speed_rad_s": 0.1,
    "cycle_count": 2,
    "task_timeout_ms": 120000
  }
}
```

接纳回执：

```json
{
  "protocol": "2.3",
  "kind": "response",
  "device_id": "isr-01",
  "response_id": "req-sector-001",
  "method": "CircularSearch",
  "ok": true,
  "command": {
    "request_id": "req-sector-001",
    "method": "CircularSearch",
    "state": "accepted",
    "task_id": "task-019",
    "reason": null,
  },
  "error": null
}
```

周扫示例使用同一结构，将 scan_mode 改为 circular，yaw_center_rad 和 yaw_span_rad 均填 null；采用新的 request_id，不复用扇扫请求编号。

### 3.3 TaskControl：任务控制

| params 字段 | 中文含义 | 类型 / 必填 | 约定 |
| --- | --- | --- | --- |
| task_id | 被控制任务编号 | string，是 | 必须使用任务下达成功时回执REP中返回的编号 |
| action | 控制动作 | string，是 | start / pause / resume / stop / next_follow |

保留 start/pause/resume/stop，新增 next_follow【V2.2】；task_id 不允许 null，不能以“当前任务”隐式猜测。

| action | 允许状态 | 接纳后的状态与完成条件 |
| --- | --- | --- |
| start | ready | starting → searching；首次接纳启动预算；进入 searching 后命令 accepted |
| pause | starting / searching | pausing → paused；禁止新扫描动作，可靠停稳后命令 accepted，保留进度 |
| resume | paused | starting → searching；恢复尚未完成的扫描，不重置预算或进度 |
| stop | preparing / ready / starting / searching / pausing / paused / stopping | stopping → canceled；撤销任务、清理待执行动作、确认停稳后命令 accepted |
| next_follow【V2.2 新增】 | 参考稿未定义具体允许状态，须由对接双方补齐 | 切换下一个跟踪目标；V2.3 集成说明明确按确认顺序轮换，不支持直接指定目标 |

`next_follow` 仍使用 `method="TaskControl"`，params 为返回的 `task_id` 与 `action="next_follow"`，新切换使用新的 request_id。参考稿未定义无候选、遍历结束、切换完成判据及具体错误码；接入前须确认，不能仅凭接纳回执认定切换成功，应结合后续 TaskStatus、TrackList 核验。

同 request_id、同 method/params 的重发返回原回执，不重复执行；同 request_id 改变内容返回 ID_CONFLICT。服务端在本次运行期间保存命令记录，容量不足时拒绝新请求并返回 RESOURCE_EXHAUSTED。新编号 start 已启动任务、resume 非 paused 任务返回 INVALID_STATE；pause 已 paused 任务可直接 accepted；stop 已 canceled/completed 且已停稳任务可直接 accepted。stop 已 failed 的任务仍可重试其遗留物理停止，停稳后原任务保持 failed，不改写故障历史。若控制权已交给另一任务或遥控，旧终态任务的 stop 不得作用于新运动：已确认清理完毕则仅返回原任务结果，未能确认清理则拒绝并报 INVALID_STATE。不存在返回 NOT_FOUND；不属于调用方且无跨任务停止授权返回 FORBIDDEN。

stop 会抢占尚未完成的 start/resume/pause，后者记 failed、reason=SUPERSEDED；服务端必须防止被撤销的排队动作之后再驱动设备。首次 start 接纳后若预算已在队列中耗尽，执行器不得再启动运动。处于 pausing/stopping 时其他新 start/resume/pause 均返回 INVALID_STATE。停止过程中的新 stop 合并至现有停止过程，不能重置停止截止时间。

暂停与终止的停止监督预算为 3000ms，从首次实际发出停止动作起算，实机须验证是否满足。无法在预算内确认停止：任务 failed，reason=STOP_UNCONFIRMED，设备 fault；继续监督停止并拒绝新运动，不能把超时当作已经停稳。

任务总预算从首次 start accepted 起按单调时钟递减，准备启动、搜索、暂停及恢复均计时；**暂停不冻结预算**。预算到期主动停止，最终 failed、reason=DEADLINE_EXCEEDED；若停止也未确认，则优先 reason=STOP_UNCONFIRMED，设备故障说明记录预算到期背景。

启动请求（暂停/继续/终止分别将 action 改为 pause/resume/stop，并使用各自新的 request_id）：

```json
{
  "protocol": "2.3",
  "kind": "request",
  "device_id": "isr-01",
  "request_id": "req-start-001",
  "method": "TaskControl",
  "params": {
    "task_id": "task-018",
    "action": "start"
  }
}
```

接纳回执：

```json
{
  "protocol": "2.3",
  "kind": "response",
  "device_id": "isr-01",
  "response_id": "req-start-001",
  "method": "TaskControl",
  "ok": true,
  "command": {
    "request_id": "req-start-001",
    "method": "TaskControl",
    "state": "accepted",
    "task_id": "task-018",
    "reason": null,
  },
  "error": null
}
```

### 3.4 TeleControl：云台遥控与变焦

支持云台位置控制、速度控制及当前工作相机的光学变焦，不改变算法、标定或任务参数。非终态搜索任务（含 preparing/ready/paused）占用控制权，此时位置、速度、变焦请求在 REP 中返回 ok=false、command=null、error.code=BUSY；需要遥控须先 TaskControl.stop 并确认动作结束。TeleControl.stop 仅停止遥控动作，含云台与正在进行的变焦，不终止搜索任务；搜索占用期间仍返回 BUSY。

| params 字段 | 类型 / 必填 | 约定 |
| --- | --- | --- |
| action | string，是 | position / velocity / zoom / stop |
| yaw_rad / pitch_rad | number，position 必填 | 绝对车体方位/仰角；满足 2.2 与机械限位 |
| move_timeout_ms | integer，position 必填 | 100～10000ms，含运动和停稳确认的总预算 |
| yaw_rate_rad_s / pitch_rate_rad_s | number，velocity 必填 | 有符号角速度，幅值不得超过部署上限 |
| hold_ms | integer，velocity 必填 | 100～1000ms，执行器采用该指令起算的速度租期 |
| zoom_ratio | number，zoom 必填 | 绝对光学倍率；1.0 为该相机最广角基准，须在部署支持范围内 |
| zoom_timeout_ms | integer，zoom 必填 | 100～10000ms，含变焦动作及倍率稳定反馈的总预算 |

params 按 action 互斥：position 只含 action、yaw_rad、pitch_rad、move_timeout_ms；velocity 只含 action、yaw_rate_rad_s、pitch_rate_rad_s、hold_ms；zoom 只含 action、zoom_ratio、zoom_timeout_ms；stop 只含 action。不允许混合参数。zoom_ratio=2.0 表示调至绝对 2 倍，不是将当前倍率再乘 2；本版不包含数字裁剪变焦或自动对焦参数。不支持光学变焦或缺少可靠倍率完成反馈的设备返回 UNSUPPORTED；超出部署倍率范围返回 INVALID_ARGUMENT，不能静默限幅。

REP 仅返回接纳结果，不等待动作结束。执行结果通过 4.1 DeviceStatus.data.telecontrol.state 上报，并由 command.request_id 关联原请求：running=排队或执行中，succeeded=达到完成条件，failed=执行失败，原因在 command.reason 中。完成条件分别为：position 到达角度容差并停稳；velocity 租期结束并停稳；zoom 实际倍率达到部署容差且镜头动作稳定；stop 确认所有遥控动作停止。变化时立即 publish，并保留在周期状态中，不再发送第二次 REP。

位置/速度/变焦动作需有效设备反馈；变焦期间以实际反馈倍率更新 DeviceStatus.zoom_ratio，不能用请求值冒充实际值。变焦改变成像内参，光电端须按曝光时刻倍率采用相应标定，倍率变化或标定未就绪时不输出定位结果；完成变焦后才能接纳新搜索任务。变焦不得通过修改标定参数实现。

同一时刻仅执行一个遥控动作。position/zoom 执行期间其他运动或变焦请求返回 BUSY，不隐式打断；同一调用方可用新的速度指令更新 velocity，旧执行结果记 failed、reason=SUPERSEDED。新 request_id 才是新动作，同 ID 重发不重复变焦、不刷新速度租期。stop 可抢占遥控动作，原动作标记 failed、reason=SUPERSEDED。

客户端同一 REQ 仍须发送后接收，再发下一条。速度租期到期须由设备本地撤销速度并停止；位置/变焦执行预算耗尽亦触发对应动作停止，执行结果 failed、reason=DEADLINE_EXCEEDED。停止监督预算为 3000ms，未取得确认则 failed、reason=STOP_UNCONFIRMED，设备 fault，不接纳新动作。重复 stop 不延长原停止截止时间。

位置遥控请求（以下示例为独立场景）：

```json
{
  "protocol": "2.3",
  "kind": "request",
  "device_id": "isr-01",
  "request_id": "req-tele-pos-001",
  "method": "TeleControl",
  "params": {
    "action": "position",
    "yaw_rad": 0.3,
    "pitch_rad": -0.2,
    "move_timeout_ms": 3000
  }
}
```

速度遥控请求：

```json
{
  "protocol": "2.3",
  "kind": "request",
  "device_id": "isr-01",
  "request_id": "req-tele-vel-001",
  "method": "TeleControl",
  "params": {
    "action": "velocity",
    "yaw_rate_rad_s": 0.1,
    "pitch_rate_rad_s": 0,
    "hold_ms": 500
  }
}
```

变焦请求：

```json
{
  "protocol": "2.3",
  "kind": "request",
  "device_id": "isr-01",
  "request_id": "req-tele-zoom-001",
  "method": "TeleControl",
  "params": {
    "action": "zoom",
    "zoom_ratio": 2.0,
    "zoom_timeout_ms": 3000
  }
}
```

遥控停止请求：

```json
{
  "protocol": "2.3",
  "kind": "request",
  "device_id": "isr-01",
  "request_id": "req-tele-stop-001",
  "method": "TeleControl",
  "params": {
    "action": "stop"
  }
}
```

变焦接纳回执（表示已接纳，执行完成由 4.1 上报）：

```json
{
  "protocol": "2.3",
  "kind": "response",
  "device_id": "isr-01",
  "response_id": "req-tele-zoom-001",
  "method": "TeleControl",
  "ok": true,
  "command": {
    "request_id": "req-tele-zoom-001",
    "method": "TeleControl",
    "state": "accepted",
    "task_id": null,
    "reason": null
  },
  "error": null
}
```

## 4. 上报接口详述

### 4.1 DeviceStatus：设备状态

第一帧 isr/<device_id>/device_status；第二帧中的JSON中的topic=device_status。**固定 1Hz 周期上报完整快照，故障、模式、停止状态及遥控命令关键变化时另行立即上报**。即时上报不取代周期保活。

| data 字段 | 类型 | 约定 |
| --- | --- | --- |
| mode | string | idle / task / telecontrol / stopping / fault |
| ready | boolean | 当前能否接纳新任务/新遥控；非终态任务、遥控占用、未停稳或故障时 false |
| data_origin | string | measured / simulated / replay |
| camera_online / gimbal_online / navigation_valid | boolean | 由数据新鲜度、设备反馈与有效性判定，不只看进程存活 |
| gimbal_yaw_rad / gimbal_pitch_rad | number/null | 最新有效实际视轴角；未知/陈旧时 null |
| zoom_ratio | number/null | 当前工作相机的实际光学倍率；未知、反馈陈旧或不支持时 null |
| active_task_id | string/null | 当前非终态任务；无则 null |
| telecontrol | object/null | 最近遥控状态，结构见下；本次运行从未遥控则 null |
| fault_code / fault_message | string/null | 当前故障原因及说明；正常均 null |

telecontrol={action,state,remaining_ms,command}：action 为 position/velocity/zoom/stop；state 为 running/succeeded/failed，表示后台执行结果，与 REP 中 command.state=accepted 的接纳语义区分；remaining_ms 为非负 integer，位置/变焦剩余执行预算或速度剩余租期，终态/stop 为 0；command 为最近遥控请求的编号、方法等信息，失败原因写入 command.reason。每次新遥控更新，终态保留至下一条遥控或服务重启。

设备 mode 优先表达 fault，其次 stopping，再表示 task/telecontrol/idle。任务 ready/paused 虽不运动仍占用控制权，因此 mode=task、ready=false；active_task_id 非空。失败但未确认停止时 active_task_id 可为空，mode=fault、ready=false，TaskStatus 保留失败任务以供关联。

不能因已发停止指令、速度设为零、任务终态或无任务而置 true。DeviceStatus.ready 是瞬时快照，执行请求仍需重新校验；导航无效时区域搜索不可接纳，纯车体角扫描是否可用按部署条件判断。

完整 DeviceStatus 示例（变焦完成），第一帧 isr/isr-01/device_status，第二帧数据如下：

```json
{
  "protocol": "2.3",
  "kind": "event",
  "device_id": "isr-01",
  "topic": "device_status",
  "published_at_utc_ms": 1791590400000,
  "data": {
    "mode": "idle",
    "ready": true,
    "data_origin": "measured",
    "camera_online": true,
    "gimbal_online": true,
    "navigation_valid": true,
    "gimbal_yaw_rad": 0.3,
    "gimbal_pitch_rad": -0.2,
    "zoom_ratio": 2.0,
    "active_task_id": null,
    "telecontrol": {
      "action": "zoom",
      "state": "succeeded",
      "remaining_ms": 0,
      "command": {
        "request_id": "req-tele-zoom-001",
        "method": "TeleControl",
        "state": "accepted",
        "task_id": null,
        "reason": null
      }
    },
    "fault_code": null,
    "fault_message": null
  }
}
```

### 4.2 TaskStatus：任务状态

第一帧 isr/<device_id>/task_status；第二帧中的JSON中的topic=task_status。**固定 1Hz 周期上报完整快照；任务创建、命令状态变化、暂停、恢复、终止、完成和失败时立即上报**。本次运行无任务时也发送 {task:null,command:null}，不靠“停止上报”表示无任务。

| data 字段 | 类型 | 约定 |
| --- | --- | --- |
| task | object/null | 当前非终态任务；无则保留最近终态任务；本次运行从未有任务则 null |
| command | object/null | 该任务最近下达/控制命令的 Command 最新记录；无任务则 null |

| task 字段 | 类型 | 约定 |
| --- | --- | --- |
| task_id | string | 创建后不变且服务重启后也不复用 |
| task_type | string | AreaSearch / CircularSearch |
| state | string | preparing / ready / starting / searching / pausing / paused / stopping / completed / canceled / failed |
| remaining_ms | integer | 非负；首次 start 前等于原 task_timeout_ms，首次 start 后递减，终态为 0 |
| progress_ratio | number/null | 0～1；区域搜索用合格面积覆盖比，周扫/扇扫用已实际扫描路径长度/计划总扫描路径长度；未知为 null |
| coverage_ratio | number/null | 区域合格覆盖面积/区域面积；CircularSearch 为 null |
| coverage_complete | boolean/null | 区域是否满足覆盖条件，CircularSearch 为 null；未知为 null |
| completed_cycles / total_cycles | integer/null | CircularSearch 的完成循环数/计划循环数；AreaSearch 均 null |
| reason | string/null | 失败/终止原因；正常为 null |

面积覆盖不是帧数或网格数比例；内部移动/稳定/观测统一映射 searching。CircularSearch 路径进度不含移至扫描起点的路径；暂停恢复不回退已记进度，完整扫完全部循环才能 progress_ratio=1。覆盖未知不能伪造 0 或 true。

核心流转：preparing → ready → starting → searching；暂停为 searching/starting → pausing → paused；继续为 paused → starting → searching；主动终止为非终态 → stopping → canceled；计划完成为 searching → stopping → completed

command 只保留最近一条，新的控制命令会覆盖旧快照，不是历史账本。不能因为没收到即时事件就使用新 request_id 重复启动；同一逻辑请求重发须保持原 request_id、method 和 params。

完整 TaskStatus 示例，第一帧 isr/isr-01/task_status，第二帧数据如下：

```json
{
  "protocol": "2.3",
  "kind": "event",
  "device_id": "isr-01",
  "topic": "task_status",
  "published_at_utc_ms": 1791590400000,
  "data": {
    "task": {
      "task_id": "task-018",
      "task_type": "AreaSearch",
      "state": "searching",
      "remaining_ms": 95000,
      "progress_ratio": 0.25,
      "coverage_ratio": 0.25,
      "coverage_complete": false,
      "completed_cycles": null,
      "total_cycles": null,
      "reason": null
    },
    "command": {
      "request_id": "req-start-001",
      "method": "TaskControl",
      "state": "accepted",
      "task_id": "task-018",
      "reason": null,
    }
  }
}
```

### 4.3 TargetList：识别目标列表

第一帧 isr/<device_id>/targetlist；JSON.topic=targetlist。上报同一相机、同一图像帧的识别结果，**不包含 position、range_m 或其他地理定位字段**，定位与测距结果仅见 4.4 TrackList。

对有效检测帧按部署频率上报（建议不高于 10Hz），不能合并多帧目标。无检测目标时上报 targets=[]；相机/算法无有效帧时不伪造空列表，由 DeviceStatus 表示不可用。recognize 和 track 策略均可上报本列表，跟踪策略再从识别目标中选定一个进行锁定。

| data 字段 | 类型 | 约定 |
| --- | --- | --- |
| task_id | string/null | 本次观测的搜索任务；非任务观测为 null |
| observed_at_utc_ms | integer/null | 图像曝光/采集时间，非发布时间；无可靠 UTC 映射时 null |
| image | object | 同帧图像引用与尺寸，见 4.5 |
| data_origin | string | measured / simulated / replay |
| truncated | boolean | 是否因 65536 字节上限仅发送部分识别条目 |
| targets | array | 识别条目；空帧为 []；数量直接取数组长度 |

不再增加 report_id 和 total_count：以 device_id+topic+image.camera_id+image.frame_id 识别同帧报告，每帧每主题仅发一次不可变识别结果；truncated=true 明确表示不完整。超限按 confidence 降序保留完整条目，同置信度按 target_id 排序，直到序列化后满足字节上限，不静默截断或把分片伪装为完整列表。

| targets[] 字段 | 类型 | 约定 |
| --- | --- | --- |
| target_id | string | 识别条目编号，在 device_id 下不复用；不代表跨帧同一实体，用于关联最初锁定的识别结果 |
| category | string | 部署类别表中的 1～64 字符类别；未知用 unknown |
| confidence | number | 0～1，识别置信度，不是威胁度或定位精度 |
| threat_level | integer/null | 1=低、2=中、3=高；尚未评估或缺少依据为 null |
| pixel | object | 该帧选定目标像素点；不是地理位置，结构见 4.5 |
| bbox | object/null | 该帧检测框；无可用框时 null |

威胁度由设备按部署确认的业务规则评估，规则、等级含义及评估对象须在联调前约定；未配置评估能力时填 null。不得把 confidence 换算为 threat_level，也不能仅凭示例类别猜测威胁等级。本协议不增加威胁分数、权重或评估详情字段。

TargetList 是当前帧快照，不是历史累计目标，也不保证跨帧目标身份。暂停/终止后的迟到结果保留原 task_id 和 frame_id，不能归入新任务。

完整 TargetList 示例，第一帧 isr/isr-01/targetlist：

```json
{
  "protocol": "2.3",
  "kind": "event",
  "device_id": "isr-01",
  "topic": "targetlist",
  "published_at_utc_ms": 1791590400000,
  "data": {
    "task_id": "task-018",
    "observed_at_utc_ms": 1791590400000,
    "image": {
      "camera_id": "eo-01",
      "frame_id": "image-000042",
      "width_px": 1920,
      "height_px": 1080
    },
    "data_origin": "measured",
    "truncated": false,
    "targets": [
      {
        "target_id": "det-001",
        "category": "person",
        "confidence": 0.92,
        "threat_level": null,
        "pixel": {
          "x_px": 960.0,
          "y_px": 540.0
        },
        "bbox": {
          "x_px": 940.0,
          "y_px": 500.0,
          "width_px": 40.0,
          "height_px": 100.0
        }
      }
    ]
  }
}
```

### 4.4 TrackList：单目标跟踪与定位列表

第一帧 isr/<device_id>/tracklist；JSON.topic=tracklist。仅 track 策略产生有效跟踪结果：光电端先从 TargetList 的识别结果选定目标，再进行锁定、持续跟踪、测距及地理定位。**同时至多跟踪一个对象，targets 长度只能为 0 或 1。** recognize 策略不输出地理定位结果。

【V2.2/V2.3 修订】初次锁定按确认序列从左到右选第一个目标，TaskControl.next_follow 按确认顺序切换下一个目标；当前接口不支持外部直接指定 target_id，不增加独立选目标 method。识别类别、置信度、威胁度通过最初的 target_id 关联 4.3，不在每条跟踪上报中重复；外部若缺失关联的识别帧，仅展示已知跟踪信息，不猜造类别。

有效跟踪帧按部署频率上报（建议不高于 10Hz），锁定、丢失、停止及定位有效性变化时立即上报最新结果。无新有效帧时不重发旧坐标冒充新观测；acquiring/lost 状态保持 1Hz 状态上报。没有跟踪任务时可不周期发送本主题，但离开 track 策略或任务终止时立即发送一次 idle，任务是否已停止仍以周期 TaskStatus 为准。

| data 字段 | 类型 | 约定 |
| --- | --- | --- |
| task_id | string | 对应 track 策略的搜索任务；idle 终止通知仍保留原 task_id |
| track_state | string | acquiring=正在锁定；tracking=当前跟踪有效；lost=已丢失；idle=未选定或已结束跟踪 |
| track_id | string/null | 本次连续跟踪编号，acquiring/tracking/lost 非空且保持不变，idle 为 null |
| target_id | string/null | 最初锁定候选在 TargetList 中的 target_id；锁定期间保持不变，idle 为 null |
| observed_at_utc_ms | integer/null | 当前跟踪图像观测时间；没有有效图像或无法映射 UTC 时 null |
| data_origin | string | measured / simulated / replay |
| targets | array | 当前有效跟踪条目，tracking 时恰好 1 条，其他状态为 [] |

| targets[0] 字段 | 类型 | 约定 |
| --- | --- | --- |
| image | object | 当前跟踪图像编号与尺寸，结构见 4.5；与 pixel 对应同次观测 |
| pixel | object | 当前跟踪图像中的选定像素点，与本次定位关联 |
| bbox【V2.3 新增】 | object/null | 该跟踪帧中目标的检测框，结构同 4.5；无可用框时 null；非空时 pixel 须落在框内 |
| observed_at_utc_ms【V2.3 新增】 | integer/null | 本目标图像曝光时间，与其 image.frame_id 同次观测；无可靠 UTC 映射时 null |
| position | Position/null | WGS84 地理位置，结构见 2.5.3；定位不可用/失败时 null |
| range_m | number/null | 光心至选定点的径向距离，>0；仿真可使用部署约定的目标参考点；无有效距离时 null |
| range_source | string/null | 有效距离来源，见下；无有效距离时 null |
| reason | string/null | 定位有效时 null；不可用/失败时给出原因 |

【V2.3】上述新增字段均须出现，可按约定填 null。逐目标 observed_at_utc_ms 与 data 级字段同源，当前单目标场景两者相等（无法可靠映射时均为 null），使转发、落盘与回放的条目自包含。bbox 使用原图、去畸变后空间的半开区间，须逆变换网络缩放、补边与裁剪坐标；不能用其他帧的框补齐。单目标、识别/定位分离及 lost 时 targets=[] 的语义不变。

跟踪有效与定位有效分开判断：track_state=tracking 仅表示图像目标仍被锁定，position 可以为 null。定位成功时 position、range_m、range_source 全部非空，reason=null；定位失败时 position=null 并给出 NO_RANGE、NO_NAVIGATION、OUT_OF_MODEL 或 INVALID_GEOMETRY 等原因。若本次有有效测距但不能计算经纬度，可以保留 range_m/range_source；没有有效距离时两者同时 null。不能复用旧位置或用 (0,0,0) 表示失败。

range_source：measured_laser=实测激光径向距离；measured_radial_depth=实测径向深度；simulated_radial_depth=仿真径向深度；computed_plane_intersection=依据标定、导航与约定平面求交的估计距离

本仿真部署采用同次曝光上下文中的目标参考点（V2公共Detection.pose.position，对应旧actor原点）：位置为该参考点，像素为其原图投影，range_m为原光心到参考点的三维距离，range_source=simulated_radial_depth。不是激光或表面回波；参考点不可见或原数据无效时保持未知，不复用旧位置。

data_origin=simulated 不能标为实测测距；replay 保留原来源。measured 只表示实设备观测，不保证距离实测。

目标丢失时 track_state=lost、targets=[]，保留 track_id/target_id 供外部明确结束当前轨迹；不保留旧地理点作为当前结果。重新锁定不同对象时使用新的 track_id/target_id。任务暂停不假定仍在跟踪；只有继续取得有效帧才能上报 tracking，不能凭暂停前画面维持锁定状态。暂停/终止后的迟到跟踪结果仍关联原 task_id，客户端不得将其覆盖到新任务或已结束的轨迹。

完整 TrackList 示例，第一帧 isr/isr-01/tracklist（定位数值仅示意）：

```json
{
  "protocol": "2.3",
  "kind": "event",
  "device_id": "isr-01",
  "topic": "tracklist",
  "published_at_utc_ms": 1791590400000,
  "data": {
    "task_id": "task-018",
    "track_state": "tracking",
    "track_id": "track-001",
    "target_id": "det-001",
    "observed_at_utc_ms": 1791590400000,
    "data_origin": "measured",
    "targets": [
      {
        "image": {"camera_id": "eo-01", "frame_id": "image-000043", "width_px": 1920, "height_px": 1080},
        "pixel": {"x_px": 960.0, "y_px": 540.0},
        "bbox": {"x_px": 900.0, "y_px": 480.0, "width_px": 120.0, "height_px": 160.0},
        "observed_at_utc_ms": 1791590400000,
        "position": {
          "latitude_deg": 31.0005,
          "longitude_deg": 121.0005,
          "ellipsoid_height_m": 10
        },
        "range_m": 100,
        "range_source": "measured_laser",
        "reason": null
      }
    ]
  }
}
```

定位暂不可用时仍为 tracking，保留当前 pixel，position=null，并填写 reason；无测距时 range_m/range_source 均为 null。丢失通知示例：

```json
{
  "protocol": "2.3",
  "kind": "event",
  "device_id": "isr-01",
  "topic": "tracklist",
  "published_at_utc_ms": 1791590400000,
  "data": {
    "task_id": "task-018",
    "track_state": "lost",
    "track_id": "track-001",
    "target_id": "det-001",
    "observed_at_utc_ms": null,
    "data_origin": "measured",
    "targets": []
  }
}
```

### 4.5 图像、像素与检测框公共结构

| 对象/字段 | 类型 | 单位与约束 |
| --- | --- | --- |
| image.camera_id | string | 对外相机编号 |
| image.frame_id | string | 在 device_id+camera_id 下唯一；重启、重连后不复用 |
| image.width_px / height_px | integer | 原图尺寸，各 1～32768px |
| pixel.x_px / y_px | number | 跟踪点，0 ≤ x < image.width_px；0 ≤ y < image.height_px |
| bbox.x_px / y_px | number | 检测框，非负，检测框左上角 |
| bbox.width_px / height_px | number | >0；x+width ≤ image.width_px，y+height ≤ image.height_px |

图像左上角为 (0,0)，x 向右、y 向下，零基坐标，允许小数。光电端须逆变换检测网络的缩放、letterbox 补边和裁剪坐标，不把网络输入坐标标在原图上。

bbox 使用半开区间 [x,x+width)、[y,y+height)；4.3 与 4.4 中 bbox 非空时 pixel 须落在框内【V2.3 扩展至 TrackList】。TargetList.pixel 是识别目标的选定点，TrackList.pixel 是当前跟踪帧的定位关联点，两者不要求在不同帧保持相同坐标。外部可另算检测框中心用于显示，但不能自动当成地理定位点。

各列表的 pixel/bbox，以及 4.4 中有效的 position，须对应本条 image.frame_id 的同次观测；定位采用对应曝光时刻的导航、姿态和变焦标定，不以发布时刻的数据代替。非法像素/框不得静默裁剪或借用旧数据；应丢弃非法条目并记录诊断，完整图像信息失效时不发该帧报告。

视频另走部署约定通道，须提供显示帧与 camera_id+frame_id 的映射及去畸变空间说明。外部只在匹配帧绘框；显示缩放、裁剪、黑边须正确变换。没有帧映射时仅展示数值，不将坐标直接叠加在“最新画面”。

## 5. 视频流与帧对齐逻辑链路【V2.3 新增】

> 本章为参考变更单的链路设计，不表示本仓已实现。参考变更单仅给出 frame_header/frame_pull 逻辑名称；本稿 5.4、5.5 分别补充 frame_header 与 frame_pull 的报文约定。REQ/REP 不使用 PUB/SUB 订阅 topic；frame_pull 使用独立服务，其二进制响应格式与大小限制以 5.5 为准，不套用第 2 章任务通道的单帧 JSON 响应格式。

V2.2 §1.2 明确 ZMQ 协议本身不传视频；§4.5 要求"视频另走部署约定通道，须提供显示帧与 camera_id+frame_id 的映射"。本节定义该通道的逻辑链路。**参考变更单将当前仿真阶段定义为不处理真实视频、代码按此链路设计；实际实现状态需单独验证。**

### 5.1 逻辑链路

```
光电(或仿真器)
  │  通道A: 视频流(部署约定, 真车=RTSP/H.264等, 帧带 camera_id+frame_id+exposure_utc_ms)
  │  通道B: 帧头流 isr/<id>/frame_header (ZMQ PUB, 轻量, 与视频同帧率, 仅元数据, 无像素)
  │  通道C: 按需取帧 isr/<id>/frame_pull (ZMQ REQ/REP, 仅按 camera_id+frame_id 精确取单帧编码图)
  ▼
Agent 帧缓冲器(FrameBuffer, 每相机一个环形缓冲, 深度≥5s)
  │  对齐规则:
  │   1) 优先 frame_id 精确匹配(TargetList/TrackList.image.frame_id ↔ 帧头)
  │   2) frame_id 缺失时按时间戳最近邻, 容差 ±33ms(约1帧@30fps)
  │   3) 帧已被挤出缓冲 → 标记"像素不可得", 感知链路降级为纯元数据路径
  ▼
Agent 按需取帧 → bbox 裁剪 ROI → 模型服务层(人脸/Re-ID/VLM)
```

### 5.2 关键设计决策

- **检测事件与像素解耦**：TargetList/TrackList 走原协议不动（轻量、高频）；像素只在 Agent 需要时（身份确认、VLM 问答、示教绑定）按 frame_id 回取。带宽友好，也符合"事件流常开、图像按需"的分工。
- **曝光时刻为准**：帧对齐、像素坐标、定位都锚定曝光时间戳（observed_at_utc_ms），不是发布/接收时间。时钟同步（NTP/PTP）与误差监测沿用 V2.2 §6.1（本稿 7.1）的部署要求。
- **降级语义明确**：取帧失败/帧过期 ≠ 感知失败，只表示"本次无法做像素级确认"，置信度相应降低，走五层防御的正常分流。

### 5.3 仿真实现（当前阶段）

参考变更单设计同一逻辑接口的两个仿真实现档位，接口签名保持一致：

- **档位A·纯元数据**：仿真器维护 frame_id 注册表，frame_header 流照发，frame_pull 返回占位图（纯色+frame_id 水印）。验证链路逻辑、时序、降级路径。
- **档位B·合成图像**：仿真器从 2.5D 场景按光电 FOV/位姿/倍率渲染当前帧（2D 俯视图的场景截图或投影图），frame_pull 返回真实像素。可提前跑通"裁剪 ROI → VLM 工具"的完整代码路径，VLM 侧接 vlm_sim 替身（真值+误差模型）。

真车切换时仅替换通道A/B/C 的传输实现（RTSP 拉流 + SEI 时间戳解析等），Agent 帧缓冲器与上游逻辑零改动。

### 5.4 FrameHeader：逐帧元数据上报【V2.3 集成补充】

本节为在参考变更单基础上补充的接口设计，供后续实现与联调，不声明当前视频服务已支持。FrameHeader 是上报名称，不是请求 method；仅包含元数据，不包含图像、Base64 或检测列表。

#### 5.4.1 通道与分帧

复用 2.1 的 PUB 服务（默认 tcp://<光电IP>:5556），固定两帧 multipart：

| 消息部分 | 内容 |
| --- | --- |
| 第一帧 | UTF-8 topic：isr/<device_id>/frame_header，例如 isr/isr-01/frame_header |
| 第二帧 | UTF-8 JSON；topic 固定为 frame_header，device_id 与第一帧一致 |

沿用第 2 章的通用类型、JSON 规则与大小限制：topic 不超过 128 字节，JSON 不超过 65536 字节。订阅者核对完整 topic、JSON.topic、device_id，再按 camera_id 区分相机。

#### 5.4.2 Payload 与字段

第二帧完整示例（编号与时间仅示意）：

```json
{
  "protocol": "2.3",
  "kind": "event",
  "device_id": "isr-01",
  "topic": "frame_header",
  "published_at_utc_ms": 1791590400020,
  "data": {
    "camera_id": "eo-01",
    "frame_id": "image-000043",
    "exposure_utc_ms": 1791590400000,
    "width_px": 1920,
    "height_px": 1080
  }
}
```

以上字段均必填；仅明确标记可空的字段允许 null。

| 信封字段 | 类型 | 约定 |
| --- | --- | --- |
| protocol | string | 固定 "2.3" |
| kind | string | 固定 event |
| device_id | string | 设备编号，符合 2.2 的 ID 约束 |
| topic | string | 固定 frame_header |
| published_at_utc_ms | integer | 本条元数据发布时的 UTC 毫秒，符合 2.2；不是曝光时间 |
| data | object | 下表逐帧元数据 |

| data 字段 | 类型 | 约定 |
| --- | --- | --- |
| camera_id | string | 对外相机编号，符合 2.2 的 ID 约束；与对应 TargetList/TrackList.image.camera_id 一致 |
| frame_id | string | 图像源头生成的帧编号，符合 2.2 的 ID 约束；在 device_id+camera_id 下唯一，重启、重连后不复用；与对应检测/跟踪报告的 image.frame_id 一致 |
| exposure_utc_ms | integer/null | 本帧图像曝光时间，符合 2.2 的 UTC 约束；与同次观测的 observed_at_utc_ms 相等；无可靠 UTC 映射时 null，不用编码、发送或接收时间替代 |
| width_px / height_px | integer | 本条对应的视频输出图像尺寸，各为 1～32768px；不一定等于检测原图尺寸 |

#### 5.4.3 发送与匹配规则

- **每个实际输出的视频图像帧对应一条帧头**。输入 30fps、经限帧后输出 15fps，则发布 15 条/秒；编码前被丢弃的输入帧不发布输出帧头。无新输出帧时不重发旧帧头保活，设备保活仍由 DeviceStatus 承担。
- 同一图像的检测、跟踪、视频及取帧缓存共用源头生成的 camera_id+frame_id。若启用取帧缓存，应先完成该帧缓存登记，再发布帧头；发布后仍可能因缓存淘汰而取帧失败。
- RTP 时间戳必须在视频发送链路确定后填入，不能由帧头发布线程另取当前时间推算。部署须明确 camera_id 与视频轨道/RTP 流的映射；不同流或重连后的时间戳可能重复，客户端须按当前流会话隔离映射并清理旧记录，不单独以 rtp_timestamp 作为全局帧 ID。
- 接收端优先按 camera_id+frame_id 关联检测与跟踪报告；两路独立传输，不保证同时到达或相同到达顺序，须做有界缓存匹配，不能把最新帧头直接赋给最新画面。
- 缺少帧编号时，仅在双方曝光时间均可靠的前提下，按同一相机的曝光时间最近邻匹配，容差 ±33ms；等距时取较早帧。已有 frame_id 但未命中时，不得用附近帧冒充精确匹配。
- PUB/SUB 尽力分发，帧头与视频均可能缺失，帧头不历史补发；接收帧头不保证接收到了对应视频或像素。缓存超时仍未匹配时标记“像素不可得”，保留已知元数据，禁止借用其他帧裁剪 ROI。
- **尺寸相同不代表坐标空间相同**。视频发生缩放、裁剪、补边或去畸变变化时，部署须提供检测原图到视频输出的坐标映射；width_px/height_px 仅描述视频尺寸，不能单凭二者推断裁剪偏移。缺少映射时不直接叠框或按原图 bbox 裁剪视频。

### 5.5 FramePull：按需获取单帧图像【V2.3 集成补充】

FramePull 是新增的辅助服务方法，不加入 1.2 的四个任务与遥控 method。它只查询缓存并返回图像，不创建任务、不驱动云台、不抢占任务控制权，也不触发新的图像采集。

#### 5.5.1 连接、分帧与限制

| 项目 | 约定 |
| --- | --- |
| 逻辑服务名 | isr/<device_id>/frame_pull；不是 PUB/SUB topic，不作为请求的额外一帧 |
| 服务端 / 客户端 | 光电端 REP bind；外部端 REQ connect；独立于任务控制服务 |
| 建议默认地址 | tcp://<光电IP>:5557；实际地址由部署确定，每个服务绑定一个 device_id |
| 请求 | 一帧 UTF-8 JSON |
| 成功响应 | 两帧 multipart：第一帧 UTF-8 JSON 元数据，第二帧 JPEG 二进制 |
| 失败响应 | 一帧 UTF-8 JSON，不附空图像帧 |
| JSON 大小 | 每个 JSON 帧不超过 65536 字节 |
| 图像大小 | 本补充设计规定 JPEG 不超过 16777216 字节（16 MiB），超限返回 RESOURCE_EXHAUSTED；不得静默降采样 |
| 图像格式 | 首版固定 jpeg，不使用 Base64，不返回依赖其他帧的 H.264 数据 |

通用 JSON、ID、UTC、有限数值和未知字段约束沿用 2.2。应用不添加 REQ/REP 空信封帧。客户端完整接收 multipart 后才可发送下一个请求；同一 REQ 同时仅允许一个在途查询，应答超时后销毁并重建 REQ，socket 各自归属单一线程。连接、收发超时建议沿用 2.1；超时属于传输结果，不能伪装为服务端 FRAME_UNAVAILABLE。

该辅助 socket 的接收大小限制须容纳 16 MiB 图像，不能照搬任务通道 MAXMSGSIZE=65536。服务端仍须按上述规则校验请求大小，客户端校验 JSON 大小、帧数、byte_length 与图像上限，并为队列设置有限 HWM。取帧传输不得阻塞任务控制 socket；缓存未命中立即返回，不等待未来图像，不异步返回 accepted。

#### 5.5.2 请求信封与查询参数

| 请求字段 | 类型 / 必填 | 约定 |
| --- | --- | --- |
| protocol | string，是 | 固定 "2.3" |
| kind | string，是 | 固定 request |
| device_id | string，是 | 与连接服务绑定的设备一致 |
| request_id | string，是 | 一次逻辑查询的唯一编号；同一查询重试沿用，新查询生成新编号 |
| method | string，是 | 固定 FramePull |
| params | object，是 | 固定包含 camera_id 与 frame_id，仅支持帧编号精确查询 |

**唯一查询方式：按帧编号精确查询。**

```json
{
  "protocol": "2.3",
  "kind": "request",
  "device_id": "isr-01",
  "request_id": "req-frame-001",
  "method": "FramePull",
  "params": {
    "camera_id": "eo-01",
    "frame_id": "image-000043"
  }
}
```

| params 字段 | 类型 / 必填 | 约定 |
| --- | --- | --- |
| camera_id | string，是 | 对外相机编号，符合 2.2 的 ID 约束 |
| frame_id | string，是 | 源图像帧编号，符合 2.2 的 ID 约束；与检测/跟踪报告及帧头共用 |

frame_id 是取得完整图像的唯一查询依据，camera_id 用于限定其相机命名空间；在请求的 device_id 下，以 camera_id+frame_id 精确查找。两字段均不得省略、为空或为 null。请求不得携带 exposure_utc_ms、tolerance_ms 或其他查询参数，否则返回 INVALID_ARGUMENT。

未命中返回 FRAME_UNAVAILABLE，不支持按时间戳查询、最近邻查询、最新帧查询或任何替代帧回退。曝光时间仅作为响应元数据，不参与取帧选择。成功响应中的 camera_id 和 frame_id 必须与请求完全一致，客户端据此核验。

#### 5.5.3 成功响应

第一帧完整 JSON 示例：

```json
{
  "protocol": "2.3",
  "kind": "response",
  "device_id": "isr-01",
  "response_id": "req-frame-001",
  "method": "FramePull",
  "ok": true,
  "result": {
    "camera_id": "eo-01",
    "frame_id": "image-000043",
    "exposure_utc_ms": 1791590400000,
    "width_px": 1920,
    "height_px": 1080,
    "encoding": "jpeg",
    "byte_length": 183426
  },
  "error": null
}
```

第二帧为该示例对应的 **183426 字节 JPEG 二进制**，不是字符串、JSON 数组或另一次消息。示例长度仅用于说明，实际 byte_length 必须等于发送的图像字节数。

| 响应字段 | 类型 / 必填 | 约定 |
| --- | --- | --- |
| protocol / kind / device_id | string，是 | 分别为 "2.3"、response、服务绑定的设备编号 |
| response_id | string/null，是 | 回显 request_id；无法解析有效请求编号时 null |
| method | string/null，是 | 回显请求方法；无法解析时 null；成功时为 FramePull |
| ok | boolean，是 | true 表示本次查询成功，图像随本响应返回；false 表示查询失败 |
| result | object/null，是 | 成功为下表图像元数据；失败为 null |
| error | object/null，是 | 成功为 null；失败为 {code,message}，字段类型同 2.5.1 |

| result 字段 | 类型 | 约定 |
| --- | --- | --- |
| camera_id / frame_id | string | 实际返回图像的相机与帧编号，唯一性规则同 5.4 |
| exposure_utc_ms | integer/null | 实际图像曝光时间，与同帧 observed_at_utc_ms 相等；无可靠 UTC 时 null；仅作观测元数据，不作为取帧查询参数 |
| width_px / height_px | integer | 返回图像解码后的尺寸，各为 1～32768px |
| encoding | string | 固定 jpeg |
| byte_length | integer | 第二帧字节数，1～16777216 |

result 字段全部必填。这里的 result 专用于辅助取帧接口，不改变 2.4 的任务回执结构，也不返回 command、task_id 或任务 accepted 状态。

返回图像采用检测原图的尺寸与坐标空间，包括相同的去畸变方式，供 TargetList/TrackList 的 bbox 直接裁剪；JPEG 压缩允许改变像素值，不改变几何尺寸。若视频经过缩放或裁剪，5.4 的视频尺寸可与此处不同，但 camera_id+frame_id 仍关联同次源图像；不得将缩放视频截图冒充检测原图。首版不提供请求级尺寸、质量、ROI 或编码选项。

#### 5.5.4 失败响应与错误码

失败只返回一帧 JSON，例如：

```json
{
  "protocol": "2.3",
  "kind": "response",
  "device_id": "isr-01",
  "response_id": "req-frame-001",
  "method": "FramePull",
  "ok": false,
  "result": null,
  "error": {
    "code": "FRAME_UNAVAILABLE",
    "message": "指定图像不在当前缓存中"
  }
}
```

| code | 含义 |
| --- | --- |
| INVALID_ARGUMENT | 参数缺失、类型/范围非法、携带时间查询等未定义参数或报文格式错误 |
| UNSUPPORTED | 协议版本或辅助方法不支持 |
| FORBIDDEN | 设备编号不符或访问权限不满足 |
| NOT_FOUND | 相机不存在 |
| FRAME_UNAVAILABLE【辅助接口新增】 | 指定 camera_id+frame_id 的图像已淘汰、尚未入缓存或不可返回 |
| RESOURCE_EXHAUSTED | JPEG 超出大小限制、缓存/编码或服务容量不足 |
| INTERNAL | 编码或读取内部异常 |

不要求维护历史墓碑来区分“从未存在”和“已过期”。占位图仅用于 5.3 明确配置的仿真联调档位，不可用于真实身份确认；真实图像缺失时不得悄悄返回占位图或其他帧。

#### 5.5.5 缓存、重试与客户端校验

- 每相机使用有界环形缓存，按 5.1 的 ≥5s 设计容量，同时限定总内存。部署须说明分辨率、帧率、缓存格式与实际保留窗口；资源不足以达到目标时明确报告容量不足，不声称仍保证 5 秒。
- 图像与帧编号、曝光时间、原图尺寸一起入缓存。命中后持有该条目的有效引用或副本，直到编码和发送完成，避免淘汰竞态；编码方式与 JPEG 质量由部署固定。
- 本接口是只读查询，不套用任务命令账本的永久回执复用语义。request_id 用于关联与重试，不锁定或延长缓存寿命；重试仍以原 camera_id+frame_id 精确查询当前缓存，可能因淘汰而失败；不得返回其他帧。
- 客户端使用 multipart 接收，先校验帧数、信封和请求关联，再校验返回的 camera_id/frame_id 与请求完全一致，以及图像长度、格式、解码尺寸；任一不符视为无效响应，不交给 ROI/模型链路。解码须限制图像尺寸与资源，不能只信任 JSON 声明。
- 取帧失败只表示本次像素不可得，保留已有检测/跟踪元数据，不据此认定感知任务失败或设备失联；不得换用最新画面冒充指定帧。

---

## 6. 状态、错误与英文中文对照

### 6.1 主要状态与术语

| 英文 | 中文/语义 |
| --- | --- |
| accepted / failed | Command 命令已接纳 / 执行失败 |
| running / succeeded / failed | 遥控动作执行中 / 达到完成条件 / 执行失败 |
| preparing / ready | 任务配置准备中 / 已下达待启动；task.state=ready 不等于设备 ready=true |
| starting / searching | 启动或恢复中 / 正在搜索 |
| pausing / paused | 正在等待暂停停稳 / 已暂停并保留进度 |
| stopping | 正在停止，尚不能认定物理停稳 |
| completed / canceled / failed | 正常计划完成 / 外部终止 / 故障或预算失败 |
| idle / task / telecontrol / fault | 空闲 / 任务占用 / 遥控占用 / 故障设备模式 |
| circular / sector | 周扫 / 扇扫 |
| position / velocity / zoom / stop | 位置遥控 / 速度遥控 / 光学变焦 / 停止遥控动作 |
| acquiring / tracking / lost / idle | 跟踪正在锁定 / 跟踪有效 / 目标丢失 / 未选定或已结束 |
| threat_level | 威胁度：1 低、2 中、3 高；null 未知 |
| measured / simulated / replay | 实设备观测 / 仿真 / 回放 |
| request / response / event | 请求 / 回执 / 主动上报 |
| REQ/REP、PUB/SUB | 请求应答、发布订阅通信模式 |
| WGS84、FLU、UTC | 地理坐标基准、前左上车体坐标、协调世界时 |

字段中文、类型、单位以第 2～4 章各表为准，不重复维护旧版结构名或逐词拆解清单。TaskStatus.command 与 DeviceStatus.telecontrol.command 均为同一 Command 结构，不另建不同命令状态枚举。

### 6.2 错误码与原因

| code / reason | 中文含义与处置 |
| --- | --- |
| INVALID_ARGUMENT | 字段缺失、类型/范围/几何非法；修改参数后使用新请求编号 |
| UNSUPPORTED | 方法、版本或设备能力不支持 |
| INVALID_STATE | 任务状态不允许该动作；核对最新 TaskStatus |
| NOT_READY | 设备、反馈、导航、算法或时钟条件不足 |
| BUSY | 非终态任务或遥控占用，不隐式抢占 |
| ID_CONFLICT | 相同幂等键使用不同业务参数 |
| NOT_FOUND | 指定任务不存在；不得猜测当前任务替代 |
| FORBIDDEN | 身份/设备/任务控制权限不符 |
| RESOURCE_EXHAUSTED | 队列或命令账本容量不足；停止结果仍查实际状态 |
| INTERNAL | 内部处理异常，不能据此推断没有执行 |
| DEADLINE_EXCEEDED | 已接纳任务/位置或变焦动作执行预算耗尽 |
| STOP_UNCONFIRMED | 停止监督预算内未取得可靠停稳反馈 |
| DEVICE_FAULT | 设备/反馈执行故障 |
| CANCELED_BY_CLIENT | 外部 TaskControl.stop 终止任务的原因 |
| SUPERSEDED | 命令被授权停止或更新速度替代，旧命令不得继续驱动 |

ok=false 的 error 是准入/处理拒绝；

拒绝回执示例：

```json
{
  "protocol": "2.3",
  "kind": "response",
  "device_id": "isr-01",
  "response_id": "req-resume-001",
  "method": "TaskControl",
  "ok": false,
  "command": null,
  "error": {
    "code": "INVALID_STATE",
    "message": "任务 task-018 当前为 searching，不能执行 resume；请先暂停并确认 paused。"
  }
}
```

已接纳动作执行失败通过 DeviceStatus.data.telecontrol.command.reason、TaskStatus.reason 或设备故障上报。NO_RANGE/NO_NAVIGATION/OUT_OF_MODEL/INVALID_GEOMETRY/CALIBRATION_NOT_READY 仅用于 TrackList 的定位原因，不代表 ZeroMQ 连接故障。

## 7. 部署与验收

### 7.1 部署需要确定的参数

| 参数组 | 双方确认项 |
| --- | --- |
| 通信/身份 | 光电 IP、device_id |
| 时间 | UTC 同步与误差监测、曝光时间映射、数据新鲜度阈值 |
| 云台/变焦 | 车体视轴标定、角/速度限位、连续周扫能力、位置容差、停稳判据、光学倍率范围与容差、镜头停止反馈及各倍率标定 |
| 扫描/跟踪 | 水平面椭球高与容差、可达范围、扫描/覆盖判据、识别/跟踪发布频率、目标选择及丢失/重锁规则、类别表与威胁度评估规则 |
| 安全停止 | 本地速度租期监督、故障撤权机制、3000ms 停止预算的实测证据 |
| 图像/定位 | camera_id、frame_id 生成规则、视频帧映射、去畸变坐标、测距对准、实测/仿真/平面估计来源标记 |

以上物理参数必须写入交付配置说明，不能只留口头约定；不在本稿中虚构某型号硬件限值。临时未满足条件时返回明确错误，不能靠增大超时掩盖反馈缺失。

### 7.2 最小联调序列

本文示例为独立场景，固定 UTC、编号与状态仅用于阅读。实际发送须使用真实返回的 task_id；新逻辑请求生成新 request_id，重试才保留原编号。不能顺次原样发送全部示例，也不能直接用于实机运动。

1. 建立两个状态 topic 的 SUB，收到当前设备和任务快照；
2. 下达 AreaSearch，保存回执 task_id，等待 TaskStatus.state=ready 与下达命令 accepted；此时不得发生搜索运动。
3. TaskControl(task_id,start)，确认 starting → searching；收到同 task_id 的 TargetList，核验类别、威胁度和像素；track 策略另核验 TrackList 的锁定、单目标、定位失败与丢失通知。
4. pause 后确认 pausing → paused；resume 后进度连续且 remaining_ms 未增加。
5. stop 后确认 stopping → canceled、reason=CANCELED_BY_CLIENT；核验 DeviceStatus 和 TaskStatus 中的最新停止反馈。
6. 使用新任务编号测试 sector 与 circular；确认循环定义、角度跨界、机械限位、完成与超时结果。
7. 无搜索任务时验证遥控 position/velocity/zoom；停止刷新速度后本地租期生效；变焦实际倍率、完成状态、超时与不支持回执符合 3.4，定位使用相应倍率标定。
8. 测试幂等、服务重启、断开订阅、UTC 异常与陈旧反馈，不重复运动、不冒充停稳。

### 7.3 验收矩阵

| 场景 | 预期 |
| --- | --- |
| 无任务周期状态 | DeviceStatus 正常发送；TaskStatus={task:null,command:null} |
| 下达任务未启动 | 生成 task_id，ready，云台无搜索运动 |
| 错 task_id / 错所有者 / 错状态 | NOT_FOUND / FORBIDDEN / INVALID_STATE，不驱动设备 |
| 同 ID 同参数重发 | 返回原记录，不重复配置、启动、恢复或续租 |
| 同 ID 改参数 | ID_CONFLICT |
| 控制权占用 | BUSY；暂停任务也不能被遥控隐式接管 |
| 暂停超过原任务预算 | 自动停止，failed，不因 resume 重置预算 |
| 任务正常耗尽 | 确认停止后 completed；coverage_complete 单独表达区域覆盖 |
| 停止反馈超时/陈旧 | STOP_UNCONFIRMED 或停止确认失效，ready=false，继续监督停止 |
| 速度更新断开/丢失 | 租期到期自动撤销，不持续保留最后速度 |
| PUB/SUB 缺口 | 周期快照恢复最新状态；目标缺失不声称已经补齐 |
| TargetList 空列表 | 明确该帧检测为空，不等于设备无效帧 |
| 识别与定位分离 | TargetList 无 position/range_m，含 threat_level；定位仅见 TrackList |
| 跟踪定位不可用 | tracking 可保持，position=null 并说明原因，有效测距可保留 |
| 跟踪丢失/结束 | lost/idle 时 targets=[]；保留或清除跟踪编号按 4.4 约定，不上报旧位置 |
| 识别列表超限 | 保持整包 ≤65536 字节，truncated=true，不虚报完整；TrackList 至多一个目标 |
| 威胁度无评估依据 | threat_level=null，不以 confidence 或示例类别推算 |
| 变焦动作 | REP 只确认接纳，实际倍率与最终结果由 DeviceStatus 上报；超限/不支持明确拒绝 |
| TrackList 字段完整【V2.3 新增】 | tracking 条目含 bbox 与 observed_at_utc_ms（允许按约定为 null）；与 image.frame_id 同次观测一致，逐目标与 data 级时间相等，非空 bbox 包含 pixel |
| 帧头与视频对应【集成补充】 | 按实际输出帧率发布；验证同帧编号/曝光时间、实际 RTP 时间戳、乱序与丢失处理；缩放或裁剪后不错误套用原图 bbox |
| 按需取帧【集成补充】 | 验证仅支持 camera_id+frame_id 精确查询、时间查询参数拒绝、未命中不替换帧、成功两帧/失败一帧、JPEG 长度与原图坐标、超限拒绝、缓存淘汰与重试；取帧不干扰任务控制 |
| 图像像素 | 像素/框合法，去畸变空间一致，frame_id 对应同次观测 |
| 仿真/平面求交 | 来源明确，不能冒充实测距离或已验证精度 |
| 服务重启 | 先撤销旧运动并核验停止；任务编号不复用，内存记录不跨重启保留 |

## 8. 版本演进与改动项

### 8.1 V2.1 → V2.2：参考稿修订摘要

以下为 V2.2 参考稿自带的修订摘要；未提供独立 V2.1 快照，不能据此还原逐行差异：

- 保留区域任务的四点 WGS84 参数与总时限；明确下达不启动，任务预算自首次 start 接纳起算。
- 保留 TaskControl 四个动作，补充 task_id、状态转移、暂停预算语义及停止确认。
- 补齐 CircularSearch 的周扫/扇扫参数、循环和可达性约束；补齐 TeleControl 的位置/速度/变焦/停止、实际倍率反馈与执行结果。
- 将 DeviceStatus 与 TaskStatus 拆成独立周期快照，统一回执、幂等、topic 和完整例报。
- TargetList 仅保留识别结果并增加 threat_level；定位移入单目标 TrackList，补齐关联编号、锁定/丢失与定位不可用规则。删除重复的 report_id/total_count、跟踪截断统计及误差上界等字段，保留图像对应和距离来源约束。
- 2026.10.20：删除 GetStatus 与恢复章节，不定义 server_session 或请求有效期字段；Command.state 统一为 accepted/failed。遥控执行结果 telecontrol.state 仍为 running/succeeded/failed。服务端实现及仿真限制见 ros2_zmq_server_sl 包内《光电接口映射.md》。

### 8.2 本次对照 V2.2 实际补齐项

| 改动项 | 正文位置 | 处理 |
| --- | --- | --- |
| 区域顶点数量 | 3.1 | 字段表明确恰好四个 Position，与原有四点凸区域约束一致 |
| 切换跟踪目标 | 1.2、3.3、4.4 | 增加 TaskControl.action=next_follow，删除“不支持切换目标”的旧描述；参考稿空缺的状态与完成条件明确标为待确认 |
| 参考稿与本仓部署差异 | 2.2、4.4 | 保留本仓 device_id=isr-01 与仿真目标参考点测距说明；V2.2 参考稿使用“选定表面点”且不含该仿真约定，后者仅适用于本仿真部署，不代表实测表面回波 |

### 8.3 V2.2 → V2.3：新增与集成说明

| 改动项 | 正文位置 | 内容与影响 |
| --- | --- | --- |
| 跟踪检测框 | 4.4、4.5 | targets[0] 新增必填可空 bbox，支持按同帧框裁剪 ROI；非空时 pixel 在框内 |
| 逐目标曝光时间 | 4.4 | targets[0] 新增必填可空 observed_at_utc_ms；与 data 级时间相等，关联同一 image.frame_id |
| 示例与验收 | 4.4、7.3 | 更新完整 TrackList 示例，新增字段完整性与同帧一致性验收 |
| 帧头报文【本稿集成补充】 | 5.4 | 明确 frame_header 两帧 multipart、完整 JSON、逐帧发布、曝光时间与 RTP 映射、丢帧及坐标空间约束 |
| 取帧报文【本稿集成补充】 | 5.5 | 明确独立 FramePull 服务、仅按 camera_id+frame_id 精确查询（删除时间查询）、JSON+JPEG 响应、错误码、大小限制、原图坐标及缓存重试语义 |
| 视频与帧对齐 | 第 5 章 | 补充三通道逻辑链路、≥5s 帧缓冲、frame_id 优先及 ±33ms 时间匹配、像素不可得降级和两档仿真设计 |
| Agent 集成 | 第 9 章 | 明确确定性锁定与轮换、控制权互斥、短任务节拍、状态监护与重试，以及待演进能力 |
| 版本标识 | 页头、2.3、2.4、全部信封示例 | 本合并稿统一为 V2.3 / protocol="2.3"；兼容与版本协商未由参考稿定义 |

本次另将 6.2 拒绝回执示例的 `result:null` 对齐为 2.4 已定义的 `command:null`，属于文档内部一致性修正，不新增业务字段。

## 9. Agent 集成约束【V2.3 集成说明】

本章技能名、FrameBuffer、vlm_sim、“五层防御”及火控调用属于 Agent 集成设计，不是第 1.2 节注册的光电 method，也不声明本仓已提供对应工具。下表是能力映射而非完整请求 JSON，实际参数须使用第 3 章 schema；例如扇扫字段为 yaw_center_rad/yaw_span_rad。

### 9.1 技能 → 光电方法映射

| Agent 技能 | 光电方法 | 说明 |
| --- | --- | --- |
| scan_area（区域搜索） | AreaSearch(recognize) + TaskControl | 室外/城市战图为主；WGS84 四点凸区域，依赖 navigation_valid |
| scan_sector（扇扫/周扫） | CircularSearch + TaskControl | 室内主力扫描手段 |
| track_target（锁定跟踪） | AreaSearch/CircularSearch(track 策略) | 光电内部闭环：扫描→逐帧检测→逐个确认(匹配限定目标类型)→锁定**确认序列中从左到右的第一个目标**→跟踪。规则确定、可预测；Agent 用 TrackList.target_id 反查 TargetList 确认类别 |
| switch_target（切换目标） | TaskControl(next_follow) | 按确认顺序切换到下一个；**当前版本无法直接指定目标**，见 9.4 |
| point_at / zoom（指向/变焦确认） | TeleControl position / zoom | **受控制权约束，见 9.2** |
| observe_status | DeviceStatus / TaskStatus 订阅 | 监护层心跳与任务状态来源 |

### 9.2 控制权约束 → "确认"技能的实现形态

V2.2 §3.4：非终态任务（含 paused）占用控制权期间，TeleControl 一律 BUSY。因此"扫描→检测→变焦确认"不能在一个长任务内完成变焦，技能实现采用**短任务节拍**：

```
detect_and_confirm 技能:
  1. 下发短 CircularSearch(recognize, cycle_count=1, 小角宽) 或利用进行中的扫描检测结果
  2. 任务完成/stop, 控制权释放
  3. TeleControl.position 指向候选 + zoom 放大 → 等 DeviceStatus.data.telecontrol.state=succeeded
  4. 新短任务复查该指向, 或按需取帧走 Agent 侧 VLM/Re-ID 确认(推荐, 不动云台)
  5. 需要持续跟踪时再下达 track 策略任务
```

优先路径是第 4 步的 **Agent 侧像素确认**（不动云台、不占用光电任务），这正是 V2.3 变更（bbox+时间戳）支撑的能力；云台变焦复查作为高价值目标的二次手段。

### 9.3 状态机与监护语义对齐

- Agent 技能的状态轮询以 TaskStatus.data.task.state 为准（preparing→ready→starting→searching→…），**不以 REQ 回执判断执行结果**。
- 任务预算（task_timeout_ms）由技能卡片按场景给值；预算到期=DEADLINE_EXCEEDED 属正常失败类别，进五层防御分流。
- 设备失联判定：DeviceStatus 1Hz 周期帧超时（>3s）→ 监护层报设备失联 → 能力降级流程。
- 技能重试必须沿用原 request_id（幂等），新逻辑请求才生成新 request_id。

### 9.4 待协议演进项（向对方提出，暂用变通方案）

以下建议不属于 V2.3 已定义能力，不得直接调用 SelectTarget 或发送 confirm_zoom 参数。

| 需求 | 现状 | 变通 | 建议 |
| --- | --- | --- | --- |
| 指定目标锁定 | 锁定规则固定为"确认序列从左到右第一个"+next_follow 轮换 | 利用规则的可预测性做策略（见下）；轮换+target_id 反查确认 | 增加 SelectTarget(target_id) |
| 任务内变焦确认 | 控制权互斥 | 短任务节拍/Agent 侧像素确认 | 任务参数支持 confirm_zoom 策略 |
| 多目标跟踪 | 单目标 TrackList | 多帧 TargetList 由 Agent 侧做多目标关联 | TrackList 支持多目标条目 |

### 9.5 利用确定性锁定规则的目标选择策略

锁定规则（确认序列左起第一个）是确定的，Agent 可以主动利用而非被动接受：

1. **扇区整形**：调整扇扫的 yaw_center/span 或云台起始指向，让期望目标成为视场中"最左"的确认目标，提高首发命中率；
2. **轮换确认链**：track 任务启动后，Agent 收到 TrackList → 按 target_id 反查 TargetList 类别 → 按需取帧做身份识别（B 同学？敌方？）→ 不是期望目标则 next_follow 切下一个，直到命中或遍历完毕（遍历完仍未找到 = 进入重搜索/上报分支）；
3. **接敌场景**：track 策略+轮换确认链找到敌目标后，以 track_ref（eo_device_id+track_id）交给火控 EngageTarget——光电持续出定位流，火控随动，Agent 只做裁决。

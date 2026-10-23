# 光电系统对外 ZeroMQ 接口

- **版本号 V2.2**
- **修订时间 2026.10.20**

## 1. 总体说明

### 1.1 对接目标与范围

外部上位机或整车系统下达区域搜索、周扫/扇扫任务，控制任务启动、暂停、继续、终止，以及遥控云台和相机变焦；光电端周期上报设备状态、任务状态、识别列表和跟踪列表。图像采集、检测、扫描规划、设备控制、坐标变换与定位在光电端完成。

本协议开放云台位置/速度遥控、相机光学变焦和任务暂停恢复；不开放算法参数、标定修改、内部扫描网格、视频传输。区域搜索限四点凸区域和部署约定的水平面，不支持任意地形。云台角限位、速度上限、扫描策略及相机配置由部署确定；外部请求必须满足这些物理约束，不能靠协议取值范围绕过限位。

### 1.2 接口清单

| 方向/通道 | method 或上报名称 | 作用 |
|---|---|---|
| 外部 → 光电，REQ/REP | AreaSearch | 下达区域搜索，仅配置，不运动，生成 task_id |
| 外部 → 光电，REQ/REP | CircularSearch | 下达周扫/扇扫，仅配置，不运动，生成 task_id |
| 外部 → 光电，REQ/REP | TaskControl | 对指定 task_id 执行 start/pause/resume/stop |
| 外部 → 光电，REQ/REP | TeleControl | 云台位置/速度遥控、相机变焦、停止遥控动作 |
| 光电 → 外部，PUB/SUB | DeviceStatus | 设备健康、实际角度、停止确认和遥控状态 |
| 光电 → 外部，PUB/SUB | TaskStatus | 当前或最近任务、进度和最近任务命令 |
| 光电 → 外部，PUB/SUB | TargetList | 同一图像帧的识别目标列表，含类别、置信度、威胁度和像素信息 |
| 光电 → 外部，PUB/SUB | TrackList | 单目标跟踪状态、当前像素及可用地理位置 |

上报名称供文档阅读，不是请求 method；实际 topic 见 2.1。本稿只支持上表四个 method，无原版旧方法别名。

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
|---|---|---|---|
| 指令 | REP，bind | REQ，connect | tcp://<光电IP>:5555 |
| 周期/事件上报 | PUB，bind | SUB，connect | tcp://<光电IP>:5556 |

- **请求和响应均为一帧 UTF-8 JSON**；REQ/REP 内部信封由 ZeroMQ 管理，应用不加空帧。

- **发布消息固定两帧 multipart：第一帧 UTF-8 topic，第二帧 UTF-8 JSON**

| 上报名称 | 第一帧完整 topic | 第二帧 JSON.topic |
|---|---|---|
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
|---|---|
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
|---|---|---|
| protocol | string，是 | 固定 2.2 |
| kind | string，是 | 固定 request |
| device_id | string，是 | 目标设备编号，须与连接设备一致 |
| request_id | string，是 | 一次逻辑请求的全局唯一编号，重试不变 |
| method | string，是 | 1.2 的四个请求方法之一 |
| params | object，是 | 对应方法的业务参数 |

### 2.4 RES回执信封【8】

| 字段 | 类型 / 必填 | 约定 |
|---|---|---|
| protocol | string，是 | 2.2 |
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
| code    | string | 错误码，具体定义在 5.2 中                                    |
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
|---|---|---|---|
| region_wgs84 | 搜索区域顶点 | array，是 | 沿边界顺序排列，不重复首点 |
| task_timeout_ms | 任务总预算 | integer，是 | 1000～3600000ms，从首次 start 接纳起算 |
| search_strategy | 搜索策略 | string，是 | recognize 表示 仅识别(默认），track 表示 跟踪 |

区域边界点须严格凸、无重复、无自交，并满足部署约定的水平面高度容差、搜索距离、视线与机械条件；不能覆盖的请求明确拒绝，不静默改区域。禁止将任意地形近似结果宣称为精确地面定位。

本接口只校验、建档、规划准备，**不驱动云台搜索**。接纳即分配唯一 task_id，上报的TaskStatus 可暂为 preparing；

- **recognize** 识别模式上报 4.3 TargetList，包含类别、图像位置、置信度和威胁度，不含地理定位。
- **track** 跟踪模式先识别并按设备配置选定一个目标，再锁定、测距和定位；上报 4.4 TrackList。目标选择规则由部署约定，本版不增加人工选目标接口。

请求示例：

```json
{
  "protocol": "2.2",
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
  "protocol": "2.2",
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
|---|---|---|---|
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
  "protocol": "2.2",
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
  "protocol": "2.2",
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
|---|---|---|---|
| task_id | 被控制任务编号 | string，是 | 必须使用任务下达成功时回执REP中返回的编号 |
| action | 控制动作 | string，是 | start / pause / resume / stop |

保持四种用户指定动作；task_id 不允许 null，不能以“当前任务”隐式猜测。

| action | 允许状态 | 接纳后的状态与完成条件 |
|---|---|---|
| start | ready | starting → searching；首次接纳启动预算；进入 searching 后命令 accepted |
| pause | starting / searching | pausing → paused；禁止新扫描动作，可靠停稳后命令 accepted，保留进度 |
| resume | paused | starting → searching；恢复尚未完成的扫描，不重置预算或进度 |
| stop | preparing / ready / starting / searching / pausing / paused / stopping | stopping → canceled；撤销任务、清理待执行动作、确认停稳后命令 accepted |

同 request_id、同 method/params 的重发返回原回执，不重复执行；同 request_id 改变内容返回 ID_CONFLICT。服务端在本次运行期间保存命令记录，容量不足时拒绝新请求并返回 RESOURCE_EXHAUSTED。新编号 start 已启动任务、resume 非 paused 任务返回 INVALID_STATE；pause 已 paused 任务可直接 accepted；stop 已 canceled/completed 且已停稳任务可直接 accepted。stop 已 failed 的任务仍可重试其遗留物理停止，停稳后原任务保持 failed，不改写故障历史。若控制权已交给另一任务或遥控，旧终态任务的 stop 不得作用于新运动：已确认清理完毕则仅返回原任务结果，未能确认清理则拒绝并报 INVALID_STATE。不存在返回 NOT_FOUND；不属于调用方且无跨任务停止授权返回 FORBIDDEN。

stop 会抢占尚未完成的 start/resume/pause，后者记 failed、reason=SUPERSEDED；服务端必须防止被撤销的排队动作之后再驱动设备。首次 start 接纳后若预算已在队列中耗尽，执行器不得再启动运动。处于 pausing/stopping 时其他新 start/resume/pause 均返回 INVALID_STATE。停止过程中的新 stop 合并至现有停止过程，不能重置停止截止时间。

暂停与终止的停止监督预算为 3000ms，从首次实际发出停止动作起算，实机须验证是否满足。无法在预算内确认停止：任务 failed，reason=STOP_UNCONFIRMED，设备 fault；继续监督停止并拒绝新运动，不能把超时当作已经停稳。

任务总预算从首次 start accepted 起按单调时钟递减，准备启动、搜索、暂停及恢复均计时；**暂停不冻结预算**。预算到期主动停止，最终 failed、reason=DEADLINE_EXCEEDED；若停止也未确认，则优先 reason=STOP_UNCONFIRMED，设备故障说明记录预算到期背景。

启动请求（暂停/继续/终止分别将 action 改为 pause/resume/stop，并使用各自新的 request_id）：

```json
{
  "protocol": "2.2",
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
  "protocol": "2.2",
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
|---|---|---|
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
  "protocol": "2.2",
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
  "protocol": "2.2",
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
  "protocol": "2.2",
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
  "protocol": "2.2",
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
  "protocol": "2.2",
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
|---|---|---|
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
  "protocol": "2.2",
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
|---|---|---|
| task | object/null | 当前非终态任务；无则保留最近终态任务；本次运行从未有任务则 null |
| command | object/null | 该任务最近下达/控制命令的 Command 最新记录；无任务则 null |

| task 字段 | 类型 | 约定 |
|---|---|---|
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
  "protocol": "2.2",
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
|---|---|---|
| task_id | string/null | 本次观测的搜索任务；非任务观测为 null |
| observed_at_utc_ms | integer/null | 图像曝光/采集时间，非发布时间；无可靠 UTC 映射时 null |
| image | object | 同帧图像引用与尺寸，见 4.5 |
| data_origin | string | measured / simulated / replay |
| truncated | boolean | 是否因 65536 字节上限仅发送部分识别条目 |
| targets | array | 识别条目；空帧为 []；数量直接取数组长度 |

不再增加 report_id 和 total_count：以 device_id+topic+image.camera_id+image.frame_id 识别同帧报告，每帧每主题仅发一次不可变识别结果；truncated=true 明确表示不完整。超限按 confidence 降序保留完整条目，同置信度按 target_id 排序，直到序列化后满足字节上限，不静默截断或把分片伪装为完整列表。

| targets[] 字段 | 类型 | 约定 |
|---|---|---|
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
  "protocol": "2.2",
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

当前接口未提供外部指定目标或切换目标的请求，选定规则使用设备部署配置，不隐式添加请求方法。识别类别、置信度、威胁度通过最初的 target_id 关联 4.3，不在每条跟踪上报中重复；外部若缺失关联的识别帧，仅展示已知跟踪信息，不猜造类别。

有效跟踪帧按部署频率上报（建议不高于 10Hz），锁定、丢失、停止及定位有效性变化时立即上报最新结果。无新有效帧时不重发旧坐标冒充新观测；acquiring/lost 状态保持 1Hz 状态上报。没有跟踪任务时可不周期发送本主题，但离开 track 策略或任务终止时立即发送一次 idle，任务是否已停止仍以周期 TaskStatus 为准。

| data 字段 | 类型 | 约定 |
|---|---|---|
| task_id | string | 对应 track 策略的搜索任务；idle 终止通知仍保留原 task_id |
| track_state | string | acquiring=正在锁定；tracking=当前跟踪有效；lost=已丢失；idle=未选定或已结束跟踪 |
| track_id | string/null | 本次连续跟踪编号，acquiring/tracking/lost 非空且保持不变，idle 为 null |
| target_id | string/null | 最初锁定候选在 TargetList 中的 target_id；锁定期间保持不变，idle 为 null |
| observed_at_utc_ms | integer/null | 当前跟踪图像观测时间；没有有效图像或无法映射 UTC 时 null |
| data_origin | string | measured / simulated / replay |
| targets | array | 当前有效跟踪条目，tracking 时恰好 1 条，其他状态为 [] |



| targets[0] 字段 | 类型 | 约定 |
|---|---|---|
| image | object | 当前跟踪图像编号与尺寸，结构见 4.5；与 pixel 对应同次观测 |
| pixel | object | 当前跟踪图像中的选定像素点，与本次定位关联 |
| position | Position/null | WGS84 地理位置，结构见 2.5.3；定位不可用/失败时 null |
| range_m | number/null | 光心至选定点的径向距离，>0；仿真可使用部署约定的目标参考点；无有效距离时 null |
| range_source | string/null | 有效距离来源，见下；无有效距离时 null |
| reason | string/null | 定位有效时 null；不可用/失败时给出原因 |

跟踪有效与定位有效分开判断：track_state=tracking 仅表示图像目标仍被锁定，position 可以为 null。定位成功时 position、range_m、range_source 全部非空，reason=null；定位失败时 position=null 并给出 NO_RANGE、NO_NAVIGATION、OUT_OF_MODEL 或 INVALID_GEOMETRY 等原因。若本次有有效测距但不能计算经纬度，可以保留 range_m/range_source；没有有效距离时两者同时 null。不能复用旧位置或用 (0,0,0) 表示失败。

range_source：measured_laser=实测激光径向距离；measured_radial_depth=实测径向深度；simulated_radial_depth=仿真径向深度；computed_plane_intersection=依据标定、导航与约定平面求交的估计距离

data_origin=simulated 不能标为实测测距；replay 保留原来源。measured 只表示实设备观测，不保证距离实测。

目标丢失时 track_state=lost、targets=[]，保留 track_id/target_id 供外部明确结束当前轨迹；不保留旧地理点作为当前结果。重新锁定不同对象时使用新的 track_id/target_id。任务暂停不假定仍在跟踪；只有继续取得有效帧才能上报 tracking，不能凭暂停前画面维持锁定状态。暂停/终止后的迟到跟踪结果仍关联原 task_id，客户端不得将其覆盖到新任务或已结束的轨迹。

完整 TrackList 示例，第一帧 isr/isr-01/tracklist（定位数值仅示意）：

```json
{
  "protocol": "2.2",
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
  "protocol": "2.2",
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
|---|---|---|
| image.camera_id | string | 对外相机编号 |
| image.frame_id | string | 在 device_id+camera_id 下唯一；重启、重连后不复用 |
| image.width_px / height_px | integer | 原图尺寸，各 1～32768px |
| pixel.x_px / y_px | number | 跟踪点，0 ≤ x < image.width_px；0 ≤ y < image.height_px |
| bbox.x_px / y_px | number | 检测框，非负，检测框左上角 |
| bbox.width_px / height_px | number | >0；x+width ≤ image.width_px，y+height ≤ image.height_px |

图像左上角为 (0,0)，x 向右、y 向下，零基坐标，允许小数。光电端须逆变换检测网络的缩放、letterbox 补边和裁剪坐标，不把网络输入坐标标在原图上。

bbox 使用半开区间 [x,x+width)、[y,y+height)；4.3 中非空时 pixel 须落在框内。TargetList.pixel 是识别目标的选定点，TrackList.pixel 是当前跟踪帧的定位关联点，两者不要求在不同帧保持相同坐标。外部可另算检测框中心用于显示，但不能自动当成地理定位点。

各列表的 pixel/bbox，以及 4.4 中有效的 position，须对应本条 image.frame_id 的同次观测；定位采用对应曝光时刻的导航、姿态和变焦标定，不以发布时刻的数据代替。非法像素/框不得静默裁剪或借用旧数据；应丢弃非法条目并记录诊断，完整图像信息失效时不发该帧报告。

视频另走部署约定通道，须提供显示帧与 camera_id+frame_id 的映射及去畸变空间说明。外部只在匹配帧绘框；显示缩放、裁剪、黑边须正确变换。没有帧映射时仅展示数值，不将坐标直接叠加在“最新画面”。

## 5. 状态、错误与英文中文对照

### 5.1 主要状态与术语

| 英文 | 中文/语义 |
|---|---|
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

### 5.2 错误码与原因

| code / reason | 中文含义与处置 |
|---|---|
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
  "protocol": "2.2",
  "kind": "response",
  "device_id": "isr-01",
  "response_id": "req-resume-001",
  "method": "TaskControl",
  "ok": false,
  "result": null,
  "error": {
    "code": "INVALID_STATE",
    "message": "任务 task-018 当前为 searching，不能执行 resume；请先暂停并确认 paused。"
  }
}
```

已接纳动作执行失败通过 DeviceStatus.data.telecontrol.command.reason、TaskStatus.reason 或设备故障上报。NO_RANGE/NO_NAVIGATION/OUT_OF_MODEL/INVALID_GEOMETRY/CALIBRATION_NOT_READY 仅用于 TrackList 的定位原因，不代表 ZeroMQ 连接故障。

## 6. 部署与验收

### 6.1 部署需要确定的参数

| 参数组 | 双方确认项 |
|---|---|
| 通信/身份 | 光电 IP、device_id |
| 时间 | UTC 同步与误差监测、曝光时间映射、数据新鲜度阈值 |
| 云台/变焦 | 车体视轴标定、角/速度限位、连续周扫能力、位置容差、停稳判据、光学倍率范围与容差、镜头停止反馈及各倍率标定 |
| 扫描/跟踪 | 水平面椭球高与容差、可达范围、扫描/覆盖判据、识别/跟踪发布频率、目标选择及丢失/重锁规则、类别表与威胁度评估规则 |
| 安全停止 | 本地速度租期监督、故障撤权机制、3000ms 停止预算的实测证据 |
| 图像/定位 | camera_id、frame_id 生成规则、视频帧映射、去畸变坐标、测距对准、实测/仿真/平面估计来源标记 |

以上物理参数必须写入交付配置说明，不能只留口头约定；不在本稿中虚构某型号硬件限值。临时未满足条件时返回明确错误，不能靠增大超时掩盖反馈缺失。

### 6.2 最小联调序列

本文示例为独立场景，固定 UTC、编号与状态仅用于阅读。实际发送须使用真实返回的 task_id；新逻辑请求生成新 request_id，重试才保留原编号。不能顺次原样发送全部示例，也不能直接用于实机运动。

1. 建立两个状态 topic 的 SUB，收到当前设备和任务快照；
2. 下达 AreaSearch，保存回执 task_id，等待 TaskStatus.state=ready 与下达命令 accepted；此时不得发生搜索运动。
3. TaskControl(task_id,start)，确认 starting → searching；收到同 task_id 的 TargetList，核验类别、威胁度和像素；track 策略另核验 TrackList 的锁定、单目标、定位失败与丢失通知。
4. pause 后确认 pausing → paused；resume 后进度连续且 remaining_ms 未增加。
5. stop 后确认 stopping → canceled、reason=CANCELED_BY_CLIENT；核验 DeviceStatus 和 TaskStatus 中的最新停止反馈。
6. 使用新任务编号测试 sector 与 circular；确认循环定义、角度跨界、机械限位、完成与超时结果。
7. 无搜索任务时验证遥控 position/velocity/zoom；停止刷新速度后本地租期生效；变焦实际倍率、完成状态、超时与不支持回执符合 3.4，定位使用相应倍率标定。
8. 测试幂等、服务重启、断开订阅、UTC 异常与陈旧反馈，不重复运动、不冒充停稳。

### 6.3 验收矩阵

| 场景 | 预期 |
|---|---|
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
| 图像像素 | 像素/框合法，去畸变空间一致，frame_id 对应同次观测 |
| 仿真/平面求交 | 来源明确，不能冒充实测距离或已验证精度 |
| 服务重启 | 先撤销旧运动并核验停止；任务编号不复用，内存记录不跨重启保留 |

## 7. 相对源文档的修订摘要

- 保留区域任务的四点 WGS84 参数与总时限；明确下达不启动，任务预算自首次 start 接纳起算。
- 保留 TaskControl 四个动作，补充 task_id、状态转移、暂停预算语义及停止确认。
- 补齐 CircularSearch 的周扫/扇扫参数、循环和可达性约束；补齐 TeleControl 的位置/速度/变焦/停止、实际倍率反馈与执行结果。
- 将 DeviceStatus 与 TaskStatus 拆成独立周期快照，统一回执、幂等、topic 和完整例报。
- TargetList 仅保留识别结果并增加 threat_level；定位移入单目标 TrackList，补齐关联编号、锁定/丢失与定位不可用规则。删除重复的 report_id/total_count、跟踪截断统计及误差上界等字段，保留图像对应和距离来源约束。
- 2026.10.20：删除 GetStatus 与恢复章节，不定义 server_session 或请求有效期字段；Command.state 统一为 accepted/failed。遥控执行结果 telecontrol.state 仍为 running/succeeded/failed。服务端实现及仿真限制见 ros2_zmq_server_sl 包内《光电接口映射.md》。


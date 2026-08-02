# Decisions

## D-001 Workspace 归位

原 ZIP 的应用位于根目录 `pms-web/`，任务强制最终使用 `apps/pms-web`。因此只进行目录归位，未创建第二套应用，页面路径与业务交互不变。

## D-002 保留 navigate 兼容函数

一次性修改所有 Feature 内点击处理会扩大回归面。保留同名函数，但内部完全委托 React Router，旧 History Router 已删除。后续可渐进替换为 `Link`/`useNavigate`。

## D-003 Gateway 包装现有 Mock 引擎

为避免破坏五条流程，保留成熟的 Scenario/operation 状态引擎，将其降为 Mock Gateway 内部实现；页面依赖仍由 Query 适配层承接。

## D-004 API 模式失败关闭

本任务禁止接真实 API。生产默认 `api` 模式时展示受控错误，不回退 Mock。

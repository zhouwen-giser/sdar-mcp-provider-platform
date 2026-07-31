# Data Layer Migration

- 新增 `QueryClient`，统一 stale、gc、retry、background refetch 与 mutation 默认策略。
- 原 `useDataQuery` 改为 TanStack Query 兼容适配器，页面不再自行实现 Promise 生命周期状态机。
- 新增 Dashboard、Provider、Resource、Runtime、Configuration、Catalog、Registry、Operations、Audit Gateway 契约。
- Mock Gateway 将现有 Scenario-aware 引擎封装为领域接口，保留现有 Mock 资产。
- `gateways/openapi/` 仅说明未来 DTO -> Mapper -> ViewModel 链路，不生成或伪造真实 API。
- `VITE_PMS_DATA_MODE=api` 未配置时受控失败，禁止静默回退 Mock。

# API 要求

冻结接口前缀为 `/api/console/v1`，唯一权威是 `contracts/pms-console-api/v1`。

- 列表响应使用 `{ items, page }`；`page` 包含 `limit`、可选 `nextCursor`。
- 错误使用 `application/problem+json` 的 `ProblemDetails`。
- RuntimeDeployment 写操作返回 `202 Accepted` 的 Intent，其中 `operationId` 只是相关标识，不是 Generic Operation 领域对象。
- `X-Actor-ID` 仅用于审计上下文；登录、鉴权和 RBAC 均未实现。
- Web 的 Mock Gateway 必须保留冻结接口所需 scope；`api` 模式在真实 Gateway 未实现时必须 fail-closed，禁止静默回退 Mock。
- Goal 09 不实现浏览器到 PMS API 的真实 HTTP 集成。

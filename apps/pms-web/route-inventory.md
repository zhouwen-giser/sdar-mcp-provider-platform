# Route Inventory

| 路由                                                            | 页面                       | 模块       | 优先级   |
| --------------------------------------------------------------- | -------------------------- | ---------- | -------- |
| `/dashboard`                                                    | 工作台                     | 概览       | P0       |
| `/attention`                                                    | 待处理中心                 | 概览       | P0       |
| `/notifications`                                                | 通知中心                   | 概览       | P1       |
| `/search`                                                       | 全局搜索                   | 概览       | P1       |
| `/providers`                                                    | Provider 列表              | Provider   | P0       |
| `/providers/new`                                                | 创建 Provider              | Provider   | P0       |
| `/providers/:providerId`                                        | Provider 详情              | Provider   | P0       |
| `/providers/:providerId/overview`                               | Provider 概览              | Provider   | P0       |
| `/providers/:providerId/edit`                                   | 编辑 Provider              | Provider   | P0       |
| `/providers/:providerId/configuration`                          | Provider 配置              | Provider   | P0       |
| `/providers/:providerId/deployments`                            | Provider Deployments       | Provider   | P0       |
| `/providers/:providerId/resources`                              | Provider Resources         | Provider   | P0       |
| `/providers/:providerId/catalog`                                | Provider Catalog           | Provider   | P0       |
| `/providers/:providerId/activity`                               | Provider Activity          | Provider   | P0       |
| `/providers/:providerId/settings`                               | Provider Settings          | Provider   | P1       |
| `/providers/:providerId/decommission`                           | Provider 下线              | Provider   | P0       |
| `/provider-packages`                                            | Provider Packages          | Provider   | P0       |
| `/provider-packages/new`                                        | 注册 Package               | Provider   | P1       |
| `/provider-packages/import`                                     | 导入 Package               | Provider   | P1       |
| `/provider-packages/:packageId`                                 | Package 详情               | Provider   | P0       |
| `/provider-packages/:packageId/versions/:version`               | Package Version            | Provider   | P0       |
| `/provider-packages/:packageId/versions/:version/qualification` | Package Qualification      | Provider   | P0       |
| `/provider-packages/:packageId/versions/:version/usage`         | Package Usage              | Provider   | P1       |
| `/runtime/deployments`                                          | Runtime Deployments        | 运行管理   | P0       |
| `/runtime/deployments/new`                                      | 创建 Deployment            | 运行管理   | P0       |
| `/runtime/deployments/:providerId/:deploymentId`                | Deployment 详情            | 运行管理   | P0       |
| `/runtime/deployments/:providerId/:deploymentId/overview`       | Deployment 概览            | 运行管理   | P0       |
| `/runtime/deployments/:providerId/:deploymentId/edit`           | 编辑 Deployment            | 运行管理   | P0       |
| `/runtime/deployments/:providerId/:deploymentId/reconciliation` | 调和时间线                 | 运行管理   | P0       |
| `/runtime/deployments/:providerId/:deploymentId/instances`      | Deployment Instances       | 运行管理   | P0       |
| `/runtime/deployments/:providerId/:deploymentId/configuration`  | Deployment Configuration   | 运行管理   | P0       |
| `/runtime/deployments/:providerId/:deploymentId/activity`       | Deployment Activity        | 运行管理   | P0       |
| `/runtime/deployments/:providerId/:deploymentId/upgrade`        | 升级 Deployment            | 运行管理   | P0       |
| `/runtime/deployments/:providerId/:deploymentId/scale`          | 扩缩容                     | 运行管理   | P1       |
| `/runtime/instances`                                            | Runtime Instances          | 运行管理   | P0       |
| `/runtime/instances/:providerId/:runtimeId`                     | Runtime Instance 详情      | 运行管理   | P0       |
| `/runtime/instances/:providerId/:runtimeId/registration`        | Runtime Registration       | 运行管理   | P0       |
| `/runtime/instances/:providerId/:runtimeId/configuration`       | Runtime Configuration      | 运行管理   | P0       |
| `/runtime/instances/:providerId/:runtimeId/activity`            | Runtime Activity           | 运行管理   | P0       |
| `/runtime/processes`                                            | Runtime Processes          | 运行管理   | P0       |
| `/runtime/processes/:providerId/:processId`                     | Runtime Process 详情       | 运行管理   | P0       |
| `/runtime/releases`                                             | Runtime Releases           | 运行管理   | P1       |
| `/runtime/releases/new`                                         | 注册 Runtime Release       | 运行管理   | P1       |
| `/runtime/releases/:releaseId`                                  | Runtime Release 详情       | 运行管理   | P1       |
| `/runtime/releases/:releaseId/compatibility`                    | Release Compatibility      | 运行管理   | P1       |
| `/runtime/releases/:releaseId/usage`                            | Release Usage              | 运行管理   | P1       |
| `/databases`                                                    | Database Profiles          | 运行管理   | P1       |
| `/databases/new`                                                | 创建 Database Profile      | 运行管理   | P1       |
| `/databases/:profileId`                                         | Database Profile 详情      | 运行管理   | P1       |
| `/databases/:profileId/edit`                                    | 编辑 Database Profile      | 运行管理   | P1       |
| `/databases/:profileId/usage`                                   | Database Profile Usage     | 运行管理   | P1       |
| `/configuration`                                                | 配置中心                   | 制品与配置 | P0       |
| `/configuration/new`                                            | 新建配置                   | 制品与配置 | P0       |
| `/configuration/:profileId`                                     | 配置详情                   | 制品与配置 | P0       |
| `/configuration/:profileId/edit`                                | 编辑配置                   | 制品与配置 | P0       |
| `/configuration/:profileId/revisions`                           | 配置 Revisions             | 制品与配置 | P0       |
| `/configuration/:profileId/revisions/:revision`                 | Configuration Revision     | 制品与配置 | P0       |
| `/configuration/:profileId/compare`                             | 配置对比                   | 制品与配置 | P0       |
| `/configuration/:profileId/revisions/:revision/rollback`        | 配置回滚                   | 制品与配置 | P0       |
| `/secrets`                                                      | Secret References          | 制品与配置 | P1       |
| `/secrets/:secretRef`                                           | Secret Reference 详情      | 制品与配置 | P1       |
| `/resources`                                                    | Resources                  | 发现与资源 | P0       |
| `/resources/:environment/:resourceId`                           | Resource 详情              | 发现与资源 | P0       |
| `/resources/:environment/:resourceId/history`                   | Resource History           | 发现与资源 | P1       |
| `/resources/:environment/:resourceId/activity`                  | Resource Activity          | 发现与资源 | P1       |
| `/catalog`                                                      | Catalog                    | 发现与资源 | P0       |
| `/catalog/providers/:providerId`                                | Provider Catalog           | 发现与资源 | P0       |
| `/catalog/providers/:providerId/:operationName`                 | Catalog Operation          | 发现与资源 | P0       |
| `/catalog/providers/:providerId/revisions`                      | Catalog Revisions          | 发现与资源 | P0       |
| `/catalog/providers/:providerId/revisions/:revision`            | Catalog Revision           | 发现与资源 | P0       |
| `/catalog/providers/:providerId/compare`                        | Catalog Compare            | 发现与资源 | P0       |
| `/catalog/:providerId/:operationName`                           | Catalog Operation 兼容路由 | 发现与资源 | P0       |
| `/registry`                                                     | Registry                   | 发现与资源 | P0       |
| `/registry/revisions/:revision`                                 | Registry Revision          | 发现与资源 | P0       |
| `/registry/compare`                                             | Registry Compare           | 发现与资源 | P0       |
| `/registry/publish`                                             | Registry Publish           | 发现与资源 | P0       |
| `/conformance`                                                  | Conformance                | 发现与资源 | P1       |
| `/conformance/suites`                                           | Conformance Suites         | 发现与资源 | P1       |
| `/conformance/runs`                                             | Conformance Runs           | 发现与资源 | P1       |
| `/conformance/runs/:runId`                                      | Conformance Run 详情       | 发现与资源 | P1       |
| `/mcp-explorer`                                                 | MCP Explorer               | 发现与资源 | P1       |
| `/mcp-explorer/history`                                         | MCP Explorer History       | 发现与资源 | P1       |
| `/operations`                                                   | Control Plane Operations   | 运维       | P0       |
| `/operations/:operationId`                                      | Operation 详情             | 运维       | P0       |
| `/operations/health`                                            | 系统健康                   | 运维       | P0       |
| `/operations/jobs`                                              | Worker Jobs                | 运维       | P0       |
| `/operations/jobs/:jobId`                                       | Worker Job 详情            | 运维       | P0       |
| `/operations/queues`                                            | Worker Queue               | 运维       | P1       |
| `/operations/workers`                                           | Workers                    | 运维       | P1       |
| `/operations/incidents`                                         | Incidents                  | 运维       | P0       |
| `/operations/incidents/new`                                     | 创建 Incident              | 运维       | P0       |
| `/operations/incidents/:incidentId`                             | Incident 详情              | 运维       | P0       |
| `/operations/incident-rules`                                    | Incident Rules             | 运维       | P1       |
| `/changes`                                                      | Change Requests            | 治理       | P0       |
| `/changes/new`                                                  | 创建 Change Request        | 治理       | P0       |
| `/changes/:changeId`                                            | Change Request 详情        | 治理       | P0       |
| `/changes/:changeId/review`                                     | Change Review              | 治理       | P0       |
| `/audit`                                                        | Audit                      | 治理       | P0       |
| `/audit/:auditId`                                               | Audit 详情                 | 治理       | P0       |
| `/audit/export`                                                 | Audit Export               | 治理       | P1       |
| `/environments`                                                 | Environments               | 系统       | P1       |
| `/environments/:environmentId`                                  | Environment 详情           | 系统       | P1       |
| `/access/users`                                                 | 用户管理                   | 系统       | P1       |
| `/access/roles`                                                 | 角色管理                   | 系统       | P1       |
| `/access/roles/:roleId`                                         | 角色详情                   | 系统       | P1       |
| `/access/service-accounts`                                      | Service Accounts           | 系统       | P1       |
| `/system/general`                                               | General Settings           | 系统       | P1       |
| `/system/runtime-defaults`                                      | Runtime Defaults           | 系统       | P1       |
| `/system/registry`                                              | Registry Settings          | 系统       | P1       |
| `/system/retention`                                             | Retention Settings         | 系统       | P1       |
| `/system/security`                                              | Security Settings          | 系统       | P1       |
| `/system/settings`                                              | System Settings 兼容路由   | 系统       | P1       |
| `/profile`                                                      | 用户资料                   | 系统       | P1       |
| `/profile/preferences`                                          | 用户偏好                   | 系统       | P1       |
| `/login`                                                        | 登录                       | 通用       | P1       |
| `/session-expired`                                              | 会话过期                   | 通用       | P1       |
| `/access-denied`                                                | 访问拒绝                   | 通用       | P1       |
| `/403`                                                          | 403                        | 通用       | P1       |
| `/404`                                                          | 404                        | 通用       | P1       |
| `/500`                                                          | 500                        | 通用       | P1       |
| `/maintenance`                                                  | 维护模式                   | 通用       | P1       |
| `/_prototype/components`                                        | 组件展示                   | Prototype  | internal |
| `/_prototype/scenarios`                                         | 场景展示                   | Prototype  | internal |

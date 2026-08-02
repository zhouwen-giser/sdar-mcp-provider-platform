# PMS 本地运维与配置手册

本手册用于在本仓库的本地开发环境中启动 Provider Management System（PMS，Provider 管理系统）并修改、校验和发布配置。它面向首次接触项目的开发或运维人员。

> 本地示例仅适用于开发环境。示例中的数据库密码和 HTTP 连接不能用于生产环境。

## 1. 先理解三个进程和两条配置路径

| 组件       | 默认地址                | 责任                                | 是否由 `compose.yaml` 启动 |
| ---------- | ----------------------- | ----------------------------------- | -------------------------- |
| Runtime    | `http://127.0.0.1:8080` | MCP 任务执行和 Adapter 协作         | 是                         |
| PMS API    | `http://127.0.0.1:8090` | 配置草稿、发布、审计、Provider 管理 | 否                         |
| PMS Web    | `http://127.0.0.1:5173` | PMS 图形控制台                      | 否                         |
| PostgreSQL | `127.0.0.1:5432`        | Runtime 与 PMS 的持久化存储         | 是                         |

当前 `compose.yaml` 只启动 Runtime、TypeScript Adapter 和 PostgreSQL。它没有启动 PMS API 或 PMS Web。Runtime 当前读取的是 Compose 中的环境变量；PMS 中发布的配置也不会自动改写这个已经运行的 Compose 容器。

这两条路径的用途不同：

1. **修改当前 Compose Runtime**：修改 `compose.yaml` 中 Runtime 的 `environment`，然后重新创建 Runtime 容器。这是最快的本地调试路径。
2. **管理受 PMS 治理的 Runtime**：在 PMS 创建、校验并发布配置修订；受管 Runtime 必须额外配置 PMS Runtime Config Client，才能拉取并确认该修订。这是控制面路径。

不要在浏览器界面中粘贴数据库密码、Token 或私钥。PMS 配置中的敏感字段只接受 `SecretRef`（秘密引用路径）。

## 2. 每次开始前的检查

在仓库根目录执行：

```bash
node --version
pnpm --version
docker compose -f compose.yaml ps
curl --fail http://127.0.0.1:8080/health/ready
```

预期：Node.js 22、pnpm 11，且 Runtime 的健康检查返回 `"status":"ready"`。

若基础开发栈尚未启动：

```bash
docker compose -f compose.yaml up --build --wait
```

常用观察命令：

```bash
docker compose -f compose.yaml ps
docker compose -f compose.yaml logs -f runtime
docker compose -f compose.yaml logs -f postgres
```

停止基础栈但保留数据库数据：

```bash
docker compose -f compose.yaml down
```

不要为了消除日志而随意执行带 `--volumes` 的 `down`；该操作会删除本地数据库数据。

## 3. 修改当前 Compose Runtime 配置

适用场景：你正在调试 Runtime 或 Adapter，希望立即修改端口、Adapter 地址、日志级别、认证模式等。

1. 打开 `compose.yaml`，修改 `runtime.environment` 下的变量。例如开发环境的 Adapter 地址为：

   ```yaml
   ADAPTER_ENDPOINT: adapter-typescript:7001
   ```

2. 对于镜像构建时复制的 TypeScript 代码，修改源文件后需要重建容器：

   ```bash
   docker compose -f compose.yaml up --build --wait
   ```

3. 检查修改是否生效：

   ```bash
   curl --fail http://127.0.0.1:8080/health/ready
   docker compose -f compose.yaml logs --tail=100 runtime
   ```

Runtime 变量的完整说明、范围和生产限制见 [Runtime 配置参考](configuration.md)。例如 `PORT`、`ADAPTER_ENDPOINT`、`ADAPTER_TLS_MODE` 和 `AUTH_MODE` 都会在启动阶段校验；无效值会使 Runtime 无法就绪。

## 4. 准备 PMS API 的本地数据库和凭据文件

PMS API 强制从文件读取数据库连接和凭据描述符，不接受内联密码或 Token。这样做是为了避免秘密出现在环境变量、命令行和日志中。

### 4.1 创建独立的 PMS 数据库

推荐让 PMS 使用独立数据库，避免将本地 Runtime 历史任务与控制面数据混在一起。以下命令只需成功执行一次：

```bash
docker compose -f compose.yaml exec postgres \
  psql -U sdar -d postgres -c 'CREATE DATABASE sdar_pms;'
```

如果出现 `database "sdar_pms" already exists`，表示数据库已经准备好，可以继续。PMS API 在首次启动时会自动执行 `migrations/pms/001` 到 `009`，不需要手动执行 SQL 迁移。

### 4.2 建立本地秘密目录

使用仓库根目录下的 `.local/pms/` 保存本地开发凭据；该目录已被 Git 忽略。目录和文件必须是当前用户拥有的普通文件，不能是符号链接，且权限不能向组或其他用户开放写入。

```bash
mkdir -p .local/pms
chmod 700 .local .local/pms
```

在编辑器中创建下列文件，并将 `<仓库绝对路径>` 替换为执行 `pwd` 所显示的路径。

| 文件                                | 内容                                             | 权限   |
| ----------------------------------- | ------------------------------------------------ | ------ |
| `.local/pms/database-url`           | `postgresql://sdar:sdar@127.0.0.1:5432/sdar_pms` | `0600` |
| `.local/pms/management-admin.token` | 一段仅用于本地的随机、非空、无空白字符 Token     | `0600` |
| `.local/pms/management.json`        | 下方的管理凭据描述符                             | `0600` |
| `.local/pms/runtime.json`           | 下方的 Runtime 凭据描述符                        | `0600` |

`management.json`：

```json
{
  "management": {
    "reader": [],
    "administrator": [
      {
        "subjectId": "local-admin",
        "tokenFile": "<仓库绝对路径>/.local/pms/management-admin.token"
      }
    ]
  }
}
```

`runtime.json`：

```json
{
  "runtimeConfig": [],
  "runtimeRegistration": []
}
```

然后限制文件权限：

```bash
chmod 600 .local/pms/*
```

`runtime.json` 中的空数组足以让 PMS Web 管理草稿。本地 Runtime 要接入 PMS 配置拉取或注册时，再按第 8 节增加对应身份和 Token；不要复用管理 Token。

## 5. 启动并验证 PMS API

在**另一个终端**中，从仓库根目录启动 PMS API。不要设置 `DATABASE_URL`、`PMS_DATABASE_URL`、`PMS_ADMIN_TOKEN` 或其他内联秘密环境变量，否则 API 会明确拒绝启动。

```bash
PMS_DATABASE_URL_FILE="$PWD/.local/pms/database-url" \
PMS_MANAGEMENT_CREDENTIAL_FILE="$PWD/.local/pms/management.json" \
PMS_RUNTIME_CREDENTIAL_FILE="$PWD/.local/pms/runtime.json" \
pnpm dev:pms-api
```

默认仅监听本机 `127.0.0.1:8090`。需要调整时可追加 `PMS_API_HOST`、`PMS_API_PORT` 和 `PMS_API_RUNTIME_HEARTBEAT_TTL_MS`；不要把 API 暴露到不受保护的网络。

新开终端验证：

```bash
curl --fail http://127.0.0.1:8090/health/live
curl --fail http://127.0.0.1:8090/health/ready
curl --fail http://127.0.0.1:8090/api/v1
```

`/health/live` 只表示进程存在，`/health/ready` 还会检查 PostgreSQL。`/api/v1/openapi.json` 提供 API 机器可读契约。

## 6. 启动 PMS Web 并登录本地控制台

在第三个终端执行：

```bash
pnpm dev:pms-web
```

浏览器打开：<http://127.0.0.1:5173/configuration>

PMS Web 将同源的 `/api/*` 转发到 `http://127.0.0.1:8090`。如 PMS API 不在默认地址，启动 Web 前指定：

```bash
PMS_WEB_API_ORIGIN=http://127.0.0.1:8090 pnpm dev:pms-web
```

### 6.1 设置本地管理身份

当前 Web 是无登录页的开发控制台；它从浏览器 `sessionStorage` 读取认证信息。打开浏览器开发者工具的 Console，执行以下两行（将占位符替换为 `management-admin.token` 的实际内容）：

```js
sessionStorage.setItem("pms.management.authorization", "Bearer <本地管理Token>");
sessionStorage.setItem("pms.management.actorId", "local-admin");
```

然后刷新页面。`actorId` 必须与 `management.json` 中的 `subjectId` 完全一致；写请求同时需要 `Authorization: Bearer …` 和 `x-actor-id`，否则 API 返回 `MANAGEMENT_AUTHORIZATION_DENIED`。

关闭该浏览器标签页或清除站点数据后，需要重新设置上述两个值。不要在共享浏览器配置生产 Token。

## 7. 在界面中创建、校验和发布 Runtime Bootstrap 配置

配置入口为左侧 **Configuration**，即 `/configuration`。当前界面提供的是 `runtime.bootstrap` 配置定义，目标类型固定为 `runtime_deployment`，数据标识固定为 `runtime`。

### 7.1 创建草稿

在页面填写：

| 字段                   | 本地示例                                     | 说明                                                    |
| ---------------------- | -------------------------------------------- | ------------------------------------------------------- |
| Draft ID               | `local-runtime-bootstrap-01`                 | 本次草稿的唯一标识；建议每次修改递增编号                |
| Deployment ID          | `local-runtime-01`                           | 计划受管 Runtime 的部署标识，不是 Docker 容器名         |
| Environment            | `development`                                | 与受管 Runtime 的 `RUNTIME_ENV` 一致                    |
| Runtime environment    | `development`                                | 开发安全配置                                            |
| Listen host / port     | `0.0.0.0` / `8080`                           | 监听地址和端口，发布后需要重启受管 Runtime              |
| Database URL SecretRef | 例如 `file/v1/local-runtime-01/database-url` | 秘密引用，不是数据库 URL 本文                           |
| Adapter endpoint       | `adapter-typescript:7001`                    | 容器内网络使用服务名；主机进程通常使用 `127.0.0.1:7001` |
| Adapter key SecretRef  | 留空或填写秘密引用                           | 本地禁用 TLS 时留空                                     |
| Adapter RPC timeout    | `5000`                                       | 毫秒，必须为整数                                        |

点击 **Save Draft** 后 URL 会变成 `/configuration?draftId=<草稿ID>`。草稿仅保存在 PMS API 当前进程内：**在发布前重启 PMS API 会丢失草稿**，而已发布的配置修订会保存在 PostgreSQL 中。

### 7.2 校验与发布

1. 点击 **Validate**。
2. 阅读 `Draft → effective diff`，确认值来源、默认值和 `restart_required` 标记。
3. 若出现校验问题，先修正草稿；不要通过发布绕过错误。
4. 第一次发布时，`Current published revision` 留空；同一目标后续发布时填写当前已发布的修订号。这是乐观并发保护，避免覆盖其他操作者的变更。
5. 点击 **Publish** 并确认。成功发布会生成不可变的修订和审计事件。

Bootstrap 字段大多是 `restart_required`，因此发布本身不会重启 Runtime。应先安排重启窗口，再由受管部署机制或运维人员重启相应 Runtime，并用健康检查验证。当前 Compose Runtime 不会自动消费此发布结果。

## 8. 让受管 Runtime 拉取 PMS 配置（高级，本地验证）

Runtime 的内置配置客户端目前拉取的是 `runtime.observability` / `main`，用于热更新 `OTEL_ENABLED`；它**不拉取**第 7 节界面创建的 `runtime.bootstrap` / `runtime` 配置。Bootstrap 配置通常由部署/进程管理流程在重启时注入。

若要测试 Runtime 配置客户端，需同时完成以下工作：

1. 在 `runtime.json` 加入与 Runtime 完全绑定的 `runtimeConfig` 身份：`providerId`、`deploymentId`、`instanceId`、`environment`、`runtimeVersion`、Token 文件和三个 `runtime:config:*` scopes 都必须匹配。协议版本必须是 `2026-07-28`。
2. 为 Runtime 增加 `PMS_RUNTIME_CONFIG_URL`、`PMS_RUNTIME_CONFIG_TOKEN_FILE`、`PMS_RUNTIME_CONFIG_CACHE_PATH`、`PMS_DEPLOYMENT_ID` 和 `PMS_INSTANCE_ID`。生产环境的 PMS URL 必须是 HTTPS。
3. 通过 PMS API 创建并发布 `definitionId: "runtime.observability"`、`configGroup: "runtime.observability"`、`dataId: "main"` 的草稿；当前 Web 页面尚未提供该配置定义的编辑器，应使用 API 契约。
4. 观察 Runtime 日志和 PMS Runtime 页面中的配置 ACK（确认状态）。

Runtime 注册同理需要独立的 `runtimeRegistration` 身份、独立 Token、`PMS_RUNTIME_REGISTRATION_URL` 和 `PMS_RUNTIME_REGISTRATION_TOKEN_FILE`。详细安全要求参见 [PMS API 配置](PMS_API_CONFIGURATION.md) 与 [Runtime 配置参考](configuration.md)。

## 9. 通过 API 修改已有草稿

Web 当前可以创建、校验和发布 Bootstrap 草稿，但没有“编辑已存在草稿”的表单。需要修改同一草稿时，使用 `PATCH /api/v1/config-drafts/:draftId`。

先在终端中读取 Token 到非导出的临时变量；不要把该变量命名为 `PMS_ADMIN_TOKEN`，也不要在启动 PMS API 的环境中导出它：

```bash
read -r -s -p 'PMS admin token: ' pms_admin_token
printf '\n'
```

以下示例将已有草稿 `local-runtime-bootstrap-01` 的 Adapter 超时改为 8 秒。`expectedVersion` 必须是该草稿当前的 `version`；每次 PATCH 和 Validate 都会使版本号递增。

```bash
curl --fail --silent --show-error \
  -X PATCH 'http://127.0.0.1:8090/api/v1/config-drafts/local-runtime-bootstrap-01' \
  -H "authorization: Bearer $pms_admin_token" \
  -H 'x-actor-id: local-admin' \
  -H 'x-correlation-id: local-bootstrap-edit-01' \
  -H 'content-type: application/json' \
  --data '{
    "expectedVersion": 2,
    "content": {
      "RUNTIME_ENV": "development",
      "HOST": "0.0.0.0",
      "PORT": 8080,
      "ADAPTER_ENDPOINT": "adapter-typescript:7001",
      "ADAPTER_RPC_TIMEOUT_MS": 8000
    }
  }'
```

然后重新执行 Validate，再用返回的最新 `version` 调用 Publish。第一次发布的 `expectedPublishedRevision` 为 `null`；更新已有已发布配置时，它必须是当前修订号。操作完成后清除终端变量：

```bash
unset pms_admin_token
```

完整请求体和错误码以 <http://127.0.0.1:8090/api/v1/openapi.json> 为准。

## 10. 发布、回滚与审计原则

| 操作            | 影响                        | 必做检查                                    |
| --------------- | --------------------------- | ------------------------------------------- |
| Save Draft      | 仅当前 PMS API 进程内草稿   | 检查目标、环境和秘密引用                    |
| Validate        | 不修改 Runtime              | 检查 diff、校验错误和 apply mode            |
| Publish         | PostgreSQL 中新增不可变修订 | 确认当前发布修订号、actor、重启计划         |
| Restart Runtime | 使 bootstrap 类修改生效     | `/health/ready`、Runtime 日志、Adapter 就绪 |
| Rollback        | 发布一个指向旧内容的新修订  | 确认回滚源属于同一目标，并同样执行重启/验证 |

所有配置发布与回滚都会写入审计事件。通过 PMS Web 的 **Audit** 页面按 actor、subject 或 correlation ID 查询；也可以调用 `GET /api/v1/audit-events`。审计记录不会包含 Token、数据库 URL 或配置正文。

## 11. 常见问题排查

| 现象                                            | 常见原因                                 | 处理方式                                                      |
| ----------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| `PMS_API_INLINE_SECRET_REJECTED`                | 将密码或 Token 放进环境变量              | 移除内联秘密，改用第 4 节的文件路径变量                       |
| `PMS_API_CREDENTIAL_PATH_NOT_ABSOLUTE`          | 描述符中使用相对 `tokenFile`             | 用 `pwd` 得到仓库绝对路径并更新 JSON                          |
| `PMS_API_CREDENTIAL_PATH_PERMISSIONS_VIOLATION` | 目录或文件权限过宽                       | `chmod 700 .local .local/pms` 与 `chmod 600 .local/pms/*`     |
| Web 显示 `PMS_WEB_ACTOR_REQUIRED`               | 未写入 `sessionStorage` actor ID         | 执行第 6.1 节两行浏览器 Console 命令后刷新                    |
| HTTP 401/403                                    | Token 无效、actor 不匹配或角色不足       | 检查 `management.json` 的 `subjectId`、Token 文件和管理员角色 |
| PMS API `ready` 为 unavailable                  | `sdar_pms` 不存在或 PostgreSQL 未启动    | 先检查 Compose PostgreSQL，再创建数据库                       |
| Publish 返回并发冲突                            | 发布修订号或草稿版本过期                 | 刷新当前状态，使用最新 `version` 和 published revision 重试   |
| 发布后 Runtime 未变化                           | 当前 Compose Runtime 不消费 PMS 发布配置 | 按第 3 节修改 Compose，或按第 8 节接入 Runtime Config Client  |
| Runtime 日志反复出现旧任务恢复错误              | PostgreSQL 卷中保留了历史测试数据        | 先保留数据并定位任务；只有确认不需要时才由负责人清理卷        |

## 12. 交接检查清单

在把环境交给其他人前，确认：

- [ ] `docker compose -f compose.yaml ps` 中 PostgreSQL、Adapter、Runtime 状态正常。
- [ ] Runtime 与 PMS API 的 `/health/ready` 都返回成功。
- [ ] PMS Web 可打开 `/configuration`，且本地管理身份已设置。
- [ ] 草稿已 Validate，发布修订和对应审计事件可查。
- [ ] 任何 `restart_required` 修改都有已完成的 Runtime 重启和健康检查记录。
- [ ] `.local/`、Token 文件、数据库 URL 未被提交、复制到工单或写入日志。

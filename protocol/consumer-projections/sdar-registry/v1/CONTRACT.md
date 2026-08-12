# SMPP → SDAR Registry consumer projection v1

本目录是 SMPP 对 SDAR consumer projection 的权威、可离线验证合同。它只从原生
`RegistrySnapshotRepository.latest(environment)` 读取 LKG；不新增第二张 authority 表，
不改变原生 Registry DTO、repository、routes 或 migration。

## HTTP surface

```text
GET /api/v1/registry/{environment}/consumers/sdar/v1/sources/{smppSourceId}/latest
GET /api/v1/registry/{environment}/consumers/sdar/v1/sources/{smppSourceId}/bootstrap
GET /api/v1/registry/{environment}/consumers/sdar/v1/sources/{smppSourceId}/watch
```

三条路由复用 PMS management Bearer authentication。`environment` 必须匹配
`^[a-z][a-z0-9-]{0,62}$`，`smppSourceId` 必须匹配
`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`。错误响应不得回显 path、endpoint、credential、
native document 或异常原文。

## 严格 DTO

顶层字段仅允许：

```text
revision checksum generatedAt expiresAt providers
```

每个 provider 仅允许：

```text
externalProviderId externalServerId serverEndpoint catalogRevision labels
```

`labels` 仅允许 `environment` 与 `protocolMode`。`catalogRevision` 是十进制字符串。
原生 `tools`、`displayName`、Task 事实、Home Assistant Entity ID、credential 和 secret
均不得进入 projection。

映射规则：

| Native Registry          | SDAR projection                         |
| ------------------------ | --------------------------------------- |
| `revision`               | `revision`                              |
| `publishedAt`            | `generatedAt`                           |
| `providerId`             | `externalProviderId`                    |
| `serverId`               | `externalServerId`                      |
| `effectiveEndpoint`      | `serverEndpoint`，按下述 URL 规则规范化 |
| `catalogRevision` number | `catalogRevision` string                |
| snapshot `environment`   | `labels.environment`                    |
| `protocolMode`           | `labels.protocolMode`                   |

## TTL 与 checksum

`SDAR_REGISTRY_PROJECTION_TTL_SECONDS` 默认值为 `2592000`，必须是正 safe integer。
`generatedAt` 必须等于 native `publishedAt`；`expiresAt` 必须由
`generatedAt + TTL` 固定推导。请求时间不得参与 projection。

Projection checksum 不复用 native checksum。输入精确为：

```json
{
  "smppSourceId": "home-lab-smpp",
  "revision": 4,
  "generatedAt": "2026-08-04T00:00:00.000Z",
  "expiresAt": "2026-09-03T00:00:00.000Z",
  "candidates": []
}
```

算法与 SDAR commit `a9957c82c17ca01e77528f3817c03d86224aaf88` 的
`hashConfigurationRequest` / `computeSmppSnapshotChecksum` 字节兼容：对象 key 以
`localeCompare` 排序，数组保持既定顺序，再对 UTF-8 canonical JSON 做 SHA-256 hex。
候选先按 `smppSourceId::externalProviderId::externalServerId` 排序，labels 通过对象 key
canonicalization 排序。重复复合身份必须拒绝。

URL 规范与 SDAR `safeHttpUrl` 相同：必须为绝对 `http:` 或 `https:` URL；禁止
username/password；清除 fragment；调用 `URL.toString()` 后移除一个末尾 `/`。
query string 保留。credential-bearing endpoint 必须 fail closed。

## Cache、bootstrap 与 watch

`latest` 与存在 LKG 时的 `bootstrap` 返回同一 DTO：

```text
ETag: "<projection-checksum>"
X-SMPP-Native-Revision: <native-revision>
X-SMPP-Native-Checksum: <native-checksum>
X-SMPP-Projection-Contract: sdar-registry-v1
```

匹配 `If-None-Match` 时返回 HTTP 304。无 native LKG 的 `bootstrap` 与 `latest` 返回
HTTP 404 / `SDAR_REGISTRY_PROJECTION_NOT_FOUND`；绝不合成 revision 0。

`watch` 是 hint-only SSE；每个 hint 仅含：

```text
event: revision
id: <projection-checksum>
data: {"environment":"...","smppSourceId":"...","revision":4,"checksum":"..."}
```

Consumer 收到 hint 后必须重新获取 `latest`。Watch 不携带 provider、tool、Entity ID、
Task 或 secret。

## Frozen assets

`projection.schema.json` 冻结 strict DTO；`error-catalog.json` 冻结公开错误；
`checksum-vectors.json` 冻结 canonical checksum/拒绝向量；`SOURCE_LOCK.json` 锁定
SDAR 算法与 native Registry baseline；`MANIFEST.json` 锁定本目录其余资产原始字节。
合同变更必须发布新版本目录，不得就地放宽 v1。

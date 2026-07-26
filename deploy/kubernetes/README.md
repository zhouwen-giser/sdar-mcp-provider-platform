# Kubernetes deployment

These JSON documents are valid Kubernetes manifests and intentionally leave the
PostgreSQL and resource Adapter deployments to their owning teams. Before use,
replace every `replace-*` value, create `sdar-adapter-mtls` with `ca.pem`,
`tls.crt`, and `tls.key`, and create `sdar-runtime-secrets` through the cluster's
secret manager. `secret.example.json` is a shape example and must not be applied
unchanged.

Telemetry remains disabled in the ConfigMap by default. Before enabling it, create
`sdar-otel-headers` from `otel-headers-secret.example.json` and `sdar-otel-mtls` from
`otel-tls-secret.example.json` through the cluster secret manager. The Deployment mounts them as
files at the paths named by the ConfigMap; collector credentials must not be copied into the
ConfigMap or ordinary environment variables.

Apply the namespace and service account first, then configuration/secrets, and
finally the Deployment, Service, PodDisruptionBudget and NetworkPolicy. The
Deployment runs two non-root replicas; PostgreSQL advisory locks and row claims
coordinate scheduler/recovery work across them.

```bash
pnpm deployment:check
kubectl apply -f deploy/kubernetes/namespace.json
kubectl apply -f deploy/kubernetes/service-account.json
kubectl apply -f deploy/kubernetes/config-map.json
kubectl apply -f deploy/kubernetes/deployment.json
kubectl apply -f deploy/kubernetes/service.json
kubectl apply -f deploy/kubernetes/pod-disruption-budget.json
kubectl apply -f deploy/kubernetes/network-policy.json
kubectl -n sdar-system rollout status deployment/sdar-runtime
```

## 启用 Provider 遥测入口

默认清单只对外提供 `8080` HTTP 端口；`7002` Provider 遥测 gRPC 端口不会自动暴露。启用 `PROVIDER_TELEMETRY_INGRESS_ENABLED=true`（启用 Provider 遥测入口）时，必须同时完成以下部署输入：

1. 在 Deployment 的 `containerPorts` 增加名为 `provider-telemetry`（Provider 遥测）的 `7002` 端口。
2. 在 Service 增加 `port: 7002`、`targetPort: provider-telemetry` 的端口映射。
3. 在 NetworkPolicy 增加只允许指定 Provider 命名空间或 Pod 访问 TCP `7002` 的入站规则；不得向所有来源开放。
4. 通过 Secret 挂载入口 CA、服务端证书和私钥，并设置 `PROVIDER_TELEMETRY_TLS_MODE=required`（强制双向 TLS）。

Service 输入片段示例：

```json
{
  "name": "provider-telemetry",
  "protocol": "TCP",
  "port": 7002,
  "targetPort": "provider-telemetry"
}
```

NetworkPolicy 端口片段示例：

```json
{
  "protocol": "TCP",
  "port": 7002
}
```

部署后的预期输出是：获准的 Provider 可访问 `<service-name>:7002` 并调用 `EmitProviderEvents`（批量提交 Provider 事件）；未获准来源由 NetworkPolicy 拒绝，证书 `CN`（通用名称）与 Provider 标识符不一致的客户端由 Runtime 拒绝。应用层请求和响应样例见 [Provider 遥测入口](../../docs/protocol/provider-telemetry-ingress.md)。

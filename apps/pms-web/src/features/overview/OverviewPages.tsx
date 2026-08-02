import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  DataTable,
  FilterBar,
  MetricCard,
  QuerySurface,
  StatusBadge,
  Button,
  EmptyState,
} from "../../components/ui.js";
import {
  useAuditEvents,
  useConfigurationDrafts,
  useDeployments,
  useProviders,
  useRegistryLatest,
  useResources,
  useProcesses,
} from "../../queries/hooks.js";
import { useClientWorkspace, useClientWorkspaceStore } from "../../client-workspace/context.js";
import { navigate } from "../../app/navigation.js";
import { ProductPage, LocalWorkspaceHeader } from "../shared/product-components.js";

export function DashboardPage() {
  const providers = useProviders();
  const deployments = useDeployments();
  const drafts = useConfigurationDrafts();
  const registry = useRegistryLatest("production");
  const audit = useAuditEvents();
  const workspace = useClientWorkspace();
  const pending =
    workspace.jobs.filter((job) => job.status === "FAILED" || job.status === "PENDING").length +
    workspace.incidents.filter((item) => item.status !== "CLOSED").length;
  return (
    <ProductPage
      title="工作台"
      description="由 Provider、Runtime、Configuration、Registry 与 Audit 查询在前端组合的控制面总览。"
      classification="WEB_COMPOSED"
      actions={
        <Button variant="primary" onClick={() => navigate("/providers/new")}>
          接入 Provider
        </Button>
      }
    >
      <div className="metrics-row">
        <MetricCard
          label="Providers"
          value={providers.data?.length ?? "—"}
          hint={`${providers.data?.filter((item) => item.status === "active").length ?? 0} active`}
        />
        <MetricCard
          label="Runtime Deployments"
          value={deployments.data?.length ?? "—"}
          hint={`${deployments.data?.filter((item) => item.converged).length ?? 0} converged`}
        />
        <MetricCard
          label="Configuration Drafts"
          value={drafts.data?.length ?? "—"}
          hint={`${drafts.data?.filter((item) => item.status === "invalid").length ?? 0} invalid`}
        />
        <MetricCard
          label="Registry Revision"
          value={registry.data?.revision ?? "—"}
          hint={`${registry.data?.toolCount ?? 0} tools`}
        />
        <MetricCard label="待处理" value={pending} hint="Client workspace + frozen queries" />
      </div>
      <div className="grid-two">
        <section className="panel">
          <h2>运行态摘要</h2>
          <QuerySurface query={deployments}>
            {(items) => (
              <DataTable
                columns={["Deployment", "Provider", "Desired", "Status", "Revision"]}
                rows={items.slice(0, 5).map((item) => [
                  <button
                    className="table-link"
                    onClick={() =>
                      navigate(`/runtime/deployments/${item.providerId}/${item.deploymentId}`)
                    }
                  >
                    {item.deploymentId}
                  </button>,
                  item.providerId,
                  `${item.desiredState}/${item.desiredReplicas}`,
                  <StatusBadge status={item.status} />,
                  `${item.observedRevision}/${item.desiredRevision}`,
                ])}
              />
            )}
          </QuerySurface>
        </section>
        <section className="panel">
          <h2>最近 Audit</h2>
          <QuerySurface query={audit}>
            {(items) => (
              <DataTable
                columns={["Action", "Subject", "Actor", "Time"]}
                rows={items
                  .slice(0, 5)
                  .map((item) => [
                    item.action,
                    `${item.subjectType}/${item.subjectId}`,
                    item.actorId,
                    item.occurredAt,
                  ])}
              />
            )}
          </QuerySurface>
        </section>
      </div>
      <section className="panel">
        <h2>快速入口</h2>
        <div className="quick-actions">
          <Button onClick={() => navigate("/runtime/deployments/new")}>创建 Deployment</Button>
          <Button onClick={() => navigate("/configuration/new")}>创建配置 Draft</Button>
          <Button onClick={() => navigate("/registry/compare")}>Registry Diff</Button>
          <Button onClick={() => navigate("/operations/health")}>系统健康</Button>
        </div>
      </section>
    </ProductPage>
  );
}

export function AttentionPage() {
  const providers = useProviders();
  const deployments = useDeployments();
  const drafts = useConfigurationDrafts();
  const workspace = useClientWorkspace();
  const rows = [
    ...(providers.data ?? [])
      .filter((item) => item.status === "degraded" || item.status === "disabled")
      .map((item) => [
        "Provider",
        item.providerId,
        item.status,
        "检查 Adapter 与 Resource 绑定",
        `/providers/${item.providerId}`,
      ]),
    ...(deployments.data ?? [])
      .filter((item) => !item.converged || ["FAILED", "DEGRADED"].includes(item.status))
      .map((item) => [
        "Runtime",
        item.deploymentId,
        item.status,
        "执行 reconcile 并检查 RuntimeProcess",
        `/runtime/deployments/${item.providerId}/${item.deploymentId}/reconciliation`,
      ]),
    ...(drafts.data ?? [])
      .filter((item) => item.status === "invalid")
      .map((item) => [
        "Configuration",
        item.draftId,
        item.status,
        "修复 Validation Issues",
        `/configuration/${item.draftId}/edit`,
      ]),
    ...workspace.jobs
      .filter((item) => item.status === "FAILED")
      .map((item) => [
        "Worker Job",
        item.jobId,
        item.status,
        item.error ?? "检查失败摘要",
        `/operations/jobs/${item.jobId}`,
      ]),
    ...workspace.incidents
      .filter((item) => item.status !== "CLOSED")
      .map((item) => [
        "Incident",
        item.incidentId,
        item.severity,
        "进入本地运维工作区",
        `/operations/incidents/${item.incidentId}`,
      ]),
  ];
  return (
    <ProductPage
      title="待处理中心"
      description="跨领域查询的前端 Attention Read Model；建议项不是新的后端状态。"
      classification="WEB_COMPOSED"
    >
      <section className="panel">
        <DataTable
          columns={["类型", "对象", "状态", "建议操作", "入口"]}
          rows={rows.map((row) => [
            row[0],
            row[1],
            <StatusBadge status={String(row[2])} />,
            row[3],
            <Button variant="ghost" onClick={() => navigate(String(row[4]))}>
              处理
            </Button>,
          ])}
          emptyTitle="当前没有待处理项"
        />
      </section>
    </ProductPage>
  );
}

export function NotificationsPage() {
  const snapshot = useClientWorkspace();
  const store = useClientWorkspaceStore();
  const [filter, setFilter] = useState("all");
  const items = snapshot.notifications.filter(
    (item) => filter === "all" || (filter === "unread" ? !item.read : item.category === filter),
  );
  return (
    <>
      <LocalWorkspaceHeader
        title="通知中心"
        description="通知为浏览器本地聚合，不创建 Notification API。"
        actions={
          <>
            <Button onClick={() => store.markAllNotifications()}>全部已读</Button>
            <Button variant="danger" onClick={() => store.clearNotifications()}>
              清空本地通知
            </Button>
          </>
        }
      />
      <FilterBar>
        <select value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">全部</option>
          <option value="unread">未读</option>
          <option value="runtime">Runtime</option>
          <option value="configuration">Configuration</option>
          <option value="registry">Registry</option>
        </select>
      </FilterBar>
      <section className="panel">
        <DataTable
          columns={["状态", "分类", "标题", "对象", "时间", "操作"]}
          rows={items.map((item) => [
            item.read ? "已读" : <StatusBadge status="UNREAD" />,
            item.category,
            item.title,
            item.subjectId,
            item.createdAt,
            <Button variant="ghost" onClick={() => store.markNotification(item.id, !item.read)}>
              {item.read ? "标记未读" : "标记已读"}
            </Button>,
          ])}
        />
      </section>
    </>
  );
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [value, setValue] = useState(q);
  const providers = useProviders();
  const resources = useResources();
  const deployments = useDeployments();
  const processes = useProcesses();
  const audit = useAuditEvents();
  const results = useMemo(() => {
    const needle = q.toLowerCase().trim();
    if (needle.length === 0) return [];
    return [
      ...(providers.data ?? []).map((item) => ({
        type: "Provider",
        id: item.providerId,
        summary: `${item.providerTypeId} ${item.status}`,
        path: `/providers/${item.providerId}`,
      })),
      ...(resources.data ?? []).map((item) => ({
        type: "Resource",
        id: item.resourceId,
        summary: `${item.resourceType} ${item.status}`,
        path: `/resources/${item.environment}/${item.resourceId}`,
      })),
      ...(deployments.data ?? []).map((item) => ({
        type: "RuntimeDeployment",
        id: item.deploymentId,
        summary: `${item.providerId} ${item.status}`,
        path: `/runtime/deployments/${item.providerId}/${item.deploymentId}`,
      })),
      ...(processes.data ?? []).map((item) => ({
        type: "RuntimeProcess",
        id: item.instanceId,
        summary: `${item.deploymentId} ${item.observedHealth}`,
        path: `/runtime/processes/${item.providerId}/${item.instanceId}`,
      })),
      ...(audit.data ?? []).map((item) => ({
        type: "Audit",
        id: item.auditEventId,
        summary: `${item.action} ${item.subjectId}`,
        path: `/audit/${item.auditEventId}`,
      })),
    ].filter((item) => `${item.type} ${item.id} ${item.summary}`.toLowerCase().includes(needle));
  }, [audit.data, deployments.data, processes.data, providers.data, q, resources.data]);
  return (
    <ProductPage
      title="全局搜索"
      description="并行调用冻结查询后在浏览器中合并结果；不创建 Search API。"
      classification="WEB_COMPOSED"
    >
      <form
        className="search-page-form"
        onSubmit={(event) => {
          event.preventDefault();
          setParams(value.length ? { q: value } : {});
        }}
      >
        <input
          aria-label="搜索关键字"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="输入 ID、类型、状态或 Audit action"
        />
        <Button variant="primary" type="submit">
          搜索
        </Button>
      </form>
      {q.length === 0 ? (
        <EmptyState
          title="输入关键字开始搜索"
          description="支持 Provider、Resource、RuntimeDeployment、RuntimeProcess 和 Audit。"
        />
      ) : (
        <section className="panel">
          <DataTable
            columns={["类型", "对象", "摘要", "入口"]}
            rows={results.map((item) => [
              item.type,
              item.id,
              item.summary,
              <Button variant="ghost" onClick={() => navigate(item.path)}>
                打开
              </Button>,
            ])}
            emptyTitle="没有匹配结果"
          />
        </section>
      )}
    </ProductPage>
  );
}

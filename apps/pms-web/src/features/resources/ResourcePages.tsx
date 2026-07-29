import { useCallback, useMemo, useState } from "react";
import { useDataQuery, usePmsWebDataSource } from "../../data/context.js";
import { navigate } from "../../router.js";
import {
  CodeOrJsonViewer,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  Skeleton,
  StatusBadge,
} from "../../components/ui.js";

export function ResourcesPage() {
  const query = useCallback(
    (source: ReturnType<typeof usePmsWebDataSource>) => source.resources(),
    [],
  );
  const state = useDataQuery(query);
  const params = new URLSearchParams(window.location.search);
  const [search, setSearch] = useState("");
  const [environment, setEnvironment] = useState(params.get("environment") ?? "all");
  const providerId = params.get("providerId");
  const filtered = useMemo(
    () =>
      state.status === "success"
        ? state.data.filter(
            (resource) =>
              (providerId === null || resource.providerId === providerId) &&
              (environment === "all" || resource.environment === environment) &&
              `${resource.name} ${resource.resourceId} ${resource.kind}`
                .toLowerCase()
                .includes(search.toLowerCase()),
          )
        : [],
    [environment, providerId, search, state],
  );
  return (
    <>
      <PageHeader
        title="Resources"
        description="Provider 报告的观测摘要；不代表 PMS 对设备进行直接控制。"
      />
      <FilterBar>
        <input
          aria-label="搜索 Resource"
          value={search}
          placeholder="名称 / ID / 类型"
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          value={environment}
          onChange={(event) => {
            setEnvironment(event.target.value);
            const next = new URLSearchParams(window.location.search);
            if (event.target.value === "all") next.delete("environment");
            else next.set("environment", event.target.value);
            window.history.replaceState({}, "", `${window.location.pathname}?${next.toString()}`);
          }}
        >
          <option value="all">全部环境</option>
          <option value="production-mock">production-mock</option>
          <option value="staging-mock">staging-mock</option>
        </select>
        {providerId === null ? null : <code>Provider: {providerId}</code>}
      </FilterBar>
      {state.status === "loading" ? (
        <Skeleton lines={7} />
      ) : state.status === "error" ? (
        <ErrorState
          code={state.error.message}
          impact="Resource 观测摘要不可用。"
          action="切换 healthy 场景"
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="没有 Resource 观测" description="调整环境或等待模拟发现。" />
      ) : (
        <DataTable
          columns={["Resource", "Provider", "类型", "状态", "Capabilities", "观测时间"]}
          rows={filtered.map((resource) => [
            <button
              className="table-link"
              onClick={() => navigate(`/resources/${resource.resourceId}`)}
            >
              {resource.name}
              <code>{resource.resourceId}</code>
            </button>,
            <button
              className="table-link"
              onClick={() => navigate(`/providers/${resource.providerId}`)}
            >
              {resource.providerId}
            </button>,
            resource.kind,
            <StatusBadge status={resource.status} />,
            resource.capabilities.join(", "),
            resource.observedAt,
          ])}
        />
      )}
    </>
  );
}

export function ResourceDetailPage({ resourceId }: { readonly resourceId: string }) {
  const query = useCallback(
    (source: ReturnType<typeof usePmsWebDataSource>) =>
      source
        .resources()
        .then((resources) => resources.find((item) => item.resourceId === resourceId)),
    [resourceId],
  );
  const state = useDataQuery(query);
  if (state.status === "loading") return <Skeleton />;
  if (state.status === "error") {
    return (
      <ErrorState code={state.error.message} impact="Resource 摘要不可用。" action="返回列表" />
    );
  }
  if (state.data === undefined) {
    return <EmptyState title="Resource 不存在" description={`未找到 ${resourceId}。`} />;
  }
  const resource = state.data;
  return (
    <>
      <PageHeader
        title={resource.name}
        description="Provider 上报的只读观测摘要"
        actions={<StatusBadge status={resource.status} />}
      />
      <div className="grid-two">
        <section className="panel">
          <h2>观测信息</h2>
          <CodeOrJsonViewer value={resource} />
        </section>
        <section className="panel">
          <h2>数据边界</h2>
          <p>此页面不编辑 Runtime Task，不提供设备命令，也不显示 Secret。</p>
          <button
            className="table-link"
            onClick={() => navigate(`/providers/${resource.providerId}`)}
          >
            返回 Provider {resource.providerId}
          </button>
        </section>
      </div>
    </>
  );
}

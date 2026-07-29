import { useCallback, useMemo, useState } from "react";
import { useDataQuery, usePmsWebDataSource } from "../../data/context.js";
import type { ProviderSummary } from "../../data/types.js";
import { navigate } from "../../router.js";
import {
  Button,
  CodeOrJsonViewer,
  DataTable,
  DetailDrawer,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  Skeleton,
  StatusBadge,
} from "../../components/ui.js";

const providerTabs = [
  "概览",
  "Resources",
  "Runtime",
  "Configuration",
  "Catalog",
  "Events",
  "Audit",
] as const;

export function ProvidersPage() {
  const query = useCallback(
    (source: ReturnType<typeof usePmsWebDataSource>) => source.providers(),
    [],
  );
  const state = useDataQuery(query);
  const initial = new URLSearchParams(window.location.search);
  const [search, setSearch] = useState(initial.get("q") ?? "");
  const [status, setStatus] = useState(initial.get("status") ?? "all");
  const [sort, setSort] = useState(initial.get("sort") ?? "name");
  const [showObserved, setShowObserved] = useState(true);
  const [selected, setSelected] = useState<ProviderSummary>();
  const filtered = useMemo(() => {
    if (state.status !== "success") return [];
    return [...state.data]
      .filter(
        (provider) =>
          (status === "all" || provider.status === status) &&
          `${provider.name} ${provider.providerId} ${provider.type}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      )
      .sort((left, right) =>
        sort === "status"
          ? left.status.localeCompare(right.status)
          : left.name.localeCompare(right.name, "zh-CN"),
      );
  }, [search, sort, state, status]);

  const syncFilters = (next: { q?: string; status?: string; sort?: string }) => {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === "" || value === "all") params.delete(key);
      else params.set(key, value);
    }
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  };

  return (
    <>
      <PageHeader
        title="Providers"
        description="管理 Provider 身份、连接状态和关联的 Runtime/Resource 摘要。"
        actions={
          <Button variant="primary" onClick={() => navigate("/providers/new")}>
            接入 Provider
          </Button>
        }
      />
      <FilterBar>
        <input
          aria-label="搜索 Provider"
          value={search}
          placeholder="名称 / ID / 类型"
          onChange={(event) => {
            setSearch(event.target.value);
            syncFilters({ q: event.target.value });
          }}
        />
        <select
          aria-label="Provider 状态"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            syncFilters({ status: event.target.value });
          }}
        >
          <option value="all">全部状态</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="DEGRADED">DEGRADED</option>
          <option value="BLOCKED">BLOCKED</option>
          <option value="PENDING">PENDING</option>
        </select>
        <select
          aria-label="Provider 排序"
          value={sort}
          onChange={(event) => {
            setSort(event.target.value);
            syncFilters({ sort: event.target.value });
          }}
        >
          <option value="name">按名称</option>
          <option value="status">按状态</option>
        </select>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={showObserved}
            onChange={(event) => setShowObserved(event.target.checked)}
          />
          显示观测时间
        </label>
      </FilterBar>
      {state.status === "loading" ? (
        <Skeleton lines={7} />
      ) : state.status === "error" ? (
        <ErrorState
          code={state.error.message}
          impact="Provider Mock 列表不可用。"
          action="切换 healthy 或 degraded 场景"
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="没有匹配的 Provider" description="调整筛选条件或启动模拟接入流程。" />
      ) : (
        <DataTable
          columns={[
            "Provider",
            "类型",
            "环境",
            "状态",
            "Resources",
            "Deployments",
            ...(showObserved ? ["最近观测"] : []),
            "操作",
          ]}
          rows={filtered.map((provider) => [
            <button
              className="table-link"
              onClick={() => navigate(`/providers/${provider.providerId}`)}
            >
              <strong>{provider.name}</strong>
              <code>{provider.providerId}</code>
            </button>,
            provider.type,
            provider.environment,
            <StatusBadge status={provider.status} />,
            provider.resourceCount,
            provider.deploymentCount,
            ...(showObserved ? [provider.observedAt] : []),
            <Button onClick={() => setSelected(provider)}>快速详情</Button>,
          ])}
        />
      )}
      <DetailDrawer
        title={selected?.name ?? "Provider 详情"}
        open={selected !== undefined}
        onClose={() => setSelected(undefined)}
      >
        {selected === undefined ? null : (
          <>
            <StatusBadge status={selected.status} />
            <CodeOrJsonViewer value={selected} />
            <Button variant="primary" onClick={() => navigate(`/providers/${selected.providerId}`)}>
              打开完整详情
            </Button>
          </>
        )}
      </DetailDrawer>
    </>
  );
}

export function ProviderDetailPage({ providerId }: { readonly providerId: string }) {
  const queryProvider = useCallback(
    (source: ReturnType<typeof usePmsWebDataSource>) => source.provider(providerId),
    [providerId],
  );
  const queryResources = useCallback(
    (source: ReturnType<typeof usePmsWebDataSource>) => source.resources(),
    [],
  );
  const provider = useDataQuery(queryProvider);
  const resources = useDataQuery(queryResources);
  const [tab, setTab] = useState<(typeof providerTabs)[number]>("概览");

  if (provider.status === "loading") return <Skeleton lines={8} />;
  if (provider.status === "error") {
    return (
      <ErrorState
        code={provider.error.message}
        impact="Provider 详情不可用。"
        action="返回 Providers 列表"
      />
    );
  }
  if (provider.data === undefined) {
    return (
      <EmptyState title="Provider 不存在" description={`未找到 ${providerId} 的 Mock 投影。`} />
    );
  }
  const value = provider.data;
  const relatedResources =
    resources.status === "success"
      ? resources.data.filter((resource) => resource.providerId === providerId)
      : [];
  return (
    <>
      <PageHeader
        title={value.name}
        description={`${value.providerId} · ${value.type}`}
        actions={<StatusBadge status={value.status} />}
      />
      <nav className="tabs" aria-label="Provider 详情视图">
        {providerTabs.map((item) => (
          <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
            {item}
          </button>
        ))}
      </nav>
      {tab === "概览" ? (
        <div className="grid-two">
          <section className="panel">
            <h2>身份与状态</h2>
            <dl className="detail-list">
              <dt>Provider ID</dt>
              <dd>
                <code>{value.providerId}</code>
              </dd>
              <dt>类型</dt>
              <dd>{value.type}</dd>
              <dt>环境</dt>
              <dd>{value.environment}</dd>
              <dt>最近观测</dt>
              <dd>{value.observedAt}</dd>
            </dl>
          </section>
          <section className="panel">
            <h2>关联摘要</h2>
            <p>
              {value.resourceCount} Resources · {value.deploymentCount} RuntimeDeployments
            </p>
            <Button onClick={() => navigate(`/resources?providerId=${value.providerId}`)}>
              查看 Resources
            </Button>
          </section>
        </div>
      ) : tab === "Resources" ? (
        relatedResources.length === 0 ? (
          <EmptyState
            title="尚未发现 Resource"
            description="模拟接入 Operation 仍在等待发现步骤。"
          />
        ) : (
          <DataTable
            columns={["Resource", "类型", "状态", "Capabilities"]}
            rows={relatedResources.map((resource) => [
              <button
                className="table-link"
                onClick={() => navigate(`/resources/${resource.resourceId}`)}
              >
                {resource.name}
              </button>,
              resource.kind,
              <StatusBadge status={resource.status} />,
              resource.capabilities.join(", "),
            ])}
          />
        )
      ) : (
        <section className="panel">
          <h2>{tab}</h2>
          <p>{tab} 的关联信息结构已就绪；后续对象仍通过 Mock DataSource 提供。</p>
          <CodeOrJsonViewer value={{ providerId, view: tab, prototype: true }} />
        </section>
      )}
    </>
  );
}

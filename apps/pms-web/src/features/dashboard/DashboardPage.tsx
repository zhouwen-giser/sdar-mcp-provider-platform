import { useCallback, useState } from "react";
import { useDataQuery, usePmsWebDataSource } from "../../data/context.js";
import { navigate } from "../../router.js";
import {
  Button,
  DataTable,
  ErrorState,
  MetricCard,
  PageHeader,
  Skeleton,
  StatusBadge,
} from "../../components/ui.js";
import "../../design-system/provider-experience.css";

export function DashboardPage() {
  const queryDashboard = useCallback(
    (source: ReturnType<typeof usePmsWebDataSource>) => source.dashboard(),
    [],
  );
  const queryProviders = useCallback(
    (source: ReturnType<typeof usePmsWebDataSource>) => source.providers(),
    [],
  );
  const queryIncidents = useCallback(
    (source: ReturnType<typeof usePmsWebDataSource>) => source.incidents(),
    [],
  );
  const dashboard = useDataQuery(queryDashboard);
  const providers = useDataQuery(queryProviders);
  const incidents = useDataQuery(queryIncidents);
  const [range, setRange] = useState("1h");

  if (dashboard.status === "loading") return <Skeleton lines={8} />;
  if (dashboard.status === "error") {
    return (
      <ErrorState
        code={dashboard.error.message}
        impact="工作台 Mock 投影不可用，无法判断模拟平台状态。"
        action="切换 healthy 场景或重试页面"
      />
    );
  }
  return (
    <>
      <PageHeader
        title="工作台"
        description="Provider Platform 运行概览；所有指标来自当前 Mock Scenario。"
        actions={
          <label>
            时间范围{" "}
            <select value={range} onChange={(event) => setRange(event.target.value)}>
              <option value="15m">最近 15 分钟</option>
              <option value="1h">最近 1 小时</option>
              <option value="24h">最近 24 小时</option>
            </select>
          </label>
        }
      />
      <div className="metrics-row metrics-four">
        <MetricCard
          label="Providers"
          value={`${String(dashboard.data.healthyProviderCount)} / ${String(dashboard.data.providerCount)}`}
          hint="健康 / 总数"
        />
        <MetricCard
          label="ACTIVE Deployments"
          value={dashboard.data.activeDeploymentCount}
          hint="Desired 与 Observed 一致"
        />
        <MetricCard
          label="Open Incidents"
          value={dashboard.data.openIncidentCount}
          hint={dashboard.data.stale ? "存在 stale observation" : "无关键异常"}
        />
        <MetricCard
          label="Worker Backlog"
          value={dashboard.data.workerBacklog}
          hint={`时间窗口 ${range}`}
        />
      </div>
      {(dashboard.data.stale ||
        dashboard.data.openIncidentCount > 0 ||
        dashboard.data.workerBacklog > 20) && (
        <section className="alert-panel">
          <div>
            <strong>需要处理的模拟异常</strong>
            <p>检测到 Runtime stale、Incident 或 Worker backlog 场景。</p>
          </div>
          <Button variant="primary" onClick={() => navigate("/operations/incidents")}>
            查看 Incidents
          </Button>
        </section>
      )}
      <div className="grid-two">
        <section className="panel">
          <div className="section-heading">
            <h2>Provider 状态分布</h2>
            <Button variant="ghost" onClick={() => navigate("/providers")}>
              查看全部
            </Button>
          </div>
          {providers.status === "success" && providers.data.length > 0 ? (
            <DataTable
              columns={["Provider", "类型", "状态"]}
              rows={providers.data.map((provider) => [
                <button
                  className="table-link"
                  onClick={() => navigate(`/providers/${provider.providerId}`)}
                >
                  {provider.name}
                </button>,
                provider.type,
                <StatusBadge status={provider.status} />,
              ])}
            />
          ) : (
            <p className="muted">当前场景没有 Provider 数据。</p>
          )}
        </section>
        <section className="panel">
          <div className="section-heading">
            <h2>关键异常</h2>
            <Button variant="ghost" onClick={() => navigate("/operations/health")}>
              系统健康
            </Button>
          </div>
          {incidents.status === "success" && incidents.data.length > 0 ? (
            <DataTable
              columns={["Incident", "级别", "状态"]}
              rows={incidents.data.map((incident) => [
                <button
                  className="table-link"
                  onClick={() => navigate(`/operations/incidents/${incident.incidentId}`)}
                >
                  {incident.title}
                </button>,
                incident.severity,
                incident.status,
              ])}
            />
          ) : (
            <div className="healthy-summary">
              <StatusBadge status="ACTIVE" />
              <p>当前 Mock 时间范围内没有开放 Incident。</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

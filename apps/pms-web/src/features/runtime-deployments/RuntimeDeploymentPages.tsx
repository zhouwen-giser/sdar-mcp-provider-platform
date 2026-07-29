import { useCallback, useState } from "react";
import {
  Button,
  DataTable,
  DetailDrawer,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusBadge,
  Timeline,
} from "../../components/ui.js";
import { useDataQuery, usePmsWebDataSource } from "../../data/context.js";
import type { RuntimeProcessSummary } from "../../data/types.js";
import { navigate } from "../../router.js";
import "../../design-system/runtime-experience.css";

export function RuntimeDeploymentsPage() {
  const query = useCallback(
    (source: ReturnType<typeof usePmsWebDataSource>) => source.deployments(),
    [],
  );
  const deployments = useDataQuery(query);
  if (deployments.status === "loading") return <Skeleton lines={7} />;
  if (deployments.status === "error")
    return (
      <ErrorState
        code={deployments.error.message}
        impact="无法读取模拟 RuntimeDeployment 投影。"
        action="切换 healthy 场景"
      />
    );
  return (
    <>
      <PageHeader
        title="Runtime Deployments"
        description="分别观察 Desired、Lifecycle、Health 与 Drift；所有动作仅在浏览器 Mock 中模拟。"
        actions={
          <Button variant="primary" onClick={() => navigate("/runtime/deployments/new")}>
            创建模拟部署
          </Button>
        }
      />
      <section className="panel">
        <DataTable
          columns={["Deployment", "Desired", "Lifecycle / Health", "Drift", "Release"]}
          rows={deployments.data.map((deployment) => [
            <button
              className="table-link"
              onClick={() => navigate(`/runtime/deployments/${deployment.deploymentId}`)}
            >
              {deployment.deploymentId}
            </button>,
            `${deployment.desiredState} · r${String(deployment.desiredRevision)}`,
            <span className="status-stack">
              <StatusBadge status={deployment.observedState} />
              <small>Observed lifecycle，不代表 PM2 状态</small>
            </span>,
            deployment.desiredRevision === deployment.observedRevision
              ? "一致"
              : `落后 ${String(deployment.desiredRevision - deployment.observedRevision)} revision`,
            deployment.release,
          ])}
        />
      </section>
    </>
  );
}

export function RuntimeDeploymentDetailPage({
  deploymentId,
}: {
  readonly deploymentId: string;
}) {
  const source = usePmsWebDataSource();
  const queryDeployment = useCallback(
    (dataSource: ReturnType<typeof usePmsWebDataSource>) =>
      dataSource.deployment(deploymentId),
    [deploymentId],
  );
  const queryProcesses = useCallback(
    async (dataSource: ReturnType<typeof usePmsWebDataSource>) =>
      (await dataSource.runtimeProcesses()).filter(
        (process) => process.deploymentId === deploymentId,
      ),
    [deploymentId],
  );
  const deployment = useDataQuery(queryDeployment);
  const processes = useDataQuery(queryProcesses);
  const [tab, setTab] = useState<"overview" | "versions" | "config" | "replicas">("overview");
  const [selectedProcess, setSelectedProcess] = useState<RuntimeProcessSummary>();
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  if (deployment.status === "loading" || processes.status === "loading")
    return <Skeleton lines={8} />;
  if (deployment.status === "error" || processes.status === "error")
    return (
      <ErrorState
        code="MOCK_RUNTIME_DETAIL_UNAVAILABLE"
        impact="部署或进程投影不可用。"
        action="切换 healthy 场景"
      />
    );
  if (deployment.data === undefined)
    return (
      <ErrorState
        code="DEPLOYMENT_NOT_FOUND"
        impact={`未找到 ${deploymentId}。`}
        action="返回 Runtime Deployments"
      />
    );
  const item = deployment.data;
  return (
    <>
      <PageHeader
        title={item.deploymentId}
        description={`${item.providerId} · Desired ${item.desiredState} · 模拟投影`}
        actions={
          item.observedState === "ACTIVE" &&
          item.desiredRevision === item.observedRevision ? null : (
            <Button variant="primary" onClick={() => source.reconcileRuntime(item.deploymentId)}>
              模拟 Reconcile
            </Button>
          )
        }
      />
      <div className="lifecycle-strip" aria-label="部署生命周期">
        {["REQUESTED", "PROVISIONING", "STARTING", "REGISTERING", "ACTIVE"].map(
          (state) => (
            <span key={state} data-current={state === item.observedState}>
              {state}
            </span>
          ),
        )}
      </div>
      <nav className="tabs" aria-label="部署详情">
        {(["overview", "versions", "config", "replicas"] as const).map((value) => (
          <button
            key={value}
            aria-current={tab === value ? "page" : undefined}
            onClick={() => setTab(value)}
          >
            {value === "overview"
              ? "概览"
              : value === "versions"
                ? "版本"
                : value === "config"
                  ? "配置"
                  : "副本"}
          </button>
        ))}
      </nav>
      <section className="panel runtime-detail-grid">
        {tab === "overview" ? (
          <>
            <div>
              <small>Desired</small>
              <strong>{item.desiredState}</strong>
              <span>revision {item.desiredRevision}</span>
            </div>
            <div>
              <small>Observed lifecycle</small>
              <StatusBadge status={item.observedState} />
              <span>revision {item.observedRevision}</span>
            </div>
            <div>
              <small>Drift</small>
              <strong>
                {item.desiredRevision === item.observedRevision ? "无" : "需要 Reconcile"}
              </strong>
              <span>config revision {item.configRevision}</span>
            </div>
          </>
        ) : tab === "versions" ? (
          <Timeline
            items={[
              { label: item.release, meta: "当前模拟 Release" },
              { label: "@sdar/runtime@1.9.4", meta: "前一稳定版本" },
            ]}
          />
        ) : tab === "config" ? (
          <dl className="key-value-list">
            <div>
              <dt>Configuration Profile</dt>
              <dd>provider-runtime-r{item.configRevision}</dd>
            </div>
            <div>
              <dt>Desired / Applied</dt>
              <dd>{item.desiredRevision} / {item.observedRevision}</dd>
            </div>
          </dl>
        ) : (
          <DataTable
            columns={["Process", "PM2", "Health", "Registration"]}
            rows={processes.data.map((process) => [
              <button
                className="table-link"
                onClick={(event) => {
                  setReturnFocus(event.currentTarget);
                  setSelectedProcess(process);
                }}
              >
                {process.processId}
              </button>,
              process.pm2Status,
              <StatusBadge status={process.healthStatus} />,
              process.registrationStatus,
            ])}
          />
        )}
      </section>
      <DetailDrawer
        title={selectedProcess?.processId ?? "Runtime Process"}
        open={selectedProcess !== undefined}
        onClose={() => setSelectedProcess(undefined)}
        returnFocus={returnFocus}
      >
        {selectedProcess === undefined ? null : <ProcessState process={selectedProcess} />}
      </DetailDrawer>
    </>
  );
}

export function ProcessState({ process }: { readonly process: RuntimeProcessSummary }) {
  return (
    <div className="process-state-groups">
      <section>
        <small>PM2 supervisor</small>
        <strong>{process.pm2Status}</strong>
        <p>仅表示本机进程监督状态。</p>
      </section>
      <section>
        <small>Application health</small>
        <StatusBadge status={process.healthStatus} />
        <p>来自模拟健康投影。</p>
      </section>
      <section>
        <small>Platform registration</small>
        <strong>{process.registrationStatus}</strong>
        <p>PM2 online 不等于 ACTIVE 或已注册。</p>
      </section>
    </div>
  );
}

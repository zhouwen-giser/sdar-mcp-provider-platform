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
import { useDataQuery, usePmsWebDataSource, useScenario } from "../../data/context.js";
import type { WorkerJobSummary } from "../../data/types.js";
import { navigate } from "../../router.js";
import "../../design-system/runtime-experience.css";
import "../../design-system/governance-experience.css";

export function RuntimeHealthPage() {
  const query = useCallback(
    (source: ReturnType<typeof usePmsWebDataSource>) => source.deployments(),
    [],
  );
  const deployments = useDataQuery(query);
  if (deployments.status === "loading") return <Skeleton lines={6} />;
  if (deployments.status === "error")
    return <ErrorState code={deployments.error.message} impact="健康投影不可用。" action="切换场景" />;
  return (
    <>
      <PageHeader title="系统健康" description="模拟 Desired、Observed 与 Registration 健康视图。" />
      <section className="panel">
        <DataTable
          columns={["Deployment", "Observed", "Revision", "Action"]}
          rows={deployments.data.map((deployment) => [
            deployment.deploymentId,
            <StatusBadge status={deployment.observedState} />,
            `${deployment.observedRevision} / ${deployment.desiredRevision}`,
            <Button onClick={() => navigate(`/runtime/deployments/${deployment.deploymentId}`)}>
              诊断
            </Button>,
          ])}
        />
      </section>
    </>
  );
}

export function RuntimeJobsPage() {
  const source = usePmsWebDataSource();
  const [scenario] = useScenario();
  const query = useCallback(
    (source: ReturnType<typeof usePmsWebDataSource>) => source.jobs(),
    [],
  );
  const jobs = useDataQuery(query);
  const [selected, setSelected] = useState<WorkerJobSummary>();
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  if (jobs.status === "loading") return <Skeleton lines={6} />;
  if (jobs.status === "error")
    return <ErrorState code={jobs.error.message} impact="Job 投影不可用。" action="切换场景" />;
  return (
    <>
      <PageHeader title="Worker Jobs" description="浏览器内模拟任务；不触发真实 Worker。" />
      <section className="panel">
        <DataTable
          columns={["Job", "Kind", "Aggregate", "Status", "Attempts"]}
          rows={jobs.data.map((job) => [
            <button
              className="table-link"
              onClick={(event) => {
                setReturnFocus(event.currentTarget);
                setSelected(job);
              }}
            >
              {job.jobId}
            </button>,
            job.kind,
            <button
              className="table-link"
              onClick={() =>
                job.kind === "RECONCILE_RUNTIME"
                  ? navigate(`/runtime/deployments/${job.aggregateId}`)
                  : undefined
              }
            >
              {job.aggregateId}
            </button>,
            job.status,
            job.attempts,
          ])}
        />
      </section>
      <DetailDrawer
        title={selected?.jobId ?? "Worker Job"}
        open={selected !== undefined}
        onClose={() => setSelected(undefined)}
        returnFocus={returnFocus}
      >
        {selected === undefined ? null : (
          <>
            <div className="job-state-grid">
              <section><small>Lease owner</small><p>{selected.leaseOwner}</p></section>
              <section><small>Fence token</small><p><code>{selected.fenceToken}</code></p></section>
              <section><small>Attempt</small><p>{selected.attempts}</p></section>
              <section><small>Status</small><p>{selected.status}</p></section>
            </div>
            <Timeline items={selected.timeline.map((label) => ({ label, meta: "Mock worker event" }))} />
            <Button
              variant="primary"
              disabled={scenario === "read-only" || scenario === "permission-denied"}
              onClick={() => source.requeueJob(selected.jobId)}
            >
              模拟重新入队
            </Button>
            <p className="prototype-note">不提供“标记成功”；仅创建新的模拟 Attempt。</p>
          </>
        )}
      </DetailDrawer>
    </>
  );
}

export function RuntimeIncidentsPage({
  incidentId,
}: {
  readonly incidentId?: string;
}) {
  const source = usePmsWebDataSource();
  const [scenario] = useScenario();
  const query = useCallback(
    (source: ReturnType<typeof usePmsWebDataSource>) => source.incidents(),
    [],
  );
  const queryDeployments = useCallback(
    (dataSource: ReturnType<typeof usePmsWebDataSource>) => dataSource.deployments(),
    [],
  );
  const incidents = useDataQuery(query);
  const deployments = useDataQuery(queryDeployments);
  if (incidents.status === "loading" || deployments.status === "loading")
    return <Skeleton lines={6} />;
  if (incidents.status === "error")
    return (
      <ErrorState
        code={incidents.error.message}
        impact="Incident 投影不可用。"
        action="切换场景"
      />
    );
  if (deployments.status === "error")
    return (
      <ErrorState
        code={deployments.error.message}
        impact="关联 RuntimeDeployment 投影不可用。"
        action="切换场景"
      />
    );
  const incident = incidentId === undefined
    ? undefined
    : incidents.data.find((item) => item.incidentId === incidentId);
  const affectedDeployment =
    incident === undefined
      ? undefined
      : deployments.data.find((item) => item.deploymentId === incident.deploymentId);
  const recovered =
    affectedDeployment?.observedState === "ACTIVE" &&
    affectedDeployment.observedRevision === affectedDeployment.desiredRevision;
  if (incidentId !== undefined && incident === undefined)
    return (
      <ErrorState
        code="INCIDENT_NOT_FOUND"
        impact={`当前场景没有 ${incidentId}。`}
        action="切换 incident-active 场景"
      />
    );
  return (
    <>
      <PageHeader
        title={incident?.title ?? "Incidents"}
        description="从 Incident 进入 Deployment、Process、Job 与模拟 Reconcile 恢复链路。"
        actions={
          incident === undefined ? null : (
            <div className="button-row">
              <Button onClick={() => navigate(`/runtime/deployments/${incident.deploymentId}`)}>
                查看受影响 Deployment
              </Button>
              <Button
                variant="primary"
                disabled={
                  incident.status === "CLOSED" ||
                  !recovered ||
                  scenario === "read-only" ||
                  scenario === "permission-denied"
                }
                onClick={() => source.closeIncident(incident.incidentId)}
              >
                模拟关闭 Incident
              </Button>
            </div>
          )
        }
      />
      <section className="panel">
        {incident === undefined ? (
          <DataTable
            columns={["Incident", "Severity", "Status", "Deployment"]}
            rows={incidents.data.map((item) => [
              <button className="table-link" onClick={() => navigate(`/operations/incidents/${item.incidentId}`)}>
                {item.title}
              </button>,
              item.severity,
              item.status,
              item.deploymentId,
            ])}
          />
        ) : (
          <>
            <div className="job-state-grid">
              <section><small>Severity</small><p>{incident.severity}</p></section>
              <section><small>Status</small><p>{incident.status}</p></section>
              <section><small>Owner</small><p>{incident.owner}</p></section>
              <section><small>Deployment</small><button className="table-link" onClick={() => navigate(`/runtime/deployments/${incident.deploymentId}`)}>{incident.deploymentId}</button></section>
              <section><small>Related Job</small><button className="table-link" onClick={() => navigate("/operations/jobs")}>{incident.jobId}</button></section>
            </div>
            <Timeline items={incident.timeline.map((label) => ({ label, meta: "Incident timeline" }))} />
            {!recovered && incident.status !== "CLOSED" ? (
              <p className="prototype-note">Deployment 尚未恢复为 ACTIVE，关闭操作保持禁用。</p>
            ) : null}
            <div className="recovery-path">
              <span>Incident {incident.incidentId}</span>
              <span>→ Deployment {incident.deploymentId}</span>
              <span>→ Process diagnosis</span>
              <span>→ RECONCILE_RUNTIME Job</span>
              <span>→ Observed ACTIVE</span>
            </div>
          </>
        )}
      </section>
    </>
  );
}

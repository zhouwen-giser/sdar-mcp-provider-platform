import { useCallback } from "react";
import {
  Button,
  DataTable,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusBadge,
} from "../../components/ui.js";
import { useDataQuery, usePmsWebDataSource } from "../../data/context.js";
import { navigate } from "../../router.js";
import "../../design-system/runtime-experience.css";

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
  const query = useCallback(
    (source: ReturnType<typeof usePmsWebDataSource>) => source.jobs(),
    [],
  );
  const jobs = useDataQuery(query);
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
            job.jobId,
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
    </>
  );
}

export function RuntimeIncidentsPage({
  incidentId,
}: {
  readonly incidentId?: string;
}) {
  const query = useCallback(
    (source: ReturnType<typeof usePmsWebDataSource>) => source.incidents(),
    [],
  );
  const incidents = useDataQuery(query);
  if (incidents.status === "loading") return <Skeleton lines={6} />;
  if (incidents.status === "error")
    return <ErrorState code={incidents.error.message} impact="Incident 投影不可用。" action="切换场景" />;
  const incident = incidentId === undefined
    ? undefined
    : incidents.data.find((item) => item.incidentId === incidentId);
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
            <Button variant="primary" onClick={() => navigate(`/runtime/deployments/${incident.deploymentId}`)}>
              查看受影响 Deployment
            </Button>
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
          <div className="recovery-path">
            <span>Incident {incident.incidentId}</span>
            <span>→ Deployment {incident.deploymentId}</span>
            <span>→ Process diagnosis</span>
            <span>→ RECONCILE_RUNTIME Job</span>
            <span>→ Observed ACTIVE</span>
          </div>
        )}
      </section>
    </>
  );
}

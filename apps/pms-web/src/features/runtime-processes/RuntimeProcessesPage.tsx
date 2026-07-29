import { useCallback, useState } from "react";
import {
  Button,
  DataTable,
  DetailDrawer,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusBadge,
} from "../../components/ui.js";
import { useDataQuery, usePmsWebDataSource } from "../../data/context.js";
import type { RuntimeProcessSummary } from "../../data/types.js";
import { navigate } from "../../router.js";
import { ProcessState } from "../runtime-deployments/RuntimeDeploymentPages.js";
import "../../design-system/runtime-experience.css";

export function RuntimeProcessesPage() {
  const query = useCallback(
    (source: ReturnType<typeof usePmsWebDataSource>) => source.runtimeProcesses(),
    [],
  );
  const processes = useDataQuery(query);
  const [selected, setSelected] = useState<RuntimeProcessSummary>();
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  if (processes.status === "loading") return <Skeleton lines={7} />;
  if (processes.status === "error")
    return (
      <ErrorState
        code={processes.error.message}
        impact="RuntimeProcess Mock 投影不可用。"
        action="切换 healthy 场景"
      />
    );
  return (
    <>
      <PageHeader
        title="Runtime Processes"
        description="PM2、Application Health 与 Platform Registration 是三个独立状态面。"
      />
      <section className="panel">
        <DataTable
          columns={["Process", "Deployment", "PM2", "Health", "Registration", "Heartbeat"]}
          rows={processes.data.map((process) => [
            <button
              className="table-link"
              onClick={(event) => {
                setReturnFocus(event.currentTarget);
                setSelected(process);
              }}
            >
              {process.processId}
            </button>,
            <Button
              variant="ghost"
              onClick={() => navigate(`/runtime/deployments/${process.deploymentId}`)}
            >
              {process.deploymentId}
            </Button>,
            process.pm2Status,
            <StatusBadge status={process.healthStatus} />,
            process.registrationStatus,
            process.heartbeatAt,
          ])}
        />
      </section>
      <DetailDrawer
        title={selected?.processId ?? "Runtime Process"}
        open={selected !== undefined}
        onClose={() => setSelected(undefined)}
        returnFocus={returnFocus}
      >
        {selected === undefined ? null : <ProcessState process={selected} />}
      </DetailDrawer>
    </>
  );
}

import { useCallback, useState } from "react";
import {
  Button,
  CodeOrJsonViewer,
  DataTable,
  DetailDrawer,
  DiffViewer,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusBadge,
} from "../../components/ui.js";
import { useDataQuery, usePmsWebDataSource } from "../../data/context.js";
import type { RegistryRevision } from "../../data/types.js";
import "../../design-system/governance-experience.css";

export function RegistryPage() {
  const query = useCallback(
    (source: ReturnType<typeof usePmsWebDataSource>) => source.registryRevisions(),
    [],
  );
  const revisions = useDataQuery(query);
  const [selected, setSelected] = useState<RegistryRevision>();
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  if (revisions.status === "loading") return <Skeleton lines={7} />;
  if (revisions.status === "error")
    return <ErrorState code={revisions.error.message} impact="Registry 投影不可用。" action="切换场景" />;
  return (
    <>
      <PageHeader
        title="Registry"
        description="Revision History、Diff 与 Bootstrap Export 的纯视觉交互。"
        actions={
          <Button onClick={() => setSelected(revisions.data[0])}>
            预览 Bootstrap Export
          </Button>
        }
      />
      <section className="panel">
        <DataTable
          columns={["Revision", "Status", "Checksum", "Operations", "Created"]}
          rows={revisions.data.map((revision) => [
            <button
              className="table-link"
              onClick={(event) => {
                setReturnFocus(event.currentTarget);
                setSelected(revision);
              }}
            >
              revision-{revision.revision}
            </button>,
            <StatusBadge status={revision.status} />,
            <code>{revision.checksum}</code>,
            revision.operationCount,
            revision.createdAt,
          ])}
        />
      </section>
      {revisions.data.length > 1 ? (
        <section className="panel">
          <h2>Revision Diff</h2>
          <DiffViewer
            before={JSON.stringify(revisions.data[1], null, 2)}
            after={JSON.stringify(revisions.data[0], null, 2)}
          />
        </section>
      ) : null}
      <DetailDrawer
        title={`Bootstrap Export · revision ${String(selected?.revision ?? "")}`}
        open={selected !== undefined}
        onClose={() => setSelected(undefined)}
        returnFocus={returnFocus}
      >
        <p className="prototype-note">仅视觉预览，不下载文件、不调用 Registry API。</p>
        <CodeOrJsonViewer
          value={
            selected === undefined
              ? {}
              : {
                  apiVersion: "sdar.mock/v1",
                  revision: selected.revision,
                  checksum: selected.checksum,
                  secrets: "REDACTED",
                }
          }
        />
      </DetailDrawer>
    </>
  );
}

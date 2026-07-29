import { useCallback, useState } from "react";
import {
  CodeOrJsonViewer,
  DataTable,
  DetailDrawer,
  ErrorState,
  PageHeader,
  Skeleton,
} from "../../components/ui.js";
import { useDataQuery, usePmsWebDataSource } from "../../data/context.js";
import type { AuditEvent } from "../../data/types.js";
import "../../design-system/governance-experience.css";

export function AuditPage() {
  const query = useCallback(
    (source: ReturnType<typeof usePmsWebDataSource>) => source.auditEvents(),
    [],
  );
  const events = useDataQuery(query);
  const [selected, setSelected] = useState<AuditEvent>();
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  if (events.status === "loading") return <Skeleton lines={7} />;
  if (events.status === "error")
    return <ErrorState code={events.error.message} impact="Audit 投影不可用。" action="切换场景" />;
  return (
    <>
      <PageHeader
        title="Audit"
        description="模拟不可变审计投影；Secret 字段统一 REDACTED。"
      />
      <section className="panel">
        <DataTable
          columns={["Event", "Action", "Aggregate", "Reason", "Correlation ID", "Occurred"]}
          rows={events.data.map((event) => [
            <button
              className="table-link"
              onClick={(click) => {
                setReturnFocus(click.currentTarget);
                setSelected(event);
              }}
            >
              {event.auditId}
            </button>,
            event.action,
            event.aggregateId,
            event.reason,
            <code>{event.correlationId}</code>,
            event.occurredAt,
          ])}
        />
      </section>
      <DetailDrawer
        title={selected?.auditId ?? "Audit Event"}
        open={selected !== undefined}
        onClose={() => setSelected(undefined)}
        returnFocus={returnFocus}
      >
        {selected === undefined ? null : (
          <>
            <dl className="key-value-list">
              <div><dt>Reason</dt><dd>{selected.reason}</dd></div>
              <div><dt>Correlation ID</dt><dd><code>{selected.correlationId}</code></dd></div>
            </dl>
            <div className="audit-comparison">
              <section><h3>Before</h3><CodeOrJsonViewer value={selected.before} /></section>
              <section><h3>After</h3><CodeOrJsonViewer value={selected.after} /></section>
            </div>
            <p className="prototype-note">Sensitive values: REDACTED。此原型没有 Reveal 操作。</p>
          </>
        )}
      </DetailDrawer>
    </>
  );
}

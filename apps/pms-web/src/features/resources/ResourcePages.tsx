import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  Button,
  CodeOrJsonViewer,
  ConfirmDialog,
  DataTable,
  FilterBar,
  KeyValueList,
  MetricCard,
  QuerySurface,
  StatusBadge,
  Tabs,
  Timeline,
} from "../../components/ui.js";
import {
  useAuditEvents,
  useBindResource,
  useBindings,
  useResource,
  useResources,
  useUnbindResource,
  useUpdateResourceStatus,
} from "../../queries/hooks.js";
import { navigate } from "../../app/navigation.js";
import { MutationFeedback, ProductPage } from "../shared/product-components.js";

export function ResourceListPage() {
  const resources = useResources();
  const [params] = useSearchParams();
  const bindProvider = params.get("bindProvider");
  const bindings = useBindings(bindProvider ?? "");
  const bind = useBindResource();
  const unbind = useUnbindResource();
  const [search, setSearch] = useState("");
  const [environment, setEnvironment] = useState("all");
  const bound = new Set(
    (bindings.data ?? []).map((item) => `${item.environment}/${item.resourceId}`),
  );
  const rows = (resources.data ?? []).filter(
    (item) =>
      `${item.resourceId} ${item.resourceType} ${item.displayName}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (environment === "all" || item.environment === environment),
  );
  return (
    <ProductPage
      title="Resources"
      description={
        bindProvider
          ? `为 ${bindProvider} 管理 Resource Binding；绑定和解绑均为冻结命令。`
          : "Resource 列表、状态和 Metadata；设备实时状态权威仍在既有系统。"
      }
      classification={bindProvider ? "WEB_COMPOSED" : "FROZEN_API"}
      actions={
        bindProvider ? (
          <Button onClick={() => navigate(`/providers/${bindProvider}/resources`)}>
            返回 Provider
          </Button>
        ) : undefined
      }
    >
      <div className="metrics-row">
        <MetricCard label="总数" value={resources.data?.length ?? "—"} />
        <MetricCard
          label="Available"
          value={resources.data?.filter((x) => x.status === "available").length ?? "—"}
        />
        <MetricCard
          label="Unavailable"
          value={resources.data?.filter((x) => x.status === "unavailable").length ?? "—"}
        />
        <MetricCard
          label="Environments"
          value={new Set(resources.data?.map((x) => x.environment)).size || "—"}
        />
      </div>
      <FilterBar>
        <input
          placeholder="Resource ID / Type / Name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={environment} onChange={(e) => setEnvironment(e.target.value)}>
          <option value="all">全部环境</option>
          <option>production</option>
          <option>staging</option>
        </select>
      </FilterBar>
      <section className="panel">
        <QuerySurface query={resources}>
          {() => (
            <DataTable
              columns={[
                "Resource",
                "Name",
                "Environment",
                "Type",
                "Status",
                "Updated",
                bindProvider ? "Binding" : "Metadata",
              ]}
              rows={rows.map((item) => [
                <button
                  className="table-link"
                  onClick={() =>
                    navigate(
                      `/resources/${encodeURIComponent(item.environment)}/${encodeURIComponent(item.resourceId)}`,
                    )
                  }
                >
                  {item.resourceId}
                </button>,
                item.displayName,
                item.environment,
                item.resourceType,
                <StatusBadge status={item.status} />,
                item.updatedAt,
                bindProvider ? (
                  bound.has(`${item.environment}/${item.resourceId}`) ? (
                    <Button
                      variant="danger"
                      busy={unbind.isPending}
                      onClick={() =>
                        unbind.mutate({
                          providerId: bindProvider,
                          environment: item.environment,
                          resourceId: item.resourceId,
                        })
                      }
                    >
                      解绑
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      busy={bind.isPending}
                      onClick={() =>
                        bind.mutate({
                          providerId: bindProvider,
                          environment: item.environment,
                          resourceId: item.resourceId,
                        })
                      }
                    >
                      绑定
                    </Button>
                  )
                ) : (
                  Object.keys(item.metadata).join(", ")
                ),
              ])}
            />
          )}
        </QuerySurface>
      </section>
      <MutationFeedback mutation={bind} />
      <MutationFeedback mutation={unbind} />
    </ProductPage>
  );
}

type ResourceSection = "overview" | "history" | "activity";
export function ResourceDetailPage({
  section = "overview",
}: {
  readonly section?: ResourceSection;
}) {
  const { environment = "", resourceId = "" } = useParams();
  const resource = useResource(environment, resourceId);
  const audit = useAuditEvents({ subjectId: resourceId });
  const update = useUpdateResourceStatus();
  const [confirm, setConfirm] = useState<"retired" | "unavailable" | null>(null);
  return (
    <QuerySurface query={resource}>
      {(item) => (
        <ProductPage
          title={item.resourceId}
          description={`${item.displayName} · ${item.environment} · ${item.resourceType}`}
          classification="FROZEN_API"
          actions={
            <>
              <Button
                disabled={item.status === "available"}
                onClick={() =>
                  update.mutate({
                    environment: item.environment,
                    resourceId: item.resourceId,
                    status: "available",
                    expectedUpdatedAt: item.updatedAt,
                  })
                }
              >
                设为 available
              </Button>
              <Button variant="danger" onClick={() => setConfirm("unavailable")}>
                设为 unavailable
              </Button>
            </>
          }
        >
          <Tabs
            current={section}
            onChange={(id) =>
              navigate(
                `/resources/${encodeURIComponent(item.environment)}/${encodeURIComponent(item.resourceId)}/${id === "overview" ? "" : id}`.replace(
                  /\/$/,
                  "",
                ),
              )
            }
            items={[
              { id: "overview", label: "Overview" },
              { id: "history", label: "History" },
              { id: "activity", label: "Activity" },
            ]}
          />
          {section === "overview" ? (
            <div className="grid-two">
              <section className="panel">
                <KeyValueList
                  entries={[
                    ["Environment", item.environment],
                    ["Resource Type", item.resourceType],
                    ["Status", <StatusBadge status={item.status} />],
                    ["updatedAt", item.updatedAt],
                    ["Concurrency", `expectedUpdatedAt = ${item.updatedAt}`],
                  ]}
                />
                <div className="danger-zone">
                  <h3>Lifecycle</h3>
                  <Button
                    variant="danger"
                    disabled={item.status === "retired"}
                    onClick={() => setConfirm("retired")}
                  >
                    Retire Resource
                  </Button>
                </div>
              </section>
              <section className="panel">
                <h2>Metadata</h2>
                <CodeOrJsonViewer value={item.metadata} />
              </section>
            </div>
          ) : section === "history" ? (
            <section className="panel">
              <h2>Resource History Read Model</h2>
              <Timeline
                items={[
                  { label: "Resource observed", meta: item.updatedAt, status: item.status },
                  { label: "Status changes", meta: "Derived from Audit list when present" },
                  { label: "Binding history", meta: "Current binding query + Audit projection" },
                ]}
              />
            </section>
          ) : (
            <section className="panel">
              <DataTable
                columns={["Action", "Actor", "Correlation", "Time"]}
                rows={(audit.data ?? []).map((event) => [
                  event.action,
                  event.actorId,
                  <code>{event.correlationId}</code>,
                  event.occurredAt,
                ])}
              />
            </section>
          )}
          <ConfirmDialog
            open={confirm !== null}
            title={confirm === "retired" ? "Retire Resource" : "Mark Resource unavailable"}
            impact={
              <ul>
                <li>目标状态：{confirm}</li>
                <li>expectedUpdatedAt：{item.updatedAt}</li>
                <li>不会级联删除 Provider Binding</li>
              </ul>
            }
            requirePhrase={item.resourceId}
            reasonRequired
            busy={update.isPending}
            onCancel={() => setConfirm(null)}
            onConfirm={() =>
              update.mutate(
                {
                  environment: item.environment,
                  resourceId: item.resourceId,
                  status: confirm ?? "unavailable",
                  expectedUpdatedAt: item.updatedAt,
                },
                { onSuccess: () => setConfirm(null) },
              )
            }
          />
          <MutationFeedback mutation={update} />
        </ProductPage>
      )}
    </QuerySurface>
  );
}

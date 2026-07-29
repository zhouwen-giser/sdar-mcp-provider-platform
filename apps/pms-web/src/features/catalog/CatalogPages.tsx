import { useCallback, useState } from "react";
import {
  Button,
  CodeOrJsonViewer,
  DataTable,
  DiffViewer,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusBadge,
  Timeline,
} from "../../components/ui.js";
import { useDataQuery, usePmsWebDataSource, useScenario } from "../../data/context.js";
import { navigate } from "../../router.js";
import "../../design-system/governance-experience.css";

export function CatalogPage() {
  const query = useCallback(
    (source: ReturnType<typeof usePmsWebDataSource>) => source.catalogOperations(),
    [],
  );
  const operations = useDataQuery(query);
  if (operations.status === "loading") return <Skeleton lines={7} />;
  if (operations.status === "error")
    return (
      <ErrorState
        code={operations.error.message}
        impact="Catalog Mock 投影不可用。"
        action="切换 healthy 场景"
      />
    );
  return (
    <>
      <PageHeader
        title="Catalog"
        description="Operation、Schema、Profile 与证据的模拟发现投影。"
      />
      <section className="panel">
        <DataTable
          columns={["Operation", "Provider", "Revision", "Compatibility", "Registry"]}
          rows={operations.data.map((operation) => [
            <button
              className="table-link"
              onClick={() =>
                navigate(`/catalog/${operation.providerId}/${operation.operationName}`)
              }
            >
              {operation.operationName}
            </button>,
            operation.providerId,
            operation.revision,
            <StatusBadge status={operation.compatibility} />,
            <StatusBadge status={operation.registryStatus} />,
          ])}
        />
      </section>
    </>
  );
}

export function CatalogOperationPage({
  providerId,
  operationName,
}: {
  readonly providerId: string;
  readonly operationName: string;
}) {
  const source = usePmsWebDataSource();
  const [scenario] = useScenario();
  const query = useCallback(
    async (dataSource: ReturnType<typeof usePmsWebDataSource>) =>
      (await dataSource.catalogOperations()).find(
        (item) => item.providerId === providerId && item.operationName === operationName,
      ),
    [operationName, providerId],
  );
  const operation = useDataQuery(query);
  const [tab, setTab] = useState<"schema" | "profile" | "evidence" | "diff">("schema");
  const mutationBlocked = scenario === "read-only" || scenario === "permission-denied";
  if (operation.status === "loading") return <Skeleton lines={8} />;
  if (operation.status === "error" || operation.data === undefined)
    return (
      <ErrorState
        code={operation.status === "error" ? operation.error.message : "CATALOG_OPERATION_NOT_FOUND"}
        impact="无法显示 Operation 详情。"
        action="返回 Catalog"
      />
    );
  const item = operation.data;
  return (
    <>
      <PageHeader
        title={item.operationName}
        description={`${item.providerId} · revision ${String(item.revision)} · Mock Catalog`}
        actions={
          <div className="button-row">
            <Button disabled={mutationBlocked} onClick={() => source.rediscoverCatalog(providerId)}>
              模拟重新发现
            </Button>
            <Button
              variant="primary"
              disabled={mutationBlocked || item.compatibility === "BREAKING"}
              onClick={() => source.publishCatalog(providerId)}
            >
              模拟发布 Registry
            </Button>
          </div>
        }
      />
      {mutationBlocked ? (
        <section className="permission-banner">
          {scenario === "read-only" ? "READ_ONLY：当前原型场景只允许查看。" : "PERMISSION_DENIED：模拟权限不足。"}
        </section>
      ) : null}
      {item.compatibility === "BREAKING" ? (
        <section className="blocking-callout">
          <div>
            <strong>BREAKING · Registry 发布已阻断</strong>
            <p>新增必填字段 safetyApproval；需评审兼容策略后才能模拟发布。</p>
          </div>
          <Button onClick={() => navigate("/conformance")}>查看 Conformance 占位</Button>
        </section>
      ) : null}
      <nav className="tabs" aria-label="Catalog Operation 详情">
        {(["schema", "profile", "evidence", "diff"] as const).map((value) => (
          <button
            key={value}
            aria-current={tab === value ? "page" : undefined}
            onClick={() => setTab(value)}
          >
            {value === "schema" ? "Schema" : value === "profile" ? "Profile" : value === "evidence" ? "Evidence" : "Catalog Diff"}
          </button>
        ))}
      </nav>
      <section className="panel">
        {tab === "schema" ? (
          <CodeOrJsonViewer value={item.schema} />
        ) : tab === "profile" ? (
          <dl className="key-value-list">
            <div><dt>Profile</dt><dd>{item.profile}</dd></div>
            <div><dt>Method</dt><dd>{item.method}</dd></div>
            <div><dt>Classification</dt><dd>{item.compatibility}</dd></div>
          </dl>
        ) : tab === "evidence" ? (
          <Timeline items={item.evidence.map((label) => ({ label, meta: "Mock evidence" }))} />
        ) : (
          <DiffViewer
            before={JSON.stringify(item.previousSchema, null, 2)}
            after={JSON.stringify(item.schema, null, 2)}
          />
        )}
      </section>
    </>
  );
}

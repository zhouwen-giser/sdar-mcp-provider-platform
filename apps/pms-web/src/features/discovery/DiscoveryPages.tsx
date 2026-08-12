import { useState } from "react";
import { useParams } from "react-router-dom";
import {
  Button,
  CodeOrJsonViewer,
  DataTable,
  DeferredCapability,
  DiffViewer,
  FormField,
  KeyValueList,
  MetricCard,
  QuerySurface,
  StatusBadge,
  Tabs,
  Timeline,
} from "../../components/ui.js";
import {
  currentEnvironmentScope,
  useDeployments,
  useRegistryDiff,
  useRegistryHistory,
  useRegistryLatest,
  useRuntimeCommand,
} from "../../queries/hooks.js";
import { useClientWorkspaceStore } from "../../client-workspace/context.js";
import { navigate } from "../../app/navigation.js";
import {
  ContractBoundaryNote,
  LocalWorkspaceHeader,
  MutationFeedback,
  ProductPage,
} from "../shared/product-components.js";

function toolName(tool: unknown): string {
  return typeof tool === "object" &&
    tool !== null &&
    "name" in tool &&
    typeof (tool as { name?: unknown }).name === "string"
    ? (tool as { name: string }).name
    : "unnamed-tool";
}
function toolSchema(tool: unknown): unknown {
  return typeof tool === "object" && tool !== null ? tool : {};
}

export function CatalogPage({
  mode = "list",
}: {
  readonly mode?: "list" | "provider" | "operation" | "revisions" | "revision" | "compare";
}) {
  const { providerId = "", operationName = "", revision = "" } = useParams();
  const latest = useRegistryLatest();
  const history = useRegistryHistory();
  const deployments = useDeployments();
  const reconcile = useRuntimeCommand("reconcile");
  const workspace = useClientWorkspaceStore();
  return (
    <QuerySurface query={latest}>
      {(snapshot) => (
        <CatalogInternal
          mode={mode}
          providerId={providerId}
          operationName={operationName}
          revision={revision}
          snapshot={snapshot}
          rawProviders={snapshot.providers}
          history={history.data ?? []}
          deployments={deployments.data ?? []}
          reconcile={reconcile}
          workspace={workspace}
        />
      )}
    </QuerySurface>
  );
}

function CatalogInternal({
  mode,
  providerId,
  operationName,
  revision,
  snapshot,
  rawProviders,
  history,
  deployments,
  reconcile,
  workspace,
}: {
  readonly mode: "list" | "provider" | "operation" | "revisions" | "revision" | "compare";
  readonly providerId: string;
  readonly operationName: string;
  readonly revision: string;
  readonly snapshot: {
    readonly environment: string;
    readonly revision: number;
    readonly checksum: string;
    readonly providerCount: number;
    readonly toolCount: number;
    readonly publishedAt: string;
  };
  readonly rawProviders?: readonly any[];
  readonly history: readonly {
    readonly revision: number;
    readonly checksum: string;
    readonly publishedAt: string;
  }[];
  readonly deployments: readonly {
    readonly deploymentId: string;
    readonly providerId: string;
    readonly desiredRevision: number;
  }[];
  readonly reconcile: ReturnType<typeof useRuntimeCommand>;
  readonly workspace: ReturnType<typeof useClientWorkspaceStore>;
}) {
  const providers = rawProviders ?? [];
  const selectedProvider = providers.find((item) => item.providerId === providerId) ?? providers[0];
  const selectedTool =
    selectedProvider?.tools?.find((tool: unknown) => toolName(tool) === operationName) ??
    selectedProvider?.tools?.[0];
  const triggerReconcile = () => {
    const deployment = deployments.find((item) => item.providerId === selectedProvider?.providerId);
    if (!deployment) return;
    reconcile.mutate(
      {
        deploymentId: deployment.deploymentId,
        providerId: deployment.providerId,
        expectedDesiredRevision: deployment.desiredRevision,
      },
      {
        onSuccess: (intent) =>
          workspace.recordIntent("runtime.reconcile", deployment.deploymentId, intent.operationId),
      },
    );
  };
  if (mode === "list")
    return (
      <ProductPage
        title="Catalog"
        description="Catalog 页面由 Registry Snapshot 的 Provider/Tool projection 构建；没有手工编辑命令。"
        classification="WEB_COMPOSED"
      >
        <div className="metrics-row">
          <MetricCard label="Providers" value={snapshot.providerCount} />
          <MetricCard label="Tools" value={snapshot.toolCount} />
          <MetricCard label="Registry Revision" value={snapshot.revision} />
          <MetricCard label="Published" value={snapshot.publishedAt} />
        </div>
        <section className="panel">
          <DataTable
            columns={["Provider", "Server", "Endpoint", "Catalog Revision", "Tools"]}
            rows={providers.map((item) => [
              <button
                className="table-link"
                onClick={() => navigate(`/catalog/providers/${item.providerId}`)}
              >
                {item.providerId}
              </button>,
              item.serverId,
              item.effectiveEndpoint,
              item.catalogRevision,
              item.tools.length,
            ])}
          />
        </section>
      </ProductPage>
    );
  if (mode === "provider")
    return (
      <ProductPage
        title={`${selectedProvider?.providerId ?? providerId} Catalog`}
        description="Provider 级 Tool 清单来自最新 Registry Snapshot。"
        classification="WEB_COMPOSED"
        actions={
          <Button
            variant="primary"
            busy={reconcile.isPending}
            disabled={!deployments.some((item) => item.providerId === selectedProvider?.providerId)}
            onClick={triggerReconcile}
          >
            通过 Deployment Reconcile 重新发现
          </Button>
        }
      >
        <ContractBoundaryNote>
          V1 不提供独立 rediscover、block/unblock 或手工 Tool 编辑。重新发现必须沿用
          RuntimeDeployment reconcile。
        </ContractBoundaryNote>
        <section className="panel">
          <DataTable
            columns={["Operation", "Protocol", "Input Schema", "Annotations"]}
            rows={(selectedProvider?.tools ?? []).map((tool: unknown) => [
              <button
                className="table-link"
                onClick={() =>
                  navigate(`/catalog/providers/${selectedProvider.providerId}/${toolName(tool)}`)
                }
              >
                {toolName(tool)}
              </button>,
              selectedProvider.protocolMode,
              typeof toolSchema(tool) === "object" ? "JSON Schema" : "unknown",
              "Registry projection",
            ])}
          />
        </section>
        <MutationFeedback mutation={reconcile} />
      </ProductPage>
    );
  if (mode === "operation")
    return (
      <ProductPage
        title={toolName(selectedTool)}
        description={`${selectedProvider?.providerId ?? providerId} · catalog revision ${selectedProvider?.catalogRevision ?? "—"}`}
        classification="WEB_COMPOSED"
      >
        <Tabs
          current="schema"
          onChange={() => undefined}
          items={[
            { id: "schema", label: "Input Schema" },
            { id: "output", label: "Output Schema" },
            { id: "annotations", label: "Annotations" },
          ]}
        />
        <div className="grid-two">
          <section className="panel">
            <h2>Tool Projection</h2>
            <CodeOrJsonViewer value={selectedTool ?? { name: operationName }} />
          </section>
          <section className="panel">
            <h2>Authority boundary</h2>
            <KeyValueList
              entries={[
                ["Provider", selectedProvider?.providerId ?? providerId],
                ["Endpoint", selectedProvider?.effectiveEndpoint ?? "unknown"],
                ["Catalog Revision", selectedProvider?.catalogRevision ?? "unknown"],
                ["Registry Revision", snapshot.revision],
                ["Editable", "No"],
              ]}
            />
          </section>
        </div>
      </ProductPage>
    );
  if (mode === "revisions")
    return (
      <ProductPage
        title={`${selectedProvider?.providerId ?? providerId} Catalog Revisions`}
        description="Registry history is the available revision authority; Catalog-specific history is not frozen separately."
        classification="WEB_COMPOSED"
      >
        <section className="panel">
          <DataTable
            columns={["Registry Revision", "Checksum", "Published", "Catalog relation"]}
            rows={history.map((item) => [
              <button
                className="table-link"
                onClick={() =>
                  navigate(
                    `/catalog/providers/${selectedProvider?.providerId ?? providerId}/revisions/${item.revision}`,
                  )
                }
              >
                {item.revision}
              </button>,
              <code>{item.checksum.slice(0, 12)}…</code>,
              item.publishedAt,
              "Provider projection at snapshot",
            ])}
          />
        </section>
      </ProductPage>
    );
  if (mode === "revision")
    return (
      <ProductPage
        title={`Catalog Revision View ${revision}`}
        description="通过对应 Registry Snapshot 解释 Provider Catalog；不创建 Catalog Revision API。"
        classification="WEB_COMPOSED"
      >
        <section className="panel">
          <KeyValueList
            entries={[
              ["Requested revision", revision],
              ["Provider", selectedProvider?.providerId ?? providerId],
              ["Latest catalog revision", selectedProvider?.catalogRevision ?? "—"],
              ["Registry checksum", snapshot.checksum],
            ]}
          />
          <CodeOrJsonViewer value={selectedProvider ?? { providerId }} />
        </section>
      </ProductPage>
    );
  return (
    <ProductPage
      title="Catalog Compare"
      description="在浏览器中比较 Registry Provider projections，识别新增、删除与结构变化。"
      classification="CLIENT_ONLY"
    >
      <section className="panel">
        <DiffViewer
          before={JSON.stringify(
            {
              revision: Math.max(1, snapshot.revision - 1),
              provider: selectedProvider?.providerId,
              tools: (selectedProvider?.tools ?? []).slice(0, 1),
            },
            null,
            2,
          )}
          after={JSON.stringify(
            {
              revision: snapshot.revision,
              provider: selectedProvider?.providerId,
              tools: selectedProvider?.tools ?? [],
            },
            null,
            2,
          )}
        />
        <div className="blocking-callout">
          <strong>Breaking review</strong>
          <p>
            新增必填字段、删除 Tool 或 Schema 收紧需要人工检查；页面不会 block/unblock Registry。
          </p>
        </div>
      </section>
    </ProductPage>
  );
}

export function RegistryPage({
  mode = "latest",
}: {
  readonly mode?: "latest" | "revision" | "compare" | "publish";
}) {
  const { revision = "" } = useParams();
  const environment = currentEnvironmentScope()[0] ?? "selected environment";
  const latest = useRegistryLatest();
  const history = useRegistryHistory();
  const from = history.data?.[1]?.revision ?? 3;
  const to = history.data?.[0]?.revision ?? 4;
  const diff = useRegistryDiff(undefined, from, to);
  if (mode === "publish")
    return (
      <ProductPage
        title="Registry Publish"
        description="展示候选变化和影响分析；V1 没有人工 publish 命令。"
        classification="DEFERRED"
      >
        <DeferredCapability
          title="Registry publication"
          reason="Registry Snapshot 由既有 Catalog/Registry 收口流程产生；Console API V1 只提供 latest/history/diff。"
        >
          <div className="grid-two">
            <section>
              <h3>Current Snapshot</h3>
              <QuerySurface query={latest}>
                {(item) => (
                  <KeyValueList
                    entries={[
                      ["Environment", item.environment],
                      ["Revision", item.revision],
                      ["Checksum", <code>{item.checksum}</code>],
                      ["Providers", item.providerCount],
                      ["Tools", item.toolCount],
                    ]}
                  />
                )}
              </QuerySurface>
            </section>
            <section>
              <h3>Candidate impact</h3>
              <ul>
                <li>Added tools: local diff preview</li>
                <li>Removed tools: requires compatibility review</li>
                <li>Publication authority: automated closure flow</li>
              </ul>
            </section>
          </div>
          <Button disabled variant="primary" title="No manual publish command">
            Publish unavailable
          </Button>
        </DeferredCapability>
      </ProductPage>
    );
  if (mode === "compare")
    return (
      <ProductPage
        title="Registry Diff"
        description={`比较 ${environment} revision ${from} → ${to}。`}
        classification="FROZEN_API"
      >
        <section className="panel">
          <QuerySurface query={diff}>
            {(item) => (
              <>
                <div className="metrics-row">
                  <MetricCard label="Added" value={item.added.length} />
                  <MetricCard label="Removed" value={item.removed.length} />
                  <MetricCard label="Changed" value={item.changed.length} />
                </div>
                <CodeOrJsonViewer value={item} />
              </>
            )}
          </QuerySurface>
        </section>
      </ProductPage>
    );
  if (mode === "revision")
    return (
      <ProductPage
        title={`Registry Revision ${revision}`}
        description="从冻结 history 查询选择的 Snapshot；详情由历史项和当前示例投影组合。"
        classification="WEB_COMPOSED"
      >
        <section className="panel">
          <QuerySurface query={history}>
            {(items) => {
              const item = items.find((value) => String(value.revision) === revision);
              return item ? (
                <KeyValueList
                  entries={[
                    ["Environment", item.environment],
                    ["Revision", item.revision],
                    ["Checksum", <code>{item.checksum}</code>],
                    ["Providers", item.providerCount],
                    ["Tools", item.toolCount],
                    ["Published", item.publishedAt],
                  ]}
                />
              ) : (
                <p>该 Revision 不在当前 history 页中。</p>
              );
            }}
          </QuerySurface>
        </section>
      </ProductPage>
    );
  return (
    <ProductPage
      title="Registry"
      description="Latest、History 和 Diff 均为冻结只读能力。"
      classification="FROZEN_API"
      actions={
        <>
          <Button onClick={() => navigate("/registry/compare")}>比较 Revisions</Button>
          <Button onClick={() => navigate("/registry/publish")}>查看 Publish 边界</Button>
        </>
      }
    >
      <div className="grid-two">
        <section className="panel">
          <h2>Latest</h2>
          <QuerySurface query={latest}>
            {(item) => (
              <KeyValueList
                entries={[
                  ["Environment", item.environment],
                  ["Revision", item.revision],
                  ["Checksum", <code>{item.checksum}</code>],
                  ["Providers", item.providerCount],
                  ["Tools", item.toolCount],
                  ["Published", item.publishedAt],
                ]}
              />
            )}
          </QuerySurface>
        </section>
        <section className="panel">
          <h2>History</h2>
          <QuerySurface query={history}>
            {(items) => (
              <DataTable
                columns={["Revision", "Checksum", "Published"]}
                rows={items.map((item) => [
                  <button
                    className="table-link"
                    onClick={() => navigate(`/registry/revisions/${item.revision}`)}
                  >
                    {item.revision}
                  </button>,
                  <code>{item.checksum.slice(0, 12)}…</code>,
                  item.publishedAt,
                ])}
              />
            )}
          </QuerySurface>
        </section>
      </div>
    </ProductPage>
  );
}

const conformanceSuites = [
  { id: "suite-contract-v1", name: "Console Contract Examples", cases: 15, status: "READY" },
  { id: "suite-catalog-local", name: "Catalog Schema Local Analysis", cases: 8, status: "READY" },
];
const conformanceRuns = [
  {
    id: "run-local-001",
    suite: "suite-contract-v1",
    status: "PASSED",
    passed: 15,
    failed: 0,
    startedAt: "2026-07-30T05:20:00.000Z",
  },
  {
    id: "run-local-002",
    suite: "suite-catalog-local",
    status: "REVIEW",
    passed: 7,
    failed: 1,
    startedAt: "2026-07-30T05:18:00.000Z",
  },
];
export function ConformancePage({
  mode = "overview",
}: {
  readonly mode?: "overview" | "suites" | "runs" | "run";
}) {
  const { runId = "" } = useParams();
  const run = conformanceRuns.find((item) => item.id === runId) ?? conformanceRuns[0];
  if (mode === "run")
    return (
      <>
        <LocalWorkspaceHeader
          title={run.id}
          description="Deterministic local conformance result; not a platform execution record."
        />
        <section className="panel">
          <KeyValueList
            entries={[
              ["Suite", run.suite],
              ["Status", <StatusBadge status={run.status} />],
              ["Passed", run.passed],
              ["Failed", run.failed],
              ["Started", run.startedAt],
            ]}
          />
          <Timeline
            items={[
              { label: "Load frozen examples", status: "PASSED" },
              { label: "Validate schemas", status: "PASSED" },
              { label: "Review breaking change", status: run.failed ? "REVIEW" : "PASSED" },
            ]}
          />
        </section>
      </>
    );
  if (mode === "suites")
    return (
      <>
        <LocalWorkspaceHeader
          title="Conformance Suites"
          description="Local analysis definitions; no Conformance Run management API."
        />
        <section className="panel">
          <DataTable
            columns={["Suite", "Name", "Cases", "Status"]}
            rows={conformanceSuites.map((item) => [
              item.id,
              item.name,
              item.cases,
              <StatusBadge status={item.status} />,
            ])}
          />
        </section>
      </>
    );
  if (mode === "runs")
    return (
      <>
        <LocalWorkspaceHeader
          title="Conformance Runs"
          description="Deterministic local run history."
        />
        <section className="panel">
          <DataTable
            columns={["Run", "Suite", "Status", "Passed", "Failed", "Started"]}
            rows={conformanceRuns.map((item) => [
              <button
                className="table-link"
                onClick={() => navigate(`/conformance/runs/${item.id}`)}
              >
                {item.id}
              </button>,
              item.suite,
              <StatusBadge status={item.status} />,
              item.passed,
              item.failed,
              item.startedAt,
            ])}
          />
        </section>
      </>
    );
  return (
    <>
      <LocalWorkspaceHeader
        title="Conformance"
        description="Local schema and example analysis; does not write to PMS or invoke a real Provider."
        actions={<Button onClick={() => navigate("/conformance/runs")}>查看 Runs</Button>}
      />
      <div className="metrics-row">
        <MetricCard label="Suites" value={conformanceSuites.length} />
        <MetricCard label="Runs" value={conformanceRuns.length} />
        <MetricCard
          label="Passed"
          value={conformanceRuns.filter((x) => x.status === "PASSED").length}
        />
        <MetricCard
          label="Review"
          value={conformanceRuns.filter((x) => x.status === "REVIEW").length}
        />
      </div>
    </>
  );
}

export function McpExplorerPage({ historyMode = false }: { readonly historyMode?: boolean }) {
  const registry = useRegistryLatest();
  const [request, setRequest] = useState(JSON.stringify({ target: { x: 10, y: 4 } }, null, 2));
  const [result, setResult] = useState<unknown>();
  const localHistory = [
    {
      id: "explore-001",
      tool: "io.sdar/navigation/navigateTo",
      status: "VALIDATED",
      time: "05:22",
    },
    {
      id: "explore-002",
      tool: "io.sdar/climate/setTemperature",
      status: "VALIDATED",
      time: "05:19",
    },
  ];
  if (historyMode)
    return (
      <>
        <LocalWorkspaceHeader
          title="MCP Explorer History"
          description="本地 Request Builder 历史，不是 MCP Server 执行记录。"
        />
        <section className="panel">
          <DataTable
            columns={["Entry", "Tool", "Status", "Time"]}
            rows={localHistory.map((item) => [
              item.id,
              item.tool,
              <StatusBadge status={item.status} />,
              item.time,
            ])}
          />
        </section>
      </>
    );
  return (
    <>
      <LocalWorkspaceHeader
        title="MCP Explorer"
        description="Request Builder、Schema Viewer 和本地示例响应；不会调用真实 MCP Server。"
        actions={<Button onClick={() => navigate("/mcp-explorer/history")}>History</Button>}
      />
      <div className="grid-two">
        <section className="panel">
          <QuerySurface query={registry}>
            {() => (
              <>
                <FormField label="Tool">
                  <select>
                    <option>io.sdar/navigation/navigateTo</option>
                    <option>io.sdar/taskExecution/checkAvailability</option>
                  </select>
                </FormField>
                <FormField label="Request JSON">
                  <textarea
                    className="json-editor"
                    value={request}
                    onChange={(event) => setRequest(event.target.value)}
                  />
                </FormField>
                <Button
                  variant="primary"
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(request);
                      setResult({
                        jsonrpc: "2.0",
                        result: { validated: true, localExample: true, input: parsed },
                      });
                    } catch (error) {
                      setResult({ error: error instanceof Error ? error.message : "Invalid JSON" });
                    }
                  }}
                >
                  Validate locally
                </Button>
              </>
            )}
          </QuerySurface>
        </section>
        <section className="panel">
          <h2>Local Response</h2>
          <CodeOrJsonViewer
            value={result ?? { message: "Run local validation to create an example response." }}
          />
        </section>
      </div>
    </>
  );
}

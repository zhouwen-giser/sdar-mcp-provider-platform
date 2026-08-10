import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Button,
  CodeOrJsonViewer,
  ConfirmDialog,
  DataTable,
  FilterBar,
  FormField,
  KeyValueList,
  MetricCard,
  QuerySurface,
  StatusBadge,
  StepProgress,
  Tabs,
  Timeline,
  Wizard,
} from "../../components/ui.js";
import {
  useAuditEvents,
  useBindings,
  useCreateProvider,
  useDeployments,
  useProvider,
  useProviderPackage,
  useProviderPackages,
  useProviderTypes,
  useProviders,
  useResources,
  useUpdateProviderStatus,
} from "../../queries/hooks.js";
import { navigate } from "../../app/navigation.js";
import {
  ContractBoundaryNote,
  DeferredForm,
  MutationFeedback,
  ProductPage,
} from "../shared/product-components.js";
import { dataMode } from "../../gateways/factory.js";

export function ProviderListPage() {
  const query = useProviders();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("providerId");
  const rows = useMemo(
    () =>
      [...(query.data ?? [])]
        .filter(
          (item) =>
            `${item.providerId} ${item.providerTypeId} ${item.packageLabel}`
              .toLowerCase()
              .includes(search.toLowerCase()) &&
            (status === "all" || item.status === status),
        )
        .sort((a, b) =>
          String(a[sort as keyof typeof a]).localeCompare(String(b[sort as keyof typeof b])),
        ),
    [query.data, search, sort, status],
  );
  return (
    <ProductPage
      title="Provider 列表"
      description="Provider 是全局控制面对象；状态和并发字段逐字遵循冻结合同。"
      classification="FROZEN_API"
      actions={
        <Button variant="primary" onClick={() => navigate("/providers/new")}>
          接入 Provider
        </Button>
      }
    >
      <div className="metrics-row">
        <MetricCard label="总数" value={query.data?.length ?? "—"} />
        <MetricCard
          label="Active"
          value={query.data?.filter((item) => item.status === "active").length ?? "—"}
        />
        <MetricCard
          label="Degraded"
          value={query.data?.filter((item) => item.status === "degraded").length ?? "—"}
        />
        <MetricCard
          label="Draft"
          value={query.data?.filter((item) => item.status === "draft").length ?? "—"}
        />
      </div>
      <FilterBar>
        <input
          aria-label="搜索 Provider"
          placeholder="Provider ID / Type / Package"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label="Provider 状态"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">全部状态</option>
          {["draft", "active", "degraded", "disabled", "retired"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select aria-label="排序" value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="providerId">按 ID</option>
          <option value="providerTypeId">按类型</option>
          <option value="status">按状态</option>
        </select>
      </FilterBar>
      <section className="panel">
        <QuerySurface query={query}>
          {() => (
            <DataTable
              columns={["Provider", "Type", "Package", "Hosting", "Endpoint", "Status", "Updated"]}
              rows={rows.map((item) => [
                <button
                  className="table-link"
                  onClick={() => navigate(`/providers/${item.providerId}`)}
                >
                  {item.providerId}
                </button>,
                item.providerTypeId,
                item.packageLabel,
                item.hostingMode,
                item.adapterEndpoint,
                <StatusBadge status={item.status} />,
                item.updatedAt,
              ])}
            />
          )}
        </QuerySurface>
      </section>
    </ProductPage>
  );
}

const onboardingSteps = [
  "Provider Type",
  "Provider Package",
  "Hosting Mode",
  "Adapter Endpoint",
  "确认并创建",
  "创建结果",
];
export function ProviderCreatePage() {
  const types = useProviderTypes();
  const packages = useProviderPackages();
  const mutation = useCreateProvider();
  const mockMode = dataMode() === "mock";
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<{
    providerId: string;
    providerTypeId: string;
    packageId: string;
    packageVersion: string;
    hostingMode: "vendor_managed" | "platform_managed";
    adapterEndpoint: string;
  }>({
    providerId: mockMode ? "provider-new-001" : "",
    providerTypeId: mockMode ? "ugv" : "",
    packageId: mockMode ? "ugv-provider" : "",
    packageVersion: mockMode ? "1.0.0" : "",
    hostingMode: "platform_managed",
    adapterEndpoint: mockMode ? "127.0.0.1:8121" : "",
  });
  const submit = () => mutation.mutate(draft, { onSuccess: () => setStep(5) });
  return (
    <ProductPage
      title="接入 Provider"
      description="前端向导组合 Provider Type、Package 查询和 createProvider；不创建 onboarding 一键接口。"
      classification="WEB_COMPOSED"
    >
      <Wizard>
        <StepProgress steps={onboardingSteps} current={step} />
        <section className="wizard-body">
          <h2>{onboardingSteps[step]}</h2>
          {step === 0 ? (
            <QuerySurface query={types}>
              {(items) => (
                <FormField label="Provider Type">
                  <select
                    value={draft.providerTypeId}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, providerTypeId: event.target.value }))
                    }
                  >
                    {items.map((item) => (
                      <option key={item.providerTypeId} value={item.providerTypeId}>
                        {item.displayName} ({item.providerTypeId})
                      </option>
                    ))}
                  </select>
                </FormField>
              )}
            </QuerySurface>
          ) : null}
          {step === 1 ? (
            <QuerySurface query={packages}>
              {(items) => (
                <FormField label="Provider Package">
                  <select
                    value={draft.packageId}
                    onChange={(event) => {
                      const selected = items.find((item) => item.packageId === event.target.value);
                      setDraft((current) => ({
                        ...current,
                        packageId: event.target.value,
                        packageVersion: selected?.version ?? current.packageVersion,
                      }));
                    }}
                  >
                    {items
                      .filter((item) => item.providerType === draft.providerTypeId)
                      .map((item) => (
                        <option key={`${item.packageId}-${item.version}`} value={item.packageId}>
                          {item.packageId}@{item.version}
                        </option>
                      ))}
                  </select>
                </FormField>
              )}
            </QuerySurface>
          ) : null}
          {step === 2 ? (
            <FormField label="Hosting Mode">
              <select
                value={draft.hostingMode}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    hostingMode: event.target.value as "vendor_managed" | "platform_managed",
                  }))
                }
              >
                <option value="platform_managed">platform_managed</option>
                <option value="vendor_managed">vendor_managed</option>
              </select>
            </FormField>
          ) : null}
          {step === 3 ? (
            <FormField
              label="Adapter Endpoint"
              hint="合同保留原始字符串语义；此阶段不发起真实连接。"
            >
              <input
                value={draft.adapterEndpoint}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, adapterEndpoint: event.target.value }))
                }
              />
            </FormField>
          ) : null}
          {step === 4 ? (
            <div className="grid-two">
              <section>
                <FormField label="Provider ID">
                  <input
                    value={draft.providerId}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, providerId: event.target.value }))
                    }
                  />
                </FormField>
                <KeyValueList
                  entries={[
                    ["Type", draft.providerTypeId],
                    ["Package", `${draft.packageId}@${draft.packageVersion}`],
                    ["Hosting", draft.hostingMode],
                    ["Endpoint", draft.adapterEndpoint],
                  ]}
                />
              </section>
              <section className="impact-box">
                <h3>调用计划</h3>
                <ol>
                  <li>POST /providers</li>
                  <li>返回 draft Provider</li>
                  <li>后续状态切换和 Resource 绑定由独立合同调用完成</li>
                </ol>
              </section>
            </div>
          ) : null}
          {step === 5 && mutation.data ? (
            <div className="success-result">
              <StatusBadge status={mutation.data.status} />
              <h3>{mutation.data.providerId} 已创建</h3>
              <p>Provider 保持 draft；未自动创建配置、Resource 或 RuntimeDeployment。</p>
              <Button
                variant="primary"
                onClick={() => navigate(`/providers/${mutation.data?.providerId}`)}
              >
                进入 Provider 详情
              </Button>
            </div>
          ) : null}
          <MutationFeedback mutation={mutation} />
        </section>
        <footer className="wizard-actions">
          <Button
            disabled={step === 0 || step === 5 || mutation.isPending}
            onClick={() => setStep((current) => current - 1)}
          >
            上一步
          </Button>
          {step < 4 ? (
            <Button variant="primary" onClick={() => setStep((current) => current + 1)}>
              下一步
            </Button>
          ) : step === 4 ? (
            <Button variant="primary" busy={mutation.isPending} onClick={submit}>
              确认创建
            </Button>
          ) : null}
        </footer>
      </Wizard>
    </ProductPage>
  );
}

type ProviderSection =
  | "overview"
  | "edit"
  | "configuration"
  | "deployments"
  | "resources"
  | "catalog"
  | "activity"
  | "settings"
  | "decommission";
export function ProviderDetailPage({
  section = "overview",
}: {
  readonly section?: ProviderSection;
}) {
  const { providerId = "" } = useParams();
  const provider = useProvider(providerId);
  const deployments = useDeployments();
  const resources = useResources();
  const bindings = useBindings(providerId);
  const audit = useAuditEvents();
  const mutation = useUpdateProviderStatus();
  const [confirm, setConfirm] = useState(false);
  const providerDeployments = (deployments.data ?? []).filter(
    (item) => item.providerId === providerId,
  );
  const boundResourceIds = new Set(
    (bindings.data ?? []).map((item) => `${item.environment}/${item.resourceId}`),
  );
  const providerResources = (resources.data ?? []).filter((item) =>
    boundResourceIds.has(`${item.environment}/${item.resourceId}`),
  );
  return (
    <QuerySurface query={provider}>
      {(item) => (
        <ProductPage
          title={item.providerId}
          description={`${item.providerTypeId} · ${item.packageLabel} · ${item.hostingMode}`}
          classification={section === "settings" ? "CLIENT_ONLY" : "FROZEN_API"}
          actions={
            <>
              <Button onClick={() => navigate(`/providers/${item.providerId}/edit`)}>
                编辑状态
              </Button>
              <Button
                variant="primary"
                onClick={() => navigate(`/runtime/deployments/new?providerId=${item.providerId}`)}
              >
                创建 Deployment
              </Button>
            </>
          }
        >
          <Tabs
            current={section}
            onChange={(id) => navigate(`/providers/${item.providerId}/${id}`)}
            items={[
              { id: "overview", label: "概览" },
              { id: "configuration", label: "配置" },
              { id: "deployments", label: "Deployments" },
              { id: "resources", label: "Resources" },
              { id: "catalog", label: "Catalog" },
              { id: "activity", label: "Activity" },
              { id: "settings", label: "Settings" },
              { id: "decommission", label: "下线" },
            ]}
          />
          {section === "overview" ? (
            <>
              <div className="metrics-row">
                <MetricCard label="Status" value={<StatusBadge status={item.status} />} />
                <MetricCard label="Deployments" value={providerDeployments.length} />
                <MetricCard label="Bound Resources" value={providerResources.length} />
                <MetricCard label="Updated At" value={item.updatedAt} />
              </div>
              <div className="grid-two">
                <section className="panel">
                  <h2>合同字段</h2>
                  <KeyValueList
                    entries={[
                      ["Provider ID", item.providerId],
                      ["Provider Type", item.providerTypeId],
                      ["Package", item.packageLabel],
                      ["Hosting Mode", item.hostingMode],
                      ["Adapter Endpoint", item.adapterEndpoint],
                      ["Status", <StatusBadge status={item.status} />],
                      ["updatedAt", item.updatedAt],
                    ]}
                  />
                </section>
                <section className="panel">
                  <h2>下一步</h2>
                  <Timeline
                    items={[
                      { label: "Provider created", status: item.status },
                      { label: "Bind resources", meta: `${providerResources.length} bound` },
                      {
                        label: "Create RuntimeDeployment",
                        meta: `${providerDeployments.length} existing`,
                      },
                      { label: "Observe Registry", meta: "Generated by existing closure flow" },
                    ]}
                  />
                </section>
              </div>
            </>
          ) : null}
          {section === "edit" ? (
            <section className="panel narrow-form">
              <h2>编辑 Provider</h2>
              <ContractBoundaryNote>
                V1 不提供任意 PATCH。当前页面只执行 updateProviderStatus；Type、Package、Hosting
                Mode 与 Endpoint 只读。
              </ContractBoundaryNote>
              <KeyValueList
                entries={[
                  ["Type", item.providerTypeId],
                  ["Package", item.packageLabel],
                  ["Hosting", item.hostingMode],
                  ["Endpoint", item.adapterEndpoint],
                  ["Concurrency", `expectedUpdatedAt = ${item.updatedAt}`],
                ]}
              />
              <div className="button-row">
                {["draft", "active", "degraded", "disabled"].map((status) => (
                  <Button
                    key={status}
                    disabled={status === item.status}
                    onClick={() =>
                      mutation.mutate({
                        providerId: item.providerId,
                        status: status as typeof item.status,
                        expectedUpdatedAt: item.updatedAt,
                      })
                    }
                  >
                    设为 {status}
                  </Button>
                ))}
              </div>
              <MutationFeedback mutation={mutation} />
            </section>
          ) : null}
          {section === "configuration" ? (
            <section className="panel">
              <h2>Provider 配置入口</h2>
              <p>
                ConfigurationDraft 使用 targetType=provider 或 runtime_deployment；Provider 本身没有
                ConfigurationProfile 对象。
              </p>
              <Button
                onClick={() =>
                  navigate(`/configuration/new?targetType=provider&targetId=${item.providerId}`)
                }
              >
                创建 Provider Draft
              </Button>
            </section>
          ) : null}
          {section === "deployments" ? (
            <section className="panel">
              <DataTable
                columns={["Deployment", "Environment", "Desired", "Status", "Revision"]}
                rows={providerDeployments.map((deployment) => [
                  <button
                    className="table-link"
                    onClick={() =>
                      navigate(
                        `/runtime/deployments/${deployment.providerId}/${deployment.deploymentId}`,
                      )
                    }
                  >
                    {deployment.deploymentId}
                  </button>,
                  deployment.environment,
                  `${deployment.desiredState}/${deployment.desiredReplicas}`,
                  <StatusBadge status={deployment.status} />,
                  `${deployment.observedRevision}/${deployment.desiredRevision}`,
                ])}
              />
            </section>
          ) : null}
          {section === "resources" ? (
            <section className="panel">
              <DataTable
                columns={["Resource", "Environment", "Type", "Status"]}
                rows={providerResources.map((resource) => [
                  <button
                    className="table-link"
                    onClick={() =>
                      navigate(`/resources/${resource.environment}/${resource.resourceId}`)
                    }
                  >
                    {resource.resourceId}
                  </button>,
                  resource.environment,
                  resource.resourceType,
                  <StatusBadge status={resource.status} />,
                ])}
              />
              <Button onClick={() => navigate(`/resources?bindProvider=${item.providerId}`)}>
                管理绑定
              </Button>
            </section>
          ) : null}
          {section === "catalog" ? (
            <section className="panel">
              <h2>Catalog Read Model</h2>
              <p>
                Catalog 由 Registry Snapshot 中 Provider projection 展示；重新发现只能通过
                RuntimeDeployment reconcile 触发。
              </p>
              <Button onClick={() => navigate(`/catalog/providers/${item.providerId}`)}>
                打开 Provider Catalog
              </Button>
            </section>
          ) : null}
          {section === "activity" ? (
            <section className="panel">
              <DataTable
                columns={["Action", "Actor", "Correlation", "Time"]}
                rows={(audit.data ?? [])
                  .filter((event) => event.subjectId === item.providerId)
                  .map((event) => [
                    event.action,
                    event.actorId,
                    <code>{event.correlationId}</code>,
                    event.occurredAt,
                  ])}
              />
            </section>
          ) : null}
          {section === "settings" ? (
            <section className="panel">
              <h2>本地页面设置</h2>
              <p>标签、表格列与默认 Tab 仅存于浏览器，不写入 Provider。</p>
              <FormField label="本地显示名称">
                <input defaultValue={item.providerId} />
              </FormField>
              <Button
                onClick={() =>
                  sessionStorage.setItem(`provider-label:${item.providerId}`, item.providerId)
                }
              >
                保存本地偏好
              </Button>
            </section>
          ) : null}
          {section === "decommission" ? (
            <section className="panel danger-zone">
              <h2>Provider 下线</h2>
              <p>
                关联 {providerResources.length} 个 Resource、{providerDeployments.length} 个
                RuntimeDeployment。目标状态为 retired；原因不属于合同字段。
              </p>
              <Button
                variant="danger"
                disabled={item.status === "retired"}
                onClick={() => setConfirm(true)}
              >
                下线 Provider
              </Button>
              <ConfirmDialog
                open={confirm}
                title="确认下线 Provider"
                impact={
                  <ul>
                    <li>Provider 状态变为 retired</li>
                    <li>现有绑定和 Deployment 不会被级联删除</li>
                    <li>使用 expectedUpdatedAt={item.updatedAt}</li>
                  </ul>
                }
                requirePhrase={item.providerId}
                reasonRequired
                confirmText="确认下线"
                busy={mutation.isPending}
                onCancel={() => setConfirm(false)}
                onConfirm={() =>
                  mutation.mutate(
                    {
                      providerId: item.providerId,
                      status: "retired",
                      expectedUpdatedAt: item.updatedAt,
                    },
                    { onSuccess: () => setConfirm(false) },
                  )
                }
              />
              <MutationFeedback mutation={mutation} />
            </section>
          ) : null}
        </ProductPage>
      )}
    </QuerySurface>
  );
}

type PackageMode = "list" | "new" | "import" | "detail" | "version" | "qualification" | "usage";
export function ProviderPackagesPage({ mode }: { readonly mode: PackageMode }) {
  const { packageId = "", version } = useParams();
  const list = useProviderPackages();
  const detail = useProviderPackage(packageId, version);
  if (mode === "new")
    return (
      <ProductPage
        title="注册 Provider Package"
        description="完整的元数据与归档校验体验；V1 只冻结 Package 查询。"
        classification="DEFERRED"
      >
        <DeferredForm
          title="Package 注册"
          reason="Not available in Console API V1"
          fields={[
            { label: "Package ID", value: "new-provider-package" },
            { label: "Version", value: "1.0.0" },
            { label: "Provider Type", value: "ugv", kind: "select" },
            { label: "Manifest", value: "package.json", kind: "textarea" },
          ]}
        />
      </ProductPage>
    );
  if (mode === "import")
    return (
      <ProductPage
        title="导入 Provider Package"
        description="解析本地归档、展示 Manifest 和兼容性，但不模拟后端注册。"
        classification="DEFERRED"
      >
        <DeferredForm
          title="Package 导入"
          reason="浏览器上传/注册命令不在冻结合同中。"
          fields={[
            { label: "Local archive", value: "provider-package.tgz" },
            { label: "Checksum", value: "在本地选择文件后计算" },
            { label: "Validation policy", value: "manifest + schema + SBOM", kind: "select" },
          ]}
        />
      </ProductPage>
    );
  if (mode === "list")
    return (
      <ProductPage
        title="Provider Packages"
        description="Package、版本、Hosting Mode 和 Qualification 的冻结只读查询。"
        classification="FROZEN_API"
        actions={
          <>
            <Button onClick={() => navigate("/provider-packages/import")}>导入检查</Button>
            <Button variant="primary" onClick={() => navigate("/provider-packages/new")}>
              注册 Package
            </Button>
          </>
        }
      >
        <section className="panel">
          <QuerySurface query={list}>
            {(items) => (
              <DataTable
                columns={[
                  "Package",
                  "Version",
                  "Provider Type",
                  "Hosting",
                  "Runtime",
                  "Component",
                  "Real Resource",
                ]}
                rows={items.map((item) => [
                  <button
                    className="table-link"
                    onClick={() =>
                      navigate(`/provider-packages/${item.packageId}/versions/${item.version}`)
                    }
                  >
                    {item.packageId}
                  </button>,
                  item.version,
                  item.providerType,
                  item.hostingModes.join(", "),
                  item.runtimeVersion,
                  <StatusBadge status={item.componentStatus} />,
                  <StatusBadge status={item.realResourceStatus} />,
                ])}
              />
            )}
          </QuerySurface>
        </section>
      </ProductPage>
    );
  return (
    <QuerySurface query={detail}>
      {(item) => (
        <ProductPage
          title={`${item.packageId}@${item.version}`}
          description={`${item.providerType} · compatible runtime ${item.runtimeVersion}`}
          classification="FROZEN_API"
        >
          <Tabs
            current={mode === "detail" ? "version" : mode}
            onChange={(id) =>
              navigate(
                `/provider-packages/${item.packageId}/versions/${item.version}/${id === "version" ? "" : id}`.replace(
                  /\/$/,
                  "",
                ),
              )
            }
            items={[
              { id: "version", label: "Version" },
              { id: "qualification", label: "Qualification" },
              { id: "usage", label: "Usage" },
            ]}
          />
          {mode === "qualification" ? (
            <div className="grid-two">
              <section className="panel">
                <h2>Qualification</h2>
                <KeyValueList
                  entries={[
                    ["Component", <StatusBadge status={item.componentStatus} />],
                    ["Real Resource", <StatusBadge status={item.realResourceStatus} />],
                    ["Protocol", "frozen_v1"],
                  ]}
                />
              </section>
              <section className="panel">
                <h2>Evidence boundary</h2>
                <p>合同只暴露聚合状态，不暴露测试报告管理命令。</p>
              </section>
            </div>
          ) : mode === "usage" ? (
            <section className="panel">
              <h2>前端组合的使用情况</h2>
              <DataTable
                columns={["Provider", "Status"]}
                rows={(list.data ?? [])
                  .filter((pkg) => pkg.packageId === item.packageId)
                  .map(() => ["由 Provider 列表按 packageId 组合", "只读"])}
              />
            </section>
          ) : (
            <div className="grid-two">
              <section className="panel">
                <h2>Metadata</h2>
                <KeyValueList
                  entries={[
                    ["Package ID", item.packageId],
                    ["Version", item.version],
                    ["Provider Type", item.providerType],
                    ["Hosting Modes", item.hostingModes.join(", ")],
                    ["Runtime", item.runtimeVersion],
                  ]}
                />
              </section>
              <section className="panel">
                <h2>合同投影</h2>
                <CodeOrJsonViewer value={item} />
              </section>
            </div>
          )}
        </ProductPage>
      )}
    </QuerySurface>
  );
}

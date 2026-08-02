import { useState } from "react";
import { useParams } from "react-router-dom";
import {
  Button,
  DataTable,
  FormField,
  KeyValueList,
  MetricCard,
  StatusBadge,
  Tabs,
  Toast,
} from "../../components/ui.js";
import { navigate } from "../../app/navigation.js";
import { LocalWorkspaceHeader, ProductPage } from "../shared/product-components.js";

interface Environment {
  id: string;
  label: string;
  region: string;
  status: string;
  providers: number;
  deployments: number;
  registryRevision: number;
}
const environments: readonly Environment[] = [
  {
    id: "production",
    label: "Production",
    region: "ap-northeast-1",
    status: "ACTIVE",
    providers: 3,
    deployments: 2,
    registryRevision: 42,
  },
  {
    id: "staging",
    label: "Staging",
    region: "ap-northeast-1",
    status: "ACTIVE",
    providers: 2,
    deployments: 1,
    registryRevision: 17,
  },
];
const users = [
  {
    id: "user-local-admin",
    name: "Local administrator",
    email: "admin@example.invalid",
    role: "administrator",
    status: "LOCAL",
  },
  {
    id: "user-local-reader",
    name: "Local reviewer",
    email: "reader@example.invalid",
    role: "reader",
    status: "LOCAL",
  },
];
const roles = [
  {
    id: "administrator",
    name: "Administrator",
    permissions: 14,
    description: "Contract write operations and all read operations.",
  },
  { id: "reader", name: "Reader", permissions: 9, description: "Contract read operations only." },
];

export function EnvironmentsPage({ detail = false }: { readonly detail?: boolean }) {
  const { environmentId = "" } = useParams();
  const item = environments.find((value) => value.id === environmentId) ?? environments[0];
  if (!detail)
    return (
      <ProductPage
        title="Environments"
        description="Environment 是现有对象字段和查询作用域；此页面是本地导航与聚合视图，不创建 Environment Domain。"
        classification="CLIENT_ONLY"
      >
        <div className="metrics-row">
          <MetricCard label="Environments" value={environments.length} />
          <MetricCard
            label="Providers"
            value={environments.reduce((sum, value) => sum + value.providers, 0)}
          />
          <MetricCard
            label="Deployments"
            value={environments.reduce((sum, value) => sum + value.deployments, 0)}
          />
          <MetricCard
            label="Registry revisions"
            value={environments.map((value) => value.registryRevision).join(" / ")}
          />
        </div>
        <section className="panel">
          <DataTable
            columns={["Environment", "Region", "Status", "Providers", "Deployments", "Registry"]}
            rows={environments.map((value) => [
              <button className="table-link" onClick={() => navigate(`/environments/${value.id}`)}>
                {value.label}
              </button>,
              value.region,
              <StatusBadge status={value.status} />,
              value.providers,
              value.deployments,
              value.registryRevision,
            ])}
          />
        </section>
      </ProductPage>
    );
  return (
    <ProductPage
      title={item.label}
      description="本地环境聚合视图；不会向 Console API 写入环境设置。"
      classification="CLIENT_ONLY"
    >
      <div className="grid-two">
        <section className="panel">
          <KeyValueList
            entries={[
              ["Environment ID", item.id],
              ["Region", item.region],
              ["Status", <StatusBadge status={item.status} />],
              ["Provider count", item.providers],
              ["Deployment count", item.deployments],
              ["Registry revision", item.registryRevision],
            ]}
          />
        </section>
        <section className="panel">
          <h2>相关入口</h2>
          <div className="quick-actions">
            <Button onClick={() => navigate(`/providers?environment=${item.id}`)}>Providers</Button>
            <Button onClick={() => navigate(`/runtime/deployments?environment=${item.id}`)}>
              Deployments
            </Button>
            <Button onClick={() => navigate(`/registry?environment=${item.id}`)}>Registry</Button>
            <Button onClick={() => navigate(`/audit?environment=${item.id}`)}>Audit</Button>
          </div>
        </section>
      </div>
    </ProductPage>
  );
}

export function AccessPage({
  mode,
}: {
  readonly mode: "users" | "roles" | "role" | "service-accounts";
}) {
  const { roleId = "" } = useParams();
  if (mode === "users")
    return (
      <>
        <LocalWorkspaceHeader
          title="用户管理"
          description="Authentication and access management are outside Console API V1；用户数据为本地评审 Fixture。"
        />
        <section className="panel">
          <DataTable
            columns={["User", "Name", "Email", "Role", "Status"]}
            rows={users.map((user) => [
              user.id,
              user.name,
              user.email,
              <button className="table-link" onClick={() => navigate(`/access/roles/${user.role}`)}>
                {user.role}
              </button>,
              <StatusBadge status={user.status} />,
            ])}
          />
        </section>
      </>
    );
  if (mode === "service-accounts")
    return (
      <>
        <LocalWorkspaceHeader
          title="Service Accounts"
          description="不生成 Token、不展示 Secret、不声称身份已生效。"
        />
        <section className="panel">
          <DataTable
            columns={["Account", "Purpose", "Status", "Credential"]}
            rows={[
              [
                "pms-web-review",
                "UI review only",
                <StatusBadge status="DISABLED" />,
                "No credential generated",
              ],
              [
                "automation-example",
                "Documentation fixture",
                <StatusBadge status="DISABLED" />,
                "No credential generated",
              ],
            ]}
          />
          <div className="page-actions">
            <Button disabled title="Authentication is outside Console API V1">
              Create unavailable
            </Button>
          </div>
        </section>
      </>
    );
  if (mode === "role") {
    const role = roles.find((value) => value.id === roleId) ?? roles[0];
    return (
      <>
        <LocalWorkspaceHeader
          title={role.name}
          description="本地角色说明；实际 Bearer Principal 和角色执行属于后续认证实现。"
        />
        <div className="grid-two">
          <section className="panel">
            <KeyValueList
              entries={[
                ["Role ID", role.id],
                ["Permissions", role.permissions],
                ["Description", role.description],
                ["Persistence", "Local fixture only"],
              ]}
            />
          </section>
          <section className="panel">
            <h2>Contract scope</h2>
            <DataTable
              columns={["Capability", "Allowed"]}
              rows={[
                ["Read frozen resources", <StatusBadge status="ALLOWED" />],
                [
                  "Execute frozen commands",
                  <StatusBadge status={role.id === "administrator" ? "ALLOWED" : "DENIED"} />,
                ],
                ["Manage users or roles", <StatusBadge status="OUTSIDE_V1" />],
              ]}
            />
          </section>
        </div>
      </>
    );
  }
  return (
    <>
      <LocalWorkspaceHeader
        title="角色管理"
        description="展示冻结合同使用的 reader / administrator 角色语义；不实现 RBAC。"
      />
      <section className="panel">
        <DataTable
          columns={["Role", "Name", "Permissions", "Description"]}
          rows={roles.map((role) => [
            <button className="table-link" onClick={() => navigate(`/access/roles/${role.id}`)}>
              {role.id}
            </button>,
            role.name,
            role.permissions,
            role.description,
          ])}
        />
      </section>
    </>
  );
}

type SettingsMode = "general" | "runtime-defaults" | "registry" | "retention" | "security";
const settingsCopy: Record<
  SettingsMode,
  { title: string; description: string; fields: readonly [string, string][] }
> = {
  general: {
    title: "General Settings",
    description: "本地 Console 显示偏好，不修改 PMS 业务配置。",
    fields: [
      ["Console name", "SDAR Provider Management"],
      ["Default environment", "production"],
      ["Time zone", "Asia/Tokyo"],
    ],
  },
  "runtime-defaults": {
    title: "Runtime Defaults",
    description: "仅作为创建向导的本地默认值，不形成 Runtime Defaults API。",
    fields: [
      ["Runtime release", "runtime-2.0.0-rc.1"],
      ["Desired replicas", "1"],
      ["Reconcile timeout", "120 seconds"],
    ],
  },
  registry: {
    title: "Registry Settings",
    description: "Registry 仍由既有收口流程产生；此处只有显示偏好。",
    fields: [
      ["Default view", "latest"],
      ["Diff context", "3 revisions"],
      ["Breaking highlight", "enabled"],
    ],
  },
  retention: {
    title: "Retention Settings",
    description: "展示未来设置体验，不改变 Audit、Job 或本地工作区保留策略。",
    fields: [
      ["Local notifications", "30 days"],
      ["Explorer history", "20 entries"],
      ["Local incidents", "90 days"],
    ],
  },
  security: {
    title: "Security Settings",
    description: "不实现登录、OIDC、Token、Session 或真实权限系统。",
    fields: [
      ["Authentication", "Not configured in this release"],
      ["Bearer role model", "reader / administrator"],
      ["Secret values", "Never exposed"],
    ],
  },
};
export function SettingsPage({ mode = "general" }: { readonly mode?: SettingsMode }) {
  const [saved, setSaved] = useState(false);
  const config = settingsCopy[mode];
  return (
    <>
      <LocalWorkspaceHeader title={config.title} description={config.description} />
      <Tabs
        current={mode}
        onChange={(id) => navigate(`/system/${id}`)}
        items={Object.entries(settingsCopy).map(([id, value]) => ({ id, label: value.title }))}
      />
      <section className="panel narrow-form">
        {config.fields.map(([label, value]) => (
          <FormField key={label} label={label}>
            <input defaultValue={value} />
          </FormField>
        ))}
        <div className="page-actions">
          <Button variant="primary" onClick={() => setSaved(true)}>
            保存到本地偏好
          </Button>
        </div>
        {saved ? <Toast>设置已保存在当前浏览器评审会话中；未调用 Console API。</Toast> : null}
      </section>
    </>
  );
}

export function ProfilePage({ preferences = false }: { readonly preferences?: boolean }) {
  const [density, setDensity] = useState("comfortable");
  const [dateFormat, setDateFormat] = useState("iso");
  const [saved, setSaved] = useState(false);
  if (!preferences)
    return (
      <>
        <LocalWorkspaceHeader
          title="用户资料"
          description="当前版本无需登录；此资料仅用于产品体验。"
        />
        <div className="grid-two">
          <section className="panel">
            <KeyValueList
              entries={[
                ["Display name", "Local review operator"],
                ["Actor ID", "prototype-admin"],
                ["Role", "administrator (mock context)"],
                ["Authentication", "Not implemented"],
              ]}
            />
          </section>
          <section className="panel">
            <h2>安全边界</h2>
            <ul>
              <li>不保存密码或 Token</li>
              <li>不创建 Session</li>
              <li>写命令中的 Actor 仅由 Mock Gateway 提供</li>
            </ul>
          </section>
        </div>
      </>
    );
  return (
    <>
      <LocalWorkspaceHeader
        title="用户偏好"
        description="表格密度、日期显示和默认落地页属于 CLIENT_ONLY。"
      />
      <section className="panel narrow-form">
        <FormField label="Table density">
          <select value={density} onChange={(event) => setDensity(event.target.value)}>
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </FormField>
        <FormField label="Date format">
          <select value={dateFormat} onChange={(event) => setDateFormat(event.target.value)}>
            <option value="iso">ISO 8601</option>
            <option value="local">Local</option>
          </select>
        </FormField>
        <FormField label="Landing page">
          <select defaultValue="dashboard">
            <option value="dashboard">Dashboard</option>
            <option value="attention">Attention Center</option>
          </select>
        </FormField>
        <Button variant="primary" onClick={() => setSaved(true)}>
          保存本地偏好
        </Button>
        {saved ? <Toast>偏好已保存到当前会话。</Toast> : null}
      </section>
    </>
  );
}

type StatusMode =
  "login" | "session-expired" | "access-denied" | "403" | "404" | "500" | "maintenance";
const statusCopy: Record<
  StatusMode,
  { code: string; title: string; description: string; action: string }
> = {
  login: {
    code: "LOCAL_REVIEW",
    title: "当前版本无需登录",
    description: "本交付仅运行 Contract-first Mock；未实现账号密码、Token、OIDC 或 Session。",
    action: "进入工作台",
  },
  "session-expired": {
    code: "SESSION_NOT_ACTIVE",
    title: "没有活动会话",
    description: "认证不在 Console API V1 范围内。此状态页用于未来集成后的导航恢复。",
    action: "返回工作台",
  },
  "access-denied": {
    code: "ACCESS_DENIED",
    title: "访问被拒绝",
    description: "当前页面展示未来权限拒绝体验，不代表本地 Mock 已实现 RBAC。",
    action: "查看可用页面",
  },
  "403": {
    code: "403",
    title: "没有执行该操作的权限",
    description: "reader 只能访问冻结读接口；写命令要求 administrator。",
    action: "返回工作台",
  },
  "404": {
    code: "404",
    title: "页面或对象不存在",
    description: "检查 URL 参数，或从领域列表重新进入。不会回退到 Dashboard。",
    action: "打开全局搜索",
  },
  "500": {
    code: "500",
    title: "页面处理失败",
    description: "错误已被应用级或路由级边界捕获；原始异常和堆栈不会显示。",
    action: "返回工作台",
  },
  maintenance: {
    code: "MAINTENANCE",
    title: "控制台维护中",
    description: "该视觉状态用于计划维护；不会尝试连接真实 PMS API。",
    action: "查看系统健康",
  },
};
export function StatusPage({ mode }: { readonly mode: StatusMode }) {
  const item = statusCopy[mode];
  const target =
    mode === "404" ? "/search" : mode === "maintenance" ? "/operations/health" : "/dashboard";
  return (
    <ProductPage title={item.title} description={item.description} classification="CLIENT_ONLY">
      <section className="status-page">
        <strong>{item.code}</strong>
        <p>{item.description}</p>
        <Button variant="primary" onClick={() => navigate(target)}>
          {item.action}
        </Button>
      </section>
    </ProductPage>
  );
}

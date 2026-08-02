import { type ReactNode, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useScenario } from "../app/providers/app-providers.js";
import { PRODUCT_SCENARIOS } from "../scenarios/types.js";

const navigation = [
  [
    "概览",
    [
      ["工作台", "/dashboard"],
      ["待处理中心", "/attention"],
      ["通知中心", "/notifications"],
      ["全局搜索", "/search"],
    ],
  ],
  [
    "Provider",
    [
      ["Provider 列表", "/providers"],
      ["Provider Package", "/provider-packages"],
    ],
  ],
  [
    "运行管理",
    [
      ["Runtime Deployment", "/runtime/deployments"],
      ["Runtime Instance", "/runtime/instances"],
      ["Runtime Process", "/runtime/processes"],
      ["Runtime Release", "/runtime/releases"],
      ["Database Profile", "/databases"],
    ],
  ],
  [
    "制品与配置",
    [
      ["配置中心", "/configuration"],
      ["Secret Reference", "/secrets"],
    ],
  ],
  [
    "发现与资源",
    [
      ["Resource", "/resources"],
      ["Catalog", "/catalog"],
      ["Registry", "/registry"],
      ["Conformance", "/conformance"],
      ["MCP Explorer", "/mcp-explorer"],
    ],
  ],
  [
    "运维",
    [
      ["Operations", "/operations"],
      ["Worker Jobs", "/operations/jobs"],
      ["Worker Queue", "/operations/queues"],
      ["Incidents", "/operations/incidents"],
      ["系统健康", "/operations/health"],
    ],
  ],
  [
    "治理",
    [
      ["Change Requests", "/changes"],
      ["Audit", "/audit"],
    ],
  ],
  [
    "系统与本地设置",
    [
      ["Environments", "/environments"],
      ["用户与访问", "/access/users"],
      ["系统设置", "/system/general"],
      ["个人偏好", "/profile/preferences"],
    ],
  ],
] as const;

export function AppShell({ operationPanel }: { readonly operationPanel?: ReactNode }) {
  return (
    <div className="app-shell">
      {import.meta.env.DEV && import.meta.env.VITE_PMS_ENABLE_PROTOTYPE_TOOLS !== "false" ? (
        <PrototypeBanner />
      ) : null}
      <GlobalHeader />
      <SideNavigation />
      <main className="content" id="main-content">
        <Outlet />
      </main>
      {operationPanel}
    </div>
  );
}
export function PrototypeBanner() {
  return (
    <div className="prototype-banner">
      MOCK PRODUCT EXPERIENCE · Contract V1.0 Frozen · No real PMS API connection
    </div>
  );
}
function GlobalHeader() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  return (
    <header className="global-header">
      <NavLink className="brand" to="/dashboard">
        SDAR <span>Provider Management</span>
      </NavLink>
      <form
        className="global-search"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate(`/search?q=${encodeURIComponent(search)}`);
        }}
      >
        <span>全局搜索</span>
        <input
          aria-label="全局搜索"
          placeholder="Provider / Resource / Runtime / Audit"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </form>
      <EnvironmentSelector />
      {import.meta.env.DEV && import.meta.env.VITE_PMS_ENABLE_PROTOTYPE_TOOLS !== "false" ? (
        <ScenarioSwitcher />
      ) : null}
      <div className="identity">
        <strong>Local review mode</strong>
        <small>Authentication outside Console API V1</small>
      </div>
    </header>
  );
}
function SideNavigation() {
  const location = useLocation();
  return (
    <nav className="side-nav" aria-label="主导航">
      {navigation.map(([group, items]) => (
        <section key={group}>
          <h2>{group}</h2>
          {items.map(([label, path]) => (
            <NavLink
              key={path}
              to={path}
              className={
                location.pathname === path ||
                (path !== "/dashboard" && location.pathname.startsWith(path))
                  ? "active"
                  : ""
              }
            >
              {label}
            </NavLink>
          ))}
        </section>
      ))}
      {import.meta.env.DEV && import.meta.env.VITE_PMS_ENABLE_PROTOTYPE_TOOLS !== "false" ? (
        <section>
          <h2>Prototype Tools</h2>
          <NavLink to="/_prototype/components">组件展示</NavLink>
          <NavLink to="/_prototype/scenarios">场景展示</NavLink>
        </section>
      ) : null}
    </nav>
  );
}
function EnvironmentSelector() {
  const [environment, setEnvironment] = useState("production");
  return (
    <label className="environment-selector">
      <span>环境</span>
      <select value={environment} onChange={(event) => setEnvironment(event.target.value)}>
        <option value="production">production</option>
        <option value="staging">staging</option>
      </select>
    </label>
  );
}
function ScenarioSwitcher() {
  const [scenario, setScenario] = useScenario();
  return (
    <label className="scenario-switcher">
      <span>Scenario</span>
      <select
        value={scenario}
        onChange={(event) => setScenario(event.target.value as typeof scenario)}
      >
        {PRODUCT_SCENARIOS.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </label>
  );
}

import { type PropsWithChildren, type ReactNode, useState } from "react";
import { APP_ROUTES, navigate, type AppRoute } from "../router.js";
import { useScenario } from "../data/context.js";
import { PROTOTYPE_SCENARIOS } from "../data/scenarios.js";

const navigation = [
  ["概览", [["工作台", "/dashboard"]]],
  [
    "Providers",
    [
      ["Providers", "/providers"],
      ["Resources", "/resources"],
      ["Provider Packages", "/provider-packages"],
    ],
  ],
  [
    "Runtime",
    [
      ["Deployments", "/runtime/deployments"],
      ["Processes", "/runtime/processes"],
      ["Releases", "/runtime/releases"],
      ["Database Profiles", "/databases"],
    ],
  ],
  ["Configuration", [["配置中心", "/configuration"]]],
  [
    "Discovery",
    [
      ["Catalog", "/catalog"],
      ["Registry", "/registry"],
      ["Conformance", "/conformance"],
      ["MCP Explorer", "/mcp-explorer"],
    ],
  ],
  [
    "Operations",
    [
      ["系统健康", "/operations/health"],
      ["Worker Jobs", "/operations/jobs"],
      ["Incidents", "/operations/incidents"],
    ],
  ],
  [
    "Governance",
    [
      ["Change Requests", "/changes"],
      ["Audit", "/audit"],
      ["System Settings", "/system/settings"],
    ],
  ],
] as const;

export function AppShell({
  route,
  operationPanel,
  children,
}: PropsWithChildren<{
  readonly route: AppRoute | undefined;
  readonly operationPanel?: ReactNode;
}>) {
  return (
    <div className="app-shell">
      <PrototypeBanner />
      <GlobalHeader />
      <SideNavigation activePath={route?.path} />
      <main className="content" id="main-content">
        {children}
      </main>
      {operationPanel}
    </div>
  );
}

export function PrototypeBanner() {
  return <div className="prototype-banner">PROTOTYPE / MOCK DATA · 所有技术操作均为前端模拟</div>;
}

export function GlobalHeader() {
  return (
    <header className="global-header">
      <button className="brand" onClick={() => navigate("/dashboard")}>
        SDAR <span>Provider Management</span>
      </button>
      <label className="global-search">
        <span>全局搜索</span>
        <input placeholder="Provider / Deployment / Incident" />
      </label>
      <EnvironmentSelector />
      {import.meta.env.DEV ? <ScenarioSwitcher /> : null}
      <div className="identity">
        <strong>平台管理员</strong>
        <small>prototype-user</small>
      </div>
    </header>
  );
}

export function SideNavigation({ activePath }: { readonly activePath: string | undefined }) {
  return (
    <nav className="side-nav" aria-label="主导航">
      {navigation.map(([group, items]) => (
        <section key={group}>
          <h2>{group}</h2>
          {items.map(([label, path]) => (
            <button
              key={path}
              className={
                activePath === path || (path !== "/dashboard" && activePath?.startsWith(path))
                  ? "active"
                  : ""
              }
              onClick={() => navigate(path)}
            >
              {label}
            </button>
          ))}
        </section>
      ))}
      <button onClick={() => navigate("/_prototype/components")}>组件展示</button>
      <button onClick={() => navigate("/_prototype/scenarios")}>场景展示</button>
    </nav>
  );
}

export function EnvironmentSelector() {
  const [environment, setEnvironment] = useState("production-mock");
  return (
    <label className="environment-selector">
      <span>环境</span>
      <select value={environment} onChange={(event) => setEnvironment(event.target.value)}>
        <option value="production-mock">production-mock</option>
        <option value="staging-mock">staging-mock</option>
      </select>
    </label>
  );
}

export function ScenarioSwitcher() {
  const [scenario, setScenario] = useScenario();
  return (
    <label className="scenario-switcher">
      <span>Scenario</span>
      <select
        value={scenario}
        onChange={(event) => setScenario(event.target.value as typeof scenario)}
      >
        {PROTOTYPE_SCENARIOS.map((item) => (
          <option key={item}>{item}</option>
        ))}
      </select>
    </label>
  );
}

export function routeTitle(path: string): string {
  return APP_ROUTES.find((route) => route.path === path)?.title ?? path;
}

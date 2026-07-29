import { useEffect, useState } from "react";

export interface AppRoute {
  readonly path: string;
  readonly title: string;
  readonly group: string;
  readonly level: "P0" | "P1" | "internal";
}

export const APP_ROUTES: readonly AppRoute[] = [
  route("/dashboard", "工作台", "概览"),
  route("/providers", "Providers", "Providers"),
  route("/providers/new", "接入 Provider", "Providers"),
  route("/providers/:providerId", "Provider 详情", "Providers"),
  route("/provider-packages", "Provider Packages", "Providers", "P1"),
  route("/resources", "Resources", "Providers"),
  route("/resources/:resourceId", "Resource 详情", "Providers"),
  route("/runtime/deployments", "Runtime Deployments", "Runtime"),
  route("/runtime/deployments/new", "创建 RuntimeDeployment", "Runtime"),
  route("/runtime/deployments/:deploymentId", "RuntimeDeployment 详情", "Runtime"),
  route("/runtime/processes", "Runtime Processes", "Runtime"),
  route("/runtime/releases", "Runtime Releases", "Runtime", "P1"),
  route("/databases", "Database Profiles", "Runtime", "P1"),
  route("/configuration", "配置中心", "Configuration"),
  route("/configuration/:profileId", "配置详情", "Configuration"),
  route("/catalog", "Catalog", "Discovery"),
  route("/catalog/:providerId/:operationName", "Catalog Operation", "Discovery"),
  route("/registry", "Registry", "Discovery"),
  route("/conformance", "Conformance", "Discovery", "P1"),
  route("/mcp-explorer", "MCP Explorer", "Discovery", "P1"),
  route("/operations/health", "系统健康", "Operations"),
  route("/operations/jobs", "Worker Jobs", "Operations"),
  route("/operations/incidents", "Incidents", "Operations"),
  route("/operations/incidents/:incidentId", "Incident 详情", "Operations"),
  route("/changes", "Change Requests", "Governance", "P1"),
  route("/audit", "Audit", "Governance"),
  route("/system/settings", "System Settings", "Governance", "P1"),
  route("/_prototype/components", "组件展示", "Prototype", "internal"),
  route("/_prototype/scenarios", "场景展示", "Prototype", "internal"),
];

export function matchRoute(pathname: string): AppRoute | undefined {
  return APP_ROUTES.find((candidate) => {
    const expected = candidate.path.split("/").filter(Boolean);
    const actual = pathname.split("/").filter(Boolean);
    return (
      expected.length === actual.length &&
      expected.every((segment, index) => segment.startsWith(":") || segment === actual[index])
    );
  });
}

export function navigate(path: string): void {
  const scenario = new URLSearchParams(window.location.search).get("scenario");
  const url = new URL(path, window.location.origin);
  if (scenario !== null && !url.searchParams.has("scenario"))
    url.searchParams.set("scenario", scenario);
  window.history.pushState({}, "", `${url.pathname}${url.search}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): AppRoute | undefined {
  const [route, setRoute] = useState(() => matchRoute(window.location.pathname));
  useEffect(() => {
    const listener = () => setRoute(matchRoute(window.location.pathname));
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, []);
  return route;
}

function route(
  path: string,
  title: string,
  group: string,
  level: AppRoute["level"] = "P0",
): AppRoute {
  return { path, title, group, level };
}

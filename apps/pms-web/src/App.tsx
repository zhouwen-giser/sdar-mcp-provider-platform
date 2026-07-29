import { useEffect } from "react";
import { AppShell } from "./components/shell.js";
import { OperationPanel } from "./components/operation-panel.js";
import {
  ComponentCatalogue,
  ScenarioCatalogue,
  StructuredPlaceholder,
} from "./pages/foundation.js";
import { navigate, useRoute } from "./router.js";
import { DashboardPage } from "./features/dashboard/DashboardPage.js";
import { ProviderPackagesPage } from "./features/provider-packages/ProviderPackagesPage.js";
import { ProviderDetailPage, ProvidersPage } from "./features/providers/ProviderPages.js";
import { ProviderOnboardingPage } from "./features/providers/ProviderOnboardingPage.js";
import { ResourceDetailPage, ResourcesPage } from "./features/resources/ResourcePages.js";
import "./styles.css";

export function App() {
  const route = useRoute();
  useEffect(() => {
    if (window.location.pathname === "/") navigate("/dashboard");
  }, []);
  if (window.location.pathname === "/") return null;
  const segments = window.location.pathname.split("/").filter(Boolean);
  return (
    <AppShell route={route} operationPanel={<OperationPanel />}>
      {route === undefined ? (
        <StructuredPlaceholder
          route={{
            path: window.location.pathname,
            title: "页面不存在",
            group: "Error",
            level: "P1",
          }}
        />
      ) : route.path === "/_prototype/components" ? (
        <ComponentCatalogue />
      ) : route.path === "/_prototype/scenarios" ? (
        <ScenarioCatalogue />
      ) : route.path === "/dashboard" ? (
        <DashboardPage />
      ) : route.path === "/providers" ? (
        <ProvidersPage />
      ) : route.path === "/providers/new" ? (
        <ProviderOnboardingPage />
      ) : route.path === "/providers/:providerId" ? (
        <ProviderDetailPage providerId={segments[1] ?? ""} />
      ) : route.path === "/provider-packages" ? (
        <ProviderPackagesPage />
      ) : route.path === "/resources" ? (
        <ResourcesPage />
      ) : route.path === "/resources/:resourceId" ? (
        <ResourceDetailPage resourceId={segments[1] ?? ""} />
      ) : (
        <StructuredPlaceholder route={route} />
      )}
    </AppShell>
  );
}

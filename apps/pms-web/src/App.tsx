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
import {
  RuntimeDeploymentDetailPage,
  RuntimeDeploymentsPage,
} from "./features/runtime-deployments/RuntimeDeploymentPages.js";
import { RuntimeDeploymentWizard } from "./features/runtime-deployments/RuntimeDeploymentWizard.js";
import { RuntimeProcessesPage } from "./features/runtime-processes/RuntimeProcessesPage.js";
import { RuntimeReleasesPage } from "./features/runtime-releases/RuntimeReleasesPage.js";
import { DatabaseProfilesPage } from "./features/database-profiles/DatabaseProfilesPage.js";
import {
  RuntimeHealthPage,
  RuntimeIncidentsPage,
  RuntimeJobsPage,
} from "./features/operations/RuntimeRecoveryPage.js";
import { ConfigurationPage } from "./features/configuration/ConfigurationPage.js";
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
      ) : route.path === "/runtime/deployments" ? (
        <RuntimeDeploymentsPage />
      ) : route.path === "/runtime/deployments/new" ? (
        <RuntimeDeploymentWizard />
      ) : route.path === "/runtime/deployments/:deploymentId" ? (
        <RuntimeDeploymentDetailPage deploymentId={segments[2] ?? ""} />
      ) : route.path === "/runtime/processes" ? (
        <RuntimeProcessesPage />
      ) : route.path === "/runtime/releases" ? (
        <RuntimeReleasesPage />
      ) : route.path === "/databases" ? (
        <DatabaseProfilesPage />
      ) : route.path === "/operations/health" ? (
        <RuntimeHealthPage />
      ) : route.path === "/operations/jobs" ? (
        <RuntimeJobsPage />
      ) : route.path === "/operations/incidents" ? (
        <RuntimeIncidentsPage />
      ) : route.path === "/operations/incidents/:incidentId" ? (
        <RuntimeIncidentsPage incidentId={segments[2] ?? ""} />
      ) : route.path === "/configuration" ? (
        <ConfigurationPage />
      ) : route.path === "/configuration/:profileId" ? (
        <ConfigurationPage profileId={segments[1] ?? ""} />
      ) : (
        <StructuredPlaceholder route={route} />
      )}
    </AppShell>
  );
}

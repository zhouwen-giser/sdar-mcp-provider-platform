import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, useParams } from "react-router-dom";
import { AppShell } from "../components/shell.js";
import { OperationPanel } from "../components/operation-panel.js";
import { RouteErrorBoundary } from "./route-error-boundary.js";
import NotFoundPage from "./not-found-page.js";
import { registerRouter } from "./navigation.js";

const DashboardPage = lazy(() =>
  import("../features/overview/OverviewPages.js").then((m) => ({ default: m.DashboardPage })),
);
const AttentionPage = lazy(() =>
  import("../features/overview/OverviewPages.js").then((m) => ({ default: m.AttentionPage })),
);
const NotificationsPage = lazy(() =>
  import("../features/overview/OverviewPages.js").then((m) => ({ default: m.NotificationsPage })),
);
const SearchPage = lazy(() =>
  import("../features/overview/OverviewPages.js").then((m) => ({ default: m.SearchPage })),
);
const ProviderListPage = lazy(() =>
  import("../features/providers/ProviderPages.js").then((m) => ({ default: m.ProviderListPage })),
);
const ProviderCreatePage = lazy(() =>
  import("../features/providers/ProviderPages.js").then((m) => ({ default: m.ProviderCreatePage })),
);
const ProviderDetailPage = lazy(() =>
  import("../features/providers/ProviderPages.js").then((m) => ({ default: m.ProviderDetailPage })),
);
const ProviderPackagesPage = lazy(() =>
  import("../features/providers/ProviderPages.js").then((m) => ({
    default: m.ProviderPackagesPage,
  })),
);
const RuntimeDeploymentListPage = lazy(() =>
  import("../features/runtime/RuntimePages.js").then((m) => ({
    default: m.RuntimeDeploymentListPage,
  })),
);
const RuntimeDeploymentCreatePage = lazy(() =>
  import("../features/runtime/RuntimePages.js").then((m) => ({
    default: m.RuntimeDeploymentCreatePage,
  })),
);
const RuntimeDeploymentDetailPage = lazy(() =>
  import("../features/runtime/RuntimePages.js").then((m) => ({
    default: m.RuntimeDeploymentDetailPage,
  })),
);
const RuntimeInstancesPage = lazy(() =>
  import("../features/runtime/RuntimePages.js").then((m) => ({ default: m.RuntimeInstancesPage })),
);
const RuntimeProcessesPage = lazy(() =>
  import("../features/runtime/RuntimePages.js").then((m) => ({ default: m.RuntimeProcessesPage })),
);
const RuntimeReleasesPage = lazy(() =>
  import("../features/runtime/RuntimePages.js").then((m) => ({ default: m.RuntimeReleasesPage })),
);
const DatabaseProfilesPage = lazy(() =>
  import("../features/runtime/RuntimePages.js").then((m) => ({ default: m.DatabaseProfilesPage })),
);
const ConfigurationListPage = lazy(() =>
  import("../features/configuration/ConfigurationPages.js").then((m) => ({
    default: m.ConfigurationListPage,
  })),
);
const ConfigurationCreatePage = lazy(() =>
  import("../features/configuration/ConfigurationPages.js").then((m) => ({
    default: m.ConfigurationCreatePage,
  })),
);
const ConfigurationDetailPage = lazy(() =>
  import("../features/configuration/ConfigurationPages.js").then((m) => ({
    default: m.ConfigurationDetailPage,
  })),
);
const SecretReferencesPage = lazy(() =>
  import("../features/configuration/ConfigurationPages.js").then((m) => ({
    default: m.SecretReferencesPage,
  })),
);
const ResourceListPage = lazy(() =>
  import("../features/resources/ResourcePages.js").then((m) => ({ default: m.ResourceListPage })),
);
const ResourceDetailPage = lazy(() =>
  import("../features/resources/ResourcePages.js").then((m) => ({ default: m.ResourceDetailPage })),
);
const CatalogPage = lazy(() =>
  import("../features/discovery/DiscoveryPages.js").then((m) => ({ default: m.CatalogPage })),
);
const RegistryPage = lazy(() =>
  import("../features/discovery/DiscoveryPages.js").then((m) => ({ default: m.RegistryPage })),
);
const ConformancePage = lazy(() =>
  import("../features/discovery/DiscoveryPages.js").then((m) => ({ default: m.ConformancePage })),
);
const McpExplorerPage = lazy(() =>
  import("../features/discovery/DiscoveryPages.js").then((m) => ({ default: m.McpExplorerPage })),
);
const OperationsPage = lazy(() =>
  import("../features/operations/OperationsPages.js").then((m) => ({ default: m.OperationsPage })),
);
const RuntimeHealthPage = lazy(() =>
  import("../features/operations/OperationsPages.js").then((m) => ({
    default: m.RuntimeHealthPage,
  })),
);
const JobsPage = lazy(() =>
  import("../features/operations/OperationsPages.js").then((m) => ({ default: m.JobsPage })),
);
const QueuePage = lazy(() =>
  import("../features/operations/OperationsPages.js").then((m) => ({ default: m.QueuePage })),
);
const IncidentsPage = lazy(() =>
  import("../features/operations/OperationsPages.js").then((m) => ({ default: m.IncidentsPage })),
);
const ChangesPage = lazy(() =>
  import("../features/governance/GovernancePages.js").then((m) => ({ default: m.ChangesPage })),
);
const AuditPage = lazy(() =>
  import("../features/governance/GovernancePages.js").then((m) => ({ default: m.AuditPage })),
);
const EnvironmentsPage = lazy(() =>
  import("../features/system/SystemPages.js").then((m) => ({ default: m.EnvironmentsPage })),
);
const AccessPage = lazy(() =>
  import("../features/system/SystemPages.js").then((m) => ({ default: m.AccessPage })),
);
const SettingsPage = lazy(() =>
  import("../features/system/SystemPages.js").then((m) => ({ default: m.SettingsPage })),
);
const ProfilePage = lazy(() =>
  import("../features/system/SystemPages.js").then((m) => ({ default: m.ProfilePage })),
);
const StatusPage = lazy(() =>
  import("../features/system/SystemPages.js").then((m) => ({ default: m.StatusPage })),
);

function Loading() {
  return (
    <div className="route-skeleton" aria-label="页面加载中">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}
function S({ children }: { readonly children: ReactNode }) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}
function CatalogCompatibilityRedirect() {
  const { providerId = "", operationName = "" } = useParams();
  return (
    <Navigate
      replace
      to={`/catalog/providers/${encodeURIComponent(providerId)}/${encodeURIComponent(operationName)}`}
    />
  );
}

const routes = [
  {
    path: "dashboard",
    element: (
      <S>
        <DashboardPage />
      </S>
    ),
  },
  {
    path: "attention",
    element: (
      <S>
        <AttentionPage />
      </S>
    ),
  },
  {
    path: "notifications",
    element: (
      <S>
        <NotificationsPage />
      </S>
    ),
  },
  {
    path: "search",
    element: (
      <S>
        <SearchPage />
      </S>
    ),
  },
  {
    path: "providers",
    element: (
      <S>
        <ProviderListPage />
      </S>
    ),
  },
  {
    path: "providers/new",
    element: (
      <S>
        <ProviderCreatePage />
      </S>
    ),
  },
  {
    path: "providers/:providerId",
    element: (
      <S>
        <ProviderDetailPage section="overview" />
      </S>
    ),
  },
  {
    path: "providers/:providerId/overview",
    element: (
      <S>
        <ProviderDetailPage section="overview" />
      </S>
    ),
  },
  {
    path: "providers/:providerId/edit",
    element: (
      <S>
        <ProviderDetailPage section="edit" />
      </S>
    ),
  },
  {
    path: "providers/:providerId/configuration",
    element: (
      <S>
        <ProviderDetailPage section="configuration" />
      </S>
    ),
  },
  {
    path: "providers/:providerId/deployments",
    element: (
      <S>
        <ProviderDetailPage section="deployments" />
      </S>
    ),
  },
  {
    path: "providers/:providerId/resources",
    element: (
      <S>
        <ProviderDetailPage section="resources" />
      </S>
    ),
  },
  {
    path: "providers/:providerId/catalog",
    element: (
      <S>
        <ProviderDetailPage section="catalog" />
      </S>
    ),
  },
  {
    path: "providers/:providerId/activity",
    element: (
      <S>
        <ProviderDetailPage section="activity" />
      </S>
    ),
  },
  {
    path: "providers/:providerId/settings",
    element: (
      <S>
        <ProviderDetailPage section="settings" />
      </S>
    ),
  },
  {
    path: "providers/:providerId/decommission",
    element: (
      <S>
        <ProviderDetailPage section="decommission" />
      </S>
    ),
  },
  {
    path: "provider-packages",
    element: (
      <S>
        <ProviderPackagesPage mode="list" />
      </S>
    ),
  },
  {
    path: "provider-packages/new",
    element: (
      <S>
        <ProviderPackagesPage mode="new" />
      </S>
    ),
  },
  {
    path: "provider-packages/import",
    element: (
      <S>
        <ProviderPackagesPage mode="import" />
      </S>
    ),
  },
  {
    path: "provider-packages/:packageId",
    element: (
      <S>
        <ProviderPackagesPage mode="detail" />
      </S>
    ),
  },
  {
    path: "provider-packages/:packageId/versions/:version",
    element: (
      <S>
        <ProviderPackagesPage mode="version" />
      </S>
    ),
  },
  {
    path: "provider-packages/:packageId/versions/:version/qualification",
    element: (
      <S>
        <ProviderPackagesPage mode="qualification" />
      </S>
    ),
  },
  {
    path: "provider-packages/:packageId/versions/:version/usage",
    element: (
      <S>
        <ProviderPackagesPage mode="usage" />
      </S>
    ),
  },
  {
    path: "runtime/deployments",
    element: (
      <S>
        <RuntimeDeploymentListPage />
      </S>
    ),
  },
  {
    path: "runtime/deployments/new",
    element: (
      <S>
        <RuntimeDeploymentCreatePage />
      </S>
    ),
  },
  {
    path: "runtime/deployments/:providerId/:deploymentId",
    element: (
      <S>
        <RuntimeDeploymentDetailPage section="overview" />
      </S>
    ),
  },
  {
    path: "runtime/deployments/:providerId/:deploymentId/overview",
    element: (
      <S>
        <RuntimeDeploymentDetailPage section="overview" />
      </S>
    ),
  },
  {
    path: "runtime/deployments/:providerId/:deploymentId/edit",
    element: (
      <S>
        <RuntimeDeploymentDetailPage section="edit" />
      </S>
    ),
  },
  {
    path: "runtime/deployments/:providerId/:deploymentId/reconciliation",
    element: (
      <S>
        <RuntimeDeploymentDetailPage section="reconciliation" />
      </S>
    ),
  },
  {
    path: "runtime/deployments/:providerId/:deploymentId/instances",
    element: (
      <S>
        <RuntimeDeploymentDetailPage section="instances" />
      </S>
    ),
  },
  {
    path: "runtime/deployments/:providerId/:deploymentId/configuration",
    element: (
      <S>
        <RuntimeDeploymentDetailPage section="configuration" />
      </S>
    ),
  },
  {
    path: "runtime/deployments/:providerId/:deploymentId/activity",
    element: (
      <S>
        <RuntimeDeploymentDetailPage section="activity" />
      </S>
    ),
  },
  {
    path: "runtime/deployments/:providerId/:deploymentId/upgrade",
    element: (
      <S>
        <RuntimeDeploymentDetailPage section="upgrade" />
      </S>
    ),
  },
  {
    path: "runtime/deployments/:providerId/:deploymentId/scale",
    element: (
      <S>
        <RuntimeDeploymentDetailPage section="scale" />
      </S>
    ),
  },
  {
    path: "runtime/instances",
    element: (
      <S>
        <RuntimeInstancesPage />
      </S>
    ),
  },
  {
    path: "runtime/instances/:providerId/:runtimeId",
    element: (
      <S>
        <RuntimeInstancesPage detail section="overview" />
      </S>
    ),
  },
  {
    path: "runtime/instances/:providerId/:runtimeId/registration",
    element: (
      <S>
        <RuntimeInstancesPage detail section="registration" />
      </S>
    ),
  },
  {
    path: "runtime/instances/:providerId/:runtimeId/configuration",
    element: (
      <S>
        <RuntimeInstancesPage detail section="configuration" />
      </S>
    ),
  },
  {
    path: "runtime/instances/:providerId/:runtimeId/activity",
    element: (
      <S>
        <RuntimeInstancesPage detail section="activity" />
      </S>
    ),
  },
  {
    path: "runtime/processes",
    element: (
      <S>
        <RuntimeProcessesPage />
      </S>
    ),
  },
  {
    path: "runtime/processes/:providerId/:processId",
    element: (
      <S>
        <RuntimeProcessesPage detail />
      </S>
    ),
  },
  {
    path: "runtime/releases",
    element: (
      <S>
        <RuntimeReleasesPage mode="list" />
      </S>
    ),
  },
  {
    path: "runtime/releases/new",
    element: (
      <S>
        <RuntimeReleasesPage mode="new" />
      </S>
    ),
  },
  {
    path: "runtime/releases/:releaseId",
    element: (
      <S>
        <RuntimeReleasesPage mode="detail" />
      </S>
    ),
  },
  {
    path: "runtime/releases/:releaseId/compatibility",
    element: (
      <S>
        <RuntimeReleasesPage mode="compatibility" />
      </S>
    ),
  },
  {
    path: "runtime/releases/:releaseId/usage",
    element: (
      <S>
        <RuntimeReleasesPage mode="usage" />
      </S>
    ),
  },
  {
    path: "databases",
    element: (
      <S>
        <DatabaseProfilesPage mode="list" />
      </S>
    ),
  },
  {
    path: "databases/new",
    element: (
      <S>
        <DatabaseProfilesPage mode="new" />
      </S>
    ),
  },
  {
    path: "databases/:profileId",
    element: (
      <S>
        <DatabaseProfilesPage mode="detail" />
      </S>
    ),
  },
  {
    path: "databases/:profileId/edit",
    element: (
      <S>
        <DatabaseProfilesPage mode="edit" />
      </S>
    ),
  },
  {
    path: "databases/:profileId/usage",
    element: (
      <S>
        <DatabaseProfilesPage mode="usage" />
      </S>
    ),
  },
  {
    path: "configuration",
    element: (
      <S>
        <ConfigurationListPage />
      </S>
    ),
  },
  {
    path: "configuration/new",
    element: (
      <S>
        <ConfigurationCreatePage />
      </S>
    ),
  },
  {
    path: "configuration/:profileId",
    element: (
      <S>
        <ConfigurationDetailPage section="overview" />
      </S>
    ),
  },
  {
    path: "configuration/:profileId/edit",
    element: (
      <S>
        <ConfigurationDetailPage section="edit" />
      </S>
    ),
  },
  {
    path: "configuration/:profileId/revisions",
    element: (
      <S>
        <ConfigurationDetailPage section="revisions" />
      </S>
    ),
  },
  {
    path: "configuration/:profileId/revisions/:revision",
    element: (
      <S>
        <ConfigurationDetailPage section="revision" />
      </S>
    ),
  },
  {
    path: "configuration/:profileId/compare",
    element: (
      <S>
        <ConfigurationDetailPage section="compare" />
      </S>
    ),
  },
  {
    path: "configuration/:profileId/revisions/:revision/rollback",
    element: (
      <S>
        <ConfigurationDetailPage section="rollback" />
      </S>
    ),
  },
  {
    path: "secrets",
    element: (
      <S>
        <SecretReferencesPage />
      </S>
    ),
  },
  {
    path: "secrets/:secretRef",
    element: (
      <S>
        <SecretReferencesPage detail />
      </S>
    ),
  },
  {
    path: "resources",
    element: (
      <S>
        <ResourceListPage />
      </S>
    ),
  },
  {
    path: "resources/:environment/:resourceId",
    element: (
      <S>
        <ResourceDetailPage section="overview" />
      </S>
    ),
  },
  {
    path: "resources/:environment/:resourceId/history",
    element: (
      <S>
        <ResourceDetailPage section="history" />
      </S>
    ),
  },
  {
    path: "resources/:environment/:resourceId/activity",
    element: (
      <S>
        <ResourceDetailPage section="activity" />
      </S>
    ),
  },
  {
    path: "catalog",
    element: (
      <S>
        <CatalogPage mode="list" />
      </S>
    ),
  },
  {
    path: "catalog/providers/:providerId",
    element: (
      <S>
        <CatalogPage mode="provider" />
      </S>
    ),
  },
  {
    path: "catalog/providers/:providerId/:operationName",
    element: (
      <S>
        <CatalogPage mode="operation" />
      </S>
    ),
  },
  {
    path: "catalog/providers/:providerId/revisions",
    element: (
      <S>
        <CatalogPage mode="revisions" />
      </S>
    ),
  },
  {
    path: "catalog/providers/:providerId/revisions/:revision",
    element: (
      <S>
        <CatalogPage mode="revision" />
      </S>
    ),
  },
  {
    path: "catalog/providers/:providerId/compare",
    element: (
      <S>
        <CatalogPage mode="compare" />
      </S>
    ),
  },
  { path: "catalog/:providerId/:operationName", element: <CatalogCompatibilityRedirect /> },
  {
    path: "registry",
    element: (
      <S>
        <RegistryPage mode="latest" />
      </S>
    ),
  },
  {
    path: "registry/revisions/:revision",
    element: (
      <S>
        <RegistryPage mode="revision" />
      </S>
    ),
  },
  {
    path: "registry/compare",
    element: (
      <S>
        <RegistryPage mode="compare" />
      </S>
    ),
  },
  {
    path: "registry/publish",
    element: (
      <S>
        <RegistryPage mode="publish" />
      </S>
    ),
  },
  {
    path: "conformance",
    element: (
      <S>
        <ConformancePage mode="overview" />
      </S>
    ),
  },
  {
    path: "conformance/suites",
    element: (
      <S>
        <ConformancePage mode="suites" />
      </S>
    ),
  },
  {
    path: "conformance/runs",
    element: (
      <S>
        <ConformancePage mode="runs" />
      </S>
    ),
  },
  {
    path: "conformance/runs/:runId",
    element: (
      <S>
        <ConformancePage mode="run" />
      </S>
    ),
  },
  {
    path: "mcp-explorer",
    element: (
      <S>
        <McpExplorerPage />
      </S>
    ),
  },
  {
    path: "mcp-explorer/history",
    element: (
      <S>
        <McpExplorerPage historyMode />
      </S>
    ),
  },
  {
    path: "operations",
    element: (
      <S>
        <OperationsPage />
      </S>
    ),
  },
  {
    path: "operations/:operationId",
    element: (
      <S>
        <OperationsPage detail />
      </S>
    ),
  },
  {
    path: "operations/health",
    element: (
      <S>
        <RuntimeHealthPage />
      </S>
    ),
  },
  {
    path: "operations/jobs",
    element: (
      <S>
        <JobsPage />
      </S>
    ),
  },
  {
    path: "operations/jobs/:jobId",
    element: (
      <S>
        <JobsPage detail />
      </S>
    ),
  },
  {
    path: "operations/queues",
    element: (
      <S>
        <QueuePage />
      </S>
    ),
  },
  {
    path: "operations/workers",
    element: (
      <S>
        <QueuePage workers />
      </S>
    ),
  },
  {
    path: "operations/incidents",
    element: (
      <S>
        <IncidentsPage mode="list" />
      </S>
    ),
  },
  {
    path: "operations/incidents/new",
    element: (
      <S>
        <IncidentsPage mode="new" />
      </S>
    ),
  },
  {
    path: "operations/incidents/:incidentId",
    element: (
      <S>
        <IncidentsPage mode="detail" />
      </S>
    ),
  },
  {
    path: "operations/incident-rules",
    element: (
      <S>
        <IncidentsPage mode="rules" />
      </S>
    ),
  },
  {
    path: "changes",
    element: (
      <S>
        <ChangesPage mode="list" />
      </S>
    ),
  },
  {
    path: "changes/new",
    element: (
      <S>
        <ChangesPage mode="new" />
      </S>
    ),
  },
  {
    path: "changes/:changeId",
    element: (
      <S>
        <ChangesPage mode="detail" />
      </S>
    ),
  },
  {
    path: "changes/:changeId/review",
    element: (
      <S>
        <ChangesPage mode="review" />
      </S>
    ),
  },
  {
    path: "audit",
    element: (
      <S>
        <AuditPage mode="list" />
      </S>
    ),
  },
  {
    path: "audit/:auditId",
    element: (
      <S>
        <AuditPage mode="detail" />
      </S>
    ),
  },
  {
    path: "audit/export",
    element: (
      <S>
        <AuditPage mode="export" />
      </S>
    ),
  },
  {
    path: "environments",
    element: (
      <S>
        <EnvironmentsPage />
      </S>
    ),
  },
  {
    path: "environments/:environmentId",
    element: (
      <S>
        <EnvironmentsPage detail />
      </S>
    ),
  },
  {
    path: "access/users",
    element: (
      <S>
        <AccessPage mode="users" />
      </S>
    ),
  },
  {
    path: "access/roles",
    element: (
      <S>
        <AccessPage mode="roles" />
      </S>
    ),
  },
  {
    path: "access/roles/:roleId",
    element: (
      <S>
        <AccessPage mode="role" />
      </S>
    ),
  },
  {
    path: "access/service-accounts",
    element: (
      <S>
        <AccessPage mode="service-accounts" />
      </S>
    ),
  },
  {
    path: "system/general",
    element: (
      <S>
        <SettingsPage mode="general" />
      </S>
    ),
  },
  {
    path: "system/runtime-defaults",
    element: (
      <S>
        <SettingsPage mode="runtime-defaults" />
      </S>
    ),
  },
  {
    path: "system/registry",
    element: (
      <S>
        <SettingsPage mode="registry" />
      </S>
    ),
  },
  {
    path: "system/retention",
    element: (
      <S>
        <SettingsPage mode="retention" />
      </S>
    ),
  },
  {
    path: "system/security",
    element: (
      <S>
        <SettingsPage mode="security" />
      </S>
    ),
  },
  { path: "system/settings", element: <Navigate replace to="/system/general" /> },
  {
    path: "profile",
    element: (
      <S>
        <ProfilePage />
      </S>
    ),
  },
  {
    path: "profile/preferences",
    element: (
      <S>
        <ProfilePage preferences />
      </S>
    ),
  },
  {
    path: "login",
    element: (
      <S>
        <StatusPage mode="login" />
      </S>
    ),
  },
  {
    path: "session-expired",
    element: (
      <S>
        <StatusPage mode="session-expired" />
      </S>
    ),
  },
  {
    path: "access-denied",
    element: (
      <S>
        <StatusPage mode="access-denied" />
      </S>
    ),
  },
  {
    path: "403",
    element: (
      <S>
        <StatusPage mode="403" />
      </S>
    ),
  },
  {
    path: "404",
    element: (
      <S>
        <StatusPage mode="404" />
      </S>
    ),
  },
  {
    path: "500",
    element: (
      <S>
        <StatusPage mode="500" />
      </S>
    ),
  },
  {
    path: "maintenance",
    element: (
      <S>
        <StatusPage mode="maintenance" />
      </S>
    ),
  },
];

const prototypeRoutes =
  import.meta.env.DEV && import.meta.env.VITE_PMS_ENABLE_PROTOTYPE_TOOLS !== "false"
    ? [
        {
          path: "_prototype/components",
          lazy: async () => {
            const m = await import("../prototype/PrototypePages.js");
            return { Component: m.ComponentCatalogue };
          },
        },
        {
          path: "_prototype/scenarios",
          lazy: async () => {
            const m = await import("../prototype/PrototypePages.js");
            return { Component: m.ScenarioCatalogue };
          },
        },
      ]
    : [];

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell operationPanel={<OperationPanel />} />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <Navigate replace to="/dashboard" /> },
      ...routes,
      ...prototypeRoutes,
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
registerRouter(router);

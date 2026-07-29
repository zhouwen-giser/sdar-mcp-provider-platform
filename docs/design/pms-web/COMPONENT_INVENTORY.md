# Component inventory

## Shell and navigation

`AppShell`, `GlobalHeader`, `SideNavigation`, `EnvironmentSelector`, `GlobalSearch`,
`PrototypeBanner`, `ScenarioSwitcher`.

## Content structure

`PageHeader`, `Breadcrumbs`, `StatusBadge`, `HealthIndicator`, `MetricCard`, `FilterBar`,
`DataTable`, `Timeline`, `CodeOrJsonViewer`, `DiffViewer`.

## Interaction

`DetailDrawer`, `ConfirmDialog`, `Wizard`, `StepProgress`, `Toast`, `OperationPanel`.

Drawers close with Escape and restore focus. Dialogs require explicit cancel/confirm actions.
Wizards retain prior input. Table filter state is represented in URL search parameters.

## Feedback

`Skeleton`, `EmptyState`, `ErrorState`, `PartialDataNotice`, `StaleDataNotice`,
`PrototypeOperationStatus`.

Errors contain a mock code, impact statement and suggested recovery. Status includes text and icon,
not color alone.

## Feature compositions

- `ProviderOnboardingWizard`
- `RuntimeDeploymentWizard`
- `ConfigurationWorkspace`
- `RuntimeAckMatrix`
- `RuntimeProcessDrawer`
- `JobDrawer`
- `IncidentRecoveryTimeline`
- `CatalogBreakingDiff`
- `RegistryPublicationPanel`

The internal component route demonstrates reusable components in healthy and edge states.

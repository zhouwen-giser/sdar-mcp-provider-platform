export const queryKeys = {
  providerTypes: ["provider-types"] as const,
  providerPackages: ["provider-packages"] as const,
  providerPackage: (id: string, version?: string) =>
    ["provider-package", id, version ?? "latest"] as const,
  providers: ["providers"] as const,
  provider: (id: string) => ["provider", id] as const,
  resources: (environments: readonly string[]) => ["resources", ...environments] as const,
  resource: (environment: string, id: string) => ["resource", environment, id] as const,
  bindings: (providerId: string) => ["provider-bindings", providerId] as const,
  configurationDrafts: ["configuration-drafts"] as const,
  configurationDraft: (id: string) => ["configuration-draft", id] as const,
  configurationPreview: (id: string) => ["configuration-preview", id] as const,
  configurationRevisions: (id: string) => ["configuration-revisions", id] as const,
  deployments: (providerIds: readonly string[]) => ["runtime-deployments", ...providerIds] as const,
  deployment: (providerId: string, id: string) => ["runtime-deployment", providerId, id] as const,
  processes: (scopes: readonly (readonly [string, string])[]) =>
    ["runtime-processes", ...scopes.map((scope) => scope.join("/"))] as const,
  process: (providerId: string, id: string) => ["runtime-process", providerId, id] as const,
  registryLatest: (environment: string) => ["registry-latest", environment] as const,
  registryHistory: (environment: string) => ["registry-history", environment] as const,
  registryDiff: (environment: string, from: number, to: number) =>
    ["registry-diff", environment, from, to] as const,
  audit: (filters: object) => ["audit-events", filters] as const,
};

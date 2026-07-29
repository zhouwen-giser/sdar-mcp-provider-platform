import type {
  AuditEventSummary,
  AuditFilters,
  CatalogToolSummary,
  ConfigurationDraftSummary,
  ConfigurationFieldMetadata,
  EffectiveConfigurationSummary,
  ProviderPackageSummary,
  ProviderSummary,
  ResourceSummary,
  RegistryDiffSummary,
  RegistryProviderSummary,
  RegistrySnapshotSummary,
  RuntimeDeploymentSummary,
  RuntimeProcessSummary,
} from "./model.js";

export function shell(content: string, active: string): string {
  return `<div class="shell">
    <aside class="rail">
      <a class="brand" href="/providers" data-link><span class="brand-mark">S</span><span>SDAR</span></a>
      <nav aria-label="Primary">
        ${nav("/providers", "Providers", active === "providers")}
        ${nav("/packages", "Packages", active === "packages")}
        ${nav("/resources?environment=production", "Resources", active === "resources")}
        ${nav("/configuration", "Configuration", active === "configuration")}
        ${nav("/runtime", "Runtime", active === "runtime")}
        ${nav("/catalog?environment=production", "Catalog", active === "catalog")}
        ${nav("/registry?environment=production", "Registry", active === "registry")}
        ${nav("/audit", "Audit", active === "audit")}
      </nav>
      <p class="rail-note">Runtime governance<br><span>Control plane</span></p>
    </aside>
    <main>${content}</main>
  </div>`;
}

export function loading(title: string): string {
  return (
    pageHeader(title, "Loading authoritative control-plane data…") +
    `<section class="panel loading" aria-busy="true"><span></span><span></span><span></span></section>`
  );
}

export function errorView(title: string, code: string): string {
  return (
    pageHeader(title, "The request could not be completed.") +
    `<section class="panel error"><p class="eyebrow">Request failed</p><h2>${escapeHtml(code)}</h2>
      <button type="button" data-action="retry">Try again</button></section>`
  );
}

export function providersView(providers: readonly ProviderSummary[]): string {
  return (
    pageHeader("Providers", "Runtime identities and their current lifecycle state.", true) +
    `<section class="metrics">
      ${metric("Total", providers.length)}
      ${metric("Active", providers.filter(({ status }) => status === "active").length)}
      ${metric("Attention", providers.filter(({ status }) => ["degraded", "disabled"].includes(status)).length)}
    </section>
    <section class="panel">
      <div class="panel-head"><div><p class="eyebrow">Inventory</p><h2>Provider fleet</h2></div></div>
      ${providers.length === 0 ? empty("No Providers have been created.") : providerTable(providers)}
    </section>
    ${createProviderForm()}`
  );
}

export function providerDetailView(provider: ProviderSummary): string {
  return (
    pageHeader(provider.providerId, "Provider identity and hosting configuration.") +
    `<section class="detail-grid">
      ${detail("Provider type", provider.providerTypeId)}
      ${detail("Hosting", hosting(provider.hostingMode))}
      ${detail("Status", provider.status)}
      ${detail("Package", provider.packageId === undefined ? "Unbound" : `${provider.packageId}@${provider.packageVersion ?? "—"}`)}
    </section>
    <section class="notice"><strong>Secret-safe view</strong><span>Credentials, database URLs, PM2 internals, and Runtime Task data are never requested by this page.</span></section>`
  );
}

export function packagesView(packages: readonly ProviderPackageSummary[]): string {
  return (
    pageHeader(
      "Provider Packages",
      "Controlled package metadata and separately scoped qualification.",
    ) +
    `<section class="card-grid">${packages
      .map(
        (item) => `<article class="package-card">
          <p class="eyebrow">${escapeHtml(item.providerType)}</p>
          <h2>${escapeHtml(item.packageId)}</h2>
          <p class="muted">Version ${escapeHtml(item.packageVersion)} · Runtime ${escapeHtml(item.compatibleRuntimeVersion)}</p>
          <div class="badges">
            ${badge(`Component: ${item.qualification.componentStatus}`, item.qualification.componentStatus)}
            ${badge(`Real resource: ${item.qualification.realResourceStatus}`, item.qualification.realResourceStatus)}
          </div>
          <dl><dt>Hosting</dt><dd>${item.hostingModes.map(hosting).join(", ")}</dd>
          <dt>Protocol</dt><dd>${escapeHtml(item.protocolMode)}</dd></dl>
          <p class="qualification-note">${qualificationNote(item)}</p>
        </article>`,
      )
      .join("")}</section>`
  );
}

export function resourcesView(resources: readonly ResourceSummary[], environment: string): string {
  return (
    pageHeader("Resources", `Environment-scoped inventory · ${environment}`) +
    `<section class="panel"><div class="panel-head"><div><p class="eyebrow">Environment</p><h2>${escapeHtml(environment)}</h2></div>
      <form class="environment-form"><input name="environment" value="${escapeAttribute(environment)}" aria-label="Environment"><button>Load</button></form></div>
      ${resources.length === 0 ? empty("No Resources are registered in this environment.") : resourceTable(resources)}
    </section>`
  );
}

export function configurationView(
  fields: readonly ConfigurationFieldMetadata[],
  draft?: ConfigurationDraftSummary,
  effective?: EffectiveConfigurationSummary,
): string {
  const summary =
    draft === undefined
      ? ""
      : `<section class="panel">
        <div class="panel-head"><div><p class="eyebrow">Draft ${escapeHtml(draft.status)}</p><h2>${escapeHtml(draft.draftId)}</h2></div>
          ${badge(draft.applyMode ?? "not validated", draft.applyMode ?? "pending")}</div>
        ${restartNotice(draft.applyMode)}
        <div class="config-actions">
          <form data-form="validate-config"><input type="hidden" name="draftId" value="${escapeAttribute(draft.draftId)}"><button>Validate</button></form>
          <form data-form="publish-config" data-danger="Publish this configuration revision? Runtime restart may be required.">
            <input type="hidden" name="draftId" value="${escapeAttribute(draft.draftId)}">
            <input type="hidden" name="draftVersion" value="${String(draft.version)}">
            <label>Current published revision<input name="publishedRevision" inputmode="numeric" placeholder="None"></label>
            <button class="danger">Publish</button>
          </form>
        </div>
        ${configurationDiff(draft, effective)}
        ${
          draft.validationIssues.length === 0
            ? ""
            : `<div class="issue-list">${draft.validationIssues
                .map((issue) => `<p>${escapeHtml(issue.code)} · ${escapeHtml(issue.path)}</p>`)
                .join("")}</div>`
        }
      </section>`;
  return (
    pageHeader(
      "Configuration",
      "Metadata-driven drafts, safe publication, and effective-value diff.",
    ) +
    `<section class="notice"><strong>SecretRef only</strong><span>Secret values are never loaded or displayed. Secret fields accept reference paths and are sent as SecretRef objects.</span></section>
    ${summary}
    <section class="panel create-panel config-editor">
      <div><p class="eyebrow">Draft</p><h2>Runtime bootstrap</h2><p class="muted">Field behavior and restart impact come from configuration metadata.</p></div>
      <form data-form="create-config">
        ${textField("Draft ID", "draftId", true, draft?.draftId)}
        ${textField("Deployment ID", "targetId", true, draft?.targetId)}
        ${textField("Environment", "environment", true, draft?.environment ?? "production")}
        ${fields.map(configurationField).join("")}
        <button type="submit">Save Draft</button><p class="form-status" role="status"></p>
      </form>
    </section>`
  );
}

export function runtimeView(
  providerId: string | undefined,
  deployments: readonly RuntimeDeploymentSummary[],
  processes: readonly RuntimeProcessSummary[],
  selectedDeploymentId?: string,
): string {
  const scope = `<section class="panel"><form class="runtime-scope-form">
    ${textField("Provider ID", "providerId", true, providerId)}
    ${textField("Deployment ID (optional)", "deploymentId", false, selectedDeploymentId)}
    <button>Load Runtime state</button>
  </form></section>`;
  if (providerId === undefined) {
    return (
      pageHeader("Runtime", "Provider-scoped deployment and process control.") +
      scope +
      `<section class="empty panel"><p>Enter a Provider ID to load Runtime state.</p></section>`
    );
  }
  return (
    pageHeader("Runtime", "Desired deployment state and independently observed process health.") +
    scope +
    `<section class="panel"><div class="panel-head"><div><p class="eyebrow">Desired state</p><h2>Deployments</h2></div></div>
      ${deployments.length === 0 ? empty("No Runtime Deployments found.") : deploymentTable(deployments)}
    </section>
    <section class="panel"><div class="panel-head"><div><p class="eyebrow">Observed state</p><h2>Processes & readiness</h2></div></div>
      <div class="notice compact"><strong>PM2 online ≠ Runtime ACTIVE</strong><span>ACTIVE requires live and ready health plus registration, Catalog, and configuration acknowledgement.</span></div>
      ${selectedDeploymentId === undefined ? empty("Choose a Deployment to inspect its processes.") : processTable(processes)}
    </section>`
  );
}

export function catalogView(
  environment: string,
  providers: readonly RegistryProviderSummary[],
  providerId?: string,
): string {
  const selected =
    providerId === undefined
      ? providers
      : providers.filter((provider) => provider.providerId === providerId);
  return (
    pageHeader("Operation Catalog", "Read-only Runtime discovery and tool schemas.") +
    governanceScope("catalog-scope-form", environment, providerId) +
    `<section class="notice"><strong>Authoritative source</strong><span>Catalog entries originate only from Runtime server/discover + tools/list and cannot be edited here.</span></section>
    <section class="catalog-stack">${
      selected.length === 0
        ? empty("No authoritative Catalog is available for this scope.")
        : selected.map(catalogProvider).join("")
    }</section>`
  );
}

export function registryView(
  environment: string,
  history: readonly RegistrySnapshotSummary[],
  diff?: RegistryDiffSummary,
): string {
  return (
    pageHeader("Registry", "Immutable environment snapshots, revision history, and safe diff.") +
    `<section class="panel"><form class="registry-scope-form">
      ${textField("Environment", "environment", true, environment)}
      ${textField("From revision", "fromRevision", false, diff?.fromRevision.toString())}
      ${textField("To revision", "toRevision", false, diff?.toRevision.toString())}
      <button>Load history / diff</button>
    </form></section>
    ${diff === undefined ? "" : registryDiffView(diff)}
    <section class="panel"><div class="panel-head"><div><p class="eyebrow">Immutable history</p><h2>${escapeHtml(environment)}</h2></div></div>
      ${history.length === 0 ? empty("No Registry revisions have been published.") : registryHistory(history)}
    </section>`
  );
}

export function auditView(events: readonly AuditEventSummary[], filters: AuditFilters): string {
  return (
    pageHeader("Audit", "Trace operations by actor, subject, correlation, and time.") +
    `<section class="panel"><form class="audit-filter-form">
      ${textField("Subject type", "subjectType", false, filters.subjectType)}
      ${textField("Subject ID", "subjectId", false, filters.subjectId)}
      ${textField("Correlation ID", "correlationId", false, filters.correlationId)}
      <button>Apply filters</button>
    </form></section>
    <section class="panel"><div class="panel-head"><div><p class="eyebrow">Trace</p><h2>Audit events</h2></div></div>
      ${events.length === 0 ? empty("No matching Audit events.") : auditTable(events)}
    </section>`
  );
}

function createProviderForm(): string {
  return `<section class="panel create-panel" id="create-provider">
    <div><p class="eyebrow">Create</p><h2>New Provider</h2><p class="muted">Production defaults to vendor managed.</p></div>
    <form data-form="create-provider">
      <label>Provider ID<input required name="providerId" maxlength="128" autocomplete="off"></label>
      <label>Provider type<input required name="providerTypeId" maxlength="128" autocomplete="off"></label>
      <label>Package ID<input name="packageId" maxlength="128" autocomplete="off"></label>
      <label>Package version<input name="packageVersion" maxlength="64" autocomplete="off"></label>
      <label>Hosting mode<select name="hostingMode"><option value="vendor_managed">Vendor managed</option><option value="platform_managed">Platform managed</option></select></label>
      <button type="submit">Create Provider</button>
      <p class="form-status" role="status"></p>
    </form>
  </section>`;
}

function governanceScope(formClass: string, environment: string, providerId?: string): string {
  return `<section class="panel"><form class="${formClass}">
    ${textField("Environment", "environment", true, environment)}
    ${textField("Provider ID (optional)", "providerId", false, providerId)}
    <button>Load Catalog</button>
  </form></section>`;
}

function catalogProvider(provider: RegistryProviderSummary): string {
  return `<section class="panel"><div class="panel-head"><div><p class="eyebrow">Catalog revision ${String(provider.catalogRevision)}</p><h2>${escapeHtml(provider.providerId)}</h2><p class="muted">${escapeHtml(provider.serverId)} · ${escapeHtml(provider.protocolMode)}</p></div>${badge(`${String(provider.tools.length)} tools`, "active")}</div>
    <div class="tool-grid">${provider.tools.map(catalogTool).join("")}</div>
  </section>`;
}

function catalogTool(tool: CatalogToolSummary): string {
  return `<article class="tool-card"><p class="eyebrow">${escapeHtml(tool.taskBehavior)}</p><h3>${escapeHtml(tool.name)}</h3><p>${escapeHtml(tool.description)}</p>
    <div class="badges">${badge(tool.resourceBindingMode ?? "NONE", "pending")}</div>
    ${schemaViewer("Input schema", tool.inputSchema)}
    ${schemaViewer("Output schema", tool.outputSchema)}
  </article>`;
}

function schemaViewer(label: string, schema: Readonly<Record<string, unknown>>): string {
  return `<details><summary>${escapeHtml(label)}</summary><pre aria-label="${escapeAttribute(label)} read-only">${escapeHtml(JSON.stringify(schema, null, 2))}</pre></details>`;
}

function registryDiffView(diff: RegistryDiffSummary): string {
  return `<section class="metrics registry-diff">
    ${changeMetric("Added", diff.addedProviderIds)}
    ${changeMetric("Changed", diff.changedProviderIds)}
    ${changeMetric("Removed", diff.removedProviderIds)}
  </section>`;
}

function changeMetric(label: string, providerIds: readonly string[]): string {
  return `<article><span>${escapeHtml(label)}</span><strong>${String(providerIds.length)}</strong><small>${providerIds.map(escapeHtml).join(", ") || "None"}</small></article>`;
}

function registryHistory(history: readonly RegistrySnapshotSummary[]): string {
  return `<div class="table-wrap"><table><thead><tr><th>Revision</th><th>Published</th><th>Providers</th><th>Checksum</th></tr></thead><tbody>${history
    .map(
      (snapshot) =>
        `<tr><td>${String(snapshot.revision)}</td><td>${escapeHtml(snapshot.publishedAt)}</td><td>${String(snapshot.providers.length)}</td><td><code>${escapeHtml(snapshot.checksum.slice(0, 16))}…</code></td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}

function auditTable(events: readonly AuditEventSummary[]): string {
  return `<div class="table-wrap"><table><thead><tr><th>Occurred</th><th>Action</th><th>Subject</th><th>Actor</th><th>Correlation</th></tr></thead><tbody>${events
    .map(
      (event) =>
        `<tr><td>${escapeHtml(event.occurredAt)}</td><td>${escapeHtml(event.action)}</td><td>${escapeHtml(event.subjectType)}<small>${escapeHtml(event.subjectId)}</small></td><td>${escapeHtml(event.actorId)}</td><td><code>${escapeHtml(event.correlationId)}</code><small>${escapeHtml(event.auditEventId)}</small></td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}

function deploymentTable(items: readonly RuntimeDeploymentSummary[]): string {
  return `<div class="table-wrap"><table><thead><tr><th>Deployment</th><th>Desired</th><th>Governed status</th><th>Revision</th><th>Actions</th></tr></thead><tbody>${items
    .map(
      (item) =>
        `<tr><td><a href="/runtime?providerId=${encodeURIComponent(item.providerId)}&deploymentId=${encodeURIComponent(item.deploymentId)}" data-link>${escapeHtml(item.deploymentId)}</a><small>${escapeHtml(item.runtimeVersion)}</small></td>
      <td>${badge(item.desiredState, item.desiredState)}</td><td>${badge(item.status, item.status.toLowerCase())}</td>
      <td>${String(item.observedRevision)} / ${String(item.desiredRevision)}</td><td><div class="row-actions">
        ${runtimeAction(item, "start")}${runtimeAction(item, "stop", true)}${runtimeAction(item, "restart", true)}
      </div></td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}

function runtimeAction(
  item: RuntimeDeploymentSummary,
  action: "start" | "stop" | "restart",
  dangerous = false,
): string {
  return `<form data-form="runtime-action"${
    dangerous
      ? ` data-danger="${action === "stop" ? "Stop" : "Restart"} Runtime ${escapeAttribute(item.deploymentId)}?"`
      : ""
  }>
    <input type="hidden" name="providerId" value="${escapeAttribute(item.providerId)}">
    <input type="hidden" name="deploymentId" value="${escapeAttribute(item.deploymentId)}">
    <input type="hidden" name="revision" value="${String(item.desiredRevision)}">
    <input type="hidden" name="action" value="${action}">
    <button${dangerous ? ' class="danger secondary"' : ' class="secondary"'}>${action}</button>
  </form>`;
}

function processTable(items: readonly RuntimeProcessSummary[]): string {
  if (items.length === 0) return empty("No Runtime process observations found.");
  return `<div class="table-wrap"><table><thead><tr><th>Instance</th><th>PM2 process</th><th>Liveness</th><th>Readiness</th><th>Governed health</th><th>Config ACK</th></tr></thead><tbody>${items
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.instanceId)}<small>${escapeHtml(item.runtimeVersion ?? "version unknown")}</small></td>
      <td>${badge(item.processState, item.processState)}</td><td>${badge(item.livenessState, item.livenessState)}</td>
      <td>${badge(item.readinessState, item.readinessState)}</td><td>${badge(item.observedHealth, item.readyForActive ? "ready" : "degraded")}<small>${escapeHtml(item.healthReasonCode)}</small></td>
      <td>${badge(item.configState, item.configState)}<small>revision ${item.configRevision === null ? "unknown" : String(item.configRevision)}</small></td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}

function configurationField(field: ConfigurationFieldMetadata): string {
  const name = field.path.slice(1);
  return `<label>${escapeHtml(field.displayName)}
    <input name="config:${escapeAttribute(name)}"${
      field.required ? " required" : ""
    } autocomplete="off" placeholder="${field.secret ? "SecretRef path" : ""}">
    <small>${escapeHtml(field.description)} · ${escapeHtml(field.applyMode)}${
      field.secret ? " · SecretRef" : ""
    }</small>
  </label>`;
}

function configurationDiff(
  draft: ConfigurationDraftSummary,
  effective: EffectiveConfigurationSummary | undefined,
): string {
  if (effective === undefined) {
    return `<p class="muted">Validate the Draft to preview its diff.</p>`;
  }
  const keys = [...new Set([...draft.configuredKeys, ...effective.keys])].sort();
  return `<div class="config-diff"><h3>Draft → effective diff</h3>${keys
    .map((key) => {
      const secret = draft.secretConfiguredKeys.includes(key);
      const source = effective.sources[`/${key}`] ?? effective.sources[key] ?? "draft";
      return `<div><code>${escapeHtml(key)}</code><span>${
        secret ? "SecretRef configured" : "Configured"
      } · source ${escapeHtml(source)}</span></div>`;
    })
    .join("")}</div>`;
}

function restartNotice(applyMode: ConfigurationDraftSummary["applyMode"]): string {
  return applyMode === "restart_required"
    ? `<div class="warning"><strong>Restart required</strong><span>Publishing does not make the Runtime current until a controlled restart and subsequent ready acknowledgement.</span></div>`
    : "";
}

function textField(
  label: string,
  name: string,
  required: boolean,
  value: string | undefined,
): string {
  return `<label>${escapeHtml(label)}<input name="${escapeAttribute(name)}"${
    required ? " required" : ""
  }${value === undefined ? "" : ` value="${escapeAttribute(value)}"`} autocomplete="off"></label>`;
}

function providerTable(items: readonly ProviderSummary[]): string {
  return `<div class="table-wrap"><table><thead><tr><th>Provider</th><th>Type</th><th>Hosting</th><th>Status</th></tr></thead><tbody>${items
    .map(
      (
        item,
      ) => `<tr><td><a href="/providers/${encodeURIComponent(item.providerId)}" data-link>${escapeHtml(item.providerId)}</a></td>
      <td>${escapeHtml(item.providerTypeId)}</td><td>${hosting(item.hostingMode)}</td><td>${badge(item.status, item.status)}</td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}

function resourceTable(items: readonly ResourceSummary[]): string {
  return `<div class="table-wrap"><table><thead><tr><th>Resource</th><th>Type</th><th>Status</th></tr></thead><tbody>${items
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.resourceId)}</td><td>${escapeHtml(item.resourceType)}</td><td>${badge(item.status, item.status)}</td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}

function pageHeader(title: string, subtitle: string, action = false): string {
  return `<header class="page-head"><div><p class="eyebrow">Provider Management Service</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div>
    ${action ? '<a class="primary-action" href="#create-provider">Create Provider</a>' : ""}</header>`;
}

function nav(href: string, label: string, active: boolean): string {
  return `<a href="${href}" data-link${active ? ' aria-current="page"' : ""}>${label}</a>`;
}

function metric(label: string, value: number): string {
  return `<article><span>${escapeHtml(label)}</span><strong>${String(value)}</strong></article>`;
}

function detail(label: string, value: string): string {
  return `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;
}

function badge(label: string, state: string): string {
  return `<span class="badge badge-${escapeAttribute(state)}">${escapeHtml(label)}</span>`;
}

function empty(message: string): string {
  return `<div class="empty"><p>${escapeHtml(message)}</p></div>`;
}

function hosting(mode: ProviderSummary["hostingMode"]): string {
  return mode === "vendor_managed" ? "Vendor managed" : "Platform managed";
}

function qualificationNote(item: ProviderPackageSummary): string {
  return item.qualification.realResourceStatus === "qualified"
    ? "Real-resource qualification is recorded independently from component validation."
    : "Component evidence does not certify authentication or behavior against a real external resource.";
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

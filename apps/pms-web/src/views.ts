import type { ProviderPackageSummary, ProviderSummary, ResourceSummary } from "./model.js";

export function shell(content: string, active: string): string {
  return `<div class="shell">
    <aside class="rail">
      <a class="brand" href="/providers" data-link><span class="brand-mark">S</span><span>SDAR</span></a>
      <nav aria-label="Primary">
        ${nav("/providers", "Providers", active === "providers")}
        ${nav("/packages", "Packages", active === "packages")}
        ${nav("/resources?environment=production", "Resources", active === "resources")}
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

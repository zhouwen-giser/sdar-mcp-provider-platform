import type { PmsWebApiClient } from "./api-client.js";
import { RUNTIME_BOOTSTRAP_FIELDS } from "./configuration-metadata.js";
import type {
  CreateConfigurationDraftInput,
  CreateProviderInput,
  EffectiveConfigurationSummary,
} from "./model.js";
import { matchRoute } from "./router.js";
import {
  configurationView,
  errorView,
  loading,
  packagesView,
  providerDetailView,
  providersView,
  resourcesView,
  runtimeView,
  shell,
} from "./views.js";

export class PmsWebApplication {
  constructor(
    private readonly root: HTMLElement,
    private readonly api: PmsWebApiClient,
  ) {}

  start(): void {
    window.addEventListener("popstate", () => void this.render());
    this.root.addEventListener("click", (event) => this.#click(event));
    this.root.addEventListener("submit", (event) => void this.#submit(event));
    void this.render();
  }

  async render(): Promise<void> {
    const route = matchRoute(window.location.pathname, window.location.search);
    this.root.innerHTML = shell(loading(title(route.page)), active(route.page));
    try {
      let content: string;
      switch (route.page) {
        case "providers":
          content = providersView((await this.api.providers()).items);
          break;
        case "provider":
          content = providerDetailView(await this.api.provider(route.providerId));
          break;
        case "packages":
          content = packagesView(await this.api.packages());
          break;
        case "resources":
          content = resourcesView(
            (await this.api.resources(route.environment)).items,
            route.environment,
          );
          break;
        case "configuration": {
          if (route.draftId === undefined) {
            content = configurationView(RUNTIME_BOOTSTRAP_FIELDS);
            break;
          }
          const draft = await this.api.configurationDraft(route.draftId);
          let effective: EffectiveConfigurationSummary | undefined;
          if (draft.status === "validated") {
            effective = await this.api.effectiveConfiguration(route.draftId);
          }
          content = configurationView(RUNTIME_BOOTSTRAP_FIELDS, draft, effective);
          break;
        }
        case "runtime": {
          const deployments =
            route.providerId === undefined
              ? []
              : (await this.api.runtimeDeployments(route.providerId)).items;
          const processes =
            route.providerId === undefined || route.deploymentId === undefined
              ? []
              : (await this.api.runtimeProcesses(route.providerId, route.deploymentId)).items;
          content = runtimeView(route.providerId, deployments, processes, route.deploymentId);
          break;
        }
      }
      this.root.innerHTML = shell(content, active(route.page));
    } catch (error) {
      this.root.innerHTML = shell(
        errorView(title(route.page), error instanceof Error ? error.message : "UNKNOWN_ERROR"),
        active(route.page),
      );
    }
  }

  #click(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('[data-action="retry"]') !== null) {
      void this.render();
      return;
    }
    const link = target.closest<HTMLAnchorElement>("a[data-link]");
    if (link?.origin !== window.location.origin) return;
    event.preventDefault();
    history.pushState({}, "", `${link.pathname}${link.search}`);
    void this.render();
  }

  async #submit(event: SubmitEvent): Promise<void> {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    const danger = form.dataset.danger;
    if (danger !== undefined && !window.confirm(danger)) return;
    if (form.matches('[data-form="create-provider"]')) {
      const status = form.querySelector<HTMLElement>(".form-status");
      if (status !== null) status.textContent = "Creating…";
      try {
        await this.api.createProvider(createInput(new FormData(form)));
        form.reset();
        if (status !== null) status.textContent = "Provider created.";
        await this.render();
      } catch (error) {
        if (status !== null) {
          status.textContent = error instanceof Error ? error.message : "Create failed";
        }
      }
      return;
    }
    if (form.matches('[data-form="create-config"]')) {
      const status = form.querySelector<HTMLElement>(".form-status");
      try {
        const draft = await this.api.createConfigurationDraft(
          configurationDraftInput(new FormData(form)),
        );
        history.pushState({}, "", `/configuration?draftId=${encodeURIComponent(draft.draftId)}`);
        await this.render();
      } catch (error) {
        if (status !== null) {
          status.textContent = error instanceof Error ? error.message : "Draft failed";
        }
      }
      return;
    }
    if (form.matches('[data-form="validate-config"]')) {
      const draftId = requiredValue(new FormData(form), "draftId");
      await this.api.validateConfigurationDraft(draftId);
      await this.render();
      return;
    }
    if (form.matches('[data-form="publish-config"]')) {
      const data = new FormData(form);
      const draftId = requiredValue(data, "draftId");
      await this.api.publishConfigurationDraft(
        draftId,
        requiredInteger(data, "draftVersion"),
        optionalInteger(data, "publishedRevision"),
      );
      await this.render();
      return;
    }
    if (form.matches('[data-form="runtime-action"]')) {
      const data = new FormData(form);
      const action = requiredValue(data, "action");
      if (action !== "start" && action !== "stop" && action !== "restart") {
        throw new Error("INVALID_RUNTIME_ACTION");
      }
      await this.api.commandRuntime(
        requiredValue(data, "deploymentId"),
        action,
        requiredValue(data, "providerId"),
        requiredInteger(data, "revision"),
      );
      await this.render();
      return;
    }
    if (form.matches(".environment-form")) {
      const environment = new FormData(form).get("environment");
      if (typeof environment !== "string") return;
      history.pushState({}, "", `/resources?environment=${encodeURIComponent(environment)}`);
      await this.render();
      return;
    }
    if (form.matches(".runtime-scope-form")) {
      const data = new FormData(form);
      const providerId = requiredValue(data, "providerId");
      const deploymentId = value(data, "deploymentId");
      history.pushState(
        {},
        "",
        `/runtime?providerId=${encodeURIComponent(providerId)}${
          deploymentId.length === 0 ? "" : `&deploymentId=${encodeURIComponent(deploymentId)}`
        }`,
      );
      await this.render();
    }
  }
}

export function configurationDraftInput(data: FormData): CreateConfigurationDraftInput {
  const content: Record<string, unknown> = {};
  for (const field of RUNTIME_BOOTSTRAP_FIELDS) {
    const name = field.path.slice(1);
    const candidate = value(data, `config:${name}`);
    if (candidate.length === 0) continue;
    content[name] = field.secret ? { secretRef: candidate } : configurationValue(name, candidate);
  }
  return {
    draftId: requiredValue(data, "draftId"),
    definitionId: "runtime.bootstrap",
    environment: requiredValue(data, "environment"),
    targetType: "runtime_deployment",
    targetId: requiredValue(data, "targetId"),
    configGroup: "runtime.bootstrap",
    dataId: "runtime",
    content,
  };
}

function configurationValue(name: string, candidate: string): string | number {
  if (name === "PORT" || name.endsWith("_MS")) {
    const parsed = Number(candidate);
    if (!Number.isSafeInteger(parsed)) throw new Error("CONFIGURATION_INTEGER_REQUIRED");
    return parsed;
  }
  return candidate;
}

function createInput(form: FormData): CreateProviderInput {
  const packageId = value(form, "packageId");
  const packageVersion = value(form, "packageVersion");
  const hostingMode = value(form, "hostingMode");
  if (hostingMode !== "vendor_managed" && hostingMode !== "platform_managed") {
    throw new Error("INVALID_HOSTING_MODE");
  }
  if ((packageId.length === 0) !== (packageVersion.length === 0)) {
    throw new Error("PACKAGE_ID_AND_VERSION_REQUIRED_TOGETHER");
  }
  return {
    providerId: requiredValue(form, "providerId"),
    providerTypeId: requiredValue(form, "providerTypeId"),
    ...(packageId.length === 0 ? {} : { packageId, packageVersion }),
    hostingMode,
  };
}

function value(form: FormData, name: string): string {
  const candidate = form.get(name);
  return typeof candidate === "string" ? candidate.trim() : "";
}

function requiredValue(form: FormData, name: string): string {
  const candidate = value(form, name);
  if (candidate.length === 0) throw new Error("REQUIRED_FIELD_MISSING");
  return candidate;
}

function requiredInteger(form: FormData, name: string): number {
  const candidate = Number(requiredValue(form, name));
  if (!Number.isSafeInteger(candidate) || candidate < 0) throw new Error("INTEGER_REQUIRED");
  return candidate;
}

function optionalInteger(form: FormData, name: string): number | null {
  const candidate = value(form, name);
  return candidate.length === 0 ? null : requiredInteger(form, name);
}

function active(page: ReturnType<typeof matchRoute>["page"]): string {
  return page === "provider" ? "providers" : page;
}

function title(page: ReturnType<typeof matchRoute>["page"]): string {
  switch (page) {
    case "provider":
      return "Provider";
    case "providers":
      return "Providers";
    case "packages":
      return "Packages";
    case "resources":
      return "Resources";
    case "configuration":
      return "Configuration";
    case "runtime":
      return "Runtime";
  }
}

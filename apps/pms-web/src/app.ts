import type { PmsWebApiClient } from "./api-client.js";
import type { CreateProviderInput } from "./model.js";
import { matchRoute } from "./router.js";
import {
  errorView,
  loading,
  packagesView,
  providerDetailView,
  providersView,
  resourcesView,
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
      const content =
        route.page === "providers"
          ? providersView((await this.api.providers()).items)
          : route.page === "provider"
            ? providerDetailView(await this.api.provider(route.providerId))
            : route.page === "packages"
              ? packagesView(await this.api.packages())
              : resourcesView(
                  (await this.api.resources(route.environment)).items,
                  route.environment,
                );
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
    if (form.matches(".environment-form")) {
      const environment = new FormData(form).get("environment");
      if (typeof environment !== "string") return;
      history.pushState({}, "", `/resources?environment=${encodeURIComponent(environment)}`);
      await this.render();
    }
  }
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
  }
}

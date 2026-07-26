export type PmsWebRoute =
  | { readonly page: "providers" }
  | { readonly page: "provider"; readonly providerId: string }
  | { readonly page: "packages" }
  | { readonly page: "resources"; readonly environment: string }
  | { readonly page: "configuration"; readonly draftId?: string }
  | {
      readonly page: "runtime";
      readonly providerId?: string;
      readonly deploymentId?: string;
    };

export function matchRoute(pathname: string, search = ""): PmsWebRoute {
  const provider = /^\/providers\/([^/]+)$/.exec(pathname);
  if (provider?.[1] !== undefined) {
    return { page: "provider", providerId: decodeURIComponent(provider[1]) };
  }
  if (pathname === "/packages") return { page: "packages" };
  if (pathname === "/resources") {
    return {
      page: "resources",
      environment: new URLSearchParams(search).get("environment") ?? "production",
    };
  }
  if (pathname === "/configuration") {
    const draftId = new URLSearchParams(search).get("draftId");
    return { page: "configuration", ...(draftId === null ? {} : { draftId }) };
  }
  if (pathname === "/runtime") {
    const query = new URLSearchParams(search);
    const providerId = query.get("providerId");
    const deploymentId = query.get("deploymentId");
    return {
      page: "runtime",
      ...(providerId === null ? {} : { providerId }),
      ...(deploymentId === null ? {} : { deploymentId }),
    };
  }
  return { page: "providers" };
}

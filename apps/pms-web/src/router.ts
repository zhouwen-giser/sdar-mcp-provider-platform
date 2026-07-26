export type PmsWebRoute =
  | { readonly page: "providers" }
  | { readonly page: "provider"; readonly providerId: string }
  | { readonly page: "packages" }
  | { readonly page: "resources"; readonly environment: string };

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
  return { page: "providers" };
}

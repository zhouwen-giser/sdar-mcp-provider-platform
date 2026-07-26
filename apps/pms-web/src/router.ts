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
    }
  | { readonly page: "catalog"; readonly environment: string; readonly providerId?: string }
  | {
      readonly page: "registry";
      readonly environment: string;
      readonly fromRevision?: number;
      readonly toRevision?: number;
    }
  | {
      readonly page: "audit";
      readonly subjectType?: string;
      readonly subjectId?: string;
      readonly correlationId?: string;
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
  if (pathname === "/catalog") {
    const query = new URLSearchParams(search);
    const providerId = query.get("providerId");
    return {
      page: "catalog",
      environment: query.get("environment") ?? "production",
      ...(providerId === null ? {} : { providerId }),
    };
  }
  if (pathname === "/registry") {
    const query = new URLSearchParams(search);
    const fromRevision = positiveInteger(query.get("fromRevision"));
    const toRevision = positiveInteger(query.get("toRevision"));
    return {
      page: "registry",
      environment: query.get("environment") ?? "production",
      ...(fromRevision === undefined ? {} : { fromRevision }),
      ...(toRevision === undefined ? {} : { toRevision }),
    };
  }
  if (pathname === "/audit") {
    const query = new URLSearchParams(search);
    return {
      page: "audit",
      ...optionalQuery(query, "subjectType"),
      ...optionalQuery(query, "subjectId"),
      ...optionalQuery(query, "correlationId"),
    };
  }
  return { page: "providers" };
}

function positiveInteger(value: string | null): number | undefined {
  if (value === null || !/^[1-9][0-9]*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function optionalQuery(
  query: URLSearchParams,
  name: "subjectType" | "subjectId" | "correlationId",
): Partial<Record<typeof name, string>> {
  const value = query.get(name);
  return value === null || value.length === 0 ? {} : { [name]: value };
}

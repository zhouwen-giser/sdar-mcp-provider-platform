import { createHash } from "node:crypto";
import { assertCatalogPublicData, canonicalize } from "../../catalog-manager/src/index.js";
import {
  type RegistryProviderInput,
  type RegistryProviderProjection,
  type RegistrySnapshotCandidate,
  validateRegistryEnvironment,
  validateRegistryProviderIdentity,
} from "./model.js";

export function buildRegistrySnapshot(
  environment: string,
  inputs: readonly RegistryProviderInput[],
): RegistrySnapshotCandidate {
  validateRegistryEnvironment(environment);
  const providerIds = new Set<string>();
  const serverIds = new Set<string>();
  const providers = inputs.map((input): RegistryProviderProjection => {
    validateRegistryProviderIdentity(input);
    if (!Number.isSafeInteger(input.catalog.revision) || input.catalog.revision < 1) {
      throw new Error("REGISTRY_CATALOG_REVISION_INVALID");
    }
    if (providerIds.has(input.providerId)) throw new Error("REGISTRY_PROVIDER_DUPLICATE");
    if (serverIds.has(input.serverId)) throw new Error("REGISTRY_SERVER_DUPLICATE");
    providerIds.add(input.providerId);
    serverIds.add(input.serverId);
    return {
      providerId: input.providerId,
      serverId: input.serverId,
      protocolMode: "frozen_v1",
      effectiveEndpoint: effectiveEndpoint(input.effectiveEndpoint),
      catalogRevision: input.catalog.revision,
      tools: [...input.catalog.document.tools].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
    };
  });
  providers.sort((left, right) => left.providerId.localeCompare(right.providerId));
  const document = { environment, providers };
  assertCatalogPublicData(document);
  const canonicalJson = canonicalize(document);
  return {
    document,
    canonicalJson,
    checksum: createHash("sha256").update(canonicalJson).digest("hex"),
  };
}

export function effectiveEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error("REGISTRY_EFFECTIVE_ENDPOINT_INVALID", { cause: error });
  }
  const loopback =
    url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "localhost";
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("REGISTRY_EFFECTIVE_ENDPOINT_INVALID");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/mcp`.replace(/\/mcp\/mcp$/, "/mcp");
  return url.toString();
}

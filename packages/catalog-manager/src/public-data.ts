const SENSITIVE_KEYS = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "clientsecret",
  "cookie",
  "credential",
  "credentialref",
  "entityid",
  "password",
  "privatekey",
  "proxyauthorization",
  "refreshtoken",
  "secret",
  "secretref",
  "setcookie",
  "token",
]);

const HOME_ASSISTANT_ENTITY_ID = /(?:^|[^A-Za-z0-9_])(?:climate|light)\.[a-z0-9_]+/i;
const AUTHORIZATION_VALUE = /\b(?:authorization\s*:\s*)?(?:bearer|basic)\s+\S+/i;
const SECRET_ASSIGNMENT = /\b(?:api[_-]?key|password|secret|token)\s*[=:]\s*\S+/i;
const SECRET_REFERENCE = /\bsecret:\/\/\S+/i;
const JWT_VALUE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/;
const URL_VALUE = /https?:\/\/[^\s"'<>]+/gi;

/**
 * Catalogs and Registry snapshots are public control-plane documents. Reject
 * credential-shaped values and internal Home Assistant identities before a
 * document can be checksummed or persisted. The error deliberately contains
 * no path or rejected value.
 */
export function assertCatalogPublicData(value: unknown): void {
  visit(value, new Set<object>());
}

function visit(value: unknown, ancestors: Set<object>): void {
  if (typeof value === "string") {
    assertPublicString(value);
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (ancestors.has(value)) throw new Error("CATALOG_PUBLIC_DATA_INVALID");

  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const item of value) visit(item, ancestors);
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (isSensitiveKey(key)) throw new Error("CATALOG_SENSITIVE_DATA_REJECTED");
      visit(item, ancestors);
    }
  }
  ancestors.delete(value);
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  return (
    SENSITIVE_KEYS.has(normalized) ||
    normalized.endsWith("password") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("token") ||
    normalized.endsWith("credential") ||
    normalized.endsWith("entityid")
  );
}

function assertPublicString(value: string): void {
  if (
    HOME_ASSISTANT_ENTITY_ID.test(value) ||
    AUTHORIZATION_VALUE.test(value) ||
    SECRET_ASSIGNMENT.test(value) ||
    SECRET_REFERENCE.test(value) ||
    JWT_VALUE.test(value)
  ) {
    throw new Error("CATALOG_SENSITIVE_DATA_REJECTED");
  }

  for (const match of value.matchAll(URL_VALUE)) {
    let parsed: URL;
    try {
      parsed = new URL(match[0].replace(/[),.;]+$/, ""));
    } catch {
      continue;
    }
    if (parsed.username !== "" || parsed.password !== "" || hasSensitiveQueryKey(parsed)) {
      throw new Error("CATALOG_SENSITIVE_DATA_REJECTED");
    }
  }
}

function hasSensitiveQueryKey(url: URL): boolean {
  return [...url.searchParams.keys()].some((key) => isSensitiveKey(key));
}

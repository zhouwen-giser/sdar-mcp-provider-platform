import { createHash } from "node:crypto";

export type CanonicalJsonValue =
  null | boolean | number | string | CanonicalJsonValue[] | { [key: string]: CanonicalJsonValue };

/**
 * Serializes the JSON data model using the RFC 8785 JSON Canonicalization Scheme.
 * Inputs outside the JSON data model are rejected instead of being silently coerced.
 */
export function canonicalizeJson(value: CanonicalJsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON numbers must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalizeJson(entry)).join(",")}]`;
  }
  const entries = Object.keys(value)
    .sort()
    .map((key) => {
      const entry = value[key];
      if (entry === undefined) throw new TypeError("Canonical JSON values cannot be undefined");
      return `${JSON.stringify(key)}:${canonicalizeJson(entry)}`;
    });
  return `{${entries.join(",")}}`;
}

export function sha256CanonicalJson(value: CanonicalJsonValue): string {
  return createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex");
}

export function uuidV5(name: string, namespace: string): string {
  const namespaceBytes = parseUuid(namespace);
  const digest = createHash("sha1").update(namespaceBytes).update(name, "utf8").digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function parseUuid(value: string): Buffer {
  const hex = value.replaceAll("-", "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new TypeError("UUID namespace is invalid");
  return Buffer.from(hex, "hex");
}

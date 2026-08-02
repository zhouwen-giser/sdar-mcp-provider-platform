/* global process */
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { parse } from "yaml";
export const root = process.cwd();
export const contract = path.join(root, "contracts/pms-console-api/v1");
export function readJson(p) {
  const text = fs.readFileSync(p, "utf8");
  try {
    return JSON.parse(text);
  } catch {
    return parse(text);
  }
}
export function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
}
export function hashFile(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}
export function operations(doc) {
  return Object.entries(doc.paths ?? {}).flatMap(([p, item]) =>
    Object.entries(item ?? {})
      .filter(([m]) => ["get", "post", "put", "patch", "delete"].includes(m))
      .map(([m, o]) => ({ path: p, method: m, operationId: o.operationId, operation: o })),
  );
}
export function resolveLocalRef(doc, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) throw new Error(`unsupported ref ${ref}`);
  return ref
    .slice(2)
    .split("/")
    .reduce((v, k) => v?.[k.replaceAll("~1", "/").replaceAll("~0", "~")], doc);
}
export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, stable(value[k])]),
    );
  return value;
}
export function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

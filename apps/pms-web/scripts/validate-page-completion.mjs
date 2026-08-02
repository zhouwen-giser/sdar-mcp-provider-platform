import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(appRoot, "../..");
const inventorySource = await readFile(resolve(appRoot, "src/router.ts"), "utf8");
const routerSource = await readFile(resolve(appRoot, "src/app/router.tsx"), "utf8");
const matrix = await readFile(resolve(workspaceRoot, "docs/design/pms-web-complete/PAGE_COMPLETION_MATRIX.md"), "utf8");
const failures = [];

const inventory = [...inventorySource.matchAll(/route\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"(P0|P1|internal)"\)/g)].map(match => ({ path: match[1], title: match[2], level: match[4] }));
const registrations = [...routerSource.matchAll(/\{path:"([^"]+)",(?:element:<([^>]+)>|lazy:)/g)].map(match => ({ path: `/${match[1]}`, component: match[2] }));
const registered = new Set(registrations.map(item => item.path));
const matrixRows = new Map(matrix.split(/\r?\n/u).filter(line => line.startsWith("| `")).map(line => {
  const columns = line.split("|").slice(1, -1).map(value => value.trim());
  return [columns[0]?.replaceAll("`", ""), columns];
}));
for (const route of inventory) {
  if (!registered.has(route.path)) failures.push(`${route.path}: not registered in formal router`);
  const row = matrixRows.get(route.path);
  if (row === undefined) {
    failures.push(`${route.path}: missing completion matrix row`);
    continue;
  }
  if (row.length < 11) failures.push(`${route.path}: incomplete matrix evidence columns`);
  const classifications = route.level === "internal"
    ? /INTERNAL_ONLY/u
    : /FROZEN_API|WEB_COMPOSED|CLIENT_ONLY|DEFERRED|FORBIDDEN/u;
  if (!classifications.test(row[6] ?? "")) failures.push(`${route.path}: invalid API classification`);
  if (!/route smoke|redirect/u.test(row[9] ?? "")) failures.push(`${route.path}: missing executable route evidence`);
  if (!/COMPLETE|BLOCKED_BY_CONTRACT|INTERNAL_ONLY/u.test(row[10] ?? "")) failures.push(`${route.path}: invalid completion decision`);
}
if (new Set(inventory.map(route => route.path)).size !== inventory.length) failures.push("route inventory contains duplicates");
if (/\bNOT_STARTED\b|\bIN_PROGRESS\b/.test(matrix)) failures.push("page matrix contains unfinished status");
if (/StructuredPlaceholder|PlatformPage|GenericRoute/.test(routerSource)) failures.push("router still uses generic page implementation");
if (!routerSource.includes('{path:"*",element:<NotFoundPage/>}')) failures.push("domain-independent Not Found route missing");
for (const registration of registrations) {
  if (registration.component !== undefined && registration.component.length === 0) failures.push(`${registration.path}: empty route component`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Page completion validation passed: ${inventory.length} routes`);

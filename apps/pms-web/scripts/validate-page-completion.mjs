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
const registered = new Set([...routerSource.matchAll(/\{path:"([^"]+)"/g)].map(match => `/${match[1]}`));
for (const route of inventory) {
  if (!registered.has(route.path)) failures.push(`${route.path}: not registered in formal router`);
  if (!matrix.includes(`| \`${route.path}\` |`)) failures.push(`${route.path}: missing completion matrix row`);
}
if (new Set(inventory.map(route => route.path)).size !== inventory.length) failures.push("route inventory contains duplicates");
if (/\bNOT_STARTED\b|\bIN_PROGRESS\b/.test(matrix)) failures.push("page matrix contains unfinished status");
if (/StructuredPlaceholder|PlatformPage|GenericRoute/.test(routerSource)) failures.push("router still uses generic page implementation");
if (!routerSource.includes('{path:"*",element:<NotFoundPage/>}')) failures.push("domain-independent Not Found route missing");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Page completion validation passed: ${inventory.length} routes`);

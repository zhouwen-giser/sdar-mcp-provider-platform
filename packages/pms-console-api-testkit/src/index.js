import fs from "node:fs";
export function loadJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}
export function collectOperations(openapi) {
  return Object.entries(openapi.paths).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([method]) => ["get", "post", "put", "patch", "delete"].includes(method))
      .map(([method, operation]) => ({ path, method, operationId: operation.operationId })),
  );
}
export function assertSourceMapComplete(openapi, sourceMap) {
  const ids = new Set(sourceMap.map((x) => x.operationId));
  for (const op of collectOperations(openapi))
    if (!ids.has(op.operationId)) throw new Error(`Missing endpoint source: ${op.operationId}`);
}
export function assertWritesMapCommands(openapi, sourceMap) {
  const maps = new Map(sourceMap.map((x) => [x.operationId, x]));
  for (const op of collectOperations(openapi))
    if (
      ["post", "put", "patch", "delete"].includes(op.method) &&
      !maps.get(op.operationId)?.existingCommand
    )
      throw new Error(`Missing command source: ${op.operationId}`);
}
export function assertNoRemovedOperations(baseline, current) {
  const keys = new Set(collectOperations(current).map((x) => `${x.method} ${x.path}`));
  for (const op of collectOperations(baseline))
    if (!keys.has(`${op.method} ${op.path}`))
      throw new Error(`Removed operation: ${op.method.toUpperCase()} ${op.path}`);
}

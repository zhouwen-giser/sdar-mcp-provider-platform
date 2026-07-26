import { resolve } from "node:path";
import { getProtoPath } from "google-proto-files";

export const repositoryRoot = resolve(process.env.SDAR_RUNTIME_ROOT ?? process.cwd());
export const adapterProtoPath = resolve(
  repositoryRoot,
  "proto/io/sdar/mcp/tasks/adapter/v1/adapter.proto",
);
export const adapterProtoIncludeDirectories = [
  resolve(repositoryRoot, "proto"),
  resolve(getProtoPath(), ".."),
];

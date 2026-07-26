import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { getProtoPath } from "google-proto-files";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "packages/adapter-protocol/generated");
const stagingName = `.tmp-proto-${String(process.pid)}-${randomUUID()}`;
const staging = resolve(root, stagingName);
const protoRoot = resolve(root, "proto");
const protoFiles = [
  resolve(protoRoot, "io/sdar/mcp/tasks/adapter/v1/adapter.proto"),
  resolve(protoRoot, "io/sdar/mcp/tasks/telemetry/v1/provider_telemetry.proto"),
];
const googleRoot = resolve(getProtoPath(), "..");
const bin = (name) =>
  resolve(root, "node_modules/.bin", process.platform === "win32" ? `${name}.cmd` : name);

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

const protocArgs = [
  `--proto_path=${protoRoot}`,
  `--proto_path=${googleRoot}`,
  `--js_out=import_style=commonjs,binary:${staging}`,
  `--grpc_out=grpc_js:${staging}`,
  ...protoFiles,
];
const protoc = spawnSync(bin("grpc_tools_node_protoc"), protocArgs, {
  cwd: root,
  stdio: "inherit",
});
let generated = protoc.status === 0;
if (generated) {
  const types = spawnSync(
    bin("grpc_tools_node_protoc"),
    [
      `--plugin=protoc-gen-ts=${bin("protoc-gen-ts")}`,
      `--ts_out=grpc_js:${staging}`,
      `--proto_path=${protoRoot}`,
      `--proto_path=${googleRoot}`,
      ...protoFiles,
    ],
    { cwd: root, stdio: "inherit" },
  );
  generated = types.status === 0;
}
if (!generated && process.platform === "win32") {
  process.stderr.write(
    "Windows grpc-tools binary unavailable; regenerating with pinned tools in Docker.\n",
  );
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const container = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${root}:/workspace`,
      "-w",
      "/workspace",
      "node:22-bookworm-slim",
      "sh",
      "-lc",
      [
        "set -eu",
        "mkdir -p /tmp/proto-tools",
        "cd /tmp/proto-tools",
        "npm init -y >/dev/null",
        "npm install --silent grpc-tools@1.13.1 grpc_tools_node_protoc_ts@5.3.3 google-proto-files@5.0.2",
        "./node_modules/.bin/grpc_tools_node_protoc --proto_path=/workspace/proto --proto_path=/tmp/proto-tools/node_modules/google-proto-files --js_out=import_style=commonjs,binary:/workspace/" +
          stagingName +
          " --grpc_out=grpc_js:/workspace/" +
          stagingName +
          " /workspace/proto/io/sdar/mcp/tasks/adapter/v1/adapter.proto /workspace/proto/io/sdar/mcp/tasks/telemetry/v1/provider_telemetry.proto",
        "./node_modules/.bin/grpc_tools_node_protoc --plugin=protoc-gen-ts=./node_modules/.bin/protoc-gen-ts --ts_out=grpc_js:/workspace/" +
          stagingName +
          " --proto_path=/workspace/proto --proto_path=/tmp/proto-tools/node_modules/google-proto-files /workspace/proto/io/sdar/mcp/tasks/adapter/v1/adapter.proto /workspace/proto/io/sdar/mcp/tasks/telemetry/v1/provider_telemetry.proto",
      ].join("; "),
    ],
    { cwd: root, stdio: "inherit" },
  );
  generated = container.status === 0;
}
if (!generated) {
  rmSync(staging, { recursive: true, force: true });
  process.exit(1);
}

for (const generatedType of [
  "io/sdar/mcp/tasks/adapter/v1/adapter_pb.d.ts",
  "io/sdar/mcp/tasks/adapter/v1/adapter_grpc_pb.d.ts",
  "io/sdar/mcp/tasks/telemetry/v1/provider_telemetry_pb.d.ts",
  "io/sdar/mcp/tasks/telemetry/v1/provider_telemetry_grpc_pb.d.ts",
]) {
  const path = resolve(staging, generatedType);
  writeFileSync(
    path,
    `${readFileSync(path, "utf8")
      .replace(/[ \t]+$/gm, "")
      .trimEnd()}\n`,
  );
}
writeFileSync(resolve(staging, "package.json"), '{"type":"commonjs"}\n');
rmSync(out, { recursive: true, force: true });
renameSync(staging, out);

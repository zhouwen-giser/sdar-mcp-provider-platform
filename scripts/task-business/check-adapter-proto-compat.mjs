import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import protoLoader from "@grpc/proto-loader";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const relativeProto = "io/sdar/mcp/tasks/adapter/v1/adapter.proto";
const packagePrefix = "io.sdar.mcp.tasks.adapter.v1.";
const baselinePath = resolve(root, "protocol/task-business/v1/legacy-adapter-surface.json");
const legacyLockPath = resolve(
  root,
  "reports/ugv-provider-v1/work-locks/protected-file-hashes.json",
);

function sortedObject(entries) {
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
}

/** Capture the structural contract of one Adapter Proto without generated-code churn. */
export function captureAdapterProtoSurface(protoRoot = resolve(root, "proto")) {
  const definitions = protoLoader.loadSync(relativeProto, {
    includeDirs: [protoRoot],
    keepCase: true,
  });
  return sortedObject(
    Object.entries(definitions)
      .filter(([name]) => name.startsWith(packagePrefix))
      .map(([name, definition]) => {
        if (definition.format === "Protocol Buffer 3 DescriptorProto") {
          const descriptor = definition.type;
          return [
            name,
            {
              kind: "message",
              fields: sortedObject(
                descriptor.field.map((field) => [
                  String(field.number),
                  {
                    name: field.name,
                    label: field.label,
                    type: field.type,
                    typeName: field.typeName,
                    oneof: descriptor.oneofDecl[field.oneofIndex]?.name ?? null,
                    proto3Optional: field.proto3Optional,
                  },
                ]),
              ),
              reservedRanges: descriptor.reservedRange.map((range) => [range.start, range.end]),
              reservedNames: descriptor.reservedName,
            },
          ];
        }
        if (definition.format === "Protocol Buffer 3 EnumDescriptorProto") {
          const descriptor = definition.type;
          return [
            name,
            {
              kind: "enum",
              values: sortedObject(descriptor.value.map((value) => [value.name, value.number])),
              reservedRanges: descriptor.reservedRange.map((range) => [range.start, range.end]),
              reservedNames: descriptor.reservedName,
            },
          ];
        }
        return [
          name,
          {
            kind: "service",
            methods: sortedObject(
              Object.entries(definition).map(([methodName, method]) => [
                methodName,
                {
                  path: method.path,
                  requestType: method.requestType.type.name,
                  responseType: method.responseType.type.name,
                  requestStream: method.requestStream,
                  responseStream: method.responseStream,
                },
              ]),
            ),
          },
        ];
      }),
  );
}

function includesDeep(values, expected) {
  return values.some((value) => JSON.stringify(value) === JSON.stringify(expected));
}

/** Additions are allowed; changed or removed legacy descriptors are not. */
export function legacyCompatibilityErrors(legacy, current) {
  const errors = [];
  for (const [name, oldDefinition] of Object.entries(legacy)) {
    const next = current[name];
    if (!next || next.kind !== oldDefinition.kind) {
      errors.push(`LEGACY_DEFINITION_CHANGED ${name}`);
      continue;
    }
    const items =
      oldDefinition.kind === "message"
        ? "fields"
        : oldDefinition.kind === "enum"
          ? "values"
          : "methods";
    for (const [key, oldValue] of Object.entries(oldDefinition[items])) {
      if (JSON.stringify(next[items][key]) !== JSON.stringify(oldValue)) {
        errors.push(`LEGACY_${items.toUpperCase()}_CHANGED ${name} ${key}`);
      }
    }
    if (oldDefinition.kind === "service") continue;
    for (const range of oldDefinition.reservedRanges) {
      if (!includesDeep(next.reservedRanges, range)) {
        errors.push(`LEGACY_RESERVED_RANGE_REMOVED ${name} ${JSON.stringify(range)}`);
      }
    }
    for (const reservedName of oldDefinition.reservedNames) {
      if (!next.reservedNames.includes(reservedName)) {
        errors.push(`LEGACY_RESERVED_NAME_REMOVED ${name} ${reservedName}`);
      }
    }
  }
  return errors;
}

function main() {
  const legacy = JSON.parse(readFileSync(baselinePath, "utf8"));
  const lock = JSON.parse(readFileSync(legacyLockPath, "utf8"));
  const locked = lock.find((entry) => entry.relativePath === `proto/${relativeProto}`);
  if (
    legacy.schema !== "sdar.adapter-proto-legacy-surface/v1" ||
    !locked ||
    legacy.baselineSourceSha256 !== locked.sha256
  ) {
    throw new Error("LEGACY_ADAPTER_PROTO_BASELINE_INVALID");
  }
  const index = process.argv.indexOf("--proto-root");
  const protoRoot = index < 0 ? resolve(root, "proto") : process.argv[index + 1];
  if (!protoRoot) throw new Error("PROTO_ROOT_REQUIRED");
  const source = readFileSync(resolve(protoRoot, relativeProto));
  const current = captureAdapterProtoSurface(protoRoot);
  const errors = legacyCompatibilityErrors(legacy.definitions, current);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  process.stdout.write(
    `${JSON.stringify({
      status: "PASS",
      baselineSourceSha256: legacy.baselineSourceSha256,
      currentSourceSha256: createHash("sha256").update(source).digest("hex"),
      legacyDefinitions: Object.keys(legacy.definitions).length,
      currentDefinitions: Object.keys(current).length,
    })}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

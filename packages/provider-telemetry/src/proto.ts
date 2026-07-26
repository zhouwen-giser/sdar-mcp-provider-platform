import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { resolve } from "node:path";
import { getProtoPath } from "google-proto-files";

interface TelemetryPackage {
  io: {
    sdar: {
      mcp: {
        tasks: {
          telemetry: {
            v1: {
              ProviderTelemetryIngress: grpc.ServiceClientConstructor;
            };
          };
        };
      };
    };
  };
}

let cachedPackage: TelemetryPackage | undefined;

export function telemetryClientConstructor(): grpc.ServiceClientConstructor {
  return loadTelemetryPackage().io.sdar.mcp.tasks.telemetry.v1.ProviderTelemetryIngress;
}

export function telemetryServiceDefinition(): grpc.ServiceDefinition {
  return telemetryClientConstructor().service;
}

function loadTelemetryPackage(): TelemetryPackage {
  const root = resolve(process.env.SDAR_RUNTIME_ROOT ?? process.cwd());
  cachedPackage ??= grpc.loadPackageDefinition(
    protoLoader.loadSync(
      resolve(root, "proto/io/sdar/mcp/tasks/telemetry/v1/provider_telemetry.proto"),
      {
        includeDirs: [resolve(root, "proto"), resolve(getProtoPath(), "..")],
        keepCase: false,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      },
    ),
  ) as unknown as TelemetryPackage;
  return cachedPackage;
}

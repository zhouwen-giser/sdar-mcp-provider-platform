import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { adapterProtoIncludeDirectories, adapterProtoPath } from "./paths.js";

interface AdapterPackage {
  io: {
    sdar: {
      mcp: {
        tasks: {
          adapter: {
            v1: {
              ResourceProviderAdapter: grpc.ServiceClientConstructor;
            };
          };
        };
      };
    };
  };
}

let cachedPackage: AdapterPackage | undefined;

export function loadAdapterPackage(): AdapterPackage {
  cachedPackage ??= grpc.loadPackageDefinition(
    protoLoader.loadSync(adapterProtoPath, {
      includeDirs: adapterProtoIncludeDirectories,
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    }),
  ) as unknown as AdapterPackage;
  return cachedPackage;
}

export function adapterClientConstructor(): grpc.ServiceClientConstructor {
  return loadAdapterPackage().io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter;
}

export function adapterServiceDefinition(): grpc.ServiceDefinition {
  return adapterClientConstructor().service;
}

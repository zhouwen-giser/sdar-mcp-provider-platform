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

interface GrpcStruct {
  fields: Record<string, GrpcValue>;
}

interface GrpcValue {
  nullValue?: "NULL_VALUE";
  numberValue?: number;
  stringValue?: string;
  boolValue?: boolean;
  structValue?: GrpcStruct;
  listValue?: { values: GrpcValue[] };
  kind?: "nullValue" | "numberValue" | "stringValue" | "boolValue" | "structValue" | "listValue";
}

export interface ProviderTelemetryStructLimits {
  maxDepth?: number;
  maxNodes?: number;
}

export class ProviderTelemetryStructError extends TypeError {
  constructor(readonly reasonCode: string) {
    super(reasonCode);
    this.name = "ProviderTelemetryStructError";
  }
}

const defaultStructLimits = { maxDepth: 16, maxNodes: 4_096 } as const;
let cachedPackage: TelemetryPackage | undefined;
let cachedClientConstructor: grpc.ServiceClientConstructor | undefined;

/**
 * Returns a client whose public request shape uses ordinary JavaScript records.
 * proto-loader does not recursively coerce those records to google.protobuf.Struct,
 * so the request serializer performs that conversion for every current consumer.
 */
export function telemetryClientConstructor(): grpc.ServiceClientConstructor {
  cachedClientConstructor ??= grpc.makeGenericClientConstructor(
    clientServiceDefinition(rawTelemetryClientConstructor().service),
    "ProviderTelemetryIngress",
  );
  return cachedClientConstructor;
}

export function telemetryServiceDefinition(): grpc.ServiceDefinition {
  return rawTelemetryClientConstructor().service;
}

export function recordToGrpcStruct(
  value: Record<string, unknown>,
  limits: ProviderTelemetryStructLimits = {},
): GrpcStruct {
  const state = codecState(limits);
  return recordToGrpcStructWithState(value, state, 1);
}

export function grpcStructToRecord(
  value: unknown,
  limits: ProviderTelemetryStructLimits = {},
): Record<string, unknown> {
  const state = codecState(limits);
  return grpcStructToRecordWithState(value, state, 1);
}

function rawTelemetryClientConstructor(): grpc.ServiceClientConstructor {
  return loadTelemetryPackage().io.sdar.mcp.tasks.telemetry.v1.ProviderTelemetryIngress;
}

function clientServiceDefinition(service: grpc.ServiceDefinition): grpc.ServiceDefinition {
  return Object.fromEntries(
    Object.entries(service).map(([name, method]) => [
      name,
      method.path.endsWith("/EmitProviderEvents")
        ? {
            ...method,
            requestSerialize: (request: unknown) =>
              method.requestSerialize(providerRequestToGrpc(request)),
          }
        : method,
    ]),
  );
}

function providerRequestToGrpc(request: unknown): unknown {
  if (!isRecord(request) || !Array.isArray(request.events)) return request;
  const events = request.events as unknown[];
  return {
    ...request,
    events: events.map((event) => {
      if (!isRecord(event)) return event;
      return {
        ...event,
        attributes: recordToGrpcStruct(requireRecord(event.attributes)),
        payload: recordToGrpcStruct(requireRecord(event.payload)),
      };
    }),
  };
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

interface CodecState {
  maxDepth: number;
  maxNodes: number;
  nodes: number;
}

function codecState(limits: ProviderTelemetryStructLimits): CodecState {
  const maxDepth = limits.maxDepth ?? defaultStructLimits.maxDepth;
  const maxNodes = limits.maxNodes ?? defaultStructLimits.maxNodes;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1) {
    throw new ProviderTelemetryStructError("PROVIDER_EVENT_STRUCT_LIMIT_INVALID");
  }
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1) {
    throw new ProviderTelemetryStructError("PROVIDER_EVENT_STRUCT_LIMIT_INVALID");
  }
  return { maxDepth, maxNodes, nodes: 0 };
}

function enterNode(state: CodecState, depth: number): void {
  if (depth > state.maxDepth) {
    throw new ProviderTelemetryStructError("PROVIDER_EVENT_TOO_DEEP");
  }
  state.nodes += 1;
  if (state.nodes > state.maxNodes) {
    throw new ProviderTelemetryStructError("PROVIDER_EVENT_TOO_COMPLEX");
  }
}

function recordToGrpcStructWithState(
  value: Record<string, unknown>,
  state: CodecState,
  depth: number,
): GrpcStruct {
  enterNode(state, depth);
  return {
    fields: Object.fromEntries(
      Object.entries(value)
        .filter((entry) => entry[1] !== undefined)
        .map(([key, child]) => [key, valueToGrpc(child, state, depth + 1)]),
    ),
  };
}

function valueToGrpc(value: unknown, state: CodecState, depth: number): GrpcValue {
  enterNode(state, depth);
  if (value === null || value === undefined) return { nullValue: "NULL_VALUE", kind: "nullValue" };
  if (typeof value === "string") return { stringValue: value, kind: "stringValue" };
  if (typeof value === "boolean") return { boolValue: value, kind: "boolValue" };
  if (typeof value === "number" && Number.isFinite(value)) {
    return { numberValue: value, kind: "numberValue" };
  }
  if (Array.isArray(value)) {
    return {
      listValue: { values: value.map((child) => valueToGrpc(child, state, depth + 1)) },
      kind: "listValue",
    };
  }
  if (isRecord(value)) {
    return {
      structValue: recordToGrpcStructWithState(value, state, depth),
      kind: "structValue",
    };
  }
  throw new ProviderTelemetryStructError("PROVIDER_EVENT_PAYLOAD_INVALID");
}

function grpcStructToRecordWithState(
  value: unknown,
  state: CodecState,
  depth: number,
): Record<string, unknown> {
  enterNode(state, depth);
  if (!isRecord(value) || !isRecord(value.fields)) {
    throw new ProviderTelemetryStructError("PROVIDER_EVENT_PAYLOAD_INVALID");
  }
  return Object.fromEntries(
    Object.entries(value.fields).map(([key, child]) => [
      key,
      valueFromGrpc(child, state, depth + 1),
    ]),
  );
}

function valueFromGrpc(value: unknown, state: CodecState, depth: number): unknown {
  enterNode(state, depth);
  if (!isRecord(value)) {
    throw new ProviderTelemetryStructError("PROVIDER_EVENT_PAYLOAD_INVALID");
  }
  const kind = typeof value.kind === "string" ? value.kind : undefined;
  if (kind === "stringValue" || (kind === undefined && Object.hasOwn(value, "stringValue"))) {
    if (typeof value.stringValue !== "string") throw invalidPayload();
    return value.stringValue;
  }
  if (kind === "numberValue" || (kind === undefined && Object.hasOwn(value, "numberValue"))) {
    if (typeof value.numberValue !== "number" || !Number.isFinite(value.numberValue)) {
      throw invalidPayload();
    }
    return value.numberValue;
  }
  if (kind === "boolValue" || (kind === undefined && Object.hasOwn(value, "boolValue"))) {
    if (typeof value.boolValue !== "boolean") throw invalidPayload();
    return value.boolValue;
  }
  if (kind === "structValue" || (kind === undefined && Object.hasOwn(value, "structValue"))) {
    return grpcStructToRecordWithState(value.structValue, state, depth);
  }
  if (kind === "listValue" || (kind === undefined && Object.hasOwn(value, "listValue"))) {
    if (!isRecord(value.listValue) || !Array.isArray(value.listValue.values)) {
      throw invalidPayload();
    }
    return value.listValue.values.map((child) => valueFromGrpc(child, state, depth + 1));
  }
  if (kind === "nullValue" || (kind === undefined && Object.hasOwn(value, "nullValue"))) {
    return null;
  }
  throw invalidPayload();
}

function invalidPayload(): ProviderTelemetryStructError {
  return new ProviderTelemetryStructError("PROVIDER_EVENT_PAYLOAD_INVALID");
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw invalidPayload();
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

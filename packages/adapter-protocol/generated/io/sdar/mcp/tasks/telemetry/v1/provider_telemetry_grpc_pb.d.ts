// package: io.sdar.mcp.tasks.telemetry.v1
// file: io/sdar/mcp/tasks/telemetry/v1/provider_telemetry.proto

/* tslint:disable */
/* eslint-disable */

import * as grpc from "@grpc/grpc-js";
import * as io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb from "../../../../../../io/sdar/mcp/tasks/telemetry/v1/provider_telemetry_pb";
import * as google_protobuf_struct_pb from "google-protobuf/google/protobuf/struct_pb";
import * as google_protobuf_timestamp_pb from "google-protobuf/google/protobuf/timestamp_pb";

interface IProviderTelemetryIngressService extends grpc.ServiceDefinition<grpc.UntypedServiceImplementation> {
    emitProviderEvents: IProviderTelemetryIngressService_IEmitProviderEvents;
}

interface IProviderTelemetryIngressService_IEmitProviderEvents extends grpc.MethodDefinition<io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsRequest, io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsResponse> {
    path: "/io.sdar.mcp.tasks.telemetry.v1.ProviderTelemetryIngress/EmitProviderEvents";
    requestStream: false;
    responseStream: false;
    requestSerialize: grpc.serialize<io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsRequest>;
    requestDeserialize: grpc.deserialize<io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsRequest>;
    responseSerialize: grpc.serialize<io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsResponse>;
    responseDeserialize: grpc.deserialize<io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsResponse>;
}

export const ProviderTelemetryIngressService: IProviderTelemetryIngressService;

export interface IProviderTelemetryIngressServer extends grpc.UntypedServiceImplementation {
    emitProviderEvents: grpc.handleUnaryCall<io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsRequest, io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsResponse>;
}

export interface IProviderTelemetryIngressClient {
    emitProviderEvents(request: io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsRequest, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsResponse) => void): grpc.ClientUnaryCall;
    emitProviderEvents(request: io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsResponse) => void): grpc.ClientUnaryCall;
    emitProviderEvents(request: io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsResponse) => void): grpc.ClientUnaryCall;
}

export class ProviderTelemetryIngressClient extends grpc.Client implements IProviderTelemetryIngressClient {
    constructor(address: string, credentials: grpc.ChannelCredentials, options?: Partial<grpc.ClientOptions>);
    public emitProviderEvents(request: io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsRequest, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsResponse) => void): grpc.ClientUnaryCall;
    public emitProviderEvents(request: io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsResponse) => void): grpc.ClientUnaryCall;
    public emitProviderEvents(request: io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsResponse) => void): grpc.ClientUnaryCall;
}

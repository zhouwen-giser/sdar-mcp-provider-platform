// package: io.sdar.mcp.tasks.adapter.v1
// file: io/sdar/mcp/tasks/adapter/v1/adapter.proto

/* tslint:disable */
/* eslint-disable */

import * as grpc from "@grpc/grpc-js";
import * as io_sdar_mcp_tasks_adapter_v1_adapter_pb from "../../../../../../io/sdar/mcp/tasks/adapter/v1/adapter_pb";
import * as google_protobuf_struct_pb from "google-protobuf/google/protobuf/struct_pb";
import * as google_protobuf_timestamp_pb from "google-protobuf/google/protobuf/timestamp_pb";

interface IResourceProviderAdapterService extends grpc.ServiceDefinition<grpc.UntypedServiceImplementation> {
    describeProvider: IResourceProviderAdapterService_IDescribeProvider;
    checkAvailability: IResourceProviderAdapterService_ICheckAvailability;
    startOperation: IResourceProviderAdapterService_IStartOperation;
    getExecution: IResourceProviderAdapterService_IGetExecution;
    requestCancel: IResourceProviderAdapterService_IRequestCancel;
    reconcileExecution: IResourceProviderAdapterService_IReconcileExecution;
    updateExecution: IResourceProviderAdapterService_IUpdateExecution;
    pauseExecution: IResourceProviderAdapterService_IPauseExecution;
    resumeExecution: IResourceProviderAdapterService_IResumeExecution;
    streamExecutionEvents: IResourceProviderAdapterService_IStreamExecutionEvents;
    streamBusinessEvents: IResourceProviderAdapterService_IStreamBusinessEvents;
    listResources: IResourceProviderAdapterService_IListResources;
}

interface IResourceProviderAdapterService_IDescribeProvider extends grpc.MethodDefinition<io_sdar_mcp_tasks_adapter_v1_adapter_pb.DescribeProviderRequest, io_sdar_mcp_tasks_adapter_v1_adapter_pb.ProviderManifest> {
    path: "/io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter/DescribeProvider";
    requestStream: false;
    responseStream: false;
    requestSerialize: grpc.serialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.DescribeProviderRequest>;
    requestDeserialize: grpc.deserialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.DescribeProviderRequest>;
    responseSerialize: grpc.serialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ProviderManifest>;
    responseDeserialize: grpc.deserialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ProviderManifest>;
}
interface IResourceProviderAdapterService_ICheckAvailability extends grpc.MethodDefinition<io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityRequest, io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityResponse> {
    path: "/io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter/CheckAvailability";
    requestStream: false;
    responseStream: false;
    requestSerialize: grpc.serialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityRequest>;
    requestDeserialize: grpc.deserialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityRequest>;
    responseSerialize: grpc.serialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityResponse>;
    responseDeserialize: grpc.deserialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityResponse>;
}
interface IResourceProviderAdapterService_IStartOperation extends grpc.MethodDefinition<io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationRequest, io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationResponse> {
    path: "/io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter/StartOperation";
    requestStream: false;
    responseStream: false;
    requestSerialize: grpc.serialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationRequest>;
    requestDeserialize: grpc.deserialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationRequest>;
    responseSerialize: grpc.serialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationResponse>;
    responseDeserialize: grpc.deserialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationResponse>;
}
interface IResourceProviderAdapterService_IGetExecution extends grpc.MethodDefinition<io_sdar_mcp_tasks_adapter_v1_adapter_pb.GetExecutionRequest, io_sdar_mcp_tasks_adapter_v1_adapter_pb.ExecutionSnapshot> {
    path: "/io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter/GetExecution";
    requestStream: false;
    responseStream: false;
    requestSerialize: grpc.serialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.GetExecutionRequest>;
    requestDeserialize: grpc.deserialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.GetExecutionRequest>;
    responseSerialize: grpc.serialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ExecutionSnapshot>;
    responseDeserialize: grpc.deserialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ExecutionSnapshot>;
}
interface IResourceProviderAdapterService_IRequestCancel extends grpc.MethodDefinition<io_sdar_mcp_tasks_adapter_v1_adapter_pb.RequestCancelRequest, io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck> {
    path: "/io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter/RequestCancel";
    requestStream: false;
    responseStream: false;
    requestSerialize: grpc.serialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.RequestCancelRequest>;
    requestDeserialize: grpc.deserialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.RequestCancelRequest>;
    responseSerialize: grpc.serialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck>;
    responseDeserialize: grpc.deserialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck>;
}
interface IResourceProviderAdapterService_IReconcileExecution extends grpc.MethodDefinition<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionRequest, io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionResponse> {
    path: "/io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter/ReconcileExecution";
    requestStream: false;
    responseStream: false;
    requestSerialize: grpc.serialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionRequest>;
    requestDeserialize: grpc.deserialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionRequest>;
    responseSerialize: grpc.serialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionResponse>;
    responseDeserialize: grpc.deserialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionResponse>;
}
interface IResourceProviderAdapterService_IUpdateExecution extends grpc.MethodDefinition<io_sdar_mcp_tasks_adapter_v1_adapter_pb.UpdateExecutionRequest, io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck> {
    path: "/io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter/UpdateExecution";
    requestStream: false;
    responseStream: false;
    requestSerialize: grpc.serialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.UpdateExecutionRequest>;
    requestDeserialize: grpc.deserialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.UpdateExecutionRequest>;
    responseSerialize: grpc.serialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck>;
    responseDeserialize: grpc.deserialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck>;
}
interface IResourceProviderAdapterService_IPauseExecution extends grpc.MethodDefinition<io_sdar_mcp_tasks_adapter_v1_adapter_pb.PauseExecutionRequest, io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck> {
    path: "/io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter/PauseExecution";
    requestStream: false;
    responseStream: false;
    requestSerialize: grpc.serialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.PauseExecutionRequest>;
    requestDeserialize: grpc.deserialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.PauseExecutionRequest>;
    responseSerialize: grpc.serialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck>;
    responseDeserialize: grpc.deserialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck>;
}
interface IResourceProviderAdapterService_IResumeExecution extends grpc.MethodDefinition<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ResumeExecutionRequest, io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck> {
    path: "/io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter/ResumeExecution";
    requestStream: false;
    responseStream: false;
    requestSerialize: grpc.serialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ResumeExecutionRequest>;
    requestDeserialize: grpc.deserialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ResumeExecutionRequest>;
    responseSerialize: grpc.serialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck>;
    responseDeserialize: grpc.deserialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck>;
}
interface IResourceProviderAdapterService_IStreamExecutionEvents extends grpc.MethodDefinition<io_sdar_mcp_tasks_adapter_v1_adapter_pb.StreamExecutionEventsRequest, io_sdar_mcp_tasks_adapter_v1_adapter_pb.ExecutionEvent> {
    path: "/io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter/StreamExecutionEvents";
    requestStream: false;
    responseStream: true;
    requestSerialize: grpc.serialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.StreamExecutionEventsRequest>;
    requestDeserialize: grpc.deserialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.StreamExecutionEventsRequest>;
    responseSerialize: grpc.serialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ExecutionEvent>;
    responseDeserialize: grpc.deserialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ExecutionEvent>;
}
interface IResourceProviderAdapterService_IStreamBusinessEvents extends grpc.MethodDefinition<io_sdar_mcp_tasks_adapter_v1_adapter_pb.StreamBusinessEventsRequest, io_sdar_mcp_tasks_adapter_v1_adapter_pb.AdapterBusinessEvent> {
    path: "/io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter/StreamBusinessEvents";
    requestStream: false;
    responseStream: true;
    requestSerialize: grpc.serialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.StreamBusinessEventsRequest>;
    requestDeserialize: grpc.deserialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.StreamBusinessEventsRequest>;
    responseSerialize: grpc.serialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.AdapterBusinessEvent>;
    responseDeserialize: grpc.deserialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.AdapterBusinessEvent>;
}
interface IResourceProviderAdapterService_IListResources extends grpc.MethodDefinition<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesRequest, io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesResponse> {
    path: "/io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter/ListResources";
    requestStream: false;
    responseStream: false;
    requestSerialize: grpc.serialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesRequest>;
    requestDeserialize: grpc.deserialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesRequest>;
    responseSerialize: grpc.serialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesResponse>;
    responseDeserialize: grpc.deserialize<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesResponse>;
}

export const ResourceProviderAdapterService: IResourceProviderAdapterService;

export interface IResourceProviderAdapterServer extends grpc.UntypedServiceImplementation {
    describeProvider: grpc.handleUnaryCall<io_sdar_mcp_tasks_adapter_v1_adapter_pb.DescribeProviderRequest, io_sdar_mcp_tasks_adapter_v1_adapter_pb.ProviderManifest>;
    checkAvailability: grpc.handleUnaryCall<io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityRequest, io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityResponse>;
    startOperation: grpc.handleUnaryCall<io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationRequest, io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationResponse>;
    getExecution: grpc.handleUnaryCall<io_sdar_mcp_tasks_adapter_v1_adapter_pb.GetExecutionRequest, io_sdar_mcp_tasks_adapter_v1_adapter_pb.ExecutionSnapshot>;
    requestCancel: grpc.handleUnaryCall<io_sdar_mcp_tasks_adapter_v1_adapter_pb.RequestCancelRequest, io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck>;
    reconcileExecution: grpc.handleUnaryCall<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionRequest, io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionResponse>;
    updateExecution: grpc.handleUnaryCall<io_sdar_mcp_tasks_adapter_v1_adapter_pb.UpdateExecutionRequest, io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck>;
    pauseExecution: grpc.handleUnaryCall<io_sdar_mcp_tasks_adapter_v1_adapter_pb.PauseExecutionRequest, io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck>;
    resumeExecution: grpc.handleUnaryCall<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ResumeExecutionRequest, io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck>;
    streamExecutionEvents: grpc.handleServerStreamingCall<io_sdar_mcp_tasks_adapter_v1_adapter_pb.StreamExecutionEventsRequest, io_sdar_mcp_tasks_adapter_v1_adapter_pb.ExecutionEvent>;
    streamBusinessEvents: grpc.handleServerStreamingCall<io_sdar_mcp_tasks_adapter_v1_adapter_pb.StreamBusinessEventsRequest, io_sdar_mcp_tasks_adapter_v1_adapter_pb.AdapterBusinessEvent>;
    listResources: grpc.handleUnaryCall<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesRequest, io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesResponse>;
}

export interface IResourceProviderAdapterClient {
    describeProvider(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.DescribeProviderRequest, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ProviderManifest) => void): grpc.ClientUnaryCall;
    describeProvider(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.DescribeProviderRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ProviderManifest) => void): grpc.ClientUnaryCall;
    describeProvider(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.DescribeProviderRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ProviderManifest) => void): grpc.ClientUnaryCall;
    checkAvailability(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityRequest, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityResponse) => void): grpc.ClientUnaryCall;
    checkAvailability(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityResponse) => void): grpc.ClientUnaryCall;
    checkAvailability(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityResponse) => void): grpc.ClientUnaryCall;
    startOperation(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationRequest, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationResponse) => void): grpc.ClientUnaryCall;
    startOperation(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationResponse) => void): grpc.ClientUnaryCall;
    startOperation(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationResponse) => void): grpc.ClientUnaryCall;
    getExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.GetExecutionRequest, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ExecutionSnapshot) => void): grpc.ClientUnaryCall;
    getExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.GetExecutionRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ExecutionSnapshot) => void): grpc.ClientUnaryCall;
    getExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.GetExecutionRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ExecutionSnapshot) => void): grpc.ClientUnaryCall;
    requestCancel(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.RequestCancelRequest, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck) => void): grpc.ClientUnaryCall;
    requestCancel(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.RequestCancelRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck) => void): grpc.ClientUnaryCall;
    requestCancel(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.RequestCancelRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck) => void): grpc.ClientUnaryCall;
    reconcileExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionRequest, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionResponse) => void): grpc.ClientUnaryCall;
    reconcileExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionResponse) => void): grpc.ClientUnaryCall;
    reconcileExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionResponse) => void): grpc.ClientUnaryCall;
    updateExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.UpdateExecutionRequest, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck) => void): grpc.ClientUnaryCall;
    updateExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.UpdateExecutionRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck) => void): grpc.ClientUnaryCall;
    updateExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.UpdateExecutionRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck) => void): grpc.ClientUnaryCall;
    pauseExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.PauseExecutionRequest, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck) => void): grpc.ClientUnaryCall;
    pauseExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.PauseExecutionRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck) => void): grpc.ClientUnaryCall;
    pauseExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.PauseExecutionRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck) => void): grpc.ClientUnaryCall;
    resumeExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ResumeExecutionRequest, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck) => void): grpc.ClientUnaryCall;
    resumeExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ResumeExecutionRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck) => void): grpc.ClientUnaryCall;
    resumeExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ResumeExecutionRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck) => void): grpc.ClientUnaryCall;
    streamExecutionEvents(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.StreamExecutionEventsRequest, options?: Partial<grpc.CallOptions>): grpc.ClientReadableStream<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ExecutionEvent>;
    streamExecutionEvents(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.StreamExecutionEventsRequest, metadata?: grpc.Metadata, options?: Partial<grpc.CallOptions>): grpc.ClientReadableStream<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ExecutionEvent>;
    streamBusinessEvents(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.StreamBusinessEventsRequest, options?: Partial<grpc.CallOptions>): grpc.ClientReadableStream<io_sdar_mcp_tasks_adapter_v1_adapter_pb.AdapterBusinessEvent>;
    streamBusinessEvents(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.StreamBusinessEventsRequest, metadata?: grpc.Metadata, options?: Partial<grpc.CallOptions>): grpc.ClientReadableStream<io_sdar_mcp_tasks_adapter_v1_adapter_pb.AdapterBusinessEvent>;
    listResources(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesRequest, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesResponse) => void): grpc.ClientUnaryCall;
    listResources(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesResponse) => void): grpc.ClientUnaryCall;
    listResources(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesResponse) => void): grpc.ClientUnaryCall;
}

export class ResourceProviderAdapterClient extends grpc.Client implements IResourceProviderAdapterClient {
    constructor(address: string, credentials: grpc.ChannelCredentials, options?: Partial<grpc.ClientOptions>);
    public describeProvider(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.DescribeProviderRequest, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ProviderManifest) => void): grpc.ClientUnaryCall;
    public describeProvider(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.DescribeProviderRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ProviderManifest) => void): grpc.ClientUnaryCall;
    public describeProvider(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.DescribeProviderRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ProviderManifest) => void): grpc.ClientUnaryCall;
    public checkAvailability(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityRequest, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityResponse) => void): grpc.ClientUnaryCall;
    public checkAvailability(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityResponse) => void): grpc.ClientUnaryCall;
    public checkAvailability(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityResponse) => void): grpc.ClientUnaryCall;
    public startOperation(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationRequest, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationResponse) => void): grpc.ClientUnaryCall;
    public startOperation(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationResponse) => void): grpc.ClientUnaryCall;
    public startOperation(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationResponse) => void): grpc.ClientUnaryCall;
    public getExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.GetExecutionRequest, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ExecutionSnapshot) => void): grpc.ClientUnaryCall;
    public getExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.GetExecutionRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ExecutionSnapshot) => void): grpc.ClientUnaryCall;
    public getExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.GetExecutionRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ExecutionSnapshot) => void): grpc.ClientUnaryCall;
    public requestCancel(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.RequestCancelRequest, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck) => void): grpc.ClientUnaryCall;
    public requestCancel(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.RequestCancelRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck) => void): grpc.ClientUnaryCall;
    public requestCancel(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.RequestCancelRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck) => void): grpc.ClientUnaryCall;
    public reconcileExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionRequest, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionResponse) => void): grpc.ClientUnaryCall;
    public reconcileExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionResponse) => void): grpc.ClientUnaryCall;
    public reconcileExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionResponse) => void): grpc.ClientUnaryCall;
    public updateExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.UpdateExecutionRequest, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck) => void): grpc.ClientUnaryCall;
    public updateExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.UpdateExecutionRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck) => void): grpc.ClientUnaryCall;
    public updateExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.UpdateExecutionRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck) => void): grpc.ClientUnaryCall;
    public pauseExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.PauseExecutionRequest, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck) => void): grpc.ClientUnaryCall;
    public pauseExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.PauseExecutionRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck) => void): grpc.ClientUnaryCall;
    public pauseExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.PauseExecutionRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck) => void): grpc.ClientUnaryCall;
    public resumeExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ResumeExecutionRequest, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck) => void): grpc.ClientUnaryCall;
    public resumeExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ResumeExecutionRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck) => void): grpc.ClientUnaryCall;
    public resumeExecution(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ResumeExecutionRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck) => void): grpc.ClientUnaryCall;
    public streamExecutionEvents(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.StreamExecutionEventsRequest, options?: Partial<grpc.CallOptions>): grpc.ClientReadableStream<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ExecutionEvent>;
    public streamExecutionEvents(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.StreamExecutionEventsRequest, metadata?: grpc.Metadata, options?: Partial<grpc.CallOptions>): grpc.ClientReadableStream<io_sdar_mcp_tasks_adapter_v1_adapter_pb.ExecutionEvent>;
    public streamBusinessEvents(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.StreamBusinessEventsRequest, options?: Partial<grpc.CallOptions>): grpc.ClientReadableStream<io_sdar_mcp_tasks_adapter_v1_adapter_pb.AdapterBusinessEvent>;
    public streamBusinessEvents(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.StreamBusinessEventsRequest, metadata?: grpc.Metadata, options?: Partial<grpc.CallOptions>): grpc.ClientReadableStream<io_sdar_mcp_tasks_adapter_v1_adapter_pb.AdapterBusinessEvent>;
    public listResources(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesRequest, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesResponse) => void): grpc.ClientUnaryCall;
    public listResources(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesRequest, metadata: grpc.Metadata, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesResponse) => void): grpc.ClientUnaryCall;
    public listResources(request: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesRequest, metadata: grpc.Metadata, options: Partial<grpc.CallOptions>, callback: (error: grpc.ServiceError | null, response: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesResponse) => void): grpc.ClientUnaryCall;
}

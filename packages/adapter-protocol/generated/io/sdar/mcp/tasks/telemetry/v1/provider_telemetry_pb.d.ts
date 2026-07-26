// package: io.sdar.mcp.tasks.telemetry.v1
// file: io/sdar/mcp/tasks/telemetry/v1/provider_telemetry.proto

/* tslint:disable */
/* eslint-disable */

import * as jspb from "google-protobuf";
import * as google_protobuf_struct_pb from "google-protobuf/google/protobuf/struct_pb";
import * as google_protobuf_timestamp_pb from "google-protobuf/google/protobuf/timestamp_pb";

export class EmitProviderEventsRequest extends jspb.Message {
    getProviderId(): string;
    setProviderId(value: string): EmitProviderEventsRequest;
    clearEventsList(): void;
    getEventsList(): Array<ProviderTelemetryEvent>;
    setEventsList(value: Array<ProviderTelemetryEvent>): EmitProviderEventsRequest;
    addEvents(value?: ProviderTelemetryEvent, index?: number): ProviderTelemetryEvent;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): EmitProviderEventsRequest.AsObject;
    static toObject(includeInstance: boolean, msg: EmitProviderEventsRequest): EmitProviderEventsRequest.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: EmitProviderEventsRequest, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): EmitProviderEventsRequest;
    static deserializeBinaryFromReader(message: EmitProviderEventsRequest, reader: jspb.BinaryReader): EmitProviderEventsRequest;
}

export namespace EmitProviderEventsRequest {
    export type AsObject = {
        providerId: string,
        eventsList: Array<ProviderTelemetryEvent.AsObject>,
    }
}

export class EmitProviderEventsResponse extends jspb.Message {
    clearResultsList(): void;
    getResultsList(): Array<ProviderTelemetryEventResult>;
    setResultsList(value: Array<ProviderTelemetryEventResult>): EmitProviderEventsResponse;
    addResults(value?: ProviderTelemetryEventResult, index?: number): ProviderTelemetryEventResult;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): EmitProviderEventsResponse.AsObject;
    static toObject(includeInstance: boolean, msg: EmitProviderEventsResponse): EmitProviderEventsResponse.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: EmitProviderEventsResponse, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): EmitProviderEventsResponse;
    static deserializeBinaryFromReader(message: EmitProviderEventsResponse, reader: jspb.BinaryReader): EmitProviderEventsResponse;
}

export namespace EmitProviderEventsResponse {
    export type AsObject = {
        resultsList: Array<ProviderTelemetryEventResult.AsObject>,
    }
}

export class ProviderTelemetryEvent extends jspb.Message {
    getProviderEventId(): string;
    setProviderEventId(value: string): ProviderTelemetryEvent;
    getProviderEventSequence(): number;
    setProviderEventSequence(value: number): ProviderTelemetryEvent;
    getEventType(): ProviderTelemetryEventType;
    setEventType(value: ProviderTelemetryEventType): ProviderTelemetryEvent;
    getResourceId(): string;
    setResourceId(value: string): ProviderTelemetryEvent;
    getResourceType(): string;
    setResourceType(value: string): ProviderTelemetryEvent;
    getTaskId(): string;
    setTaskId(value: string): ProviderTelemetryEvent;
    getExternalExecutionId(): string;
    setExternalExecutionId(value: string): ProviderTelemetryEvent;
    getOperationName(): string;
    setOperationName(value: string): ProviderTelemetryEvent;

    hasOccurredAt(): boolean;
    clearOccurredAt(): void;
    getOccurredAt(): google_protobuf_timestamp_pb.Timestamp | undefined;
    setOccurredAt(value?: google_protobuf_timestamp_pb.Timestamp): ProviderTelemetryEvent;

    hasAttributes(): boolean;
    clearAttributes(): void;
    getAttributes(): google_protobuf_struct_pb.Struct | undefined;
    setAttributes(value?: google_protobuf_struct_pb.Struct): ProviderTelemetryEvent;

    hasPayload(): boolean;
    clearPayload(): void;
    getPayload(): google_protobuf_struct_pb.Struct | undefined;
    setPayload(value?: google_protobuf_struct_pb.Struct): ProviderTelemetryEvent;
    getTraceparent(): string;
    setTraceparent(value: string): ProviderTelemetryEvent;
    getTracestate(): string;
    setTracestate(value: string): ProviderTelemetryEvent;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): ProviderTelemetryEvent.AsObject;
    static toObject(includeInstance: boolean, msg: ProviderTelemetryEvent): ProviderTelemetryEvent.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: ProviderTelemetryEvent, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): ProviderTelemetryEvent;
    static deserializeBinaryFromReader(message: ProviderTelemetryEvent, reader: jspb.BinaryReader): ProviderTelemetryEvent;
}

export namespace ProviderTelemetryEvent {
    export type AsObject = {
        providerEventId: string,
        providerEventSequence: number,
        eventType: ProviderTelemetryEventType,
        resourceId: string,
        resourceType: string,
        taskId: string,
        externalExecutionId: string,
        operationName: string,
        occurredAt?: google_protobuf_timestamp_pb.Timestamp.AsObject,
        attributes?: google_protobuf_struct_pb.Struct.AsObject,
        payload?: google_protobuf_struct_pb.Struct.AsObject,
        traceparent: string,
        tracestate: string,
    }
}

export class ProviderTelemetryEventResult extends jspb.Message {
    getProviderEventId(): string;
    setProviderEventId(value: string): ProviderTelemetryEventResult;
    getAccepted(): boolean;
    setAccepted(value: boolean): ProviderTelemetryEventResult;
    getDuplicate(): boolean;
    setDuplicate(value: boolean): ProviderTelemetryEventResult;
    getRecordId(): string;
    setRecordId(value: string): ProviderTelemetryEventResult;
    getReasonCode(): string;
    setReasonCode(value: string): ProviderTelemetryEventResult;
    getMessage(): string;
    setMessage(value: string): ProviderTelemetryEventResult;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): ProviderTelemetryEventResult.AsObject;
    static toObject(includeInstance: boolean, msg: ProviderTelemetryEventResult): ProviderTelemetryEventResult.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: ProviderTelemetryEventResult, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): ProviderTelemetryEventResult;
    static deserializeBinaryFromReader(message: ProviderTelemetryEventResult, reader: jspb.BinaryReader): ProviderTelemetryEventResult;
}

export namespace ProviderTelemetryEventResult {
    export type AsObject = {
        providerEventId: string,
        accepted: boolean,
        duplicate: boolean,
        recordId: string,
        reasonCode: string,
        message: string,
    }
}

export enum ProviderTelemetryEventType {
    PROVIDER_TELEMETRY_EVENT_TYPE_UNSPECIFIED = 0,
    RESOURCE_STATE = 1,
    RESOURCE_METRIC = 2,
    RESOURCE_HEALTH = 3,
    EXECUTION_PROGRESS = 4,
}

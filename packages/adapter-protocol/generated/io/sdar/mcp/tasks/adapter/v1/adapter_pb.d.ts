// package: io.sdar.mcp.tasks.adapter.v1
// file: io/sdar/mcp/tasks/adapter/v1/adapter.proto

/* tslint:disable */
/* eslint-disable */

import * as jspb from "google-protobuf";
import * as google_protobuf_struct_pb from "google-protobuf/google/protobuf/struct_pb";
import * as google_protobuf_timestamp_pb from "google-protobuf/google/protobuf/timestamp_pb";

export class RequestMetadata extends jspb.Message {
    getAdapterProtocolVersion(): string;
    setAdapterProtocolVersion(value: string): RequestMetadata;
    getProviderId(): string;
    setProviderId(value: string): RequestMetadata;
    getCorrelationId(): string;
    setCorrelationId(value: string): RequestMetadata;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): RequestMetadata.AsObject;
    static toObject(includeInstance: boolean, msg: RequestMetadata): RequestMetadata.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: RequestMetadata, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): RequestMetadata;
    static deserializeBinaryFromReader(message: RequestMetadata, reader: jspb.BinaryReader): RequestMetadata;
}

export namespace RequestMetadata {
    export type AsObject = {
        adapterProtocolVersion: string,
        providerId: string,
        correlationId: string,
    }
}

export class ExecutionContext extends jspb.Message {
    getAuthorizationContextHash(): string;
    setAuthorizationContextHash(value: string): ExecutionContext;
    getExecutionMode(): ExecutionMode;
    setExecutionMode(value: ExecutionMode): ExecutionContext;
    getSimulationId(): string;
    setSimulationId(value: string): ExecutionContext;
    getCorrelationId(): string;
    setCorrelationId(value: string): ExecutionContext;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): ExecutionContext.AsObject;
    static toObject(includeInstance: boolean, msg: ExecutionContext): ExecutionContext.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: ExecutionContext, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): ExecutionContext;
    static deserializeBinaryFromReader(message: ExecutionContext, reader: jspb.BinaryReader): ExecutionContext;
}

export namespace ExecutionContext {
    export type AsObject = {
        authorizationContextHash: string,
        executionMode: ExecutionMode,
        simulationId: string,
        correlationId: string,
    }
}

export class OperationCapabilities extends jspb.Message {
    getAvailability(): boolean;
    setAvailability(value: boolean): OperationCapabilities;
    getScheduling(): boolean;
    setScheduling(value: boolean): OperationCapabilities;
    getMaxElapsed(): boolean;
    setMaxElapsed(value: boolean): OperationCapabilities;
    getCancel(): boolean;
    setCancel(value: boolean): OperationCapabilities;
    getPauseResume(): boolean;
    setPauseResume(value: boolean): OperationCapabilities;
    getInputRequired(): boolean;
    setInputRequired(value: boolean): OperationCapabilities;
    getIdempotency(): boolean;
    setIdempotency(value: boolean): OperationCapabilities;
    getObservations(): boolean;
    setObservations(value: boolean): OperationCapabilities;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): OperationCapabilities.AsObject;
    static toObject(includeInstance: boolean, msg: OperationCapabilities): OperationCapabilities.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: OperationCapabilities, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): OperationCapabilities;
    static deserializeBinaryFromReader(message: OperationCapabilities, reader: jspb.BinaryReader): OperationCapabilities;
}

export namespace OperationCapabilities {
    export type AsObject = {
        availability: boolean,
        scheduling: boolean,
        maxElapsed: boolean,
        cancel: boolean,
        pauseResume: boolean,
        inputRequired: boolean,
        idempotency: boolean,
        observations: boolean,
    }
}

export class ResourceBinding extends jspb.Message {
    getMode(): ResourceBinding.Mode;
    setMode(value: ResourceBinding.Mode): ResourceBinding;
    getResourceIdJsonPointer(): string;
    setResourceIdJsonPointer(value: string): ResourceBinding;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): ResourceBinding.AsObject;
    static toObject(includeInstance: boolean, msg: ResourceBinding): ResourceBinding.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: ResourceBinding, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): ResourceBinding;
    static deserializeBinaryFromReader(message: ResourceBinding, reader: jspb.BinaryReader): ResourceBinding;
}

export namespace ResourceBinding {
    export type AsObject = {
        mode: ResourceBinding.Mode,
        resourceIdJsonPointer: string,
    }

    export enum Mode {
    MODE_UNSPECIFIED = 0,
    NONE = 1,
    ARGUMENT_REFERENCE = 2,
    }

}

export class OperationDefinition extends jspb.Message {
    getName(): string;
    setName(value: string): OperationDefinition;
    getDescription(): string;
    setDescription(value: string): OperationDefinition;
    getExecution(): OperationExecution;
    setExecution(value: OperationExecution): OperationDefinition;

    hasInputSchema(): boolean;
    clearInputSchema(): void;
    getInputSchema(): google_protobuf_struct_pb.Struct | undefined;
    setInputSchema(value?: google_protobuf_struct_pb.Struct): OperationDefinition;

    hasOutputSchema(): boolean;
    clearOutputSchema(): void;
    getOutputSchema(): google_protobuf_struct_pb.Struct | undefined;
    setOutputSchema(value?: google_protobuf_struct_pb.Struct): OperationDefinition;

    hasCapabilities(): boolean;
    clearCapabilities(): void;
    getCapabilities(): OperationCapabilities | undefined;
    setCapabilities(value?: OperationCapabilities): OperationDefinition;

    hasResourceBinding(): boolean;
    clearResourceBinding(): void;
    getResourceBinding(): ResourceBinding | undefined;
    setResourceBinding(value?: ResourceBinding): OperationDefinition;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): OperationDefinition.AsObject;
    static toObject(includeInstance: boolean, msg: OperationDefinition): OperationDefinition.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: OperationDefinition, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): OperationDefinition;
    static deserializeBinaryFromReader(message: OperationDefinition, reader: jspb.BinaryReader): OperationDefinition;
}

export namespace OperationDefinition {
    export type AsObject = {
        name: string,
        description: string,
        execution: OperationExecution,
        inputSchema?: google_protobuf_struct_pb.Struct.AsObject,
        outputSchema?: google_protobuf_struct_pb.Struct.AsObject,
        capabilities?: OperationCapabilities.AsObject,
        resourceBinding?: ResourceBinding.AsObject,
    }
}

export class DescribeProviderRequest extends jspb.Message {

    hasMetadata(): boolean;
    clearMetadata(): void;
    getMetadata(): RequestMetadata | undefined;
    setMetadata(value?: RequestMetadata): DescribeProviderRequest;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): DescribeProviderRequest.AsObject;
    static toObject(includeInstance: boolean, msg: DescribeProviderRequest): DescribeProviderRequest.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: DescribeProviderRequest, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): DescribeProviderRequest;
    static deserializeBinaryFromReader(message: DescribeProviderRequest, reader: jspb.BinaryReader): DescribeProviderRequest;
}

export namespace DescribeProviderRequest {
    export type AsObject = {
        metadata?: RequestMetadata.AsObject,
    }
}

export class ProviderManifest extends jspb.Message {
    getAdapterProtocolVersion(): string;
    setAdapterProtocolVersion(value: string): ProviderManifest;
    getProviderId(): string;
    setProviderId(value: string): ProviderManifest;
    getProviderType(): string;
    setProviderType(value: string): ProviderManifest;
    getProviderVersion(): string;
    setProviderVersion(value: string): ProviderManifest;
    getInventoryMode(): InventoryMode;
    setInventoryMode(value: InventoryMode): ProviderManifest;
    clearOperationsList(): void;
    getOperationsList(): Array<OperationDefinition>;
    setOperationsList(value: Array<OperationDefinition>): ProviderManifest;
    addOperations(value?: OperationDefinition, index?: number): OperationDefinition;
    clearBusinessEventSourcesList(): void;
    getBusinessEventSourcesList(): Array<BusinessEventSourceCapability>;
    setBusinessEventSourcesList(value: Array<BusinessEventSourceCapability>): ProviderManifest;
    addBusinessEventSources(value?: BusinessEventSourceCapability, index?: number): BusinessEventSourceCapability;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): ProviderManifest.AsObject;
    static toObject(includeInstance: boolean, msg: ProviderManifest): ProviderManifest.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: ProviderManifest, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): ProviderManifest;
    static deserializeBinaryFromReader(message: ProviderManifest, reader: jspb.BinaryReader): ProviderManifest;
}

export namespace ProviderManifest {
    export type AsObject = {
        adapterProtocolVersion: string,
        providerId: string,
        providerType: string,
        providerVersion: string,
        inventoryMode: InventoryMode,
        operationsList: Array<OperationDefinition.AsObject>,
        businessEventSourcesList: Array<BusinessEventSourceCapability.AsObject>,
    }
}

export class BusinessEventSourceCapability extends jspb.Message {
    getSourceId(): string;
    setSourceId(value: string): BusinessEventSourceCapability;
    getSourceStreamId(): string;
    setSourceStreamId(value: string): BusinessEventSourceCapability;
    getDeliverySemantics(): string;
    setDeliverySemantics(value: string): BusinessEventSourceCapability;
    getReplaySupported(): boolean;
    setReplaySupported(value: boolean): BusinessEventSourceCapability;
    getSourceRetentionMs(): number;
    setSourceRetentionMs(value: number): BusinessEventSourceCapability;
    getMaxEventBytes(): number;
    setMaxEventBytes(value: number): BusinessEventSourceCapability;
    getMaxPayloadDepth(): number;
    setMaxPayloadDepth(value: number): BusinessEventSourceCapability;
    getMaxPayloadNodes(): number;
    setMaxPayloadNodes(value: number): BusinessEventSourceCapability;
    getMaxPayloadStringBytes(): number;
    setMaxPayloadStringBytes(value: number): BusinessEventSourceCapability;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): BusinessEventSourceCapability.AsObject;
    static toObject(includeInstance: boolean, msg: BusinessEventSourceCapability): BusinessEventSourceCapability.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: BusinessEventSourceCapability, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): BusinessEventSourceCapability;
    static deserializeBinaryFromReader(message: BusinessEventSourceCapability, reader: jspb.BinaryReader): BusinessEventSourceCapability;
}

export namespace BusinessEventSourceCapability {
    export type AsObject = {
        sourceId: string,
        sourceStreamId: string,
        deliverySemantics: string,
        replaySupported: boolean,
        sourceRetentionMs: number,
        maxEventBytes: number,
        maxPayloadDepth: number,
        maxPayloadNodes: number,
        maxPayloadStringBytes: number,
    }
}

export class StreamBusinessEventsRequest extends jspb.Message {

    hasMetadata(): boolean;
    clearMetadata(): void;
    getMetadata(): RequestMetadata | undefined;
    setMetadata(value?: RequestMetadata): StreamBusinessEventsRequest;
    getSourceId(): string;
    setSourceId(value: string): StreamBusinessEventsRequest;
    getSourceStreamId(): string;
    setSourceStreamId(value: string): StreamBusinessEventsRequest;

    hasAfterSourceSequence(): boolean;
    clearAfterSourceSequence(): void;
    getAfterSourceSequence(): number | undefined;
    setAfterSourceSequence(value: number): StreamBusinessEventsRequest;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): StreamBusinessEventsRequest.AsObject;
    static toObject(includeInstance: boolean, msg: StreamBusinessEventsRequest): StreamBusinessEventsRequest.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: StreamBusinessEventsRequest, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): StreamBusinessEventsRequest;
    static deserializeBinaryFromReader(message: StreamBusinessEventsRequest, reader: jspb.BinaryReader): StreamBusinessEventsRequest;
}

export namespace StreamBusinessEventsRequest {
    export type AsObject = {
        metadata?: RequestMetadata.AsObject,
        sourceId: string,
        sourceStreamId: string,
        afterSourceSequence?: number,
    }
}

export class AdapterBusinessEvent extends jspb.Message {
    getSourceEventId(): string;
    setSourceEventId(value: string): AdapterBusinessEvent;
    getSourceSequence(): number;
    setSourceSequence(value: number): AdapterBusinessEvent;
    getSourceStreamId(): string;
    setSourceStreamId(value: string): AdapterBusinessEvent;
    getScope(): string;
    setScope(value: string): AdapterBusinessEvent;

    hasOccurredAt(): boolean;
    clearOccurredAt(): void;
    getOccurredAt(): google_protobuf_timestamp_pb.Timestamp | undefined;
    setOccurredAt(value?: google_protobuf_timestamp_pb.Timestamp): AdapterBusinessEvent;
    getEventType(): string;
    setEventType(value: string): AdapterBusinessEvent;
    getDescription(): string;
    setDescription(value: string): AdapterBusinessEvent;

    hasExternalExecutionId(): boolean;
    clearExternalExecutionId(): void;
    getExternalExecutionId(): string | undefined;
    setExternalExecutionId(value: string): AdapterBusinessEvent;

    hasResourceRef(): boolean;
    clearResourceRef(): void;
    getResourceRef(): string | undefined;
    setResourceRef(value: string): AdapterBusinessEvent;
    getSeverityHint(): string;
    setSeverityHint(value: string): AdapterBusinessEvent;
    getReasonCode(): string;
    setReasonCode(value: string): AdapterBusinessEvent;

    hasRawPayload(): boolean;
    clearRawPayload(): void;
    getRawPayload(): google_protobuf_struct_pb.Struct | undefined;
    setRawPayload(value?: google_protobuf_struct_pb.Struct): AdapterBusinessEvent;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): AdapterBusinessEvent.AsObject;
    static toObject(includeInstance: boolean, msg: AdapterBusinessEvent): AdapterBusinessEvent.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: AdapterBusinessEvent, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): AdapterBusinessEvent;
    static deserializeBinaryFromReader(message: AdapterBusinessEvent, reader: jspb.BinaryReader): AdapterBusinessEvent;
}

export namespace AdapterBusinessEvent {
    export type AsObject = {
        sourceEventId: string,
        sourceSequence: number,
        sourceStreamId: string,
        scope: string,
        occurredAt?: google_protobuf_timestamp_pb.Timestamp.AsObject,
        eventType: string,
        description: string,
        externalExecutionId?: string,
        resourceRef?: string,
        severityHint: string,
        reasonCode: string,
        rawPayload?: google_protobuf_struct_pb.Struct.AsObject,
    }
}

export class TaskStart extends jspb.Message {
    getMode(): TaskStart.Mode;
    setMode(value: TaskStart.Mode): TaskStart;

    hasScheduledAt(): boolean;
    clearScheduledAt(): void;
    getScheduledAt(): google_protobuf_timestamp_pb.Timestamp | undefined;
    setScheduledAt(value?: google_protobuf_timestamp_pb.Timestamp): TaskStart;
    getStartToleranceMs(): number;
    setStartToleranceMs(value: number): TaskStart;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): TaskStart.AsObject;
    static toObject(includeInstance: boolean, msg: TaskStart): TaskStart.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: TaskStart, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): TaskStart;
    static deserializeBinaryFromReader(message: TaskStart, reader: jspb.BinaryReader): TaskStart;
}

export namespace TaskStart {
    export type AsObject = {
        mode: TaskStart.Mode,
        scheduledAt?: google_protobuf_timestamp_pb.Timestamp.AsObject,
        startToleranceMs: number,
    }

    export enum Mode {
    MODE_UNSPECIFIED = 0,
    IMMEDIATE = 1,
    SCHEDULED = 2,
    }

}

export class TaskTiming extends jspb.Message {

    hasStart(): boolean;
    clearStart(): void;
    getStart(): TaskStart | undefined;
    setStart(value?: TaskStart): TaskTiming;

    hasMaxElapsedMs(): boolean;
    clearMaxElapsedMs(): void;
    getMaxElapsedMs(): number | undefined;
    setMaxElapsedMs(value: number): TaskTiming;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): TaskTiming.AsObject;
    static toObject(includeInstance: boolean, msg: TaskTiming): TaskTiming.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: TaskTiming, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): TaskTiming;
    static deserializeBinaryFromReader(message: TaskTiming, reader: jspb.BinaryReader): TaskTiming;
}

export namespace TaskTiming {
    export type AsObject = {
        start?: TaskStart.AsObject,
        maxElapsedMs?: number,
    }
}

export class UnresolvedArguments extends jspb.Message {

    hasKnownArguments(): boolean;
    clearKnownArguments(): void;
    getKnownArguments(): google_protobuf_struct_pb.Struct | undefined;
    setKnownArguments(value?: google_protobuf_struct_pb.Struct): UnresolvedArguments;
    clearUnresolvedPathsList(): void;
    getUnresolvedPathsList(): Array<string>;
    setUnresolvedPathsList(value: Array<string>): UnresolvedArguments;
    addUnresolvedPaths(value: string, index?: number): string;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): UnresolvedArguments.AsObject;
    static toObject(includeInstance: boolean, msg: UnresolvedArguments): UnresolvedArguments.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: UnresolvedArguments, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): UnresolvedArguments;
    static deserializeBinaryFromReader(message: UnresolvedArguments, reader: jspb.BinaryReader): UnresolvedArguments;
}

export namespace UnresolvedArguments {
    export type AsObject = {
        knownArguments?: google_protobuf_struct_pb.Struct.AsObject,
        unresolvedPathsList: Array<string>,
    }
}

export class AvailabilityCheck extends jspb.Message {
    getRequestId(): string;
    setRequestId(value: string): AvailabilityCheck;
    getOperationName(): string;
    setOperationName(value: string): AvailabilityCheck;

    hasArguments(): boolean;
    clearArguments(): void;
    getArguments(): google_protobuf_struct_pb.Struct | undefined;
    setArguments(value?: google_protobuf_struct_pb.Struct): AvailabilityCheck;

    hasUnresolvedArguments(): boolean;
    clearUnresolvedArguments(): void;
    getUnresolvedArguments(): UnresolvedArguments | undefined;
    setUnresolvedArguments(value?: UnresolvedArguments): AvailabilityCheck;

    hasTiming(): boolean;
    clearTiming(): void;
    getTiming(): TaskTiming | undefined;
    setTiming(value?: TaskTiming): AvailabilityCheck;

    getArgumentsValueCase(): AvailabilityCheck.ArgumentsValueCase;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): AvailabilityCheck.AsObject;
    static toObject(includeInstance: boolean, msg: AvailabilityCheck): AvailabilityCheck.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: AvailabilityCheck, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): AvailabilityCheck;
    static deserializeBinaryFromReader(message: AvailabilityCheck, reader: jspb.BinaryReader): AvailabilityCheck;
}

export namespace AvailabilityCheck {
    export type AsObject = {
        requestId: string,
        operationName: string,
        arguments?: google_protobuf_struct_pb.Struct.AsObject,
        unresolvedArguments?: UnresolvedArguments.AsObject,
        timing?: TaskTiming.AsObject,
    }

    export enum ArgumentsValueCase {
        ARGUMENTS_VALUE_NOT_SET = 0,
        ARGUMENTS = 3,
        UNRESOLVED_ARGUMENTS = 4,
    }

}

export class CheckAvailabilityRequest extends jspb.Message {

    hasMetadata(): boolean;
    clearMetadata(): void;
    getMetadata(): RequestMetadata | undefined;
    setMetadata(value?: RequestMetadata): CheckAvailabilityRequest;

    hasExecutionContext(): boolean;
    clearExecutionContext(): void;
    getExecutionContext(): ExecutionContext | undefined;
    setExecutionContext(value?: ExecutionContext): CheckAvailabilityRequest;
    clearChecksList(): void;
    getChecksList(): Array<AvailabilityCheck>;
    setChecksList(value: Array<AvailabilityCheck>): CheckAvailabilityRequest;
    addChecks(value?: AvailabilityCheck, index?: number): AvailabilityCheck;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): CheckAvailabilityRequest.AsObject;
    static toObject(includeInstance: boolean, msg: CheckAvailabilityRequest): CheckAvailabilityRequest.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: CheckAvailabilityRequest, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): CheckAvailabilityRequest;
    static deserializeBinaryFromReader(message: CheckAvailabilityRequest, reader: jspb.BinaryReader): CheckAvailabilityRequest;
}

export namespace CheckAvailabilityRequest {
    export type AsObject = {
        metadata?: RequestMetadata.AsObject,
        executionContext?: ExecutionContext.AsObject,
        checksList: Array<AvailabilityCheck.AsObject>,
    }
}

export class AvailableWindow extends jspb.Message {

    hasStartTime(): boolean;
    clearStartTime(): void;
    getStartTime(): google_protobuf_timestamp_pb.Timestamp | undefined;
    setStartTime(value?: google_protobuf_timestamp_pb.Timestamp): AvailableWindow;

    hasEndTime(): boolean;
    clearEndTime(): void;
    getEndTime(): google_protobuf_timestamp_pb.Timestamp | undefined;
    setEndTime(value?: google_protobuf_timestamp_pb.Timestamp): AvailableWindow;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): AvailableWindow.AsObject;
    static toObject(includeInstance: boolean, msg: AvailableWindow): AvailableWindow.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: AvailableWindow, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): AvailableWindow;
    static deserializeBinaryFromReader(message: AvailableWindow, reader: jspb.BinaryReader): AvailableWindow;
}

export namespace AvailableWindow {
    export type AsObject = {
        startTime?: google_protobuf_timestamp_pb.Timestamp.AsObject,
        endTime?: google_protobuf_timestamp_pb.Timestamp.AsObject,
    }
}

export class AvailabilityResult extends jspb.Message {
    getRequestId(): string;
    setRequestId(value: string): AvailabilityResult;
    getOperationName(): string;
    setOperationName(value: string): AvailabilityResult;
    getAvailability(): AvailabilityState;
    setAvailability(value: AvailabilityState): AvailabilityResult;
    getRiskLevel(): RiskLevel;
    setRiskLevel(value: RiskLevel): AvailabilityResult;
    getReasonCode(): string;
    setReasonCode(value: string): AvailabilityResult;
    getDescription(): string;
    setDescription(value: string): AvailabilityResult;

    hasValidUntil(): boolean;
    clearValidUntil(): void;
    getValidUntil(): google_protobuf_timestamp_pb.Timestamp | undefined;
    setValidUntil(value?: google_protobuf_timestamp_pb.Timestamp): AvailabilityResult;

    hasEarliestStartTime(): boolean;
    clearEarliestStartTime(): void;
    getEarliestStartTime(): google_protobuf_timestamp_pb.Timestamp | undefined;
    setEarliestStartTime(value?: google_protobuf_timestamp_pb.Timestamp): AvailabilityResult;
    clearNextAvailableWindowsList(): void;
    getNextAvailableWindowsList(): Array<AvailableWindow>;
    setNextAvailableWindowsList(value: Array<AvailableWindow>): AvailabilityResult;
    addNextAvailableWindows(value?: AvailableWindow, index?: number): AvailableWindow;
    getEstimatedDelayMs(): number;
    setEstimatedDelayMs(value: number): AvailabilityResult;
    clearPossibleEffectsList(): void;
    getPossibleEffectsList(): Array<string>;
    setPossibleEffectsList(value: Array<string>): AvailabilityResult;
    addPossibleEffects(value: string, index?: number): string;
    getReservationMode(): ReservationMode;
    setReservationMode(value: ReservationMode): AvailabilityResult;

    hasReservationRef(): boolean;
    clearReservationRef(): void;
    getReservationRef(): string | undefined;
    setReservationRef(value: string): AvailabilityResult;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): AvailabilityResult.AsObject;
    static toObject(includeInstance: boolean, msg: AvailabilityResult): AvailabilityResult.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: AvailabilityResult, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): AvailabilityResult;
    static deserializeBinaryFromReader(message: AvailabilityResult, reader: jspb.BinaryReader): AvailabilityResult;
}

export namespace AvailabilityResult {
    export type AsObject = {
        requestId: string,
        operationName: string,
        availability: AvailabilityState,
        riskLevel: RiskLevel,
        reasonCode: string,
        description: string,
        validUntil?: google_protobuf_timestamp_pb.Timestamp.AsObject,
        earliestStartTime?: google_protobuf_timestamp_pb.Timestamp.AsObject,
        nextAvailableWindowsList: Array<AvailableWindow.AsObject>,
        estimatedDelayMs: number,
        possibleEffectsList: Array<string>,
        reservationMode: ReservationMode,
        reservationRef?: string,
    }
}

export class CheckAvailabilityResponse extends jspb.Message {
    getProfileVersion(): string;
    setProfileVersion(value: string): CheckAvailabilityResponse;

    hasCheckedAt(): boolean;
    clearCheckedAt(): void;
    getCheckedAt(): google_protobuf_timestamp_pb.Timestamp | undefined;
    setCheckedAt(value?: google_protobuf_timestamp_pb.Timestamp): CheckAvailabilityResponse;
    clearChecksList(): void;
    getChecksList(): Array<AvailabilityResult>;
    setChecksList(value: Array<AvailabilityResult>): CheckAvailabilityResponse;
    addChecks(value?: AvailabilityResult, index?: number): AvailabilityResult;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): CheckAvailabilityResponse.AsObject;
    static toObject(includeInstance: boolean, msg: CheckAvailabilityResponse): CheckAvailabilityResponse.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: CheckAvailabilityResponse, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): CheckAvailabilityResponse;
    static deserializeBinaryFromReader(message: CheckAvailabilityResponse, reader: jspb.BinaryReader): CheckAvailabilityResponse;
}

export namespace CheckAvailabilityResponse {
    export type AsObject = {
        profileVersion: string,
        checkedAt?: google_protobuf_timestamp_pb.Timestamp.AsObject,
        checksList: Array<AvailabilityResult.AsObject>,
    }
}

export class StartOperationRequest extends jspb.Message {

    hasMetadata(): boolean;
    clearMetadata(): void;
    getMetadata(): RequestMetadata | undefined;
    setMetadata(value?: RequestMetadata): StartOperationRequest;
    getTaskId(): string;
    setTaskId(value: string): StartOperationRequest;
    getOperationName(): string;
    setOperationName(value: string): StartOperationRequest;

    hasArguments(): boolean;
    clearArguments(): void;
    getArguments(): google_protobuf_struct_pb.Struct | undefined;
    setArguments(value?: google_protobuf_struct_pb.Struct): StartOperationRequest;

    hasTiming(): boolean;
    clearTiming(): void;
    getTiming(): TaskTiming | undefined;
    setTiming(value?: TaskTiming): StartOperationRequest;

    hasExecutionContext(): boolean;
    clearExecutionContext(): void;
    getExecutionContext(): ExecutionContext | undefined;
    setExecutionContext(value?: ExecutionContext): StartOperationRequest;
    getArgumentHash(): string;
    setArgumentHash(value: string): StartOperationRequest;
    getInvocationAttempt(): number;
    setInvocationAttempt(value: number): StartOperationRequest;

    hasReservationRef(): boolean;
    clearReservationRef(): void;
    getReservationRef(): string | undefined;
    setReservationRef(value: string): StartOperationRequest;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): StartOperationRequest.AsObject;
    static toObject(includeInstance: boolean, msg: StartOperationRequest): StartOperationRequest.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: StartOperationRequest, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): StartOperationRequest;
    static deserializeBinaryFromReader(message: StartOperationRequest, reader: jspb.BinaryReader): StartOperationRequest;
}

export namespace StartOperationRequest {
    export type AsObject = {
        metadata?: RequestMetadata.AsObject,
        taskId: string,
        operationName: string,
        arguments?: google_protobuf_struct_pb.Struct.AsObject,
        timing?: TaskTiming.AsObject,
        executionContext?: ExecutionContext.AsObject,
        argumentHash: string,
        invocationAttempt: number,
        reservationRef?: string,
    }
}

export class Alternative extends jspb.Message {

    hasSuggestedStartTime(): boolean;
    clearSuggestedStartTime(): void;
    getSuggestedStartTime(): google_protobuf_timestamp_pb.Timestamp | undefined;
    setSuggestedStartTime(value?: google_protobuf_timestamp_pb.Timestamp): Alternative;
    getOperationName(): string;
    setOperationName(value: string): Alternative;

    hasArguments(): boolean;
    clearArguments(): void;
    getArguments(): google_protobuf_struct_pb.Struct | undefined;
    setArguments(value?: google_protobuf_struct_pb.Struct): Alternative;
    getDescription(): string;
    setDescription(value: string): Alternative;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): Alternative.AsObject;
    static toObject(includeInstance: boolean, msg: Alternative): Alternative.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: Alternative, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): Alternative;
    static deserializeBinaryFromReader(message: Alternative, reader: jspb.BinaryReader): Alternative;
}

export namespace Alternative {
    export type AsObject = {
        suggestedStartTime?: google_protobuf_timestamp_pb.Timestamp.AsObject,
        operationName: string,
        arguments?: google_protobuf_struct_pb.Struct.AsObject,
        description: string,
    }
}

export class AdmissionRejected extends jspb.Message {
    getReasonCode(): string;
    setReasonCode(value: string): AdmissionRejected;
    getMessage(): string;
    setMessage(value: string): AdmissionRejected;
    getRetryable(): boolean;
    setRetryable(value: boolean): AdmissionRejected;
    clearAlternativesList(): void;
    getAlternativesList(): Array<Alternative>;
    setAlternativesList(value: Array<Alternative>): AdmissionRejected;
    addAlternatives(value?: Alternative, index?: number): Alternative;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): AdmissionRejected.AsObject;
    static toObject(includeInstance: boolean, msg: AdmissionRejected): AdmissionRejected.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: AdmissionRejected, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): AdmissionRejected;
    static deserializeBinaryFromReader(message: AdmissionRejected, reader: jspb.BinaryReader): AdmissionRejected;
}

export namespace AdmissionRejected {
    export type AsObject = {
        reasonCode: string,
        message: string,
        retryable: boolean,
        alternativesList: Array<Alternative.AsObject>,
    }
}

export class Progress extends jspb.Message {

    hasCurrent(): boolean;
    clearCurrent(): void;
    getCurrent(): number | undefined;
    setCurrent(value: number): Progress;

    hasTotal(): boolean;
    clearTotal(): void;
    getTotal(): number | undefined;
    setTotal(value: number): Progress;
    getUnit(): string;
    setUnit(value: string): Progress;

    hasPercentage(): boolean;
    clearPercentage(): void;
    getPercentage(): number | undefined;
    setPercentage(value: number): Progress;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): Progress.AsObject;
    static toObject(includeInstance: boolean, msg: Progress): Progress.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: Progress, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): Progress;
    static deserializeBinaryFromReader(message: Progress, reader: jspb.BinaryReader): Progress;
}

export namespace Progress {
    export type AsObject = {
        current?: number,
        total?: number,
        unit: string,
        percentage?: number,
    }
}

export class InputRequest extends jspb.Message {
    getKey(): string;
    setKey(value: string): InputRequest;
    getDescription(): string;
    setDescription(value: string): InputRequest;

    hasInputSchema(): boolean;
    clearInputSchema(): void;
    getInputSchema(): google_protobuf_struct_pb.Struct | undefined;
    setInputSchema(value?: google_protobuf_struct_pb.Struct): InputRequest;
    getRequired(): boolean;
    setRequired(value: boolean): InputRequest;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): InputRequest.AsObject;
    static toObject(includeInstance: boolean, msg: InputRequest): InputRequest.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: InputRequest, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): InputRequest;
    static deserializeBinaryFromReader(message: InputRequest, reader: jspb.BinaryReader): InputRequest;
}

export namespace InputRequest {
    export type AsObject = {
        key: string,
        description: string,
        inputSchema?: google_protobuf_struct_pb.Struct.AsObject,
        required: boolean,
    }
}

export class McpTaskInputRequest extends jspb.Message {
    getKey(): string;
    setKey(value: string): McpTaskInputRequest;
    getMethod(): string;
    setMethod(value: string): McpTaskInputRequest;

    hasParams(): boolean;
    clearParams(): void;
    getParams(): google_protobuf_struct_pb.Struct | undefined;
    setParams(value?: google_protobuf_struct_pb.Struct): McpTaskInputRequest;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): McpTaskInputRequest.AsObject;
    static toObject(includeInstance: boolean, msg: McpTaskInputRequest): McpTaskInputRequest.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: McpTaskInputRequest, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): McpTaskInputRequest;
    static deserializeBinaryFromReader(message: McpTaskInputRequest, reader: jspb.BinaryReader): McpTaskInputRequest;
}

export namespace McpTaskInputRequest {
    export type AsObject = {
        key: string,
        method: string,
        params?: google_protobuf_struct_pb.Struct.AsObject,
    }
}

export class McpTaskInputResponse extends jspb.Message {
    getKey(): string;
    setKey(value: string): McpTaskInputResponse;

    hasResult(): boolean;
    clearResult(): void;
    getResult(): google_protobuf_struct_pb.Struct | undefined;
    setResult(value?: google_protobuf_struct_pb.Struct): McpTaskInputResponse;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): McpTaskInputResponse.AsObject;
    static toObject(includeInstance: boolean, msg: McpTaskInputResponse): McpTaskInputResponse.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: McpTaskInputResponse, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): McpTaskInputResponse;
    static deserializeBinaryFromReader(message: McpTaskInputResponse, reader: jspb.BinaryReader): McpTaskInputResponse;
}

export namespace McpTaskInputResponse {
    export type AsObject = {
        key: string,
        result?: google_protobuf_struct_pb.Struct.AsObject,
    }
}

export class EvidencePayloadRef extends jspb.Message {
    getKind(): string;
    setKind(value: string): EvidencePayloadRef;

    hasJsonPointer(): boolean;
    clearJsonPointer(): void;
    getJsonPointer(): string | undefined;
    setJsonPointer(value: string): EvidencePayloadRef;

    hasUri(): boolean;
    clearUri(): void;
    getUri(): string | undefined;
    setUri(value: string): EvidencePayloadRef;

    hasMediaType(): boolean;
    clearMediaType(): void;
    getMediaType(): string | undefined;
    setMediaType(value: string): EvidencePayloadRef;

    hasSha256(): boolean;
    clearSha256(): void;
    getSha256(): string | undefined;
    setSha256(value: string): EvidencePayloadRef;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): EvidencePayloadRef.AsObject;
    static toObject(includeInstance: boolean, msg: EvidencePayloadRef): EvidencePayloadRef.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: EvidencePayloadRef, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): EvidencePayloadRef;
    static deserializeBinaryFromReader(message: EvidencePayloadRef, reader: jspb.BinaryReader): EvidencePayloadRef;
}

export namespace EvidencePayloadRef {
    export type AsObject = {
        kind: string,
        jsonPointer?: string,
        uri?: string,
        mediaType?: string,
        sha256?: string,
    }
}

export class EvidenceItem extends jspb.Message {
    getEvidenceId(): string;
    setEvidenceId(value: string): EvidenceItem;
    getEvidenceType(): string;
    setEvidenceType(value: string): EvidenceItem;
    getObservedAt(): string;
    setObservedAt(value: string): EvidenceItem;

    hasSubjectRef(): boolean;
    clearSubjectRef(): void;
    getSubjectRef(): string | undefined;
    setSubjectRef(value: string): EvidenceItem;

    hasPayloadRef(): boolean;
    clearPayloadRef(): void;
    getPayloadRef(): EvidencePayloadRef | undefined;
    setPayloadRef(value?: EvidencePayloadRef): EvidenceItem;
    clearProducerList(): void;
    getProducerList(): Array<string>;
    setProducerList(value: Array<string>): EvidenceItem;
    addProducer(value: string, index?: number): string;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): EvidenceItem.AsObject;
    static toObject(includeInstance: boolean, msg: EvidenceItem): EvidenceItem.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: EvidenceItem, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): EvidenceItem;
    static deserializeBinaryFromReader(message: EvidenceItem, reader: jspb.BinaryReader): EvidenceItem;
}

export namespace EvidenceItem {
    export type AsObject = {
        evidenceId: string,
        evidenceType: string,
        observedAt: string,
        subjectRef?: string,
        payloadRef?: EvidencePayloadRef.AsObject,
        producerList: Array<string>,
    }
}

export class ExecutionSnapshot extends jspb.Message {
    getTaskId(): string;
    setTaskId(value: string): ExecutionSnapshot;
    getExternalExecutionId(): string;
    setExternalExecutionId(value: string): ExecutionSnapshot;
    getState(): AdapterExecutionState;
    setState(value: AdapterExecutionState): ExecutionSnapshot;
    getRevision(): number;
    setRevision(value: number): ExecutionSnapshot;
    getReasonCode(): string;
    setReasonCode(value: string): ExecutionSnapshot;
    getMessage(): string;
    setMessage(value: string): ExecutionSnapshot;

    hasProgress(): boolean;
    clearProgress(): void;
    getProgress(): Progress | undefined;
    setProgress(value?: Progress): ExecutionSnapshot;
    clearInputRequestsList(): void;
    getInputRequestsList(): Array<InputRequest>;
    setInputRequestsList(value: Array<InputRequest>): ExecutionSnapshot;
    addInputRequests(value?: InputRequest, index?: number): InputRequest;

    hasResult(): boolean;
    clearResult(): void;
    getResult(): google_protobuf_struct_pb.Struct | undefined;
    setResult(value?: google_protobuf_struct_pb.Struct): ExecutionSnapshot;
    getRetryable(): boolean;
    setRetryable(value: boolean): ExecutionSnapshot;
    clearAlternativesList(): void;
    getAlternativesList(): Array<Alternative>;
    setAlternativesList(value: Array<Alternative>): ExecutionSnapshot;
    addAlternatives(value?: Alternative, index?: number): Alternative;

    hasObservedAt(): boolean;
    clearObservedAt(): void;
    getObservedAt(): google_protobuf_timestamp_pb.Timestamp | undefined;
    setObservedAt(value?: google_protobuf_timestamp_pb.Timestamp): ExecutionSnapshot;
    getOperationName(): string;
    setOperationName(value: string): ExecutionSnapshot;
    getArgumentHash(): string;
    setArgumentHash(value: string): ExecutionSnapshot;

    hasExecutionContext(): boolean;
    clearExecutionContext(): void;
    getExecutionContext(): ExecutionContext | undefined;
    setExecutionContext(value?: ExecutionContext): ExecutionSnapshot;
    clearEvidenceList(): void;
    getEvidenceList(): Array<EvidenceItem>;
    setEvidenceList(value: Array<EvidenceItem>): ExecutionSnapshot;
    addEvidence(value?: EvidenceItem, index?: number): EvidenceItem;
    clearMcpInputRequestsList(): void;
    getMcpInputRequestsList(): Array<McpTaskInputRequest>;
    setMcpInputRequestsList(value: Array<McpTaskInputRequest>): ExecutionSnapshot;
    addMcpInputRequests(value?: McpTaskInputRequest, index?: number): McpTaskInputRequest;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): ExecutionSnapshot.AsObject;
    static toObject(includeInstance: boolean, msg: ExecutionSnapshot): ExecutionSnapshot.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: ExecutionSnapshot, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): ExecutionSnapshot;
    static deserializeBinaryFromReader(message: ExecutionSnapshot, reader: jspb.BinaryReader): ExecutionSnapshot;
}

export namespace ExecutionSnapshot {
    export type AsObject = {
        taskId: string,
        externalExecutionId: string,
        state: AdapterExecutionState,
        revision: number,
        reasonCode: string,
        message: string,
        progress?: Progress.AsObject,
        inputRequestsList: Array<InputRequest.AsObject>,
        result?: google_protobuf_struct_pb.Struct.AsObject,
        retryable: boolean,
        alternativesList: Array<Alternative.AsObject>,
        observedAt?: google_protobuf_timestamp_pb.Timestamp.AsObject,
        operationName: string,
        argumentHash: string,
        executionContext?: ExecutionContext.AsObject,
        evidenceList: Array<EvidenceItem.AsObject>,
        mcpInputRequestsList: Array<McpTaskInputRequest.AsObject>,
    }
}

export class ExecutionAccepted extends jspb.Message {
    getExternalExecutionId(): string;
    setExternalExecutionId(value: string): ExecutionAccepted;

    hasInitialSnapshot(): boolean;
    clearInitialSnapshot(): void;
    getInitialSnapshot(): ExecutionSnapshot | undefined;
    setInitialSnapshot(value?: ExecutionSnapshot): ExecutionAccepted;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): ExecutionAccepted.AsObject;
    static toObject(includeInstance: boolean, msg: ExecutionAccepted): ExecutionAccepted.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: ExecutionAccepted, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): ExecutionAccepted;
    static deserializeBinaryFromReader(message: ExecutionAccepted, reader: jspb.BinaryReader): ExecutionAccepted;
}

export namespace ExecutionAccepted {
    export type AsObject = {
        externalExecutionId: string,
        initialSnapshot?: ExecutionSnapshot.AsObject,
    }
}

export class StartOperationResponse extends jspb.Message {

    hasAccepted(): boolean;
    clearAccepted(): void;
    getAccepted(): ExecutionAccepted | undefined;
    setAccepted(value?: ExecutionAccepted): StartOperationResponse;

    hasRejected(): boolean;
    clearRejected(): void;
    getRejected(): AdmissionRejected | undefined;
    setRejected(value?: AdmissionRejected): StartOperationResponse;

    getResultCase(): StartOperationResponse.ResultCase;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): StartOperationResponse.AsObject;
    static toObject(includeInstance: boolean, msg: StartOperationResponse): StartOperationResponse.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: StartOperationResponse, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): StartOperationResponse;
    static deserializeBinaryFromReader(message: StartOperationResponse, reader: jspb.BinaryReader): StartOperationResponse;
}

export namespace StartOperationResponse {
    export type AsObject = {
        accepted?: ExecutionAccepted.AsObject,
        rejected?: AdmissionRejected.AsObject,
    }

    export enum ResultCase {
        RESULT_NOT_SET = 0,
        ACCEPTED = 1,
        REJECTED = 2,
    }

}

export class GetExecutionRequest extends jspb.Message {

    hasMetadata(): boolean;
    clearMetadata(): void;
    getMetadata(): RequestMetadata | undefined;
    setMetadata(value?: RequestMetadata): GetExecutionRequest;
    getTaskId(): string;
    setTaskId(value: string): GetExecutionRequest;
    getExternalExecutionId(): string;
    setExternalExecutionId(value: string): GetExecutionRequest;

    hasExecutionContext(): boolean;
    clearExecutionContext(): void;
    getExecutionContext(): ExecutionContext | undefined;
    setExecutionContext(value?: ExecutionContext): GetExecutionRequest;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): GetExecutionRequest.AsObject;
    static toObject(includeInstance: boolean, msg: GetExecutionRequest): GetExecutionRequest.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: GetExecutionRequest, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): GetExecutionRequest;
    static deserializeBinaryFromReader(message: GetExecutionRequest, reader: jspb.BinaryReader): GetExecutionRequest;
}

export namespace GetExecutionRequest {
    export type AsObject = {
        metadata?: RequestMetadata.AsObject,
        taskId: string,
        externalExecutionId: string,
        executionContext?: ExecutionContext.AsObject,
    }
}

export class SideEffectIdentity extends jspb.Message {
    getTaskId(): string;
    setTaskId(value: string): SideEffectIdentity;
    getOperationName(): string;
    setOperationName(value: string): SideEffectIdentity;
    getArgumentHash(): string;
    setArgumentHash(value: string): SideEffectIdentity;

    hasExecutionContext(): boolean;
    clearExecutionContext(): void;
    getExecutionContext(): ExecutionContext | undefined;
    setExecutionContext(value?: ExecutionContext): SideEffectIdentity;
    getCommandSequence(): number;
    setCommandSequence(value: number): SideEffectIdentity;
    getExternalExecutionId(): string;
    setExternalExecutionId(value: string): SideEffectIdentity;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): SideEffectIdentity.AsObject;
    static toObject(includeInstance: boolean, msg: SideEffectIdentity): SideEffectIdentity.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: SideEffectIdentity, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): SideEffectIdentity;
    static deserializeBinaryFromReader(message: SideEffectIdentity, reader: jspb.BinaryReader): SideEffectIdentity;
}

export namespace SideEffectIdentity {
    export type AsObject = {
        taskId: string,
        operationName: string,
        argumentHash: string,
        executionContext?: ExecutionContext.AsObject,
        commandSequence: number,
        externalExecutionId: string,
    }
}

export class RequestCancelRequest extends jspb.Message {

    hasMetadata(): boolean;
    clearMetadata(): void;
    getMetadata(): RequestMetadata | undefined;
    setMetadata(value?: RequestMetadata): RequestCancelRequest;

    hasIdentity(): boolean;
    clearIdentity(): void;
    getIdentity(): SideEffectIdentity | undefined;
    setIdentity(value?: SideEffectIdentity): RequestCancelRequest;
    getReason(): StopReason;
    setReason(value: StopReason): RequestCancelRequest;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): RequestCancelRequest.AsObject;
    static toObject(includeInstance: boolean, msg: RequestCancelRequest): RequestCancelRequest.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: RequestCancelRequest, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): RequestCancelRequest;
    static deserializeBinaryFromReader(message: RequestCancelRequest, reader: jspb.BinaryReader): RequestCancelRequest;
}

export namespace RequestCancelRequest {
    export type AsObject = {
        metadata?: RequestMetadata.AsObject,
        identity?: SideEffectIdentity.AsObject,
        reason: StopReason,
    }
}

export class UpdateValue extends jspb.Message {
    getInputRequestKey(): string;
    setInputRequestKey(value: string): UpdateValue;

    hasValue(): boolean;
    clearValue(): void;
    getValue(): google_protobuf_struct_pb.Value | undefined;
    setValue(value?: google_protobuf_struct_pb.Value): UpdateValue;
    getAnswerHash(): string;
    setAnswerHash(value: string): UpdateValue;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): UpdateValue.AsObject;
    static toObject(includeInstance: boolean, msg: UpdateValue): UpdateValue.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: UpdateValue, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): UpdateValue;
    static deserializeBinaryFromReader(message: UpdateValue, reader: jspb.BinaryReader): UpdateValue;
}

export namespace UpdateValue {
    export type AsObject = {
        inputRequestKey: string,
        value?: google_protobuf_struct_pb.Value.AsObject,
        answerHash: string,
    }
}

export class UpdateExecutionRequest extends jspb.Message {

    hasMetadata(): boolean;
    clearMetadata(): void;
    getMetadata(): RequestMetadata | undefined;
    setMetadata(value?: RequestMetadata): UpdateExecutionRequest;

    hasIdentity(): boolean;
    clearIdentity(): void;
    getIdentity(): SideEffectIdentity | undefined;
    setIdentity(value?: SideEffectIdentity): UpdateExecutionRequest;
    clearInputsList(): void;
    getInputsList(): Array<UpdateValue>;
    setInputsList(value: Array<UpdateValue>): UpdateExecutionRequest;
    addInputs(value?: UpdateValue, index?: number): UpdateValue;
    clearInputResponsesList(): void;
    getInputResponsesList(): Array<McpTaskInputResponse>;
    setInputResponsesList(value: Array<McpTaskInputResponse>): UpdateExecutionRequest;
    addInputResponses(value?: McpTaskInputResponse, index?: number): McpTaskInputResponse;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): UpdateExecutionRequest.AsObject;
    static toObject(includeInstance: boolean, msg: UpdateExecutionRequest): UpdateExecutionRequest.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: UpdateExecutionRequest, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): UpdateExecutionRequest;
    static deserializeBinaryFromReader(message: UpdateExecutionRequest, reader: jspb.BinaryReader): UpdateExecutionRequest;
}

export namespace UpdateExecutionRequest {
    export type AsObject = {
        metadata?: RequestMetadata.AsObject,
        identity?: SideEffectIdentity.AsObject,
        inputsList: Array<UpdateValue.AsObject>,
        inputResponsesList: Array<McpTaskInputResponse.AsObject>,
    }
}

export class PauseExecutionRequest extends jspb.Message {

    hasMetadata(): boolean;
    clearMetadata(): void;
    getMetadata(): RequestMetadata | undefined;
    setMetadata(value?: RequestMetadata): PauseExecutionRequest;

    hasIdentity(): boolean;
    clearIdentity(): void;
    getIdentity(): SideEffectIdentity | undefined;
    setIdentity(value?: SideEffectIdentity): PauseExecutionRequest;
    getReasonCode(): string;
    setReasonCode(value: string): PauseExecutionRequest;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): PauseExecutionRequest.AsObject;
    static toObject(includeInstance: boolean, msg: PauseExecutionRequest): PauseExecutionRequest.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: PauseExecutionRequest, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): PauseExecutionRequest;
    static deserializeBinaryFromReader(message: PauseExecutionRequest, reader: jspb.BinaryReader): PauseExecutionRequest;
}

export namespace PauseExecutionRequest {
    export type AsObject = {
        metadata?: RequestMetadata.AsObject,
        identity?: SideEffectIdentity.AsObject,
        reasonCode: string,
    }
}

export class ResumeExecutionRequest extends jspb.Message {

    hasMetadata(): boolean;
    clearMetadata(): void;
    getMetadata(): RequestMetadata | undefined;
    setMetadata(value?: RequestMetadata): ResumeExecutionRequest;

    hasIdentity(): boolean;
    clearIdentity(): void;
    getIdentity(): SideEffectIdentity | undefined;
    setIdentity(value?: SideEffectIdentity): ResumeExecutionRequest;
    getReasonCode(): string;
    setReasonCode(value: string): ResumeExecutionRequest;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): ResumeExecutionRequest.AsObject;
    static toObject(includeInstance: boolean, msg: ResumeExecutionRequest): ResumeExecutionRequest.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: ResumeExecutionRequest, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): ResumeExecutionRequest;
    static deserializeBinaryFromReader(message: ResumeExecutionRequest, reader: jspb.BinaryReader): ResumeExecutionRequest;
}

export namespace ResumeExecutionRequest {
    export type AsObject = {
        metadata?: RequestMetadata.AsObject,
        identity?: SideEffectIdentity.AsObject,
        reasonCode: string,
    }
}

export class CommandAck extends jspb.Message {
    getAccepted(): boolean;
    setAccepted(value: boolean): CommandAck;
    getReasonCode(): string;
    setReasonCode(value: string): CommandAck;
    getMessage(): string;
    setMessage(value: string): CommandAck;
    getCommandSequence(): number;
    setCommandSequence(value: number): CommandAck;

    hasIdentity(): boolean;
    clearIdentity(): void;
    getIdentity(): SideEffectIdentity | undefined;
    setIdentity(value?: SideEffectIdentity): CommandAck;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): CommandAck.AsObject;
    static toObject(includeInstance: boolean, msg: CommandAck): CommandAck.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: CommandAck, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): CommandAck;
    static deserializeBinaryFromReader(message: CommandAck, reader: jspb.BinaryReader): CommandAck;
}

export namespace CommandAck {
    export type AsObject = {
        accepted: boolean,
        reasonCode: string,
        message: string,
        commandSequence: number,
        identity?: SideEffectIdentity.AsObject,
    }
}

export class ReconcileExecutionRequest extends jspb.Message {

    hasMetadata(): boolean;
    clearMetadata(): void;
    getMetadata(): RequestMetadata | undefined;
    setMetadata(value?: RequestMetadata): ReconcileExecutionRequest;
    getTaskId(): string;
    setTaskId(value: string): ReconcileExecutionRequest;
    getOperationName(): string;
    setOperationName(value: string): ReconcileExecutionRequest;
    getArgumentHash(): string;
    setArgumentHash(value: string): ReconcileExecutionRequest;

    hasExecutionContext(): boolean;
    clearExecutionContext(): void;
    getExecutionContext(): ExecutionContext | undefined;
    setExecutionContext(value?: ExecutionContext): ReconcileExecutionRequest;
    getExternalExecutionId(): string;
    setExternalExecutionId(value: string): ReconcileExecutionRequest;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): ReconcileExecutionRequest.AsObject;
    static toObject(includeInstance: boolean, msg: ReconcileExecutionRequest): ReconcileExecutionRequest.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: ReconcileExecutionRequest, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): ReconcileExecutionRequest;
    static deserializeBinaryFromReader(message: ReconcileExecutionRequest, reader: jspb.BinaryReader): ReconcileExecutionRequest;
}

export namespace ReconcileExecutionRequest {
    export type AsObject = {
        metadata?: RequestMetadata.AsObject,
        taskId: string,
        operationName: string,
        argumentHash: string,
        executionContext?: ExecutionContext.AsObject,
        externalExecutionId: string,
    }
}

export class ReconcileExecutionResponse extends jspb.Message {
    getStatus(): ReconcileStatus;
    setStatus(value: ReconcileStatus): ReconcileExecutionResponse;

    hasSnapshot(): boolean;
    clearSnapshot(): void;
    getSnapshot(): ExecutionSnapshot | undefined;
    setSnapshot(value?: ExecutionSnapshot): ReconcileExecutionResponse;
    getExternalExecutionId(): string;
    setExternalExecutionId(value: string): ReconcileExecutionResponse;
    getReasonCode(): string;
    setReasonCode(value: string): ReconcileExecutionResponse;
    getMessage(): string;
    setMessage(value: string): ReconcileExecutionResponse;
    getRetryable(): boolean;
    setRetryable(value: boolean): ReconcileExecutionResponse;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): ReconcileExecutionResponse.AsObject;
    static toObject(includeInstance: boolean, msg: ReconcileExecutionResponse): ReconcileExecutionResponse.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: ReconcileExecutionResponse, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): ReconcileExecutionResponse;
    static deserializeBinaryFromReader(message: ReconcileExecutionResponse, reader: jspb.BinaryReader): ReconcileExecutionResponse;
}

export namespace ReconcileExecutionResponse {
    export type AsObject = {
        status: ReconcileStatus,
        snapshot?: ExecutionSnapshot.AsObject,
        externalExecutionId: string,
        reasonCode: string,
        message: string,
        retryable: boolean,
    }
}

export class StreamExecutionEventsRequest extends jspb.Message {

    hasExecution(): boolean;
    clearExecution(): void;
    getExecution(): GetExecutionRequest | undefined;
    setExecution(value?: GetExecutionRequest): StreamExecutionEventsRequest;
    getAfterRevision(): number;
    setAfterRevision(value: number): StreamExecutionEventsRequest;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): StreamExecutionEventsRequest.AsObject;
    static toObject(includeInstance: boolean, msg: StreamExecutionEventsRequest): StreamExecutionEventsRequest.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: StreamExecutionEventsRequest, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): StreamExecutionEventsRequest;
    static deserializeBinaryFromReader(message: StreamExecutionEventsRequest, reader: jspb.BinaryReader): StreamExecutionEventsRequest;
}

export namespace StreamExecutionEventsRequest {
    export type AsObject = {
        execution?: GetExecutionRequest.AsObject,
        afterRevision: number,
    }
}

export class ExecutionEvent extends jspb.Message {
    getTaskId(): string;
    setTaskId(value: string): ExecutionEvent;
    getRevision(): number;
    setRevision(value: number): ExecutionEvent;
    getType(): string;
    setType(value: string): ExecutionEvent;

    hasOccurredAt(): boolean;
    clearOccurredAt(): void;
    getOccurredAt(): google_protobuf_timestamp_pb.Timestamp | undefined;
    setOccurredAt(value?: google_protobuf_timestamp_pb.Timestamp): ExecutionEvent;
    getReasonCode(): string;
    setReasonCode(value: string): ExecutionEvent;

    hasProgress(): boolean;
    clearProgress(): void;
    getProgress(): Progress | undefined;
    setProgress(value?: Progress): ExecutionEvent;

    hasSnapshot(): boolean;
    clearSnapshot(): void;
    getSnapshot(): ExecutionSnapshot | undefined;
    setSnapshot(value?: ExecutionSnapshot): ExecutionEvent;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): ExecutionEvent.AsObject;
    static toObject(includeInstance: boolean, msg: ExecutionEvent): ExecutionEvent.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: ExecutionEvent, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): ExecutionEvent;
    static deserializeBinaryFromReader(message: ExecutionEvent, reader: jspb.BinaryReader): ExecutionEvent;
}

export namespace ExecutionEvent {
    export type AsObject = {
        taskId: string,
        revision: number,
        type: string,
        occurredAt?: google_protobuf_timestamp_pb.Timestamp.AsObject,
        reasonCode: string,
        progress?: Progress.AsObject,
        snapshot?: ExecutionSnapshot.AsObject,
    }
}

export class ListResourcesRequest extends jspb.Message {

    hasMetadata(): boolean;
    clearMetadata(): void;
    getMetadata(): RequestMetadata | undefined;
    setMetadata(value?: RequestMetadata): ListResourcesRequest;

    hasExecutionContext(): boolean;
    clearExecutionContext(): void;
    getExecutionContext(): ExecutionContext | undefined;
    setExecutionContext(value?: ExecutionContext): ListResourcesRequest;
    getPageToken(): string;
    setPageToken(value: string): ListResourcesRequest;
    getPageSize(): number;
    setPageSize(value: number): ListResourcesRequest;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): ListResourcesRequest.AsObject;
    static toObject(includeInstance: boolean, msg: ListResourcesRequest): ListResourcesRequest.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: ListResourcesRequest, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): ListResourcesRequest;
    static deserializeBinaryFromReader(message: ListResourcesRequest, reader: jspb.BinaryReader): ListResourcesRequest;
}

export namespace ListResourcesRequest {
    export type AsObject = {
        metadata?: RequestMetadata.AsObject,
        executionContext?: ExecutionContext.AsObject,
        pageToken: string,
        pageSize: number,
    }
}

export class ResourceInstance extends jspb.Message {
    getResourceId(): string;
    setResourceId(value: string): ResourceInstance;
    getDisplayName(): string;
    setDisplayName(value: string): ResourceInstance;
    getResourceType(): string;
    setResourceType(value: string): ResourceInstance;
    getEnabled(): boolean;
    setEnabled(value: boolean): ResourceInstance;
    getHealth(): string;
    setHealth(value: string): ResourceInstance;

    getLabelsMap(): jspb.Map<string, string>;
    clearLabelsMap(): void;

    hasMetadata(): boolean;
    clearMetadata(): void;
    getMetadata(): google_protobuf_struct_pb.Struct | undefined;
    setMetadata(value?: google_protobuf_struct_pb.Struct): ResourceInstance;

    hasLastSeenAt(): boolean;
    clearLastSeenAt(): void;
    getLastSeenAt(): google_protobuf_timestamp_pb.Timestamp | undefined;
    setLastSeenAt(value?: google_protobuf_timestamp_pb.Timestamp): ResourceInstance;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): ResourceInstance.AsObject;
    static toObject(includeInstance: boolean, msg: ResourceInstance): ResourceInstance.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: ResourceInstance, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): ResourceInstance;
    static deserializeBinaryFromReader(message: ResourceInstance, reader: jspb.BinaryReader): ResourceInstance;
}

export namespace ResourceInstance {
    export type AsObject = {
        resourceId: string,
        displayName: string,
        resourceType: string,
        enabled: boolean,
        health: string,

        labelsMap: Array<[string, string]>,
        metadata?: google_protobuf_struct_pb.Struct.AsObject,
        lastSeenAt?: google_protobuf_timestamp_pb.Timestamp.AsObject,
    }
}

export class ListResourcesResponse extends jspb.Message {
    clearResourcesList(): void;
    getResourcesList(): Array<ResourceInstance>;
    setResourcesList(value: Array<ResourceInstance>): ListResourcesResponse;
    addResources(value?: ResourceInstance, index?: number): ResourceInstance;
    getNextPageToken(): string;
    setNextPageToken(value: string): ListResourcesResponse;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): ListResourcesResponse.AsObject;
    static toObject(includeInstance: boolean, msg: ListResourcesResponse): ListResourcesResponse.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: ListResourcesResponse, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): ListResourcesResponse;
    static deserializeBinaryFromReader(message: ListResourcesResponse, reader: jspb.BinaryReader): ListResourcesResponse;
}

export namespace ListResourcesResponse {
    export type AsObject = {
        resourcesList: Array<ResourceInstance.AsObject>,
        nextPageToken: string,
    }
}

export enum ExecutionMode {
    EXECUTION_MODE_UNSPECIFIED = 0,
    LIVE = 1,
    SIMULATION = 2,
    HISTORICAL_REPLAY = 3,
}

export enum OperationExecution {
    OPERATION_EXECUTION_UNSPECIFIED = 0,
    SYNCHRONOUS = 1,
    TASK_CAPABLE = 2,
    TASK_REQUIRED = 3,
}

export enum InventoryMode {
    INVENTORY_MODE_UNSPECIFIED = 0,
    RUNTIME_VISIBLE = 1,
    OPAQUE = 2,
}

export enum AvailabilityState {
    AVAILABILITY_STATE_UNSPECIFIED = 0,
    AVAILABLE = 1,
    RESTRICTED = 2,
    DISABLED = 3,
    UNKNOWN = 4,
}

export enum RiskLevel {
    RISK_LEVEL_UNSPECIFIED = 0,
    LOW = 1,
    MEDIUM = 2,
    HIGH = 3,
    CRITICAL = 4,
}

export enum ReservationMode {
    RESERVATION_MODE_UNSPECIFIED = 0,
    NONE = 1,
    BEST_EFFORT = 2,
    GUARANTEED = 3,
}

export enum AdapterExecutionState {
    ADAPTER_EXECUTION_STATE_UNSPECIFIED = 0,
    ACCEPTED = 1,
    SCHEDULED = 2,
    QUEUED = 3,
    RUNNING = 4,
    PAUSED = 5,
    RESUMING = 6,
    WAITING_INPUT = 7,
    STOPPING = 8,
    SUCCEEDED = 20,
    BUSINESS_FAILED = 21,
    PARTIALLY_COMPLETED = 22,
    CANCELLED = 23,
    TECHNICAL_FAILED = 24,
}

export enum StopReason {
    STOP_REASON_UNSPECIFIED = 0,
    USER_REQUESTED = 1,
    DEADLINE_REACHED = 2,
    START_WINDOW_MISSED = 3,
    RUNTIME_SHUTDOWN = 4,
}

export enum ReconcileStatus {
    RECONCILE_STATUS_UNSPECIFIED = 0,
    FOUND = 1,
    NOT_FOUND = 2,
    TRANSIENT_UNAVAILABLE = 3,
    CONFLICT = 4,
}

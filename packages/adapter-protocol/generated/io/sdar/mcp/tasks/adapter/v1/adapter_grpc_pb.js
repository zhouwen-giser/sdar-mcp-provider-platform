// GENERATED CODE -- DO NOT EDIT!

'use strict';
var grpc = require('@grpc/grpc-js');
var io_sdar_mcp_tasks_adapter_v1_adapter_pb = require('../../../../../../io/sdar/mcp/tasks/adapter/v1/adapter_pb.js');
var google_protobuf_struct_pb = require('google-protobuf/google/protobuf/struct_pb.js');
var google_protobuf_timestamp_pb = require('google-protobuf/google/protobuf/timestamp_pb.js');

function serialize_io_sdar_mcp_tasks_adapter_v1_AdapterBusinessEvent(arg) {
  if (!(arg instanceof io_sdar_mcp_tasks_adapter_v1_adapter_pb.AdapterBusinessEvent)) {
    throw new Error('Expected argument of type io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_io_sdar_mcp_tasks_adapter_v1_AdapterBusinessEvent(buffer_arg) {
  return io_sdar_mcp_tasks_adapter_v1_adapter_pb.AdapterBusinessEvent.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_io_sdar_mcp_tasks_adapter_v1_CheckAvailabilityRequest(arg) {
  if (!(arg instanceof io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityRequest)) {
    throw new Error('Expected argument of type io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_io_sdar_mcp_tasks_adapter_v1_CheckAvailabilityRequest(buffer_arg) {
  return io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_io_sdar_mcp_tasks_adapter_v1_CheckAvailabilityResponse(arg) {
  if (!(arg instanceof io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityResponse)) {
    throw new Error('Expected argument of type io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_io_sdar_mcp_tasks_adapter_v1_CheckAvailabilityResponse(buffer_arg) {
  return io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_io_sdar_mcp_tasks_adapter_v1_CommandAck(arg) {
  if (!(arg instanceof io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck)) {
    throw new Error('Expected argument of type io.sdar.mcp.tasks.adapter.v1.CommandAck');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_io_sdar_mcp_tasks_adapter_v1_CommandAck(buffer_arg) {
  return io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_io_sdar_mcp_tasks_adapter_v1_DescribeProviderRequest(arg) {
  if (!(arg instanceof io_sdar_mcp_tasks_adapter_v1_adapter_pb.DescribeProviderRequest)) {
    throw new Error('Expected argument of type io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_io_sdar_mcp_tasks_adapter_v1_DescribeProviderRequest(buffer_arg) {
  return io_sdar_mcp_tasks_adapter_v1_adapter_pb.DescribeProviderRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_io_sdar_mcp_tasks_adapter_v1_ExecutionEvent(arg) {
  if (!(arg instanceof io_sdar_mcp_tasks_adapter_v1_adapter_pb.ExecutionEvent)) {
    throw new Error('Expected argument of type io.sdar.mcp.tasks.adapter.v1.ExecutionEvent');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_io_sdar_mcp_tasks_adapter_v1_ExecutionEvent(buffer_arg) {
  return io_sdar_mcp_tasks_adapter_v1_adapter_pb.ExecutionEvent.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_io_sdar_mcp_tasks_adapter_v1_ExecutionSnapshot(arg) {
  if (!(arg instanceof io_sdar_mcp_tasks_adapter_v1_adapter_pb.ExecutionSnapshot)) {
    throw new Error('Expected argument of type io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_io_sdar_mcp_tasks_adapter_v1_ExecutionSnapshot(buffer_arg) {
  return io_sdar_mcp_tasks_adapter_v1_adapter_pb.ExecutionSnapshot.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_io_sdar_mcp_tasks_adapter_v1_GetExecutionRequest(arg) {
  if (!(arg instanceof io_sdar_mcp_tasks_adapter_v1_adapter_pb.GetExecutionRequest)) {
    throw new Error('Expected argument of type io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_io_sdar_mcp_tasks_adapter_v1_GetExecutionRequest(buffer_arg) {
  return io_sdar_mcp_tasks_adapter_v1_adapter_pb.GetExecutionRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_io_sdar_mcp_tasks_adapter_v1_ListResourcesRequest(arg) {
  if (!(arg instanceof io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesRequest)) {
    throw new Error('Expected argument of type io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_io_sdar_mcp_tasks_adapter_v1_ListResourcesRequest(buffer_arg) {
  return io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_io_sdar_mcp_tasks_adapter_v1_ListResourcesResponse(arg) {
  if (!(arg instanceof io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesResponse)) {
    throw new Error('Expected argument of type io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_io_sdar_mcp_tasks_adapter_v1_ListResourcesResponse(buffer_arg) {
  return io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_io_sdar_mcp_tasks_adapter_v1_PauseExecutionRequest(arg) {
  if (!(arg instanceof io_sdar_mcp_tasks_adapter_v1_adapter_pb.PauseExecutionRequest)) {
    throw new Error('Expected argument of type io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_io_sdar_mcp_tasks_adapter_v1_PauseExecutionRequest(buffer_arg) {
  return io_sdar_mcp_tasks_adapter_v1_adapter_pb.PauseExecutionRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_io_sdar_mcp_tasks_adapter_v1_ProviderManifest(arg) {
  if (!(arg instanceof io_sdar_mcp_tasks_adapter_v1_adapter_pb.ProviderManifest)) {
    throw new Error('Expected argument of type io.sdar.mcp.tasks.adapter.v1.ProviderManifest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_io_sdar_mcp_tasks_adapter_v1_ProviderManifest(buffer_arg) {
  return io_sdar_mcp_tasks_adapter_v1_adapter_pb.ProviderManifest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_io_sdar_mcp_tasks_adapter_v1_ReconcileExecutionRequest(arg) {
  if (!(arg instanceof io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionRequest)) {
    throw new Error('Expected argument of type io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_io_sdar_mcp_tasks_adapter_v1_ReconcileExecutionRequest(buffer_arg) {
  return io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_io_sdar_mcp_tasks_adapter_v1_ReconcileExecutionResponse(arg) {
  if (!(arg instanceof io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionResponse)) {
    throw new Error('Expected argument of type io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_io_sdar_mcp_tasks_adapter_v1_ReconcileExecutionResponse(buffer_arg) {
  return io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_io_sdar_mcp_tasks_adapter_v1_RequestCancelRequest(arg) {
  if (!(arg instanceof io_sdar_mcp_tasks_adapter_v1_adapter_pb.RequestCancelRequest)) {
    throw new Error('Expected argument of type io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_io_sdar_mcp_tasks_adapter_v1_RequestCancelRequest(buffer_arg) {
  return io_sdar_mcp_tasks_adapter_v1_adapter_pb.RequestCancelRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_io_sdar_mcp_tasks_adapter_v1_ResumeExecutionRequest(arg) {
  if (!(arg instanceof io_sdar_mcp_tasks_adapter_v1_adapter_pb.ResumeExecutionRequest)) {
    throw new Error('Expected argument of type io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_io_sdar_mcp_tasks_adapter_v1_ResumeExecutionRequest(buffer_arg) {
  return io_sdar_mcp_tasks_adapter_v1_adapter_pb.ResumeExecutionRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_io_sdar_mcp_tasks_adapter_v1_StartOperationRequest(arg) {
  if (!(arg instanceof io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationRequest)) {
    throw new Error('Expected argument of type io.sdar.mcp.tasks.adapter.v1.StartOperationRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_io_sdar_mcp_tasks_adapter_v1_StartOperationRequest(buffer_arg) {
  return io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_io_sdar_mcp_tasks_adapter_v1_StartOperationResponse(arg) {
  if (!(arg instanceof io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationResponse)) {
    throw new Error('Expected argument of type io.sdar.mcp.tasks.adapter.v1.StartOperationResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_io_sdar_mcp_tasks_adapter_v1_StartOperationResponse(buffer_arg) {
  return io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_io_sdar_mcp_tasks_adapter_v1_StreamBusinessEventsRequest(arg) {
  if (!(arg instanceof io_sdar_mcp_tasks_adapter_v1_adapter_pb.StreamBusinessEventsRequest)) {
    throw new Error('Expected argument of type io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_io_sdar_mcp_tasks_adapter_v1_StreamBusinessEventsRequest(buffer_arg) {
  return io_sdar_mcp_tasks_adapter_v1_adapter_pb.StreamBusinessEventsRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_io_sdar_mcp_tasks_adapter_v1_StreamExecutionEventsRequest(arg) {
  if (!(arg instanceof io_sdar_mcp_tasks_adapter_v1_adapter_pb.StreamExecutionEventsRequest)) {
    throw new Error('Expected argument of type io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_io_sdar_mcp_tasks_adapter_v1_StreamExecutionEventsRequest(buffer_arg) {
  return io_sdar_mcp_tasks_adapter_v1_adapter_pb.StreamExecutionEventsRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_io_sdar_mcp_tasks_adapter_v1_UpdateExecutionRequest(arg) {
  if (!(arg instanceof io_sdar_mcp_tasks_adapter_v1_adapter_pb.UpdateExecutionRequest)) {
    throw new Error('Expected argument of type io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_io_sdar_mcp_tasks_adapter_v1_UpdateExecutionRequest(buffer_arg) {
  return io_sdar_mcp_tasks_adapter_v1_adapter_pb.UpdateExecutionRequest.deserializeBinary(new Uint8Array(buffer_arg));
}


// Language-neutral boundary between the SDAR Runtime and one resource Adapter.
var ResourceProviderAdapterService = exports.ResourceProviderAdapterService = {
  describeProvider: {
    path: '/io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter/DescribeProvider',
    requestStream: false,
    responseStream: false,
    requestType: io_sdar_mcp_tasks_adapter_v1_adapter_pb.DescribeProviderRequest,
    responseType: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ProviderManifest,
    requestSerialize: serialize_io_sdar_mcp_tasks_adapter_v1_DescribeProviderRequest,
    requestDeserialize: deserialize_io_sdar_mcp_tasks_adapter_v1_DescribeProviderRequest,
    responseSerialize: serialize_io_sdar_mcp_tasks_adapter_v1_ProviderManifest,
    responseDeserialize: deserialize_io_sdar_mcp_tasks_adapter_v1_ProviderManifest,
  },
  checkAvailability: {
    path: '/io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter/CheckAvailability',
    requestStream: false,
    responseStream: false,
    requestType: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityRequest,
    responseType: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CheckAvailabilityResponse,
    requestSerialize: serialize_io_sdar_mcp_tasks_adapter_v1_CheckAvailabilityRequest,
    requestDeserialize: deserialize_io_sdar_mcp_tasks_adapter_v1_CheckAvailabilityRequest,
    responseSerialize: serialize_io_sdar_mcp_tasks_adapter_v1_CheckAvailabilityResponse,
    responseDeserialize: deserialize_io_sdar_mcp_tasks_adapter_v1_CheckAvailabilityResponse,
  },
  startOperation: {
    path: '/io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter/StartOperation',
    requestStream: false,
    responseStream: false,
    requestType: io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationRequest,
    responseType: io_sdar_mcp_tasks_adapter_v1_adapter_pb.StartOperationResponse,
    requestSerialize: serialize_io_sdar_mcp_tasks_adapter_v1_StartOperationRequest,
    requestDeserialize: deserialize_io_sdar_mcp_tasks_adapter_v1_StartOperationRequest,
    responseSerialize: serialize_io_sdar_mcp_tasks_adapter_v1_StartOperationResponse,
    responseDeserialize: deserialize_io_sdar_mcp_tasks_adapter_v1_StartOperationResponse,
  },
  getExecution: {
    path: '/io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter/GetExecution',
    requestStream: false,
    responseStream: false,
    requestType: io_sdar_mcp_tasks_adapter_v1_adapter_pb.GetExecutionRequest,
    responseType: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ExecutionSnapshot,
    requestSerialize: serialize_io_sdar_mcp_tasks_adapter_v1_GetExecutionRequest,
    requestDeserialize: deserialize_io_sdar_mcp_tasks_adapter_v1_GetExecutionRequest,
    responseSerialize: serialize_io_sdar_mcp_tasks_adapter_v1_ExecutionSnapshot,
    responseDeserialize: deserialize_io_sdar_mcp_tasks_adapter_v1_ExecutionSnapshot,
  },
  requestCancel: {
    path: '/io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter/RequestCancel',
    requestStream: false,
    responseStream: false,
    requestType: io_sdar_mcp_tasks_adapter_v1_adapter_pb.RequestCancelRequest,
    responseType: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck,
    requestSerialize: serialize_io_sdar_mcp_tasks_adapter_v1_RequestCancelRequest,
    requestDeserialize: deserialize_io_sdar_mcp_tasks_adapter_v1_RequestCancelRequest,
    responseSerialize: serialize_io_sdar_mcp_tasks_adapter_v1_CommandAck,
    responseDeserialize: deserialize_io_sdar_mcp_tasks_adapter_v1_CommandAck,
  },
  reconcileExecution: {
    path: '/io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter/ReconcileExecution',
    requestStream: false,
    responseStream: false,
    requestType: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionRequest,
    responseType: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ReconcileExecutionResponse,
    requestSerialize: serialize_io_sdar_mcp_tasks_adapter_v1_ReconcileExecutionRequest,
    requestDeserialize: deserialize_io_sdar_mcp_tasks_adapter_v1_ReconcileExecutionRequest,
    responseSerialize: serialize_io_sdar_mcp_tasks_adapter_v1_ReconcileExecutionResponse,
    responseDeserialize: deserialize_io_sdar_mcp_tasks_adapter_v1_ReconcileExecutionResponse,
  },
  updateExecution: {
    path: '/io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter/UpdateExecution',
    requestStream: false,
    responseStream: false,
    requestType: io_sdar_mcp_tasks_adapter_v1_adapter_pb.UpdateExecutionRequest,
    responseType: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck,
    requestSerialize: serialize_io_sdar_mcp_tasks_adapter_v1_UpdateExecutionRequest,
    requestDeserialize: deserialize_io_sdar_mcp_tasks_adapter_v1_UpdateExecutionRequest,
    responseSerialize: serialize_io_sdar_mcp_tasks_adapter_v1_CommandAck,
    responseDeserialize: deserialize_io_sdar_mcp_tasks_adapter_v1_CommandAck,
  },
  pauseExecution: {
    path: '/io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter/PauseExecution',
    requestStream: false,
    responseStream: false,
    requestType: io_sdar_mcp_tasks_adapter_v1_adapter_pb.PauseExecutionRequest,
    responseType: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck,
    requestSerialize: serialize_io_sdar_mcp_tasks_adapter_v1_PauseExecutionRequest,
    requestDeserialize: deserialize_io_sdar_mcp_tasks_adapter_v1_PauseExecutionRequest,
    responseSerialize: serialize_io_sdar_mcp_tasks_adapter_v1_CommandAck,
    responseDeserialize: deserialize_io_sdar_mcp_tasks_adapter_v1_CommandAck,
  },
  resumeExecution: {
    path: '/io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter/ResumeExecution',
    requestStream: false,
    responseStream: false,
    requestType: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ResumeExecutionRequest,
    responseType: io_sdar_mcp_tasks_adapter_v1_adapter_pb.CommandAck,
    requestSerialize: serialize_io_sdar_mcp_tasks_adapter_v1_ResumeExecutionRequest,
    requestDeserialize: deserialize_io_sdar_mcp_tasks_adapter_v1_ResumeExecutionRequest,
    responseSerialize: serialize_io_sdar_mcp_tasks_adapter_v1_CommandAck,
    responseDeserialize: deserialize_io_sdar_mcp_tasks_adapter_v1_CommandAck,
  },
  streamExecutionEvents: {
    path: '/io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter/StreamExecutionEvents',
    requestStream: false,
    responseStream: true,
    requestType: io_sdar_mcp_tasks_adapter_v1_adapter_pb.StreamExecutionEventsRequest,
    responseType: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ExecutionEvent,
    requestSerialize: serialize_io_sdar_mcp_tasks_adapter_v1_StreamExecutionEventsRequest,
    requestDeserialize: deserialize_io_sdar_mcp_tasks_adapter_v1_StreamExecutionEventsRequest,
    responseSerialize: serialize_io_sdar_mcp_tasks_adapter_v1_ExecutionEvent,
    responseDeserialize: deserialize_io_sdar_mcp_tasks_adapter_v1_ExecutionEvent,
  },
  streamBusinessEvents: {
    path: '/io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter/StreamBusinessEvents',
    requestStream: false,
    responseStream: true,
    requestType: io_sdar_mcp_tasks_adapter_v1_adapter_pb.StreamBusinessEventsRequest,
    responseType: io_sdar_mcp_tasks_adapter_v1_adapter_pb.AdapterBusinessEvent,
    requestSerialize: serialize_io_sdar_mcp_tasks_adapter_v1_StreamBusinessEventsRequest,
    requestDeserialize: deserialize_io_sdar_mcp_tasks_adapter_v1_StreamBusinessEventsRequest,
    responseSerialize: serialize_io_sdar_mcp_tasks_adapter_v1_AdapterBusinessEvent,
    responseDeserialize: deserialize_io_sdar_mcp_tasks_adapter_v1_AdapterBusinessEvent,
  },
  listResources: {
    path: '/io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter/ListResources',
    requestStream: false,
    responseStream: false,
    requestType: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesRequest,
    responseType: io_sdar_mcp_tasks_adapter_v1_adapter_pb.ListResourcesResponse,
    requestSerialize: serialize_io_sdar_mcp_tasks_adapter_v1_ListResourcesRequest,
    requestDeserialize: deserialize_io_sdar_mcp_tasks_adapter_v1_ListResourcesRequest,
    responseSerialize: serialize_io_sdar_mcp_tasks_adapter_v1_ListResourcesResponse,
    responseDeserialize: deserialize_io_sdar_mcp_tasks_adapter_v1_ListResourcesResponse,
  },
};

exports.ResourceProviderAdapterClient = grpc.makeGenericClientConstructor(ResourceProviderAdapterService, 'ResourceProviderAdapter');

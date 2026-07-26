// GENERATED CODE -- DO NOT EDIT!

'use strict';
var grpc = require('@grpc/grpc-js');
var io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb = require('../../../../../../io/sdar/mcp/tasks/telemetry/v1/provider_telemetry_pb.js');
var google_protobuf_struct_pb = require('google-protobuf/google/protobuf/struct_pb.js');
var google_protobuf_timestamp_pb = require('google-protobuf/google/protobuf/timestamp_pb.js');

function serialize_io_sdar_mcp_tasks_telemetry_v1_EmitProviderEventsRequest(arg) {
  if (!(arg instanceof io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsRequest)) {
    throw new Error('Expected argument of type io.sdar.mcp.tasks.telemetry.v1.EmitProviderEventsRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_io_sdar_mcp_tasks_telemetry_v1_EmitProviderEventsRequest(buffer_arg) {
  return io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_io_sdar_mcp_tasks_telemetry_v1_EmitProviderEventsResponse(arg) {
  if (!(arg instanceof io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsResponse)) {
    throw new Error('Expected argument of type io.sdar.mcp.tasks.telemetry.v1.EmitProviderEventsResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_io_sdar_mcp_tasks_telemetry_v1_EmitProviderEventsResponse(buffer_arg) {
  return io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsResponse.deserializeBinary(new Uint8Array(buffer_arg));
}


// Runtime-hosted ingress called by a Resource Provider. This is intentionally
// separate from ResourceProviderAdapter, whose call direction is Runtime to Adapter.
var ProviderTelemetryIngressService = exports.ProviderTelemetryIngressService = {
  emitProviderEvents: {
    path: '/io.sdar.mcp.tasks.telemetry.v1.ProviderTelemetryIngress/EmitProviderEvents',
    requestStream: false,
    responseStream: false,
    requestType: io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsRequest,
    responseType: io_sdar_mcp_tasks_telemetry_v1_provider_telemetry_pb.EmitProviderEventsResponse,
    requestSerialize: serialize_io_sdar_mcp_tasks_telemetry_v1_EmitProviderEventsRequest,
    requestDeserialize: deserialize_io_sdar_mcp_tasks_telemetry_v1_EmitProviderEventsRequest,
    responseSerialize: serialize_io_sdar_mcp_tasks_telemetry_v1_EmitProviderEventsResponse,
    responseDeserialize: deserialize_io_sdar_mcp_tasks_telemetry_v1_EmitProviderEventsResponse,
  },
};

exports.ProviderTelemetryIngressClient = grpc.makeGenericClientConstructor(ProviderTelemetryIngressService, 'ProviderTelemetryIngress');

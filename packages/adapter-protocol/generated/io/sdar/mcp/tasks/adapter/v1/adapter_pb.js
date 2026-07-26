// source: io/sdar/mcp/tasks/adapter/v1/adapter.proto
/**
 * @fileoverview
 * @enhanceable
 * @suppress {missingRequire} reports error on implicit type usages.
 * @suppress {messageConventions} JS Compiler reports an error if a variable or
 *     field starts with 'MSG_' and isn't a translatable message.
 * @public
 */
// GENERATED CODE -- DO NOT EDIT!
/* eslint-disable */
// @ts-nocheck

var jspb = require('google-protobuf');
var goog = jspb;
var global = (function() {
  if (this) { return this; }
  if (typeof window !== 'undefined') { return window; }
  if (typeof global !== 'undefined') { return global; }
  if (typeof self !== 'undefined') { return self; }
  return Function('return this')();
}.call(null));

var google_protobuf_struct_pb = require('google-protobuf/google/protobuf/struct_pb.js');
goog.object.extend(proto, google_protobuf_struct_pb);
var google_protobuf_timestamp_pb = require('google-protobuf/google/protobuf/timestamp_pb.js');
goog.object.extend(proto, google_protobuf_timestamp_pb);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.AdapterExecutionState', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.Alternative', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.ArgumentsValueCase', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityState', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.CommandAck', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.ExecutionMode', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.InputRequest', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.InventoryMode', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.OperationExecution', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.Progress', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.ReconcileStatus', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.ReservationMode', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding.Mode', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.RiskLevel', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.ResultCase', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.StopReason', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.TaskStart', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.Mode', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest', null, global);
goog.exportSymbol('proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue', null, global);
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.repeatedFields_, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskStart = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.TaskStart, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.TaskStart';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments.repeatedFields_, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.oneofGroups_);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest.repeatedFields_, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.repeatedFields_, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse.repeatedFields_, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.Alternative = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.Alternative, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.Alternative.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.Alternative';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected.repeatedFields_, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.Progress = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.Progress, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.Progress.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.Progress';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.InputRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.InputRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.InputRequest.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.InputRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.repeatedFields_, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.repeatedFields_, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.oneofGroups_);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.repeatedFields_, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.CommandAck = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.CommandAck, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.CommandAck.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.CommandAck';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse.repeatedFields_, null);
};
goog.inherits(proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse.displayName = 'proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse';
}



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.toObject = function(includeInstance, msg) {
  var f, obj = {
    adapterProtocolVersion: jspb.Message.getFieldWithDefault(msg, 1, ""),
    providerId: jspb.Message.getFieldWithDefault(msg, 2, ""),
    correlationId: jspb.Message.getFieldWithDefault(msg, 3, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata}
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata;
  return proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata}
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setAdapterProtocolVersion(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setProviderId(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setCorrelationId(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getAdapterProtocolVersion();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getProviderId();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getCorrelationId();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
};


/**
 * optional string adapter_protocol_version = 1;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.prototype.getAdapterProtocolVersion = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.prototype.setAdapterProtocolVersion = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string provider_id = 2;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.prototype.getProviderId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.prototype.setProviderId = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string correlation_id = 3;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.prototype.getCorrelationId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.prototype.setCorrelationId = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.toObject = function(includeInstance, msg) {
  var f, obj = {
    authorizationContextHash: jspb.Message.getFieldWithDefault(msg, 1, ""),
    executionMode: jspb.Message.getFieldWithDefault(msg, 2, 0),
    simulationId: jspb.Message.getFieldWithDefault(msg, 3, ""),
    correlationId: jspb.Message.getFieldWithDefault(msg, 4, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext;
  return proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setAuthorizationContextHash(value);
      break;
    case 2:
      var value = /** @type {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionMode} */ (reader.readEnum());
      msg.setExecutionMode(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setSimulationId(value);
      break;
    case 4:
      var value = /** @type {string} */ (reader.readString());
      msg.setCorrelationId(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getAuthorizationContextHash();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getExecutionMode();
  if (f !== 0.0) {
    writer.writeEnum(
      2,
      f
    );
  }
  f = message.getSimulationId();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getCorrelationId();
  if (f.length > 0) {
    writer.writeString(
      4,
      f
    );
  }
};


/**
 * optional string authorization_context_hash = 1;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.prototype.getAuthorizationContextHash = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.prototype.setAuthorizationContextHash = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional ExecutionMode execution_mode = 2;
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionMode}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.prototype.getExecutionMode = function() {
  return /** @type {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionMode} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionMode} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.prototype.setExecutionMode = function(value) {
  return jspb.Message.setProto3EnumField(this, 2, value);
};


/**
 * optional string simulation_id = 3;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.prototype.getSimulationId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.prototype.setSimulationId = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional string correlation_id = 4;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.prototype.getCorrelationId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 4, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.prototype.setCorrelationId = function(value) {
  return jspb.Message.setProto3StringField(this, 4, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.toObject = function(includeInstance, msg) {
  var f, obj = {
    availability: jspb.Message.getBooleanFieldWithDefault(msg, 1, false),
    scheduling: jspb.Message.getBooleanFieldWithDefault(msg, 2, false),
    maxElapsed: jspb.Message.getBooleanFieldWithDefault(msg, 3, false),
    cancel: jspb.Message.getBooleanFieldWithDefault(msg, 4, false),
    pauseResume: jspb.Message.getBooleanFieldWithDefault(msg, 5, false),
    inputRequired: jspb.Message.getBooleanFieldWithDefault(msg, 6, false),
    idempotency: jspb.Message.getBooleanFieldWithDefault(msg, 7, false),
    observations: jspb.Message.getBooleanFieldWithDefault(msg, 8, false)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities;
  return proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {boolean} */ (reader.readBool());
      msg.setAvailability(value);
      break;
    case 2:
      var value = /** @type {boolean} */ (reader.readBool());
      msg.setScheduling(value);
      break;
    case 3:
      var value = /** @type {boolean} */ (reader.readBool());
      msg.setMaxElapsed(value);
      break;
    case 4:
      var value = /** @type {boolean} */ (reader.readBool());
      msg.setCancel(value);
      break;
    case 5:
      var value = /** @type {boolean} */ (reader.readBool());
      msg.setPauseResume(value);
      break;
    case 6:
      var value = /** @type {boolean} */ (reader.readBool());
      msg.setInputRequired(value);
      break;
    case 7:
      var value = /** @type {boolean} */ (reader.readBool());
      msg.setIdempotency(value);
      break;
    case 8:
      var value = /** @type {boolean} */ (reader.readBool());
      msg.setObservations(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getAvailability();
  if (f) {
    writer.writeBool(
      1,
      f
    );
  }
  f = message.getScheduling();
  if (f) {
    writer.writeBool(
      2,
      f
    );
  }
  f = message.getMaxElapsed();
  if (f) {
    writer.writeBool(
      3,
      f
    );
  }
  f = message.getCancel();
  if (f) {
    writer.writeBool(
      4,
      f
    );
  }
  f = message.getPauseResume();
  if (f) {
    writer.writeBool(
      5,
      f
    );
  }
  f = message.getInputRequired();
  if (f) {
    writer.writeBool(
      6,
      f
    );
  }
  f = message.getIdempotency();
  if (f) {
    writer.writeBool(
      7,
      f
    );
  }
  f = message.getObservations();
  if (f) {
    writer.writeBool(
      8,
      f
    );
  }
};


/**
 * optional bool availability = 1;
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.prototype.getAvailability = function() {
  return /** @type {boolean} */ (jspb.Message.getBooleanFieldWithDefault(this, 1, false));
};


/**
 * @param {boolean} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.prototype.setAvailability = function(value) {
  return jspb.Message.setProto3BooleanField(this, 1, value);
};


/**
 * optional bool scheduling = 2;
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.prototype.getScheduling = function() {
  return /** @type {boolean} */ (jspb.Message.getBooleanFieldWithDefault(this, 2, false));
};


/**
 * @param {boolean} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.prototype.setScheduling = function(value) {
  return jspb.Message.setProto3BooleanField(this, 2, value);
};


/**
 * optional bool max_elapsed = 3;
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.prototype.getMaxElapsed = function() {
  return /** @type {boolean} */ (jspb.Message.getBooleanFieldWithDefault(this, 3, false));
};


/**
 * @param {boolean} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.prototype.setMaxElapsed = function(value) {
  return jspb.Message.setProto3BooleanField(this, 3, value);
};


/**
 * optional bool cancel = 4;
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.prototype.getCancel = function() {
  return /** @type {boolean} */ (jspb.Message.getBooleanFieldWithDefault(this, 4, false));
};


/**
 * @param {boolean} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.prototype.setCancel = function(value) {
  return jspb.Message.setProto3BooleanField(this, 4, value);
};


/**
 * optional bool pause_resume = 5;
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.prototype.getPauseResume = function() {
  return /** @type {boolean} */ (jspb.Message.getBooleanFieldWithDefault(this, 5, false));
};


/**
 * @param {boolean} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.prototype.setPauseResume = function(value) {
  return jspb.Message.setProto3BooleanField(this, 5, value);
};


/**
 * optional bool input_required = 6;
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.prototype.getInputRequired = function() {
  return /** @type {boolean} */ (jspb.Message.getBooleanFieldWithDefault(this, 6, false));
};


/**
 * @param {boolean} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.prototype.setInputRequired = function(value) {
  return jspb.Message.setProto3BooleanField(this, 6, value);
};


/**
 * optional bool idempotency = 7;
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.prototype.getIdempotency = function() {
  return /** @type {boolean} */ (jspb.Message.getBooleanFieldWithDefault(this, 7, false));
};


/**
 * @param {boolean} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.prototype.setIdempotency = function(value) {
  return jspb.Message.setProto3BooleanField(this, 7, value);
};


/**
 * optional bool observations = 8;
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.prototype.getObservations = function() {
  return /** @type {boolean} */ (jspb.Message.getBooleanFieldWithDefault(this, 8, false));
};


/**
 * @param {boolean} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.prototype.setObservations = function(value) {
  return jspb.Message.setProto3BooleanField(this, 8, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding.toObject = function(includeInstance, msg) {
  var f, obj = {
    mode: jspb.Message.getFieldWithDefault(msg, 1, 0),
    resourceIdJsonPointer: jspb.Message.getFieldWithDefault(msg, 2, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding;
  return proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding.Mode} */ (reader.readEnum());
      msg.setMode(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setResourceIdJsonPointer(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getMode();
  if (f !== 0.0) {
    writer.writeEnum(
      1,
      f
    );
  }
  f = message.getResourceIdJsonPointer();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
};


/**
 * @enum {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding.Mode = {
  MODE_UNSPECIFIED: 0,
  NONE: 1,
  ARGUMENT_REFERENCE: 2
};

/**
 * optional Mode mode = 1;
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding.Mode}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding.prototype.getMode = function() {
  return /** @type {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding.Mode} */ (jspb.Message.getFieldWithDefault(this, 1, 0));
};


/**
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding.Mode} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding.prototype.setMode = function(value) {
  return jspb.Message.setProto3EnumField(this, 1, value);
};


/**
 * optional string resource_id_json_pointer = 2;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding.prototype.getResourceIdJsonPointer = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding.prototype.setResourceIdJsonPointer = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.toObject = function(includeInstance, msg) {
  var f, obj = {
    name: jspb.Message.getFieldWithDefault(msg, 1, ""),
    description: jspb.Message.getFieldWithDefault(msg, 2, ""),
    execution: jspb.Message.getFieldWithDefault(msg, 3, 0),
    inputSchema: (f = msg.getInputSchema()) && google_protobuf_struct_pb.Struct.toObject(includeInstance, f),
    outputSchema: (f = msg.getOutputSchema()) && google_protobuf_struct_pb.Struct.toObject(includeInstance, f),
    capabilities: (f = msg.getCapabilities()) && proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.toObject(includeInstance, f),
    resourceBinding: (f = msg.getResourceBinding()) && proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition;
  return proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setName(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setDescription(value);
      break;
    case 3:
      var value = /** @type {!proto.io.sdar.mcp.tasks.adapter.v1.OperationExecution} */ (reader.readEnum());
      msg.setExecution(value);
      break;
    case 4:
      var value = new google_protobuf_struct_pb.Struct;
      reader.readMessage(value,google_protobuf_struct_pb.Struct.deserializeBinaryFromReader);
      msg.setInputSchema(value);
      break;
    case 5:
      var value = new google_protobuf_struct_pb.Struct;
      reader.readMessage(value,google_protobuf_struct_pb.Struct.deserializeBinaryFromReader);
      msg.setOutputSchema(value);
      break;
    case 6:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.deserializeBinaryFromReader);
      msg.setCapabilities(value);
      break;
    case 7:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding.deserializeBinaryFromReader);
      msg.setResourceBinding(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getName();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getDescription();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getExecution();
  if (f !== 0.0) {
    writer.writeEnum(
      3,
      f
    );
  }
  f = message.getInputSchema();
  if (f != null) {
    writer.writeMessage(
      4,
      f,
      google_protobuf_struct_pb.Struct.serializeBinaryToWriter
    );
  }
  f = message.getOutputSchema();
  if (f != null) {
    writer.writeMessage(
      5,
      f,
      google_protobuf_struct_pb.Struct.serializeBinaryToWriter
    );
  }
  f = message.getCapabilities();
  if (f != null) {
    writer.writeMessage(
      6,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities.serializeBinaryToWriter
    );
  }
  f = message.getResourceBinding();
  if (f != null) {
    writer.writeMessage(
      7,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding.serializeBinaryToWriter
    );
  }
};


/**
 * optional string name = 1;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.prototype.getName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.prototype.setName = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string description = 2;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.prototype.getDescription = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.prototype.setDescription = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional OperationExecution execution = 3;
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.OperationExecution}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.prototype.getExecution = function() {
  return /** @type {!proto.io.sdar.mcp.tasks.adapter.v1.OperationExecution} */ (jspb.Message.getFieldWithDefault(this, 3, 0));
};


/**
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.OperationExecution} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.prototype.setExecution = function(value) {
  return jspb.Message.setProto3EnumField(this, 3, value);
};


/**
 * optional google.protobuf.Struct input_schema = 4;
 * @return {?proto.google.protobuf.Struct}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.prototype.getInputSchema = function() {
  return /** @type{?proto.google.protobuf.Struct} */ (
    jspb.Message.getWrapperField(this, google_protobuf_struct_pb.Struct, 4));
};


/**
 * @param {?proto.google.protobuf.Struct|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.prototype.setInputSchema = function(value) {
  return jspb.Message.setWrapperField(this, 4, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.prototype.clearInputSchema = function() {
  return this.setInputSchema(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.prototype.hasInputSchema = function() {
  return jspb.Message.getField(this, 4) != null;
};


/**
 * optional google.protobuf.Struct output_schema = 5;
 * @return {?proto.google.protobuf.Struct}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.prototype.getOutputSchema = function() {
  return /** @type{?proto.google.protobuf.Struct} */ (
    jspb.Message.getWrapperField(this, google_protobuf_struct_pb.Struct, 5));
};


/**
 * @param {?proto.google.protobuf.Struct|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.prototype.setOutputSchema = function(value) {
  return jspb.Message.setWrapperField(this, 5, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.prototype.clearOutputSchema = function() {
  return this.setOutputSchema(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.prototype.hasOutputSchema = function() {
  return jspb.Message.getField(this, 5) != null;
};


/**
 * optional OperationCapabilities capabilities = 6;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.prototype.getCapabilities = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities, 6));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.OperationCapabilities|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.prototype.setCapabilities = function(value) {
  return jspb.Message.setWrapperField(this, 6, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.prototype.clearCapabilities = function() {
  return this.setCapabilities(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.prototype.hasCapabilities = function() {
  return jspb.Message.getField(this, 6) != null;
};


/**
 * optional ResourceBinding resource_binding = 7;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.prototype.getResourceBinding = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding, 7));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.ResourceBinding|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.prototype.setResourceBinding = function(value) {
  return jspb.Message.setWrapperField(this, 7, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.prototype.clearResourceBinding = function() {
  return this.setResourceBinding(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.prototype.hasResourceBinding = function() {
  return jspb.Message.getField(this, 7) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    metadata: (f = msg.getMetadata()) && proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest;
  return proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.deserializeBinaryFromReader);
      msg.setMetadata(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getMetadata();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.serializeBinaryToWriter
    );
  }
};


/**
 * optional RequestMetadata metadata = 1;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata}
 */
proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest.prototype.getMetadata = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata, 1));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest.prototype.setMetadata = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest.prototype.clearMetadata = function() {
  return this.setMetadata(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.DescribeProviderRequest.prototype.hasMetadata = function() {
  return jspb.Message.getField(this, 1) != null;
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.repeatedFields_ = [6,7];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.toObject = function(includeInstance, msg) {
  var f, obj = {
    adapterProtocolVersion: jspb.Message.getFieldWithDefault(msg, 1, ""),
    providerId: jspb.Message.getFieldWithDefault(msg, 2, ""),
    providerType: jspb.Message.getFieldWithDefault(msg, 3, ""),
    providerVersion: jspb.Message.getFieldWithDefault(msg, 4, ""),
    inventoryMode: jspb.Message.getFieldWithDefault(msg, 5, 0),
    operationsList: jspb.Message.toObjectList(msg.getOperationsList(),
    proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.toObject, includeInstance),
    businessEventSourcesList: jspb.Message.toObjectList(msg.getBusinessEventSourcesList(),
    proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest;
  return proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setAdapterProtocolVersion(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setProviderId(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setProviderType(value);
      break;
    case 4:
      var value = /** @type {string} */ (reader.readString());
      msg.setProviderVersion(value);
      break;
    case 5:
      var value = /** @type {!proto.io.sdar.mcp.tasks.adapter.v1.InventoryMode} */ (reader.readEnum());
      msg.setInventoryMode(value);
      break;
    case 6:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.deserializeBinaryFromReader);
      msg.addOperations(value);
      break;
    case 7:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.deserializeBinaryFromReader);
      msg.addBusinessEventSources(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getAdapterProtocolVersion();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getProviderId();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getProviderType();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getProviderVersion();
  if (f.length > 0) {
    writer.writeString(
      4,
      f
    );
  }
  f = message.getInventoryMode();
  if (f !== 0.0) {
    writer.writeEnum(
      5,
      f
    );
  }
  f = message.getOperationsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      6,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition.serializeBinaryToWriter
    );
  }
  f = message.getBusinessEventSourcesList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      7,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.serializeBinaryToWriter
    );
  }
};


/**
 * optional string adapter_protocol_version = 1;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.prototype.getAdapterProtocolVersion = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.prototype.setAdapterProtocolVersion = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string provider_id = 2;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.prototype.getProviderId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.prototype.setProviderId = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string provider_type = 3;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.prototype.getProviderType = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.prototype.setProviderType = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional string provider_version = 4;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.prototype.getProviderVersion = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 4, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.prototype.setProviderVersion = function(value) {
  return jspb.Message.setProto3StringField(this, 4, value);
};


/**
 * optional InventoryMode inventory_mode = 5;
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.InventoryMode}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.prototype.getInventoryMode = function() {
  return /** @type {!proto.io.sdar.mcp.tasks.adapter.v1.InventoryMode} */ (jspb.Message.getFieldWithDefault(this, 5, 0));
};


/**
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.InventoryMode} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.prototype.setInventoryMode = function(value) {
  return jspb.Message.setProto3EnumField(this, 5, value);
};


/**
 * repeated OperationDefinition operations = 6;
 * @return {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition>}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.prototype.getOperationsList = function() {
  return /** @type{!Array<!proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition, 6));
};


/**
 * @param {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition>} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.prototype.setOperationsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 6, value);
};


/**
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition=} opt_value
 * @param {number=} opt_index
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.prototype.addOperations = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 6, opt_value, proto.io.sdar.mcp.tasks.adapter.v1.OperationDefinition, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.prototype.clearOperationsList = function() {
  return this.setOperationsList([]);
};


/**
 * repeated BusinessEventSourceCapability business_event_sources = 7;
 * @return {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability>}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.prototype.getBusinessEventSourcesList = function() {
  return /** @type{!Array<!proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability, 7));
};


/**
 * @param {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability>} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.prototype.setBusinessEventSourcesList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 7, value);
};


/**
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability=} opt_value
 * @param {number=} opt_index
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.prototype.addBusinessEventSources = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 7, opt_value, proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ProviderManifest.prototype.clearBusinessEventSourcesList = function() {
  return this.setBusinessEventSourcesList([]);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.toObject = function(includeInstance, msg) {
  var f, obj = {
    sourceId: jspb.Message.getFieldWithDefault(msg, 1, ""),
    sourceStreamId: jspb.Message.getFieldWithDefault(msg, 2, ""),
    deliverySemantics: jspb.Message.getFieldWithDefault(msg, 3, ""),
    replaySupported: jspb.Message.getBooleanFieldWithDefault(msg, 4, false),
    sourceRetentionMs: jspb.Message.getFieldWithDefault(msg, 5, 0),
    maxEventBytes: jspb.Message.getFieldWithDefault(msg, 6, 0),
    maxPayloadDepth: jspb.Message.getFieldWithDefault(msg, 7, 0),
    maxPayloadNodes: jspb.Message.getFieldWithDefault(msg, 8, 0),
    maxPayloadStringBytes: jspb.Message.getFieldWithDefault(msg, 9, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability}
 */
proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability;
  return proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability}
 */
proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSourceId(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setSourceStreamId(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setDeliverySemantics(value);
      break;
    case 4:
      var value = /** @type {boolean} */ (reader.readBool());
      msg.setReplaySupported(value);
      break;
    case 5:
      var value = /** @type {number} */ (reader.readUint64());
      msg.setSourceRetentionMs(value);
      break;
    case 6:
      var value = /** @type {number} */ (reader.readUint64());
      msg.setMaxEventBytes(value);
      break;
    case 7:
      var value = /** @type {number} */ (reader.readUint32());
      msg.setMaxPayloadDepth(value);
      break;
    case 8:
      var value = /** @type {number} */ (reader.readUint32());
      msg.setMaxPayloadNodes(value);
      break;
    case 9:
      var value = /** @type {number} */ (reader.readUint64());
      msg.setMaxPayloadStringBytes(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSourceId();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getSourceStreamId();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getDeliverySemantics();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getReplaySupported();
  if (f) {
    writer.writeBool(
      4,
      f
    );
  }
  f = message.getSourceRetentionMs();
  if (f !== 0) {
    writer.writeUint64(
      5,
      f
    );
  }
  f = message.getMaxEventBytes();
  if (f !== 0) {
    writer.writeUint64(
      6,
      f
    );
  }
  f = message.getMaxPayloadDepth();
  if (f !== 0) {
    writer.writeUint32(
      7,
      f
    );
  }
  f = message.getMaxPayloadNodes();
  if (f !== 0) {
    writer.writeUint32(
      8,
      f
    );
  }
  f = message.getMaxPayloadStringBytes();
  if (f !== 0) {
    writer.writeUint64(
      9,
      f
    );
  }
};


/**
 * optional string source_id = 1;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.prototype.getSourceId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.prototype.setSourceId = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string source_stream_id = 2;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.prototype.getSourceStreamId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.prototype.setSourceStreamId = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string delivery_semantics = 3;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.prototype.getDeliverySemantics = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.prototype.setDeliverySemantics = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional bool replay_supported = 4;
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.prototype.getReplaySupported = function() {
  return /** @type {boolean} */ (jspb.Message.getBooleanFieldWithDefault(this, 4, false));
};


/**
 * @param {boolean} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.prototype.setReplaySupported = function(value) {
  return jspb.Message.setProto3BooleanField(this, 4, value);
};


/**
 * optional uint64 source_retention_ms = 5;
 * @return {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.prototype.getSourceRetentionMs = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 5, 0));
};


/**
 * @param {number} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.prototype.setSourceRetentionMs = function(value) {
  return jspb.Message.setProto3IntField(this, 5, value);
};


/**
 * optional uint64 max_event_bytes = 6;
 * @return {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.prototype.getMaxEventBytes = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 6, 0));
};


/**
 * @param {number} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.prototype.setMaxEventBytes = function(value) {
  return jspb.Message.setProto3IntField(this, 6, value);
};


/**
 * optional uint32 max_payload_depth = 7;
 * @return {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.prototype.getMaxPayloadDepth = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 7, 0));
};


/**
 * @param {number} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.prototype.setMaxPayloadDepth = function(value) {
  return jspb.Message.setProto3IntField(this, 7, value);
};


/**
 * optional uint32 max_payload_nodes = 8;
 * @return {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.prototype.getMaxPayloadNodes = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 8, 0));
};


/**
 * @param {number} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.prototype.setMaxPayloadNodes = function(value) {
  return jspb.Message.setProto3IntField(this, 8, value);
};


/**
 * optional uint64 max_payload_string_bytes = 9;
 * @return {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.prototype.getMaxPayloadStringBytes = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 9, 0));
};


/**
 * @param {number} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.BusinessEventSourceCapability.prototype.setMaxPayloadStringBytes = function(value) {
  return jspb.Message.setProto3IntField(this, 9, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    metadata: (f = msg.getMetadata()) && proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.toObject(includeInstance, f),
    sourceId: jspb.Message.getFieldWithDefault(msg, 2, ""),
    sourceStreamId: jspb.Message.getFieldWithDefault(msg, 3, ""),
    afterSourceSequence: jspb.Message.getFieldWithDefault(msg, 4, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest;
  return proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.deserializeBinaryFromReader);
      msg.setMetadata(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setSourceId(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setSourceStreamId(value);
      break;
    case 4:
      var value = /** @type {number} */ (reader.readUint64());
      msg.setAfterSourceSequence(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getMetadata();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.serializeBinaryToWriter
    );
  }
  f = message.getSourceId();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getSourceStreamId();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = /** @type {number} */ (jspb.Message.getField(message, 4));
  if (f != null) {
    writer.writeUint64(
      4,
      f
    );
  }
};


/**
 * optional RequestMetadata metadata = 1;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest.prototype.getMetadata = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata, 1));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest.prototype.setMetadata = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest.prototype.clearMetadata = function() {
  return this.setMetadata(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest.prototype.hasMetadata = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional string source_id = 2;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest.prototype.getSourceId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest.prototype.setSourceId = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string source_stream_id = 3;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest.prototype.getSourceStreamId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest.prototype.setSourceStreamId = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional uint64 after_source_sequence = 4;
 * @return {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest.prototype.getAfterSourceSequence = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 4, 0));
};


/**
 * @param {number} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest.prototype.setAfterSourceSequence = function(value) {
  return jspb.Message.setField(this, 4, value);
};


/**
 * Clears the field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest.prototype.clearAfterSourceSequence = function() {
  return jspb.Message.setField(this, 4, undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamBusinessEventsRequest.prototype.hasAfterSourceSequence = function() {
  return jspb.Message.getField(this, 4) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.toObject = function(includeInstance, msg) {
  var f, obj = {
    sourceEventId: jspb.Message.getFieldWithDefault(msg, 1, ""),
    sourceSequence: jspb.Message.getFieldWithDefault(msg, 2, 0),
    sourceStreamId: jspb.Message.getFieldWithDefault(msg, 3, ""),
    scope: jspb.Message.getFieldWithDefault(msg, 4, ""),
    occurredAt: (f = msg.getOccurredAt()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f),
    eventType: jspb.Message.getFieldWithDefault(msg, 6, ""),
    description: jspb.Message.getFieldWithDefault(msg, 7, ""),
    externalExecutionId: jspb.Message.getFieldWithDefault(msg, 8, ""),
    resourceRef: jspb.Message.getFieldWithDefault(msg, 9, ""),
    severityHint: jspb.Message.getFieldWithDefault(msg, 10, ""),
    reasonCode: jspb.Message.getFieldWithDefault(msg, 11, ""),
    rawPayload: (f = msg.getRawPayload()) && google_protobuf_struct_pb.Struct.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent;
  return proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setSourceEventId(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readUint64());
      msg.setSourceSequence(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setSourceStreamId(value);
      break;
    case 4:
      var value = /** @type {string} */ (reader.readString());
      msg.setScope(value);
      break;
    case 5:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setOccurredAt(value);
      break;
    case 6:
      var value = /** @type {string} */ (reader.readString());
      msg.setEventType(value);
      break;
    case 7:
      var value = /** @type {string} */ (reader.readString());
      msg.setDescription(value);
      break;
    case 8:
      var value = /** @type {string} */ (reader.readString());
      msg.setExternalExecutionId(value);
      break;
    case 9:
      var value = /** @type {string} */ (reader.readString());
      msg.setResourceRef(value);
      break;
    case 10:
      var value = /** @type {string} */ (reader.readString());
      msg.setSeverityHint(value);
      break;
    case 11:
      var value = /** @type {string} */ (reader.readString());
      msg.setReasonCode(value);
      break;
    case 12:
      var value = new google_protobuf_struct_pb.Struct;
      reader.readMessage(value,google_protobuf_struct_pb.Struct.deserializeBinaryFromReader);
      msg.setRawPayload(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSourceEventId();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getSourceSequence();
  if (f !== 0) {
    writer.writeUint64(
      2,
      f
    );
  }
  f = message.getSourceStreamId();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getScope();
  if (f.length > 0) {
    writer.writeString(
      4,
      f
    );
  }
  f = message.getOccurredAt();
  if (f != null) {
    writer.writeMessage(
      5,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
  f = message.getEventType();
  if (f.length > 0) {
    writer.writeString(
      6,
      f
    );
  }
  f = message.getDescription();
  if (f.length > 0) {
    writer.writeString(
      7,
      f
    );
  }
  f = /** @type {string} */ (jspb.Message.getField(message, 8));
  if (f != null) {
    writer.writeString(
      8,
      f
    );
  }
  f = /** @type {string} */ (jspb.Message.getField(message, 9));
  if (f != null) {
    writer.writeString(
      9,
      f
    );
  }
  f = message.getSeverityHint();
  if (f.length > 0) {
    writer.writeString(
      10,
      f
    );
  }
  f = message.getReasonCode();
  if (f.length > 0) {
    writer.writeString(
      11,
      f
    );
  }
  f = message.getRawPayload();
  if (f != null) {
    writer.writeMessage(
      12,
      f,
      google_protobuf_struct_pb.Struct.serializeBinaryToWriter
    );
  }
};


/**
 * optional string source_event_id = 1;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.getSourceEventId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.setSourceEventId = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional uint64 source_sequence = 2;
 * @return {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.getSourceSequence = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.setSourceSequence = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};


/**
 * optional string source_stream_id = 3;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.getSourceStreamId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.setSourceStreamId = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional string scope = 4;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.getScope = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 4, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.setScope = function(value) {
  return jspb.Message.setProto3StringField(this, 4, value);
};


/**
 * optional google.protobuf.Timestamp occurred_at = 5;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.getOccurredAt = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 5));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.setOccurredAt = function(value) {
  return jspb.Message.setWrapperField(this, 5, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.clearOccurredAt = function() {
  return this.setOccurredAt(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.hasOccurredAt = function() {
  return jspb.Message.getField(this, 5) != null;
};


/**
 * optional string event_type = 6;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.getEventType = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 6, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.setEventType = function(value) {
  return jspb.Message.setProto3StringField(this, 6, value);
};


/**
 * optional string description = 7;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.getDescription = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 7, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.setDescription = function(value) {
  return jspb.Message.setProto3StringField(this, 7, value);
};


/**
 * optional string external_execution_id = 8;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.getExternalExecutionId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 8, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.setExternalExecutionId = function(value) {
  return jspb.Message.setField(this, 8, value);
};


/**
 * Clears the field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.clearExternalExecutionId = function() {
  return jspb.Message.setField(this, 8, undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.hasExternalExecutionId = function() {
  return jspb.Message.getField(this, 8) != null;
};


/**
 * optional string resource_ref = 9;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.getResourceRef = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 9, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.setResourceRef = function(value) {
  return jspb.Message.setField(this, 9, value);
};


/**
 * Clears the field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.clearResourceRef = function() {
  return jspb.Message.setField(this, 9, undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.hasResourceRef = function() {
  return jspb.Message.getField(this, 9) != null;
};


/**
 * optional string severity_hint = 10;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.getSeverityHint = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 10, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.setSeverityHint = function(value) {
  return jspb.Message.setProto3StringField(this, 10, value);
};


/**
 * optional string reason_code = 11;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.getReasonCode = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 11, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.setReasonCode = function(value) {
  return jspb.Message.setProto3StringField(this, 11, value);
};


/**
 * optional google.protobuf.Struct raw_payload = 12;
 * @return {?proto.google.protobuf.Struct}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.getRawPayload = function() {
  return /** @type{?proto.google.protobuf.Struct} */ (
    jspb.Message.getWrapperField(this, google_protobuf_struct_pb.Struct, 12));
};


/**
 * @param {?proto.google.protobuf.Struct|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.setRawPayload = function(value) {
  return jspb.Message.setWrapperField(this, 12, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.clearRawPayload = function() {
  return this.setRawPayload(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterBusinessEvent.prototype.hasRawPayload = function() {
  return jspb.Message.getField(this, 12) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.TaskStart} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.toObject = function(includeInstance, msg) {
  var f, obj = {
    mode: jspb.Message.getFieldWithDefault(msg, 1, 0),
    scheduledAt: (f = msg.getScheduledAt()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f),
    startToleranceMs: jspb.Message.getFieldWithDefault(msg, 3, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.TaskStart}
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.TaskStart;
  return proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.TaskStart} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.TaskStart}
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {!proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.Mode} */ (reader.readEnum());
      msg.setMode(value);
      break;
    case 2:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setScheduledAt(value);
      break;
    case 3:
      var value = /** @type {number} */ (reader.readUint64());
      msg.setStartToleranceMs(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.TaskStart} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getMode();
  if (f !== 0.0) {
    writer.writeEnum(
      1,
      f
    );
  }
  f = message.getScheduledAt();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
  f = message.getStartToleranceMs();
  if (f !== 0) {
    writer.writeUint64(
      3,
      f
    );
  }
};


/**
 * @enum {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.Mode = {
  MODE_UNSPECIFIED: 0,
  IMMEDIATE: 1,
  SCHEDULED: 2
};

/**
 * optional Mode mode = 1;
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.Mode}
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.prototype.getMode = function() {
  return /** @type {!proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.Mode} */ (jspb.Message.getFieldWithDefault(this, 1, 0));
};


/**
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.Mode} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.TaskStart} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.prototype.setMode = function(value) {
  return jspb.Message.setProto3EnumField(this, 1, value);
};


/**
 * optional google.protobuf.Timestamp scheduled_at = 2;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.prototype.getScheduledAt = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 2));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.TaskStart} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.prototype.setScheduledAt = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.TaskStart} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.prototype.clearScheduledAt = function() {
  return this.setScheduledAt(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.prototype.hasScheduledAt = function() {
  return jspb.Message.getField(this, 2) != null;
};


/**
 * optional uint64 start_tolerance_ms = 3;
 * @return {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.prototype.getStartToleranceMs = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 3, 0));
};


/**
 * @param {number} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.TaskStart} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.prototype.setStartToleranceMs = function(value) {
  return jspb.Message.setProto3IntField(this, 3, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming.toObject = function(includeInstance, msg) {
  var f, obj = {
    start: (f = msg.getStart()) && proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.toObject(includeInstance, f),
    maxElapsedMs: jspb.Message.getFieldWithDefault(msg, 2, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming}
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming;
  return proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming}
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.TaskStart;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.deserializeBinaryFromReader);
      msg.setStart(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readUint64());
      msg.setMaxElapsedMs(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getStart();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.TaskStart.serializeBinaryToWriter
    );
  }
  f = /** @type {number} */ (jspb.Message.getField(message, 2));
  if (f != null) {
    writer.writeUint64(
      2,
      f
    );
  }
};


/**
 * optional TaskStart start = 1;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.TaskStart}
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming.prototype.getStart = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.TaskStart} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.TaskStart, 1));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.TaskStart|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming.prototype.setStart = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming.prototype.clearStart = function() {
  return this.setStart(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming.prototype.hasStart = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional uint64 max_elapsed_ms = 2;
 * @return {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming.prototype.getMaxElapsedMs = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming.prototype.setMaxElapsedMs = function(value) {
  return jspb.Message.setField(this, 2, value);
};


/**
 * Clears the field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming.prototype.clearMaxElapsedMs = function() {
  return jspb.Message.setField(this, 2, undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming.prototype.hasMaxElapsedMs = function() {
  return jspb.Message.getField(this, 2) != null;
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments.repeatedFields_ = [2];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments.toObject = function(includeInstance, msg) {
  var f, obj = {
    knownArguments: (f = msg.getKnownArguments()) && google_protobuf_struct_pb.Struct.toObject(includeInstance, f),
    unresolvedPathsList: (f = jspb.Message.getRepeatedField(msg, 2)) == null ? undefined : f
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments;
  return proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new google_protobuf_struct_pb.Struct;
      reader.readMessage(value,google_protobuf_struct_pb.Struct.deserializeBinaryFromReader);
      msg.setKnownArguments(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.addUnresolvedPaths(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getKnownArguments();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      google_protobuf_struct_pb.Struct.serializeBinaryToWriter
    );
  }
  f = message.getUnresolvedPathsList();
  if (f.length > 0) {
    writer.writeRepeatedString(
      2,
      f
    );
  }
};


/**
 * optional google.protobuf.Struct known_arguments = 1;
 * @return {?proto.google.protobuf.Struct}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments.prototype.getKnownArguments = function() {
  return /** @type{?proto.google.protobuf.Struct} */ (
    jspb.Message.getWrapperField(this, google_protobuf_struct_pb.Struct, 1));
};


/**
 * @param {?proto.google.protobuf.Struct|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments.prototype.setKnownArguments = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments.prototype.clearKnownArguments = function() {
  return this.setKnownArguments(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments.prototype.hasKnownArguments = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * repeated string unresolved_paths = 2;
 * @return {!Array<string>}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments.prototype.getUnresolvedPathsList = function() {
  return /** @type {!Array<string>} */ (jspb.Message.getRepeatedField(this, 2));
};


/**
 * @param {!Array<string>} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments.prototype.setUnresolvedPathsList = function(value) {
  return jspb.Message.setField(this, 2, value || []);
};


/**
 * @param {string} value
 * @param {number=} opt_index
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments.prototype.addUnresolvedPaths = function(value, opt_index) {
  return jspb.Message.addToRepeatedField(this, 2, value, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments.prototype.clearUnresolvedPathsList = function() {
  return this.setUnresolvedPathsList([]);
};



/**
 * Oneof group definitions for this message. Each group defines the field
 * numbers belonging to that group. When of these fields' value is set, all
 * other fields in the group are cleared. During deserialization, if multiple
 * fields are encountered for a group, only the last value seen will be kept.
 * @private {!Array<!Array<number>>}
 * @const
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.oneofGroups_ = [[3,4]];

/**
 * @enum {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.ArgumentsValueCase = {
  ARGUMENTS_VALUE_NOT_SET: 0,
  ARGUMENTS: 3,
  UNRESOLVED_ARGUMENTS: 4
};

/**
 * @return {proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.ArgumentsValueCase}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.prototype.getArgumentsValueCase = function() {
  return /** @type {proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.ArgumentsValueCase} */(jspb.Message.computeOneofCase(this, proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.oneofGroups_[0]));
};



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.toObject = function(includeInstance, msg) {
  var f, obj = {
    requestId: jspb.Message.getFieldWithDefault(msg, 1, ""),
    operationName: jspb.Message.getFieldWithDefault(msg, 2, ""),
    arguments: (f = msg.getArguments()) && google_protobuf_struct_pb.Struct.toObject(includeInstance, f),
    unresolvedArguments: (f = msg.getUnresolvedArguments()) && proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments.toObject(includeInstance, f),
    timing: (f = msg.getTiming()) && proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck;
  return proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setRequestId(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setOperationName(value);
      break;
    case 3:
      var value = new google_protobuf_struct_pb.Struct;
      reader.readMessage(value,google_protobuf_struct_pb.Struct.deserializeBinaryFromReader);
      msg.setArguments(value);
      break;
    case 4:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments.deserializeBinaryFromReader);
      msg.setUnresolvedArguments(value);
      break;
    case 5:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming.deserializeBinaryFromReader);
      msg.setTiming(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getRequestId();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getOperationName();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getArguments();
  if (f != null) {
    writer.writeMessage(
      3,
      f,
      google_protobuf_struct_pb.Struct.serializeBinaryToWriter
    );
  }
  f = message.getUnresolvedArguments();
  if (f != null) {
    writer.writeMessage(
      4,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments.serializeBinaryToWriter
    );
  }
  f = message.getTiming();
  if (f != null) {
    writer.writeMessage(
      5,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming.serializeBinaryToWriter
    );
  }
};


/**
 * optional string request_id = 1;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.prototype.getRequestId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.prototype.setRequestId = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string operation_name = 2;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.prototype.getOperationName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.prototype.setOperationName = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional google.protobuf.Struct arguments = 3;
 * @return {?proto.google.protobuf.Struct}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.prototype.getArguments = function() {
  return /** @type{?proto.google.protobuf.Struct} */ (
    jspb.Message.getWrapperField(this, google_protobuf_struct_pb.Struct, 3));
};


/**
 * @param {?proto.google.protobuf.Struct|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.prototype.setArguments = function(value) {
  return jspb.Message.setOneofWrapperField(this, 3, proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.oneofGroups_[0], value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.prototype.clearArguments = function() {
  return this.setArguments(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.prototype.hasArguments = function() {
  return jspb.Message.getField(this, 3) != null;
};


/**
 * optional UnresolvedArguments unresolved_arguments = 4;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.prototype.getUnresolvedArguments = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments, 4));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.UnresolvedArguments|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.prototype.setUnresolvedArguments = function(value) {
  return jspb.Message.setOneofWrapperField(this, 4, proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.oneofGroups_[0], value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.prototype.clearUnresolvedArguments = function() {
  return this.setUnresolvedArguments(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.prototype.hasUnresolvedArguments = function() {
  return jspb.Message.getField(this, 4) != null;
};


/**
 * optional TaskTiming timing = 5;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.prototype.getTiming = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming, 5));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.prototype.setTiming = function(value) {
  return jspb.Message.setWrapperField(this, 5, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.prototype.clearTiming = function() {
  return this.setTiming(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.prototype.hasTiming = function() {
  return jspb.Message.getField(this, 5) != null;
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest.repeatedFields_ = [3];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    metadata: (f = msg.getMetadata()) && proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.toObject(includeInstance, f),
    executionContext: (f = msg.getExecutionContext()) && proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.toObject(includeInstance, f),
    checksList: jspb.Message.toObjectList(msg.getChecksList(),
    proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest;
  return proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.deserializeBinaryFromReader);
      msg.setMetadata(value);
      break;
    case 2:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.deserializeBinaryFromReader);
      msg.setExecutionContext(value);
      break;
    case 3:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.deserializeBinaryFromReader);
      msg.addChecks(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getMetadata();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.serializeBinaryToWriter
    );
  }
  f = message.getExecutionContext();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.serializeBinaryToWriter
    );
  }
  f = message.getChecksList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      3,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck.serializeBinaryToWriter
    );
  }
};


/**
 * optional RequestMetadata metadata = 1;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest.prototype.getMetadata = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata, 1));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest.prototype.setMetadata = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest.prototype.clearMetadata = function() {
  return this.setMetadata(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest.prototype.hasMetadata = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional ExecutionContext execution_context = 2;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest.prototype.getExecutionContext = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext, 2));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest.prototype.setExecutionContext = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest.prototype.clearExecutionContext = function() {
  return this.setExecutionContext(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest.prototype.hasExecutionContext = function() {
  return jspb.Message.getField(this, 2) != null;
};


/**
 * repeated AvailabilityCheck checks = 3;
 * @return {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck>}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest.prototype.getChecksList = function() {
  return /** @type{!Array<!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck, 3));
};


/**
 * @param {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck>} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest.prototype.setChecksList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 3, value);
};


/**
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck=} opt_value
 * @param {number=} opt_index
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest.prototype.addChecks = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 3, opt_value, proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityCheck, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityRequest.prototype.clearChecksList = function() {
  return this.setChecksList([]);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow.toObject = function(includeInstance, msg) {
  var f, obj = {
    startTime: (f = msg.getStartTime()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f),
    endTime: (f = msg.getEndTime()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow;
  return proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setStartTime(value);
      break;
    case 2:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setEndTime(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getStartTime();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
  f = message.getEndTime();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
};


/**
 * optional google.protobuf.Timestamp start_time = 1;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow.prototype.getStartTime = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 1));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow.prototype.setStartTime = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow.prototype.clearStartTime = function() {
  return this.setStartTime(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow.prototype.hasStartTime = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional google.protobuf.Timestamp end_time = 2;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow.prototype.getEndTime = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 2));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow.prototype.setEndTime = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow.prototype.clearEndTime = function() {
  return this.setEndTime(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow.prototype.hasEndTime = function() {
  return jspb.Message.getField(this, 2) != null;
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.repeatedFields_ = [9,11];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.toObject = function(includeInstance, msg) {
  var f, obj = {
    requestId: jspb.Message.getFieldWithDefault(msg, 1, ""),
    operationName: jspb.Message.getFieldWithDefault(msg, 2, ""),
    availability: jspb.Message.getFieldWithDefault(msg, 3, 0),
    riskLevel: jspb.Message.getFieldWithDefault(msg, 4, 0),
    reasonCode: jspb.Message.getFieldWithDefault(msg, 5, ""),
    description: jspb.Message.getFieldWithDefault(msg, 6, ""),
    validUntil: (f = msg.getValidUntil()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f),
    earliestStartTime: (f = msg.getEarliestStartTime()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f),
    nextAvailableWindowsList: jspb.Message.toObjectList(msg.getNextAvailableWindowsList(),
    proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow.toObject, includeInstance),
    estimatedDelayMs: jspb.Message.getFieldWithDefault(msg, 10, 0),
    possibleEffectsList: (f = jspb.Message.getRepeatedField(msg, 11)) == null ? undefined : f,
    reservationMode: jspb.Message.getFieldWithDefault(msg, 12, 0),
    reservationRef: jspb.Message.getFieldWithDefault(msg, 13, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult;
  return proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setRequestId(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setOperationName(value);
      break;
    case 3:
      var value = /** @type {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityState} */ (reader.readEnum());
      msg.setAvailability(value);
      break;
    case 4:
      var value = /** @type {!proto.io.sdar.mcp.tasks.adapter.v1.RiskLevel} */ (reader.readEnum());
      msg.setRiskLevel(value);
      break;
    case 5:
      var value = /** @type {string} */ (reader.readString());
      msg.setReasonCode(value);
      break;
    case 6:
      var value = /** @type {string} */ (reader.readString());
      msg.setDescription(value);
      break;
    case 7:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setValidUntil(value);
      break;
    case 8:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setEarliestStartTime(value);
      break;
    case 9:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow.deserializeBinaryFromReader);
      msg.addNextAvailableWindows(value);
      break;
    case 10:
      var value = /** @type {number} */ (reader.readUint64());
      msg.setEstimatedDelayMs(value);
      break;
    case 11:
      var value = /** @type {string} */ (reader.readString());
      msg.addPossibleEffects(value);
      break;
    case 12:
      var value = /** @type {!proto.io.sdar.mcp.tasks.adapter.v1.ReservationMode} */ (reader.readEnum());
      msg.setReservationMode(value);
      break;
    case 13:
      var value = /** @type {string} */ (reader.readString());
      msg.setReservationRef(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getRequestId();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getOperationName();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getAvailability();
  if (f !== 0.0) {
    writer.writeEnum(
      3,
      f
    );
  }
  f = message.getRiskLevel();
  if (f !== 0.0) {
    writer.writeEnum(
      4,
      f
    );
  }
  f = message.getReasonCode();
  if (f.length > 0) {
    writer.writeString(
      5,
      f
    );
  }
  f = message.getDescription();
  if (f.length > 0) {
    writer.writeString(
      6,
      f
    );
  }
  f = message.getValidUntil();
  if (f != null) {
    writer.writeMessage(
      7,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
  f = message.getEarliestStartTime();
  if (f != null) {
    writer.writeMessage(
      8,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
  f = message.getNextAvailableWindowsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      9,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow.serializeBinaryToWriter
    );
  }
  f = message.getEstimatedDelayMs();
  if (f !== 0) {
    writer.writeUint64(
      10,
      f
    );
  }
  f = message.getPossibleEffectsList();
  if (f.length > 0) {
    writer.writeRepeatedString(
      11,
      f
    );
  }
  f = message.getReservationMode();
  if (f !== 0.0) {
    writer.writeEnum(
      12,
      f
    );
  }
  f = /** @type {string} */ (jspb.Message.getField(message, 13));
  if (f != null) {
    writer.writeString(
      13,
      f
    );
  }
};


/**
 * optional string request_id = 1;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.getRequestId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.setRequestId = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string operation_name = 2;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.getOperationName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.setOperationName = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional AvailabilityState availability = 3;
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityState}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.getAvailability = function() {
  return /** @type {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityState} */ (jspb.Message.getFieldWithDefault(this, 3, 0));
};


/**
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityState} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.setAvailability = function(value) {
  return jspb.Message.setProto3EnumField(this, 3, value);
};


/**
 * optional RiskLevel risk_level = 4;
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.RiskLevel}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.getRiskLevel = function() {
  return /** @type {!proto.io.sdar.mcp.tasks.adapter.v1.RiskLevel} */ (jspb.Message.getFieldWithDefault(this, 4, 0));
};


/**
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.RiskLevel} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.setRiskLevel = function(value) {
  return jspb.Message.setProto3EnumField(this, 4, value);
};


/**
 * optional string reason_code = 5;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.getReasonCode = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 5, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.setReasonCode = function(value) {
  return jspb.Message.setProto3StringField(this, 5, value);
};


/**
 * optional string description = 6;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.getDescription = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 6, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.setDescription = function(value) {
  return jspb.Message.setProto3StringField(this, 6, value);
};


/**
 * optional google.protobuf.Timestamp valid_until = 7;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.getValidUntil = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 7));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.setValidUntil = function(value) {
  return jspb.Message.setWrapperField(this, 7, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.clearValidUntil = function() {
  return this.setValidUntil(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.hasValidUntil = function() {
  return jspb.Message.getField(this, 7) != null;
};


/**
 * optional google.protobuf.Timestamp earliest_start_time = 8;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.getEarliestStartTime = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 8));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.setEarliestStartTime = function(value) {
  return jspb.Message.setWrapperField(this, 8, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.clearEarliestStartTime = function() {
  return this.setEarliestStartTime(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.hasEarliestStartTime = function() {
  return jspb.Message.getField(this, 8) != null;
};


/**
 * repeated AvailableWindow next_available_windows = 9;
 * @return {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow>}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.getNextAvailableWindowsList = function() {
  return /** @type{!Array<!proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow, 9));
};


/**
 * @param {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow>} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.setNextAvailableWindowsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 9, value);
};


/**
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow=} opt_value
 * @param {number=} opt_index
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.addNextAvailableWindows = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 9, opt_value, proto.io.sdar.mcp.tasks.adapter.v1.AvailableWindow, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.clearNextAvailableWindowsList = function() {
  return this.setNextAvailableWindowsList([]);
};


/**
 * optional uint64 estimated_delay_ms = 10;
 * @return {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.getEstimatedDelayMs = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 10, 0));
};


/**
 * @param {number} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.setEstimatedDelayMs = function(value) {
  return jspb.Message.setProto3IntField(this, 10, value);
};


/**
 * repeated string possible_effects = 11;
 * @return {!Array<string>}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.getPossibleEffectsList = function() {
  return /** @type {!Array<string>} */ (jspb.Message.getRepeatedField(this, 11));
};


/**
 * @param {!Array<string>} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.setPossibleEffectsList = function(value) {
  return jspb.Message.setField(this, 11, value || []);
};


/**
 * @param {string} value
 * @param {number=} opt_index
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.addPossibleEffects = function(value, opt_index) {
  return jspb.Message.addToRepeatedField(this, 11, value, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.clearPossibleEffectsList = function() {
  return this.setPossibleEffectsList([]);
};


/**
 * optional ReservationMode reservation_mode = 12;
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ReservationMode}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.getReservationMode = function() {
  return /** @type {!proto.io.sdar.mcp.tasks.adapter.v1.ReservationMode} */ (jspb.Message.getFieldWithDefault(this, 12, 0));
};


/**
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ReservationMode} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.setReservationMode = function(value) {
  return jspb.Message.setProto3EnumField(this, 12, value);
};


/**
 * optional string reservation_ref = 13;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.getReservationRef = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 13, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.setReservationRef = function(value) {
  return jspb.Message.setField(this, 13, value);
};


/**
 * Clears the field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.clearReservationRef = function() {
  return jspb.Message.setField(this, 13, undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.prototype.hasReservationRef = function() {
  return jspb.Message.getField(this, 13) != null;
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse.repeatedFields_ = [3];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
    profileVersion: jspb.Message.getFieldWithDefault(msg, 1, ""),
    checkedAt: (f = msg.getCheckedAt()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f),
    checksList: jspb.Message.toObjectList(msg.getChecksList(),
    proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse;
  return proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setProfileVersion(value);
      break;
    case 2:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setCheckedAt(value);
      break;
    case 3:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.deserializeBinaryFromReader);
      msg.addChecks(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getProfileVersion();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getCheckedAt();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
  f = message.getChecksList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      3,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult.serializeBinaryToWriter
    );
  }
};


/**
 * optional string profile_version = 1;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse.prototype.getProfileVersion = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse.prototype.setProfileVersion = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional google.protobuf.Timestamp checked_at = 2;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse.prototype.getCheckedAt = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 2));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse.prototype.setCheckedAt = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse.prototype.clearCheckedAt = function() {
  return this.setCheckedAt(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse.prototype.hasCheckedAt = function() {
  return jspb.Message.getField(this, 2) != null;
};


/**
 * repeated AvailabilityResult checks = 3;
 * @return {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult>}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse.prototype.getChecksList = function() {
  return /** @type{!Array<!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult, 3));
};


/**
 * @param {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult>} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse.prototype.setChecksList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 3, value);
};


/**
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult=} opt_value
 * @param {number=} opt_index
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse.prototype.addChecks = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 3, opt_value, proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityResult, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.CheckAvailabilityResponse.prototype.clearChecksList = function() {
  return this.setChecksList([]);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    metadata: (f = msg.getMetadata()) && proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.toObject(includeInstance, f),
    taskId: jspb.Message.getFieldWithDefault(msg, 2, ""),
    operationName: jspb.Message.getFieldWithDefault(msg, 3, ""),
    arguments: (f = msg.getArguments()) && google_protobuf_struct_pb.Struct.toObject(includeInstance, f),
    timing: (f = msg.getTiming()) && proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming.toObject(includeInstance, f),
    executionContext: (f = msg.getExecutionContext()) && proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.toObject(includeInstance, f),
    argumentHash: jspb.Message.getFieldWithDefault(msg, 7, ""),
    invocationAttempt: jspb.Message.getFieldWithDefault(msg, 8, 0),
    reservationRef: jspb.Message.getFieldWithDefault(msg, 9, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest;
  return proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.deserializeBinaryFromReader);
      msg.setMetadata(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setTaskId(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setOperationName(value);
      break;
    case 4:
      var value = new google_protobuf_struct_pb.Struct;
      reader.readMessage(value,google_protobuf_struct_pb.Struct.deserializeBinaryFromReader);
      msg.setArguments(value);
      break;
    case 5:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming.deserializeBinaryFromReader);
      msg.setTiming(value);
      break;
    case 6:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.deserializeBinaryFromReader);
      msg.setExecutionContext(value);
      break;
    case 7:
      var value = /** @type {string} */ (reader.readString());
      msg.setArgumentHash(value);
      break;
    case 8:
      var value = /** @type {number} */ (reader.readUint32());
      msg.setInvocationAttempt(value);
      break;
    case 9:
      var value = /** @type {string} */ (reader.readString());
      msg.setReservationRef(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getMetadata();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.serializeBinaryToWriter
    );
  }
  f = message.getTaskId();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getOperationName();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getArguments();
  if (f != null) {
    writer.writeMessage(
      4,
      f,
      google_protobuf_struct_pb.Struct.serializeBinaryToWriter
    );
  }
  f = message.getTiming();
  if (f != null) {
    writer.writeMessage(
      5,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming.serializeBinaryToWriter
    );
  }
  f = message.getExecutionContext();
  if (f != null) {
    writer.writeMessage(
      6,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.serializeBinaryToWriter
    );
  }
  f = message.getArgumentHash();
  if (f.length > 0) {
    writer.writeString(
      7,
      f
    );
  }
  f = message.getInvocationAttempt();
  if (f !== 0) {
    writer.writeUint32(
      8,
      f
    );
  }
  f = /** @type {string} */ (jspb.Message.getField(message, 9));
  if (f != null) {
    writer.writeString(
      9,
      f
    );
  }
};


/**
 * optional RequestMetadata metadata = 1;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.getMetadata = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata, 1));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.setMetadata = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.clearMetadata = function() {
  return this.setMetadata(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.hasMetadata = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional string task_id = 2;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.getTaskId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.setTaskId = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string operation_name = 3;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.getOperationName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.setOperationName = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional google.protobuf.Struct arguments = 4;
 * @return {?proto.google.protobuf.Struct}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.getArguments = function() {
  return /** @type{?proto.google.protobuf.Struct} */ (
    jspb.Message.getWrapperField(this, google_protobuf_struct_pb.Struct, 4));
};


/**
 * @param {?proto.google.protobuf.Struct|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.setArguments = function(value) {
  return jspb.Message.setWrapperField(this, 4, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.clearArguments = function() {
  return this.setArguments(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.hasArguments = function() {
  return jspb.Message.getField(this, 4) != null;
};


/**
 * optional TaskTiming timing = 5;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.getTiming = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming, 5));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.TaskTiming|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.setTiming = function(value) {
  return jspb.Message.setWrapperField(this, 5, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.clearTiming = function() {
  return this.setTiming(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.hasTiming = function() {
  return jspb.Message.getField(this, 5) != null;
};


/**
 * optional ExecutionContext execution_context = 6;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.getExecutionContext = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext, 6));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.setExecutionContext = function(value) {
  return jspb.Message.setWrapperField(this, 6, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.clearExecutionContext = function() {
  return this.setExecutionContext(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.hasExecutionContext = function() {
  return jspb.Message.getField(this, 6) != null;
};


/**
 * optional string argument_hash = 7;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.getArgumentHash = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 7, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.setArgumentHash = function(value) {
  return jspb.Message.setProto3StringField(this, 7, value);
};


/**
 * optional uint32 invocation_attempt = 8;
 * @return {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.getInvocationAttempt = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 8, 0));
};


/**
 * @param {number} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.setInvocationAttempt = function(value) {
  return jspb.Message.setProto3IntField(this, 8, value);
};


/**
 * optional string reservation_ref = 9;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.getReservationRef = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 9, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.setReservationRef = function(value) {
  return jspb.Message.setField(this, 9, value);
};


/**
 * Clears the field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.clearReservationRef = function() {
  return jspb.Message.setField(this, 9, undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationRequest.prototype.hasReservationRef = function() {
  return jspb.Message.getField(this, 9) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.Alternative.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.Alternative.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.Alternative} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.Alternative.toObject = function(includeInstance, msg) {
  var f, obj = {
    suggestedStartTime: (f = msg.getSuggestedStartTime()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f),
    operationName: jspb.Message.getFieldWithDefault(msg, 2, ""),
    arguments: (f = msg.getArguments()) && google_protobuf_struct_pb.Struct.toObject(includeInstance, f),
    description: jspb.Message.getFieldWithDefault(msg, 4, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.Alternative}
 */
proto.io.sdar.mcp.tasks.adapter.v1.Alternative.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.Alternative;
  return proto.io.sdar.mcp.tasks.adapter.v1.Alternative.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.Alternative} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.Alternative}
 */
proto.io.sdar.mcp.tasks.adapter.v1.Alternative.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setSuggestedStartTime(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setOperationName(value);
      break;
    case 3:
      var value = new google_protobuf_struct_pb.Struct;
      reader.readMessage(value,google_protobuf_struct_pb.Struct.deserializeBinaryFromReader);
      msg.setArguments(value);
      break;
    case 4:
      var value = /** @type {string} */ (reader.readString());
      msg.setDescription(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.Alternative.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.Alternative.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.Alternative} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.Alternative.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getSuggestedStartTime();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
  f = message.getOperationName();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getArguments();
  if (f != null) {
    writer.writeMessage(
      3,
      f,
      google_protobuf_struct_pb.Struct.serializeBinaryToWriter
    );
  }
  f = message.getDescription();
  if (f.length > 0) {
    writer.writeString(
      4,
      f
    );
  }
};


/**
 * optional google.protobuf.Timestamp suggested_start_time = 1;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.io.sdar.mcp.tasks.adapter.v1.Alternative.prototype.getSuggestedStartTime = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 1));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.Alternative} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.Alternative.prototype.setSuggestedStartTime = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.Alternative} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.Alternative.prototype.clearSuggestedStartTime = function() {
  return this.setSuggestedStartTime(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.Alternative.prototype.hasSuggestedStartTime = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional string operation_name = 2;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.Alternative.prototype.getOperationName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.Alternative} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.Alternative.prototype.setOperationName = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional google.protobuf.Struct arguments = 3;
 * @return {?proto.google.protobuf.Struct}
 */
proto.io.sdar.mcp.tasks.adapter.v1.Alternative.prototype.getArguments = function() {
  return /** @type{?proto.google.protobuf.Struct} */ (
    jspb.Message.getWrapperField(this, google_protobuf_struct_pb.Struct, 3));
};


/**
 * @param {?proto.google.protobuf.Struct|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.Alternative} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.Alternative.prototype.setArguments = function(value) {
  return jspb.Message.setWrapperField(this, 3, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.Alternative} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.Alternative.prototype.clearArguments = function() {
  return this.setArguments(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.Alternative.prototype.hasArguments = function() {
  return jspb.Message.getField(this, 3) != null;
};


/**
 * optional string description = 4;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.Alternative.prototype.getDescription = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 4, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.Alternative} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.Alternative.prototype.setDescription = function(value) {
  return jspb.Message.setProto3StringField(this, 4, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected.repeatedFields_ = [4];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected.toObject = function(includeInstance, msg) {
  var f, obj = {
    reasonCode: jspb.Message.getFieldWithDefault(msg, 1, ""),
    message: jspb.Message.getFieldWithDefault(msg, 2, ""),
    retryable: jspb.Message.getBooleanFieldWithDefault(msg, 3, false),
    alternativesList: jspb.Message.toObjectList(msg.getAlternativesList(),
    proto.io.sdar.mcp.tasks.adapter.v1.Alternative.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected;
  return proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setReasonCode(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setMessage(value);
      break;
    case 3:
      var value = /** @type {boolean} */ (reader.readBool());
      msg.setRetryable(value);
      break;
    case 4:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.Alternative;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.Alternative.deserializeBinaryFromReader);
      msg.addAlternatives(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getReasonCode();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getMessage();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getRetryable();
  if (f) {
    writer.writeBool(
      3,
      f
    );
  }
  f = message.getAlternativesList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      4,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.Alternative.serializeBinaryToWriter
    );
  }
};


/**
 * optional string reason_code = 1;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected.prototype.getReasonCode = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected.prototype.setReasonCode = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string message = 2;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected.prototype.getMessage = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected.prototype.setMessage = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional bool retryable = 3;
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected.prototype.getRetryable = function() {
  return /** @type {boolean} */ (jspb.Message.getBooleanFieldWithDefault(this, 3, false));
};


/**
 * @param {boolean} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected.prototype.setRetryable = function(value) {
  return jspb.Message.setProto3BooleanField(this, 3, value);
};


/**
 * repeated Alternative alternatives = 4;
 * @return {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.Alternative>}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected.prototype.getAlternativesList = function() {
  return /** @type{!Array<!proto.io.sdar.mcp.tasks.adapter.v1.Alternative>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.Alternative, 4));
};


/**
 * @param {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.Alternative>} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected.prototype.setAlternativesList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 4, value);
};


/**
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.Alternative=} opt_value
 * @param {number=} opt_index
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.Alternative}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected.prototype.addAlternatives = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 4, opt_value, proto.io.sdar.mcp.tasks.adapter.v1.Alternative, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected.prototype.clearAlternativesList = function() {
  return this.setAlternativesList([]);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.Progress.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.Progress.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.Progress} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.Progress.toObject = function(includeInstance, msg) {
  var f, obj = {
    current: jspb.Message.getFloatingPointFieldWithDefault(msg, 1, 0.0),
    total: jspb.Message.getFloatingPointFieldWithDefault(msg, 2, 0.0),
    unit: jspb.Message.getFieldWithDefault(msg, 3, ""),
    percentage: jspb.Message.getFloatingPointFieldWithDefault(msg, 4, 0.0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.Progress}
 */
proto.io.sdar.mcp.tasks.adapter.v1.Progress.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.Progress;
  return proto.io.sdar.mcp.tasks.adapter.v1.Progress.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.Progress} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.Progress}
 */
proto.io.sdar.mcp.tasks.adapter.v1.Progress.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {number} */ (reader.readDouble());
      msg.setCurrent(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readDouble());
      msg.setTotal(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setUnit(value);
      break;
    case 4:
      var value = /** @type {number} */ (reader.readDouble());
      msg.setPercentage(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.Progress.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.Progress.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.Progress} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.Progress.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = /** @type {number} */ (jspb.Message.getField(message, 1));
  if (f != null) {
    writer.writeDouble(
      1,
      f
    );
  }
  f = /** @type {number} */ (jspb.Message.getField(message, 2));
  if (f != null) {
    writer.writeDouble(
      2,
      f
    );
  }
  f = message.getUnit();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = /** @type {number} */ (jspb.Message.getField(message, 4));
  if (f != null) {
    writer.writeDouble(
      4,
      f
    );
  }
};


/**
 * optional double current = 1;
 * @return {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.Progress.prototype.getCurrent = function() {
  return /** @type {number} */ (jspb.Message.getFloatingPointFieldWithDefault(this, 1, 0.0));
};


/**
 * @param {number} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.Progress} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.Progress.prototype.setCurrent = function(value) {
  return jspb.Message.setField(this, 1, value);
};


/**
 * Clears the field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.Progress} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.Progress.prototype.clearCurrent = function() {
  return jspb.Message.setField(this, 1, undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.Progress.prototype.hasCurrent = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional double total = 2;
 * @return {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.Progress.prototype.getTotal = function() {
  return /** @type {number} */ (jspb.Message.getFloatingPointFieldWithDefault(this, 2, 0.0));
};


/**
 * @param {number} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.Progress} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.Progress.prototype.setTotal = function(value) {
  return jspb.Message.setField(this, 2, value);
};


/**
 * Clears the field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.Progress} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.Progress.prototype.clearTotal = function() {
  return jspb.Message.setField(this, 2, undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.Progress.prototype.hasTotal = function() {
  return jspb.Message.getField(this, 2) != null;
};


/**
 * optional string unit = 3;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.Progress.prototype.getUnit = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.Progress} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.Progress.prototype.setUnit = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional double percentage = 4;
 * @return {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.Progress.prototype.getPercentage = function() {
  return /** @type {number} */ (jspb.Message.getFloatingPointFieldWithDefault(this, 4, 0.0));
};


/**
 * @param {number} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.Progress} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.Progress.prototype.setPercentage = function(value) {
  return jspb.Message.setField(this, 4, value);
};


/**
 * Clears the field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.Progress} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.Progress.prototype.clearPercentage = function() {
  return jspb.Message.setField(this, 4, undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.Progress.prototype.hasPercentage = function() {
  return jspb.Message.getField(this, 4) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.InputRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.InputRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.InputRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.InputRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    key: jspb.Message.getFieldWithDefault(msg, 1, ""),
    description: jspb.Message.getFieldWithDefault(msg, 2, ""),
    inputSchema: (f = msg.getInputSchema()) && google_protobuf_struct_pb.Struct.toObject(includeInstance, f),
    required: jspb.Message.getBooleanFieldWithDefault(msg, 4, false)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.InputRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.InputRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.InputRequest;
  return proto.io.sdar.mcp.tasks.adapter.v1.InputRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.InputRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.InputRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.InputRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setKey(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setDescription(value);
      break;
    case 3:
      var value = new google_protobuf_struct_pb.Struct;
      reader.readMessage(value,google_protobuf_struct_pb.Struct.deserializeBinaryFromReader);
      msg.setInputSchema(value);
      break;
    case 4:
      var value = /** @type {boolean} */ (reader.readBool());
      msg.setRequired(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.InputRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.InputRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.InputRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.InputRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getKey();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getDescription();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getInputSchema();
  if (f != null) {
    writer.writeMessage(
      3,
      f,
      google_protobuf_struct_pb.Struct.serializeBinaryToWriter
    );
  }
  f = message.getRequired();
  if (f) {
    writer.writeBool(
      4,
      f
    );
  }
};


/**
 * optional string key = 1;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.InputRequest.prototype.getKey = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.InputRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.InputRequest.prototype.setKey = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string description = 2;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.InputRequest.prototype.getDescription = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.InputRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.InputRequest.prototype.setDescription = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional google.protobuf.Struct input_schema = 3;
 * @return {?proto.google.protobuf.Struct}
 */
proto.io.sdar.mcp.tasks.adapter.v1.InputRequest.prototype.getInputSchema = function() {
  return /** @type{?proto.google.protobuf.Struct} */ (
    jspb.Message.getWrapperField(this, google_protobuf_struct_pb.Struct, 3));
};


/**
 * @param {?proto.google.protobuf.Struct|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.InputRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.InputRequest.prototype.setInputSchema = function(value) {
  return jspb.Message.setWrapperField(this, 3, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.InputRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.InputRequest.prototype.clearInputSchema = function() {
  return this.setInputSchema(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.InputRequest.prototype.hasInputSchema = function() {
  return jspb.Message.getField(this, 3) != null;
};


/**
 * optional bool required = 4;
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.InputRequest.prototype.getRequired = function() {
  return /** @type {boolean} */ (jspb.Message.getBooleanFieldWithDefault(this, 4, false));
};


/**
 * @param {boolean} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.InputRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.InputRequest.prototype.setRequired = function(value) {
  return jspb.Message.setProto3BooleanField(this, 4, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    key: jspb.Message.getFieldWithDefault(msg, 1, ""),
    method: jspb.Message.getFieldWithDefault(msg, 2, ""),
    params: (f = msg.getParams()) && google_protobuf_struct_pb.Struct.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest;
  return proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setKey(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setMethod(value);
      break;
    case 3:
      var value = new google_protobuf_struct_pb.Struct;
      reader.readMessage(value,google_protobuf_struct_pb.Struct.deserializeBinaryFromReader);
      msg.setParams(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getKey();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getMethod();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getParams();
  if (f != null) {
    writer.writeMessage(
      3,
      f,
      google_protobuf_struct_pb.Struct.serializeBinaryToWriter
    );
  }
};


/**
 * optional string key = 1;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest.prototype.getKey = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest.prototype.setKey = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string method = 2;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest.prototype.getMethod = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest.prototype.setMethod = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional google.protobuf.Struct params = 3;
 * @return {?proto.google.protobuf.Struct}
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest.prototype.getParams = function() {
  return /** @type{?proto.google.protobuf.Struct} */ (
    jspb.Message.getWrapperField(this, google_protobuf_struct_pb.Struct, 3));
};


/**
 * @param {?proto.google.protobuf.Struct|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest.prototype.setParams = function(value) {
  return jspb.Message.setWrapperField(this, 3, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest.prototype.clearParams = function() {
  return this.setParams(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest.prototype.hasParams = function() {
  return jspb.Message.getField(this, 3) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
    key: jspb.Message.getFieldWithDefault(msg, 1, ""),
    result: (f = msg.getResult()) && google_protobuf_struct_pb.Struct.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse}
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse;
  return proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse}
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setKey(value);
      break;
    case 2:
      var value = new google_protobuf_struct_pb.Struct;
      reader.readMessage(value,google_protobuf_struct_pb.Struct.deserializeBinaryFromReader);
      msg.setResult(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getKey();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getResult();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      google_protobuf_struct_pb.Struct.serializeBinaryToWriter
    );
  }
};


/**
 * optional string key = 1;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse.prototype.getKey = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse.prototype.setKey = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional google.protobuf.Struct result = 2;
 * @return {?proto.google.protobuf.Struct}
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse.prototype.getResult = function() {
  return /** @type{?proto.google.protobuf.Struct} */ (
    jspb.Message.getWrapperField(this, google_protobuf_struct_pb.Struct, 2));
};


/**
 * @param {?proto.google.protobuf.Struct|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse.prototype.setResult = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse.prototype.clearResult = function() {
  return this.setResult(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse.prototype.hasResult = function() {
  return jspb.Message.getField(this, 2) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.toObject = function(includeInstance, msg) {
  var f, obj = {
    kind: jspb.Message.getFieldWithDefault(msg, 1, ""),
    jsonPointer: jspb.Message.getFieldWithDefault(msg, 2, ""),
    uri: jspb.Message.getFieldWithDefault(msg, 3, ""),
    mediaType: jspb.Message.getFieldWithDefault(msg, 4, ""),
    sha256: jspb.Message.getFieldWithDefault(msg, 5, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef}
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef;
  return proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef}
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setKind(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setJsonPointer(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setUri(value);
      break;
    case 4:
      var value = /** @type {string} */ (reader.readString());
      msg.setMediaType(value);
      break;
    case 5:
      var value = /** @type {string} */ (reader.readString());
      msg.setSha256(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getKind();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = /** @type {string} */ (jspb.Message.getField(message, 2));
  if (f != null) {
    writer.writeString(
      2,
      f
    );
  }
  f = /** @type {string} */ (jspb.Message.getField(message, 3));
  if (f != null) {
    writer.writeString(
      3,
      f
    );
  }
  f = /** @type {string} */ (jspb.Message.getField(message, 4));
  if (f != null) {
    writer.writeString(
      4,
      f
    );
  }
  f = /** @type {string} */ (jspb.Message.getField(message, 5));
  if (f != null) {
    writer.writeString(
      5,
      f
    );
  }
};


/**
 * optional string kind = 1;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.prototype.getKind = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.prototype.setKind = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string json_pointer = 2;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.prototype.getJsonPointer = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.prototype.setJsonPointer = function(value) {
  return jspb.Message.setField(this, 2, value);
};


/**
 * Clears the field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.prototype.clearJsonPointer = function() {
  return jspb.Message.setField(this, 2, undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.prototype.hasJsonPointer = function() {
  return jspb.Message.getField(this, 2) != null;
};


/**
 * optional string uri = 3;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.prototype.getUri = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.prototype.setUri = function(value) {
  return jspb.Message.setField(this, 3, value);
};


/**
 * Clears the field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.prototype.clearUri = function() {
  return jspb.Message.setField(this, 3, undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.prototype.hasUri = function() {
  return jspb.Message.getField(this, 3) != null;
};


/**
 * optional string media_type = 4;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.prototype.getMediaType = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 4, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.prototype.setMediaType = function(value) {
  return jspb.Message.setField(this, 4, value);
};


/**
 * Clears the field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.prototype.clearMediaType = function() {
  return jspb.Message.setField(this, 4, undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.prototype.hasMediaType = function() {
  return jspb.Message.getField(this, 4) != null;
};


/**
 * optional string sha256 = 5;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.prototype.getSha256 = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 5, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.prototype.setSha256 = function(value) {
  return jspb.Message.setField(this, 5, value);
};


/**
 * Clears the field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.prototype.clearSha256 = function() {
  return jspb.Message.setField(this, 5, undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.prototype.hasSha256 = function() {
  return jspb.Message.getField(this, 5) != null;
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.repeatedFields_ = [6];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.toObject = function(includeInstance, msg) {
  var f, obj = {
    evidenceId: jspb.Message.getFieldWithDefault(msg, 1, ""),
    evidenceType: jspb.Message.getFieldWithDefault(msg, 2, ""),
    observedAt: jspb.Message.getFieldWithDefault(msg, 3, ""),
    subjectRef: jspb.Message.getFieldWithDefault(msg, 4, ""),
    payloadRef: (f = msg.getPayloadRef()) && proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.toObject(includeInstance, f),
    producerList: (f = jspb.Message.getRepeatedField(msg, 6)) == null ? undefined : f
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem}
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem;
  return proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem}
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setEvidenceId(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setEvidenceType(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setObservedAt(value);
      break;
    case 4:
      var value = /** @type {string} */ (reader.readString());
      msg.setSubjectRef(value);
      break;
    case 5:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.deserializeBinaryFromReader);
      msg.setPayloadRef(value);
      break;
    case 6:
      var value = /** @type {string} */ (reader.readString());
      msg.addProducer(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getEvidenceId();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getEvidenceType();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getObservedAt();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = /** @type {string} */ (jspb.Message.getField(message, 4));
  if (f != null) {
    writer.writeString(
      4,
      f
    );
  }
  f = message.getPayloadRef();
  if (f != null) {
    writer.writeMessage(
      5,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef.serializeBinaryToWriter
    );
  }
  f = message.getProducerList();
  if (f.length > 0) {
    writer.writeRepeatedString(
      6,
      f
    );
  }
};


/**
 * optional string evidence_id = 1;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.prototype.getEvidenceId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.prototype.setEvidenceId = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string evidence_type = 2;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.prototype.getEvidenceType = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.prototype.setEvidenceType = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string observed_at = 3;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.prototype.getObservedAt = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.prototype.setObservedAt = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional string subject_ref = 4;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.prototype.getSubjectRef = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 4, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.prototype.setSubjectRef = function(value) {
  return jspb.Message.setField(this, 4, value);
};


/**
 * Clears the field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.prototype.clearSubjectRef = function() {
  return jspb.Message.setField(this, 4, undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.prototype.hasSubjectRef = function() {
  return jspb.Message.getField(this, 4) != null;
};


/**
 * optional EvidencePayloadRef payload_ref = 5;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef}
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.prototype.getPayloadRef = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef, 5));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.EvidencePayloadRef|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.prototype.setPayloadRef = function(value) {
  return jspb.Message.setWrapperField(this, 5, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.prototype.clearPayloadRef = function() {
  return this.setPayloadRef(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.prototype.hasPayloadRef = function() {
  return jspb.Message.getField(this, 5) != null;
};


/**
 * repeated string producer = 6;
 * @return {!Array<string>}
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.prototype.getProducerList = function() {
  return /** @type {!Array<string>} */ (jspb.Message.getRepeatedField(this, 6));
};


/**
 * @param {!Array<string>} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.prototype.setProducerList = function(value) {
  return jspb.Message.setField(this, 6, value || []);
};


/**
 * @param {string} value
 * @param {number=} opt_index
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.prototype.addProducer = function(value, opt_index) {
  return jspb.Message.addToRepeatedField(this, 6, value, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.prototype.clearProducerList = function() {
  return this.setProducerList([]);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.repeatedFields_ = [8,11,16,17];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.toObject = function(includeInstance, msg) {
  var f, obj = {
    taskId: jspb.Message.getFieldWithDefault(msg, 1, ""),
    externalExecutionId: jspb.Message.getFieldWithDefault(msg, 2, ""),
    state: jspb.Message.getFieldWithDefault(msg, 3, 0),
    revision: jspb.Message.getFieldWithDefault(msg, 4, 0),
    reasonCode: jspb.Message.getFieldWithDefault(msg, 5, ""),
    message: jspb.Message.getFieldWithDefault(msg, 6, ""),
    progress: (f = msg.getProgress()) && proto.io.sdar.mcp.tasks.adapter.v1.Progress.toObject(includeInstance, f),
    inputRequestsList: jspb.Message.toObjectList(msg.getInputRequestsList(),
    proto.io.sdar.mcp.tasks.adapter.v1.InputRequest.toObject, includeInstance),
    result: (f = msg.getResult()) && google_protobuf_struct_pb.Struct.toObject(includeInstance, f),
    retryable: jspb.Message.getBooleanFieldWithDefault(msg, 10, false),
    alternativesList: jspb.Message.toObjectList(msg.getAlternativesList(),
    proto.io.sdar.mcp.tasks.adapter.v1.Alternative.toObject, includeInstance),
    observedAt: (f = msg.getObservedAt()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f),
    operationName: jspb.Message.getFieldWithDefault(msg, 13, ""),
    argumentHash: jspb.Message.getFieldWithDefault(msg, 14, ""),
    executionContext: (f = msg.getExecutionContext()) && proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.toObject(includeInstance, f),
    evidenceList: jspb.Message.toObjectList(msg.getEvidenceList(),
    proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.toObject, includeInstance),
    mcpInputRequestsList: jspb.Message.toObjectList(msg.getMcpInputRequestsList(),
    proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot;
  return proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setTaskId(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setExternalExecutionId(value);
      break;
    case 3:
      var value = /** @type {!proto.io.sdar.mcp.tasks.adapter.v1.AdapterExecutionState} */ (reader.readEnum());
      msg.setState(value);
      break;
    case 4:
      var value = /** @type {number} */ (reader.readUint64());
      msg.setRevision(value);
      break;
    case 5:
      var value = /** @type {string} */ (reader.readString());
      msg.setReasonCode(value);
      break;
    case 6:
      var value = /** @type {string} */ (reader.readString());
      msg.setMessage(value);
      break;
    case 7:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.Progress;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.Progress.deserializeBinaryFromReader);
      msg.setProgress(value);
      break;
    case 8:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.InputRequest;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.InputRequest.deserializeBinaryFromReader);
      msg.addInputRequests(value);
      break;
    case 9:
      var value = new google_protobuf_struct_pb.Struct;
      reader.readMessage(value,google_protobuf_struct_pb.Struct.deserializeBinaryFromReader);
      msg.setResult(value);
      break;
    case 10:
      var value = /** @type {boolean} */ (reader.readBool());
      msg.setRetryable(value);
      break;
    case 11:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.Alternative;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.Alternative.deserializeBinaryFromReader);
      msg.addAlternatives(value);
      break;
    case 12:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setObservedAt(value);
      break;
    case 13:
      var value = /** @type {string} */ (reader.readString());
      msg.setOperationName(value);
      break;
    case 14:
      var value = /** @type {string} */ (reader.readString());
      msg.setArgumentHash(value);
      break;
    case 15:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.deserializeBinaryFromReader);
      msg.setExecutionContext(value);
      break;
    case 16:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.deserializeBinaryFromReader);
      msg.addEvidence(value);
      break;
    case 17:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest.deserializeBinaryFromReader);
      msg.addMcpInputRequests(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getTaskId();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getExternalExecutionId();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getState();
  if (f !== 0.0) {
    writer.writeEnum(
      3,
      f
    );
  }
  f = message.getRevision();
  if (f !== 0) {
    writer.writeUint64(
      4,
      f
    );
  }
  f = message.getReasonCode();
  if (f.length > 0) {
    writer.writeString(
      5,
      f
    );
  }
  f = message.getMessage();
  if (f.length > 0) {
    writer.writeString(
      6,
      f
    );
  }
  f = message.getProgress();
  if (f != null) {
    writer.writeMessage(
      7,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.Progress.serializeBinaryToWriter
    );
  }
  f = message.getInputRequestsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      8,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.InputRequest.serializeBinaryToWriter
    );
  }
  f = message.getResult();
  if (f != null) {
    writer.writeMessage(
      9,
      f,
      google_protobuf_struct_pb.Struct.serializeBinaryToWriter
    );
  }
  f = message.getRetryable();
  if (f) {
    writer.writeBool(
      10,
      f
    );
  }
  f = message.getAlternativesList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      11,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.Alternative.serializeBinaryToWriter
    );
  }
  f = message.getObservedAt();
  if (f != null) {
    writer.writeMessage(
      12,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
  f = message.getOperationName();
  if (f.length > 0) {
    writer.writeString(
      13,
      f
    );
  }
  f = message.getArgumentHash();
  if (f.length > 0) {
    writer.writeString(
      14,
      f
    );
  }
  f = message.getExecutionContext();
  if (f != null) {
    writer.writeMessage(
      15,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.serializeBinaryToWriter
    );
  }
  f = message.getEvidenceList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      16,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem.serializeBinaryToWriter
    );
  }
  f = message.getMcpInputRequestsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      17,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest.serializeBinaryToWriter
    );
  }
};


/**
 * optional string task_id = 1;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.getTaskId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.setTaskId = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string external_execution_id = 2;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.getExternalExecutionId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.setExternalExecutionId = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional AdapterExecutionState state = 3;
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.AdapterExecutionState}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.getState = function() {
  return /** @type {!proto.io.sdar.mcp.tasks.adapter.v1.AdapterExecutionState} */ (jspb.Message.getFieldWithDefault(this, 3, 0));
};


/**
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.AdapterExecutionState} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.setState = function(value) {
  return jspb.Message.setProto3EnumField(this, 3, value);
};


/**
 * optional uint64 revision = 4;
 * @return {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.getRevision = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 4, 0));
};


/**
 * @param {number} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.setRevision = function(value) {
  return jspb.Message.setProto3IntField(this, 4, value);
};


/**
 * optional string reason_code = 5;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.getReasonCode = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 5, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.setReasonCode = function(value) {
  return jspb.Message.setProto3StringField(this, 5, value);
};


/**
 * optional string message = 6;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.getMessage = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 6, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.setMessage = function(value) {
  return jspb.Message.setProto3StringField(this, 6, value);
};


/**
 * optional Progress progress = 7;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.Progress}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.getProgress = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.Progress} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.Progress, 7));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.Progress|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.setProgress = function(value) {
  return jspb.Message.setWrapperField(this, 7, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.clearProgress = function() {
  return this.setProgress(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.hasProgress = function() {
  return jspb.Message.getField(this, 7) != null;
};


/**
 * repeated InputRequest input_requests = 8;
 * @return {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.InputRequest>}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.getInputRequestsList = function() {
  return /** @type{!Array<!proto.io.sdar.mcp.tasks.adapter.v1.InputRequest>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.InputRequest, 8));
};


/**
 * @param {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.InputRequest>} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.setInputRequestsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 8, value);
};


/**
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.InputRequest=} opt_value
 * @param {number=} opt_index
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.InputRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.addInputRequests = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 8, opt_value, proto.io.sdar.mcp.tasks.adapter.v1.InputRequest, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.clearInputRequestsList = function() {
  return this.setInputRequestsList([]);
};


/**
 * optional google.protobuf.Struct result = 9;
 * @return {?proto.google.protobuf.Struct}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.getResult = function() {
  return /** @type{?proto.google.protobuf.Struct} */ (
    jspb.Message.getWrapperField(this, google_protobuf_struct_pb.Struct, 9));
};


/**
 * @param {?proto.google.protobuf.Struct|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.setResult = function(value) {
  return jspb.Message.setWrapperField(this, 9, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.clearResult = function() {
  return this.setResult(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.hasResult = function() {
  return jspb.Message.getField(this, 9) != null;
};


/**
 * optional bool retryable = 10;
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.getRetryable = function() {
  return /** @type {boolean} */ (jspb.Message.getBooleanFieldWithDefault(this, 10, false));
};


/**
 * @param {boolean} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.setRetryable = function(value) {
  return jspb.Message.setProto3BooleanField(this, 10, value);
};


/**
 * repeated Alternative alternatives = 11;
 * @return {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.Alternative>}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.getAlternativesList = function() {
  return /** @type{!Array<!proto.io.sdar.mcp.tasks.adapter.v1.Alternative>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.Alternative, 11));
};


/**
 * @param {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.Alternative>} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.setAlternativesList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 11, value);
};


/**
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.Alternative=} opt_value
 * @param {number=} opt_index
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.Alternative}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.addAlternatives = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 11, opt_value, proto.io.sdar.mcp.tasks.adapter.v1.Alternative, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.clearAlternativesList = function() {
  return this.setAlternativesList([]);
};


/**
 * optional google.protobuf.Timestamp observed_at = 12;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.getObservedAt = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 12));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.setObservedAt = function(value) {
  return jspb.Message.setWrapperField(this, 12, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.clearObservedAt = function() {
  return this.setObservedAt(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.hasObservedAt = function() {
  return jspb.Message.getField(this, 12) != null;
};


/**
 * optional string operation_name = 13;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.getOperationName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 13, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.setOperationName = function(value) {
  return jspb.Message.setProto3StringField(this, 13, value);
};


/**
 * optional string argument_hash = 14;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.getArgumentHash = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 14, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.setArgumentHash = function(value) {
  return jspb.Message.setProto3StringField(this, 14, value);
};


/**
 * optional ExecutionContext execution_context = 15;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.getExecutionContext = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext, 15));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.setExecutionContext = function(value) {
  return jspb.Message.setWrapperField(this, 15, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.clearExecutionContext = function() {
  return this.setExecutionContext(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.hasExecutionContext = function() {
  return jspb.Message.getField(this, 15) != null;
};


/**
 * repeated EvidenceItem evidence = 16;
 * @return {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem>}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.getEvidenceList = function() {
  return /** @type{!Array<!proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem, 16));
};


/**
 * @param {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem>} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.setEvidenceList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 16, value);
};


/**
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem=} opt_value
 * @param {number=} opt_index
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.addEvidence = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 16, opt_value, proto.io.sdar.mcp.tasks.adapter.v1.EvidenceItem, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.clearEvidenceList = function() {
  return this.setEvidenceList([]);
};


/**
 * repeated McpTaskInputRequest mcp_input_requests = 17;
 * @return {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest>}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.getMcpInputRequestsList = function() {
  return /** @type{!Array<!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest, 17));
};


/**
 * @param {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest>} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.setMcpInputRequestsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 17, value);
};


/**
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest=} opt_value
 * @param {number=} opt_index
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.addMcpInputRequests = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 17, opt_value, proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputRequest, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.prototype.clearMcpInputRequestsList = function() {
  return this.setMcpInputRequestsList([]);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted.toObject = function(includeInstance, msg) {
  var f, obj = {
    externalExecutionId: jspb.Message.getFieldWithDefault(msg, 1, ""),
    initialSnapshot: (f = msg.getInitialSnapshot()) && proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted;
  return proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setExternalExecutionId(value);
      break;
    case 2:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.deserializeBinaryFromReader);
      msg.setInitialSnapshot(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getExternalExecutionId();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getInitialSnapshot();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.serializeBinaryToWriter
    );
  }
};


/**
 * optional string external_execution_id = 1;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted.prototype.getExternalExecutionId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted.prototype.setExternalExecutionId = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional ExecutionSnapshot initial_snapshot = 2;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted.prototype.getInitialSnapshot = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot, 2));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted.prototype.setInitialSnapshot = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted.prototype.clearInitialSnapshot = function() {
  return this.setInitialSnapshot(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted.prototype.hasInitialSnapshot = function() {
  return jspb.Message.getField(this, 2) != null;
};



/**
 * Oneof group definitions for this message. Each group defines the field
 * numbers belonging to that group. When of these fields' value is set, all
 * other fields in the group are cleared. During deserialization, if multiple
 * fields are encountered for a group, only the last value seen will be kept.
 * @private {!Array<!Array<number>>}
 * @const
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.oneofGroups_ = [[1,2]];

/**
 * @enum {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.ResultCase = {
  RESULT_NOT_SET: 0,
  ACCEPTED: 1,
  REJECTED: 2
};

/**
 * @return {proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.ResultCase}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.prototype.getResultCase = function() {
  return /** @type {proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.ResultCase} */(jspb.Message.computeOneofCase(this, proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.oneofGroups_[0]));
};



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
    accepted: (f = msg.getAccepted()) && proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted.toObject(includeInstance, f),
    rejected: (f = msg.getRejected()) && proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse;
  return proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted.deserializeBinaryFromReader);
      msg.setAccepted(value);
      break;
    case 2:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected.deserializeBinaryFromReader);
      msg.setRejected(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getAccepted();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted.serializeBinaryToWriter
    );
  }
  f = message.getRejected();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected.serializeBinaryToWriter
    );
  }
};


/**
 * optional ExecutionAccepted accepted = 1;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.prototype.getAccepted = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted, 1));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionAccepted|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.prototype.setAccepted = function(value) {
  return jspb.Message.setOneofWrapperField(this, 1, proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.oneofGroups_[0], value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.prototype.clearAccepted = function() {
  return this.setAccepted(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.prototype.hasAccepted = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional AdmissionRejected rejected = 2;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.prototype.getRejected = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected, 2));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.AdmissionRejected|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.prototype.setRejected = function(value) {
  return jspb.Message.setOneofWrapperField(this, 2, proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.oneofGroups_[0], value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.prototype.clearRejected = function() {
  return this.setRejected(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StartOperationResponse.prototype.hasRejected = function() {
  return jspb.Message.getField(this, 2) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    metadata: (f = msg.getMetadata()) && proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.toObject(includeInstance, f),
    taskId: jspb.Message.getFieldWithDefault(msg, 2, ""),
    externalExecutionId: jspb.Message.getFieldWithDefault(msg, 3, ""),
    executionContext: (f = msg.getExecutionContext()) && proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest;
  return proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.deserializeBinaryFromReader);
      msg.setMetadata(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setTaskId(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setExternalExecutionId(value);
      break;
    case 4:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.deserializeBinaryFromReader);
      msg.setExecutionContext(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getMetadata();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.serializeBinaryToWriter
    );
  }
  f = message.getTaskId();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getExternalExecutionId();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getExecutionContext();
  if (f != null) {
    writer.writeMessage(
      4,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.serializeBinaryToWriter
    );
  }
};


/**
 * optional RequestMetadata metadata = 1;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata}
 */
proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest.prototype.getMetadata = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata, 1));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest.prototype.setMetadata = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest.prototype.clearMetadata = function() {
  return this.setMetadata(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest.prototype.hasMetadata = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional string task_id = 2;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest.prototype.getTaskId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest.prototype.setTaskId = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string external_execution_id = 3;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest.prototype.getExternalExecutionId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest.prototype.setExternalExecutionId = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional ExecutionContext execution_context = 4;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext}
 */
proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest.prototype.getExecutionContext = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext, 4));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest.prototype.setExecutionContext = function(value) {
  return jspb.Message.setWrapperField(this, 4, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest.prototype.clearExecutionContext = function() {
  return this.setExecutionContext(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest.prototype.hasExecutionContext = function() {
  return jspb.Message.getField(this, 4) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.toObject = function(includeInstance, msg) {
  var f, obj = {
    taskId: jspb.Message.getFieldWithDefault(msg, 1, ""),
    operationName: jspb.Message.getFieldWithDefault(msg, 2, ""),
    argumentHash: jspb.Message.getFieldWithDefault(msg, 3, ""),
    executionContext: (f = msg.getExecutionContext()) && proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.toObject(includeInstance, f),
    commandSequence: jspb.Message.getFieldWithDefault(msg, 5, 0),
    externalExecutionId: jspb.Message.getFieldWithDefault(msg, 6, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity}
 */
proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity;
  return proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity}
 */
proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setTaskId(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setOperationName(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setArgumentHash(value);
      break;
    case 4:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.deserializeBinaryFromReader);
      msg.setExecutionContext(value);
      break;
    case 5:
      var value = /** @type {number} */ (reader.readUint64());
      msg.setCommandSequence(value);
      break;
    case 6:
      var value = /** @type {string} */ (reader.readString());
      msg.setExternalExecutionId(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getTaskId();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getOperationName();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getArgumentHash();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getExecutionContext();
  if (f != null) {
    writer.writeMessage(
      4,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.serializeBinaryToWriter
    );
  }
  f = message.getCommandSequence();
  if (f !== 0) {
    writer.writeUint64(
      5,
      f
    );
  }
  f = message.getExternalExecutionId();
  if (f.length > 0) {
    writer.writeString(
      6,
      f
    );
  }
};


/**
 * optional string task_id = 1;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.prototype.getTaskId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.prototype.setTaskId = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string operation_name = 2;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.prototype.getOperationName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.prototype.setOperationName = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string argument_hash = 3;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.prototype.getArgumentHash = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.prototype.setArgumentHash = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional ExecutionContext execution_context = 4;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext}
 */
proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.prototype.getExecutionContext = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext, 4));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.prototype.setExecutionContext = function(value) {
  return jspb.Message.setWrapperField(this, 4, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.prototype.clearExecutionContext = function() {
  return this.setExecutionContext(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.prototype.hasExecutionContext = function() {
  return jspb.Message.getField(this, 4) != null;
};


/**
 * optional uint64 command_sequence = 5;
 * @return {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.prototype.getCommandSequence = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 5, 0));
};


/**
 * @param {number} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.prototype.setCommandSequence = function(value) {
  return jspb.Message.setProto3IntField(this, 5, value);
};


/**
 * optional string external_execution_id = 6;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.prototype.getExternalExecutionId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 6, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.prototype.setExternalExecutionId = function(value) {
  return jspb.Message.setProto3StringField(this, 6, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    metadata: (f = msg.getMetadata()) && proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.toObject(includeInstance, f),
    identity: (f = msg.getIdentity()) && proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.toObject(includeInstance, f),
    reason: jspb.Message.getFieldWithDefault(msg, 3, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest;
  return proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.deserializeBinaryFromReader);
      msg.setMetadata(value);
      break;
    case 2:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.deserializeBinaryFromReader);
      msg.setIdentity(value);
      break;
    case 3:
      var value = /** @type {!proto.io.sdar.mcp.tasks.adapter.v1.StopReason} */ (reader.readEnum());
      msg.setReason(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getMetadata();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.serializeBinaryToWriter
    );
  }
  f = message.getIdentity();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.serializeBinaryToWriter
    );
  }
  f = message.getReason();
  if (f !== 0.0) {
    writer.writeEnum(
      3,
      f
    );
  }
};


/**
 * optional RequestMetadata metadata = 1;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata}
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest.prototype.getMetadata = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata, 1));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest.prototype.setMetadata = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest.prototype.clearMetadata = function() {
  return this.setMetadata(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest.prototype.hasMetadata = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional SideEffectIdentity identity = 2;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity}
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest.prototype.getIdentity = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity, 2));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest.prototype.setIdentity = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest.prototype.clearIdentity = function() {
  return this.setIdentity(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest.prototype.hasIdentity = function() {
  return jspb.Message.getField(this, 2) != null;
};


/**
 * optional StopReason reason = 3;
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StopReason}
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest.prototype.getReason = function() {
  return /** @type {!proto.io.sdar.mcp.tasks.adapter.v1.StopReason} */ (jspb.Message.getFieldWithDefault(this, 3, 0));
};


/**
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.StopReason} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.RequestCancelRequest.prototype.setReason = function(value) {
  return jspb.Message.setProto3EnumField(this, 3, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue.toObject = function(includeInstance, msg) {
  var f, obj = {
    inputRequestKey: jspb.Message.getFieldWithDefault(msg, 1, ""),
    value: (f = msg.getValue()) && google_protobuf_struct_pb.Value.toObject(includeInstance, f),
    answerHash: jspb.Message.getFieldWithDefault(msg, 3, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue;
  return proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setInputRequestKey(value);
      break;
    case 2:
      var value = new google_protobuf_struct_pb.Value;
      reader.readMessage(value,google_protobuf_struct_pb.Value.deserializeBinaryFromReader);
      msg.setValue(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setAnswerHash(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getInputRequestKey();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getValue();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      google_protobuf_struct_pb.Value.serializeBinaryToWriter
    );
  }
  f = message.getAnswerHash();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
};


/**
 * optional string input_request_key = 1;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue.prototype.getInputRequestKey = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue.prototype.setInputRequestKey = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional google.protobuf.Value value = 2;
 * @return {?proto.google.protobuf.Value}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue.prototype.getValue = function() {
  return /** @type{?proto.google.protobuf.Value} */ (
    jspb.Message.getWrapperField(this, google_protobuf_struct_pb.Value, 2));
};


/**
 * @param {?proto.google.protobuf.Value|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue.prototype.setValue = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue.prototype.clearValue = function() {
  return this.setValue(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue.prototype.hasValue = function() {
  return jspb.Message.getField(this, 2) != null;
};


/**
 * optional string answer_hash = 3;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue.prototype.getAnswerHash = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue.prototype.setAnswerHash = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.repeatedFields_ = [3,4];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    metadata: (f = msg.getMetadata()) && proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.toObject(includeInstance, f),
    identity: (f = msg.getIdentity()) && proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.toObject(includeInstance, f),
    inputsList: jspb.Message.toObjectList(msg.getInputsList(),
    proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue.toObject, includeInstance),
    inputResponsesList: jspb.Message.toObjectList(msg.getInputResponsesList(),
    proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest;
  return proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.deserializeBinaryFromReader);
      msg.setMetadata(value);
      break;
    case 2:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.deserializeBinaryFromReader);
      msg.setIdentity(value);
      break;
    case 3:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue.deserializeBinaryFromReader);
      msg.addInputs(value);
      break;
    case 4:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse.deserializeBinaryFromReader);
      msg.addInputResponses(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getMetadata();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.serializeBinaryToWriter
    );
  }
  f = message.getIdentity();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.serializeBinaryToWriter
    );
  }
  f = message.getInputsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      3,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue.serializeBinaryToWriter
    );
  }
  f = message.getInputResponsesList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      4,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse.serializeBinaryToWriter
    );
  }
};


/**
 * optional RequestMetadata metadata = 1;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.prototype.getMetadata = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata, 1));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.prototype.setMetadata = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.prototype.clearMetadata = function() {
  return this.setMetadata(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.prototype.hasMetadata = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional SideEffectIdentity identity = 2;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.prototype.getIdentity = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity, 2));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.prototype.setIdentity = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.prototype.clearIdentity = function() {
  return this.setIdentity(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.prototype.hasIdentity = function() {
  return jspb.Message.getField(this, 2) != null;
};


/**
 * repeated UpdateValue inputs = 3;
 * @return {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue>}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.prototype.getInputsList = function() {
  return /** @type{!Array<!proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue, 3));
};


/**
 * @param {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue>} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.prototype.setInputsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 3, value);
};


/**
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue=} opt_value
 * @param {number=} opt_index
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.prototype.addInputs = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 3, opt_value, proto.io.sdar.mcp.tasks.adapter.v1.UpdateValue, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.prototype.clearInputsList = function() {
  return this.setInputsList([]);
};


/**
 * repeated McpTaskInputResponse input_responses = 4;
 * @return {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse>}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.prototype.getInputResponsesList = function() {
  return /** @type{!Array<!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse, 4));
};


/**
 * @param {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse>} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.prototype.setInputResponsesList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 4, value);
};


/**
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse=} opt_value
 * @param {number=} opt_index
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse}
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.prototype.addInputResponses = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 4, opt_value, proto.io.sdar.mcp.tasks.adapter.v1.McpTaskInputResponse, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.UpdateExecutionRequest.prototype.clearInputResponsesList = function() {
  return this.setInputResponsesList([]);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    metadata: (f = msg.getMetadata()) && proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.toObject(includeInstance, f),
    identity: (f = msg.getIdentity()) && proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.toObject(includeInstance, f),
    reasonCode: jspb.Message.getFieldWithDefault(msg, 3, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest;
  return proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.deserializeBinaryFromReader);
      msg.setMetadata(value);
      break;
    case 2:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.deserializeBinaryFromReader);
      msg.setIdentity(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setReasonCode(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getMetadata();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.serializeBinaryToWriter
    );
  }
  f = message.getIdentity();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.serializeBinaryToWriter
    );
  }
  f = message.getReasonCode();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
};


/**
 * optional RequestMetadata metadata = 1;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata}
 */
proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest.prototype.getMetadata = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata, 1));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest.prototype.setMetadata = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest.prototype.clearMetadata = function() {
  return this.setMetadata(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest.prototype.hasMetadata = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional SideEffectIdentity identity = 2;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity}
 */
proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest.prototype.getIdentity = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity, 2));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest.prototype.setIdentity = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest.prototype.clearIdentity = function() {
  return this.setIdentity(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest.prototype.hasIdentity = function() {
  return jspb.Message.getField(this, 2) != null;
};


/**
 * optional string reason_code = 3;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest.prototype.getReasonCode = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.PauseExecutionRequest.prototype.setReasonCode = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    metadata: (f = msg.getMetadata()) && proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.toObject(includeInstance, f),
    identity: (f = msg.getIdentity()) && proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.toObject(includeInstance, f),
    reasonCode: jspb.Message.getFieldWithDefault(msg, 3, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest;
  return proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.deserializeBinaryFromReader);
      msg.setMetadata(value);
      break;
    case 2:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.deserializeBinaryFromReader);
      msg.setIdentity(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setReasonCode(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getMetadata();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.serializeBinaryToWriter
    );
  }
  f = message.getIdentity();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.serializeBinaryToWriter
    );
  }
  f = message.getReasonCode();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
};


/**
 * optional RequestMetadata metadata = 1;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest.prototype.getMetadata = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata, 1));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest.prototype.setMetadata = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest.prototype.clearMetadata = function() {
  return this.setMetadata(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest.prototype.hasMetadata = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional SideEffectIdentity identity = 2;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest.prototype.getIdentity = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity, 2));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest.prototype.setIdentity = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest.prototype.clearIdentity = function() {
  return this.setIdentity(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest.prototype.hasIdentity = function() {
  return jspb.Message.getField(this, 2) != null;
};


/**
 * optional string reason_code = 3;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest.prototype.getReasonCode = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResumeExecutionRequest.prototype.setReasonCode = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CommandAck.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.CommandAck.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.CommandAck} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.CommandAck.toObject = function(includeInstance, msg) {
  var f, obj = {
    accepted: jspb.Message.getBooleanFieldWithDefault(msg, 1, false),
    reasonCode: jspb.Message.getFieldWithDefault(msg, 2, ""),
    message: jspb.Message.getFieldWithDefault(msg, 3, ""),
    commandSequence: jspb.Message.getFieldWithDefault(msg, 4, 0),
    identity: (f = msg.getIdentity()) && proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.CommandAck}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CommandAck.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.CommandAck;
  return proto.io.sdar.mcp.tasks.adapter.v1.CommandAck.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.CommandAck} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.CommandAck}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CommandAck.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {boolean} */ (reader.readBool());
      msg.setAccepted(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setReasonCode(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setMessage(value);
      break;
    case 4:
      var value = /** @type {number} */ (reader.readUint64());
      msg.setCommandSequence(value);
      break;
    case 5:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.deserializeBinaryFromReader);
      msg.setIdentity(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CommandAck.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.CommandAck.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.CommandAck} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.CommandAck.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getAccepted();
  if (f) {
    writer.writeBool(
      1,
      f
    );
  }
  f = message.getReasonCode();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getMessage();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getCommandSequence();
  if (f !== 0) {
    writer.writeUint64(
      4,
      f
    );
  }
  f = message.getIdentity();
  if (f != null) {
    writer.writeMessage(
      5,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity.serializeBinaryToWriter
    );
  }
};


/**
 * optional bool accepted = 1;
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CommandAck.prototype.getAccepted = function() {
  return /** @type {boolean} */ (jspb.Message.getBooleanFieldWithDefault(this, 1, false));
};


/**
 * @param {boolean} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.CommandAck} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.CommandAck.prototype.setAccepted = function(value) {
  return jspb.Message.setProto3BooleanField(this, 1, value);
};


/**
 * optional string reason_code = 2;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CommandAck.prototype.getReasonCode = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.CommandAck} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.CommandAck.prototype.setReasonCode = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string message = 3;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CommandAck.prototype.getMessage = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.CommandAck} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.CommandAck.prototype.setMessage = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional uint64 command_sequence = 4;
 * @return {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CommandAck.prototype.getCommandSequence = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 4, 0));
};


/**
 * @param {number} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.CommandAck} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.CommandAck.prototype.setCommandSequence = function(value) {
  return jspb.Message.setProto3IntField(this, 4, value);
};


/**
 * optional SideEffectIdentity identity = 5;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CommandAck.prototype.getIdentity = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity, 5));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.SideEffectIdentity|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.CommandAck} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.CommandAck.prototype.setIdentity = function(value) {
  return jspb.Message.setWrapperField(this, 5, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.CommandAck} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.CommandAck.prototype.clearIdentity = function() {
  return this.setIdentity(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.CommandAck.prototype.hasIdentity = function() {
  return jspb.Message.getField(this, 5) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    metadata: (f = msg.getMetadata()) && proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.toObject(includeInstance, f),
    taskId: jspb.Message.getFieldWithDefault(msg, 2, ""),
    operationName: jspb.Message.getFieldWithDefault(msg, 3, ""),
    argumentHash: jspb.Message.getFieldWithDefault(msg, 4, ""),
    executionContext: (f = msg.getExecutionContext()) && proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.toObject(includeInstance, f),
    externalExecutionId: jspb.Message.getFieldWithDefault(msg, 6, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest;
  return proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.deserializeBinaryFromReader);
      msg.setMetadata(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setTaskId(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setOperationName(value);
      break;
    case 4:
      var value = /** @type {string} */ (reader.readString());
      msg.setArgumentHash(value);
      break;
    case 5:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.deserializeBinaryFromReader);
      msg.setExecutionContext(value);
      break;
    case 6:
      var value = /** @type {string} */ (reader.readString());
      msg.setExternalExecutionId(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getMetadata();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.serializeBinaryToWriter
    );
  }
  f = message.getTaskId();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getOperationName();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getArgumentHash();
  if (f.length > 0) {
    writer.writeString(
      4,
      f
    );
  }
  f = message.getExecutionContext();
  if (f != null) {
    writer.writeMessage(
      5,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.serializeBinaryToWriter
    );
  }
  f = message.getExternalExecutionId();
  if (f.length > 0) {
    writer.writeString(
      6,
      f
    );
  }
};


/**
 * optional RequestMetadata metadata = 1;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.prototype.getMetadata = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata, 1));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.prototype.setMetadata = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.prototype.clearMetadata = function() {
  return this.setMetadata(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.prototype.hasMetadata = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional string task_id = 2;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.prototype.getTaskId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.prototype.setTaskId = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string operation_name = 3;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.prototype.getOperationName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.prototype.setOperationName = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional string argument_hash = 4;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.prototype.getArgumentHash = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 4, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.prototype.setArgumentHash = function(value) {
  return jspb.Message.setProto3StringField(this, 4, value);
};


/**
 * optional ExecutionContext execution_context = 5;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.prototype.getExecutionContext = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext, 5));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.prototype.setExecutionContext = function(value) {
  return jspb.Message.setWrapperField(this, 5, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.prototype.clearExecutionContext = function() {
  return this.setExecutionContext(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.prototype.hasExecutionContext = function() {
  return jspb.Message.getField(this, 5) != null;
};


/**
 * optional string external_execution_id = 6;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.prototype.getExternalExecutionId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 6, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionRequest.prototype.setExternalExecutionId = function(value) {
  return jspb.Message.setProto3StringField(this, 6, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
    status: jspb.Message.getFieldWithDefault(msg, 1, 0),
    snapshot: (f = msg.getSnapshot()) && proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.toObject(includeInstance, f),
    externalExecutionId: jspb.Message.getFieldWithDefault(msg, 3, ""),
    reasonCode: jspb.Message.getFieldWithDefault(msg, 4, ""),
    message: jspb.Message.getFieldWithDefault(msg, 5, ""),
    retryable: jspb.Message.getBooleanFieldWithDefault(msg, 6, false)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse;
  return proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileStatus} */ (reader.readEnum());
      msg.setStatus(value);
      break;
    case 2:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.deserializeBinaryFromReader);
      msg.setSnapshot(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setExternalExecutionId(value);
      break;
    case 4:
      var value = /** @type {string} */ (reader.readString());
      msg.setReasonCode(value);
      break;
    case 5:
      var value = /** @type {string} */ (reader.readString());
      msg.setMessage(value);
      break;
    case 6:
      var value = /** @type {boolean} */ (reader.readBool());
      msg.setRetryable(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getStatus();
  if (f !== 0.0) {
    writer.writeEnum(
      1,
      f
    );
  }
  f = message.getSnapshot();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.serializeBinaryToWriter
    );
  }
  f = message.getExternalExecutionId();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getReasonCode();
  if (f.length > 0) {
    writer.writeString(
      4,
      f
    );
  }
  f = message.getMessage();
  if (f.length > 0) {
    writer.writeString(
      5,
      f
    );
  }
  f = message.getRetryable();
  if (f) {
    writer.writeBool(
      6,
      f
    );
  }
};


/**
 * optional ReconcileStatus status = 1;
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileStatus}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse.prototype.getStatus = function() {
  return /** @type {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileStatus} */ (jspb.Message.getFieldWithDefault(this, 1, 0));
};


/**
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileStatus} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse.prototype.setStatus = function(value) {
  return jspb.Message.setProto3EnumField(this, 1, value);
};


/**
 * optional ExecutionSnapshot snapshot = 2;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse.prototype.getSnapshot = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot, 2));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse.prototype.setSnapshot = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse.prototype.clearSnapshot = function() {
  return this.setSnapshot(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse.prototype.hasSnapshot = function() {
  return jspb.Message.getField(this, 2) != null;
};


/**
 * optional string external_execution_id = 3;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse.prototype.getExternalExecutionId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse.prototype.setExternalExecutionId = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional string reason_code = 4;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse.prototype.getReasonCode = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 4, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse.prototype.setReasonCode = function(value) {
  return jspb.Message.setProto3StringField(this, 4, value);
};


/**
 * optional string message = 5;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse.prototype.getMessage = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 5, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse.prototype.setMessage = function(value) {
  return jspb.Message.setProto3StringField(this, 5, value);
};


/**
 * optional bool retryable = 6;
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse.prototype.getRetryable = function() {
  return /** @type {boolean} */ (jspb.Message.getBooleanFieldWithDefault(this, 6, false));
};


/**
 * @param {boolean} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileExecutionResponse.prototype.setRetryable = function(value) {
  return jspb.Message.setProto3BooleanField(this, 6, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    execution: (f = msg.getExecution()) && proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest.toObject(includeInstance, f),
    afterRevision: jspb.Message.getFieldWithDefault(msg, 2, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest;
  return proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest.deserializeBinaryFromReader);
      msg.setExecution(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readUint64());
      msg.setAfterRevision(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getExecution();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest.serializeBinaryToWriter
    );
  }
  f = message.getAfterRevision();
  if (f !== 0) {
    writer.writeUint64(
      2,
      f
    );
  }
};


/**
 * optional GetExecutionRequest execution = 1;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest.prototype.getExecution = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest, 1));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.GetExecutionRequest|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest.prototype.setExecution = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest.prototype.clearExecution = function() {
  return this.setExecution(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest.prototype.hasExecution = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional uint64 after_revision = 2;
 * @return {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest.prototype.getAfterRevision = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.StreamExecutionEventsRequest.prototype.setAfterRevision = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.toObject = function(includeInstance, msg) {
  var f, obj = {
    taskId: jspb.Message.getFieldWithDefault(msg, 1, ""),
    revision: jspb.Message.getFieldWithDefault(msg, 2, 0),
    type: jspb.Message.getFieldWithDefault(msg, 3, ""),
    occurredAt: (f = msg.getOccurredAt()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f),
    reasonCode: jspb.Message.getFieldWithDefault(msg, 5, ""),
    progress: (f = msg.getProgress()) && proto.io.sdar.mcp.tasks.adapter.v1.Progress.toObject(includeInstance, f),
    snapshot: (f = msg.getSnapshot()) && proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent;
  return proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setTaskId(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readUint64());
      msg.setRevision(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setType(value);
      break;
    case 4:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setOccurredAt(value);
      break;
    case 5:
      var value = /** @type {string} */ (reader.readString());
      msg.setReasonCode(value);
      break;
    case 6:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.Progress;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.Progress.deserializeBinaryFromReader);
      msg.setProgress(value);
      break;
    case 7:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.deserializeBinaryFromReader);
      msg.setSnapshot(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getTaskId();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getRevision();
  if (f !== 0) {
    writer.writeUint64(
      2,
      f
    );
  }
  f = message.getType();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getOccurredAt();
  if (f != null) {
    writer.writeMessage(
      4,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
  f = message.getReasonCode();
  if (f.length > 0) {
    writer.writeString(
      5,
      f
    );
  }
  f = message.getProgress();
  if (f != null) {
    writer.writeMessage(
      6,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.Progress.serializeBinaryToWriter
    );
  }
  f = message.getSnapshot();
  if (f != null) {
    writer.writeMessage(
      7,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot.serializeBinaryToWriter
    );
  }
};


/**
 * optional string task_id = 1;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.prototype.getTaskId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.prototype.setTaskId = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional uint64 revision = 2;
 * @return {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.prototype.getRevision = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.prototype.setRevision = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};


/**
 * optional string type = 3;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.prototype.getType = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.prototype.setType = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional google.protobuf.Timestamp occurred_at = 4;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.prototype.getOccurredAt = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 4));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.prototype.setOccurredAt = function(value) {
  return jspb.Message.setWrapperField(this, 4, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.prototype.clearOccurredAt = function() {
  return this.setOccurredAt(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.prototype.hasOccurredAt = function() {
  return jspb.Message.getField(this, 4) != null;
};


/**
 * optional string reason_code = 5;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.prototype.getReasonCode = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 5, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.prototype.setReasonCode = function(value) {
  return jspb.Message.setProto3StringField(this, 5, value);
};


/**
 * optional Progress progress = 6;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.Progress}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.prototype.getProgress = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.Progress} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.Progress, 6));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.Progress|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.prototype.setProgress = function(value) {
  return jspb.Message.setWrapperField(this, 6, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.prototype.clearProgress = function() {
  return this.setProgress(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.prototype.hasProgress = function() {
  return jspb.Message.getField(this, 6) != null;
};


/**
 * optional ExecutionSnapshot snapshot = 7;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.prototype.getSnapshot = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot, 7));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionSnapshot|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.prototype.setSnapshot = function(value) {
  return jspb.Message.setWrapperField(this, 7, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.prototype.clearSnapshot = function() {
  return this.setSnapshot(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionEvent.prototype.hasSnapshot = function() {
  return jspb.Message.getField(this, 7) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    metadata: (f = msg.getMetadata()) && proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.toObject(includeInstance, f),
    executionContext: (f = msg.getExecutionContext()) && proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.toObject(includeInstance, f),
    pageToken: jspb.Message.getFieldWithDefault(msg, 3, ""),
    pageSize: jspb.Message.getFieldWithDefault(msg, 4, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest;
  return proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.deserializeBinaryFromReader);
      msg.setMetadata(value);
      break;
    case 2:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.deserializeBinaryFromReader);
      msg.setExecutionContext(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setPageToken(value);
      break;
    case 4:
      var value = /** @type {number} */ (reader.readUint32());
      msg.setPageSize(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getMetadata();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata.serializeBinaryToWriter
    );
  }
  f = message.getExecutionContext();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext.serializeBinaryToWriter
    );
  }
  f = message.getPageToken();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getPageSize();
  if (f !== 0) {
    writer.writeUint32(
      4,
      f
    );
  }
};


/**
 * optional RequestMetadata metadata = 1;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest.prototype.getMetadata = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata, 1));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.RequestMetadata|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest.prototype.setMetadata = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest.prototype.clearMetadata = function() {
  return this.setMetadata(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest.prototype.hasMetadata = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional ExecutionContext execution_context = 2;
 * @return {?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest.prototype.getExecutionContext = function() {
  return /** @type{?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext} */ (
    jspb.Message.getWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext, 2));
};


/**
 * @param {?proto.io.sdar.mcp.tasks.adapter.v1.ExecutionContext|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest.prototype.setExecutionContext = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest.prototype.clearExecutionContext = function() {
  return this.setExecutionContext(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest.prototype.hasExecutionContext = function() {
  return jspb.Message.getField(this, 2) != null;
};


/**
 * optional string page_token = 3;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest.prototype.getPageToken = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest.prototype.setPageToken = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional uint32 page_size = 4;
 * @return {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest.prototype.getPageSize = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 4, 0));
};


/**
 * @param {number} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesRequest.prototype.setPageSize = function(value) {
  return jspb.Message.setProto3IntField(this, 4, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.toObject = function(includeInstance, msg) {
  var f, obj = {
    resourceId: jspb.Message.getFieldWithDefault(msg, 1, ""),
    displayName: jspb.Message.getFieldWithDefault(msg, 2, ""),
    resourceType: jspb.Message.getFieldWithDefault(msg, 3, ""),
    enabled: jspb.Message.getBooleanFieldWithDefault(msg, 4, false),
    health: jspb.Message.getFieldWithDefault(msg, 5, ""),
    labelsMap: (f = msg.getLabelsMap()) ? f.toObject(includeInstance, undefined) : [],
    metadata: (f = msg.getMetadata()) && google_protobuf_struct_pb.Struct.toObject(includeInstance, f),
    lastSeenAt: (f = msg.getLastSeenAt()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance;
  return proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setResourceId(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setDisplayName(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setResourceType(value);
      break;
    case 4:
      var value = /** @type {boolean} */ (reader.readBool());
      msg.setEnabled(value);
      break;
    case 5:
      var value = /** @type {string} */ (reader.readString());
      msg.setHealth(value);
      break;
    case 6:
      var value = msg.getLabelsMap();
      reader.readMessage(value, function(message, reader) {
        jspb.Map.deserializeBinary(message, reader, jspb.BinaryReader.prototype.readString, jspb.BinaryReader.prototype.readString, null, "", "");
         });
      break;
    case 7:
      var value = new google_protobuf_struct_pb.Struct;
      reader.readMessage(value,google_protobuf_struct_pb.Struct.deserializeBinaryFromReader);
      msg.setMetadata(value);
      break;
    case 8:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setLastSeenAt(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getResourceId();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getDisplayName();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getResourceType();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getEnabled();
  if (f) {
    writer.writeBool(
      4,
      f
    );
  }
  f = message.getHealth();
  if (f.length > 0) {
    writer.writeString(
      5,
      f
    );
  }
  f = message.getLabelsMap(true);
  if (f && f.getLength() > 0) {
    f.serializeBinary(6, writer, jspb.BinaryWriter.prototype.writeString, jspb.BinaryWriter.prototype.writeString);
  }
  f = message.getMetadata();
  if (f != null) {
    writer.writeMessage(
      7,
      f,
      google_protobuf_struct_pb.Struct.serializeBinaryToWriter
    );
  }
  f = message.getLastSeenAt();
  if (f != null) {
    writer.writeMessage(
      8,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
};


/**
 * optional string resource_id = 1;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.prototype.getResourceId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.prototype.setResourceId = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string display_name = 2;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.prototype.getDisplayName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.prototype.setDisplayName = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string resource_type = 3;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.prototype.getResourceType = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.prototype.setResourceType = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional bool enabled = 4;
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.prototype.getEnabled = function() {
  return /** @type {boolean} */ (jspb.Message.getBooleanFieldWithDefault(this, 4, false));
};


/**
 * @param {boolean} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.prototype.setEnabled = function(value) {
  return jspb.Message.setProto3BooleanField(this, 4, value);
};


/**
 * optional string health = 5;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.prototype.getHealth = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 5, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.prototype.setHealth = function(value) {
  return jspb.Message.setProto3StringField(this, 5, value);
};


/**
 * map<string, string> labels = 6;
 * @param {boolean=} opt_noLazyCreate Do not create the map if
 * empty, instead returning `undefined`
 * @return {!jspb.Map<string,string>}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.prototype.getLabelsMap = function(opt_noLazyCreate) {
  return /** @type {!jspb.Map<string,string>} */ (
      jspb.Message.getMapField(this, 6, opt_noLazyCreate,
      null));
};


/**
 * Clears values from the map. The map will be non-null.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.prototype.clearLabelsMap = function() {
  this.getLabelsMap().clear();
  return this;};


/**
 * optional google.protobuf.Struct metadata = 7;
 * @return {?proto.google.protobuf.Struct}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.prototype.getMetadata = function() {
  return /** @type{?proto.google.protobuf.Struct} */ (
    jspb.Message.getWrapperField(this, google_protobuf_struct_pb.Struct, 7));
};


/**
 * @param {?proto.google.protobuf.Struct|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.prototype.setMetadata = function(value) {
  return jspb.Message.setWrapperField(this, 7, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.prototype.clearMetadata = function() {
  return this.setMetadata(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.prototype.hasMetadata = function() {
  return jspb.Message.getField(this, 7) != null;
};


/**
 * optional google.protobuf.Timestamp last_seen_at = 8;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.prototype.getLastSeenAt = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 8));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.prototype.setLastSeenAt = function(value) {
  return jspb.Message.setWrapperField(this, 8, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.prototype.clearLastSeenAt = function() {
  return this.setLastSeenAt(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.prototype.hasLastSeenAt = function() {
  return jspb.Message.getField(this, 8) != null;
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse.repeatedFields_ = [1];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
    resourcesList: jspb.Message.toObjectList(msg.getResourcesList(),
    proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.toObject, includeInstance),
    nextPageToken: jspb.Message.getFieldWithDefault(msg, 2, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse;
  return proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance;
      reader.readMessage(value,proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.deserializeBinaryFromReader);
      msg.addResources(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setNextPageToken(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getResourcesList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance.serializeBinaryToWriter
    );
  }
  f = message.getNextPageToken();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
};


/**
 * repeated ResourceInstance resources = 1;
 * @return {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance>}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse.prototype.getResourcesList = function() {
  return /** @type{!Array<!proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance, 1));
};


/**
 * @param {!Array<!proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance>} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse} returns this
*/
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse.prototype.setResourcesList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance=} opt_value
 * @param {number=} opt_index
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse.prototype.addResources = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.io.sdar.mcp.tasks.adapter.v1.ResourceInstance, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse.prototype.clearResourcesList = function() {
  return this.setResourcesList([]);
};


/**
 * optional string next_page_token = 2;
 * @return {string}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse.prototype.getNextPageToken = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse} returns this
 */
proto.io.sdar.mcp.tasks.adapter.v1.ListResourcesResponse.prototype.setNextPageToken = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * @enum {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ExecutionMode = {
  EXECUTION_MODE_UNSPECIFIED: 0,
  LIVE: 1,
  SIMULATION: 2,
  HISTORICAL_REPLAY: 3
};

/**
 * @enum {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.OperationExecution = {
  OPERATION_EXECUTION_UNSPECIFIED: 0,
  SYNCHRONOUS: 1,
  TASK_CAPABLE: 2,
  TASK_REQUIRED: 3
};

/**
 * @enum {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.InventoryMode = {
  INVENTORY_MODE_UNSPECIFIED: 0,
  RUNTIME_VISIBLE: 1,
  OPAQUE: 2
};

/**
 * @enum {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AvailabilityState = {
  AVAILABILITY_STATE_UNSPECIFIED: 0,
  AVAILABLE: 1,
  RESTRICTED: 2,
  DISABLED: 3,
  UNKNOWN: 4
};

/**
 * @enum {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.RiskLevel = {
  RISK_LEVEL_UNSPECIFIED: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4
};

/**
 * @enum {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReservationMode = {
  RESERVATION_MODE_UNSPECIFIED: 0,
  NONE: 1,
  BEST_EFFORT: 2,
  GUARANTEED: 3
};

/**
 * @enum {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.AdapterExecutionState = {
  ADAPTER_EXECUTION_STATE_UNSPECIFIED: 0,
  ACCEPTED: 1,
  SCHEDULED: 2,
  QUEUED: 3,
  RUNNING: 4,
  PAUSED: 5,
  RESUMING: 6,
  WAITING_INPUT: 7,
  STOPPING: 8,
  SUCCEEDED: 20,
  BUSINESS_FAILED: 21,
  PARTIALLY_COMPLETED: 22,
  CANCELLED: 23,
  TECHNICAL_FAILED: 24
};

/**
 * @enum {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.StopReason = {
  STOP_REASON_UNSPECIFIED: 0,
  USER_REQUESTED: 1,
  DEADLINE_REACHED: 2,
  START_WINDOW_MISSED: 3,
  RUNTIME_SHUTDOWN: 4
};

/**
 * @enum {number}
 */
proto.io.sdar.mcp.tasks.adapter.v1.ReconcileStatus = {
  RECONCILE_STATUS_UNSPECIFIED: 0,
  FOUND: 1,
  NOT_FOUND: 2,
  TRANSIENT_UNAVAILABLE: 3,
  CONFLICT: 4
};

goog.object.extend(exports, proto.io.sdar.mcp.tasks.adapter.v1);

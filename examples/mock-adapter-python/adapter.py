"""Durable Python reference Adapter used by cross-language conformance."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import grpc
from google.protobuf.json_format import MessageToDict, ParseDict
from google.protobuf.struct_pb2 import Struct
from google.protobuf.timestamp_pb2 import Timestamp

from generated import adapter_pb2, adapter_pb2_grpc


def json_struct(value: dict[str, Any]) -> Struct:
    message = Struct()
    ParseDict(value, message)
    return message


def now_timestamp() -> Timestamp:
    value = Timestamp()
    value.GetCurrentTime()
    return value


def future_timestamp(seconds: int) -> Timestamp:
    value = Timestamp()
    value.FromDatetime(datetime.now(timezone.utc) + timedelta(seconds=seconds))
    return value


class DurableStore:
    """Atomic JSON store; process memory is never the execution authority."""

    def __init__(self, path: str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        if not self.path.exists():
            self._write({"version": 1, "records": {}})

    def get(self, key: str) -> dict[str, Any] | None:
        with self.lock:
            value = self._read()["records"].get(key)
            return None if value is None else json.loads(json.dumps(value))

    def set(self, key: str, value: dict[str, Any]) -> None:
        with self.lock:
            document = self._read()
            document["records"][key] = value
            self._write(document)

    def _read(self) -> dict[str, Any]:
        value = json.loads(self.path.read_text(encoding="utf-8"))
        if value.get("version") != 1 or not isinstance(value.get("records"), dict):
            raise RuntimeError("INVALID_ADAPTER_STATE_FILE")
        return value

    def _write(self, value: dict[str, Any]) -> None:
        descriptor, temporary = tempfile.mkstemp(prefix=self.path.name, dir=self.path.parent)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                json.dump(value, stream, separators=(",", ":"))
                stream.write("\n")
            os.chmod(temporary, 0o600)
            os.replace(temporary, self.path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)


class ReferenceAdapter(adapter_pb2_grpc.ResourceProviderAdapterServicer):
    def __init__(self, store: DurableStore) -> None:
        self.store = store

    async def DescribeProvider(self, request, context):  # noqa: N802
        del request, context
        return adapter_pb2.ProviderManifest(
            adapter_protocol_version="1.0",
            provider_id=os.getenv("PROVIDER_ID", "mock-provider-python"),
            provider_type="reference",
            provider_version="1.0.0",
            inventory_mode=adapter_pb2.RUNTIME_VISIBLE,
            operations=[self._echo_operation(), self._task_operation(), self._flex_operation()],
            business_event_sources=self._business_event_sources(),
        )

    async def StreamBusinessEvents(self, request, context):  # noqa: N802
        sources = {source.source_id: source for source in self._business_event_sources()}
        source = sources.get(request.source_id)
        if source is None:
            await self._abort_source(context, grpc.StatusCode.NOT_FOUND, "SOURCE_NOT_FOUND")
        if request.source_stream_id != source.source_stream_id:
            await self._abort_source(
                context, grpc.StatusCode.FAILED_PRECONDITION, "SOURCE_STREAM_RESET"
            )
        if source.delivery_semantics == "best_effort_live" and request.HasField(
            "after_source_sequence"
        ):
            await self._abort_source(context, grpc.StatusCode.OUT_OF_RANGE, "SOURCE_CURSOR_AHEAD")

        after = request.after_source_sequence if request.HasField("after_source_sequence") else 0
        configured = json.loads(os.getenv("BUSINESS_EVENTS_JSON", "[]"))
        for document in configured:
            sequence = int(document["sourceSequence"])
            if source.delivery_semantics == "best_effort_live" or sequence > after:
                occurred_at = Timestamp()
                occurred_at.FromJsonString(document["occurredAt"])
                yield adapter_pb2.AdapterBusinessEvent(
                    source_event_id=document["sourceEventId"],
                    source_sequence=sequence,
                    source_stream_id=source.source_stream_id,
                    scope=document["scope"],
                    occurred_at=occurred_at,
                    event_type=document["eventType"],
                    description=document["description"],
                    **(
                        {"external_execution_id": document["externalExecutionId"]}
                        if "externalExecutionId" in document
                        else {}
                    ),
                    **(
                        {"resource_ref": document["resourceRef"]}
                        if "resourceRef" in document
                        else {}
                    ),
                    severity_hint=document.get("severityHint", ""),
                    reason_code=document.get("reasonCode", ""),
                    raw_payload=json_struct(document.get("rawPayload", {})),
                )

    @staticmethod
    async def _abort_source(context, status, reason_code: str) -> None:
        context.set_trailing_metadata((("io.sdar.business-events.reason-code", reason_code),))
        await context.abort(status, reason_code)

    @staticmethod
    def _business_event_sources():
        source_id = os.getenv("BUSINESS_EVENT_SOURCE_ID")
        if not source_id:
            return []
        semantics = os.getenv("BUSINESS_EVENT_DELIVERY_SEMANTICS", "durable_at_least_once")
        durable = semantics == "durable_at_least_once"
        return [
            adapter_pb2.BusinessEventSourceCapability(
                source_id=source_id,
                source_stream_id=os.getenv(
                    "BUSINESS_EVENT_SOURCE_STREAM_ID",
                    "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0001",
                ),
                delivery_semantics=semantics,
                replay_supported=durable,
                source_retention_ms=604800000 if durable else 0,
                max_event_bytes=65536,
                max_payload_depth=16,
                max_payload_nodes=4096,
                max_payload_string_bytes=16384,
            )
        ]

    async def CheckAvailability(self, request, context):  # noqa: N802
        del context
        checked_at = now_timestamp()
        valid_until = future_timestamp(10)
        results = []
        for check in request.checks:
            arguments = MessageToDict(check.arguments) if check.HasField("arguments") else {}
            scenario = arguments.get("scenario")
            availability = adapter_pb2.AVAILABLE
            reason = "AVAILABLE"
            description = "The operation is currently predicted to be available."
            risk = adapter_pb2.LOW
            effects: list[str] = []
            if scenario == "disabled":
                availability = adapter_pb2.DISABLED
                reason = "RESOURCE_DISABLED"
                description = "The resource is disabled."
            elif scenario == "unknown":
                availability = adapter_pb2.UNKNOWN
                reason = "RESOURCE_STATE_UNKNOWN"
                description = "The reference resource state is unknown."
                risk = adapter_pb2.MEDIUM
            elif scenario == "restricted":
                availability = adapter_pb2.RESTRICTED
                reason = "PREEMPTIBLE_TASK_ACTIVE"
                description = "The resource may require preemption."
                risk = adapter_pb2.HIGH
                effects = ["task_preemption", "start_rejection"]
            results.append(
                adapter_pb2.AvailabilityResult(
                    request_id=check.request_id,
                    operation_name=check.operation_name,
                    availability=availability,
                    risk_level=risk,
                    reservation_mode=adapter_pb2.NONE,
                    reason_code=reason,
                    description=description,
                    possible_effects=effects,
                    valid_until=valid_until,
                    **(
                        {
                            "earliest_start_time": valid_until,
                            "next_available_windows": [
                                adapter_pb2.AvailableWindow(
                                    start_time=valid_until,
                                    end_time=future_timestamp(70),
                                )
                            ],
                            "estimated_delay_ms": 10000,
                        }
                        if scenario == "restricted"
                        else {}
                    ),
                )
            )
        return adapter_pb2.CheckAvailabilityResponse(
            profile_version="1.0", checked_at=checked_at, checks=results
        )

    async def StartOperation(self, request, context):  # noqa: N802
        arguments = MessageToDict(request.arguments)
        existing = self.store.get(request.task_id)
        binding = self._binding(request)
        reservation_ref = request.reservation_ref if request.HasField("reservation_ref") else None
        if existing is not None:
            if existing["binding"] != binding or existing.get("reservation_ref") != reservation_ref:
                await context.abort(grpc.StatusCode.ALREADY_EXISTS, "taskId identity conflict")
            return self._accepted(existing)

        if request.operation_name not in {"echo_sync", "durable_task", "flex_task"}:
            return adapter_pb2.StartOperationResponse(
                rejected=adapter_pb2.AdmissionRejected(
                    reason_code="UNSUPPORTED_OPERATION",
                    message="Unknown reference operation.",
                    retryable=False,
                )
            )

        invocation_attempt = request.invocation_attempt or 1
        if (
            arguments.get("scenario") == "scheduled_retry_once" and invocation_attempt == 1
        ) or arguments.get("scenario") == "scheduled_retry_always":
            return adapter_pb2.StartOperationResponse(
                rejected=adapter_pb2.AdmissionRejected(
                    reason_code="START_CAPACITY_RETRY",
                    message="Reference Adapter requests a bounded scheduled retry.",
                    retryable=True,
                )
            )
        if arguments.get("scenario") == "scheduled_permanent_reject":
            return adapter_pb2.StartOperationResponse(
                rejected=adapter_pb2.AdmissionRejected(
                    reason_code="START_NOT_PERMITTED",
                    message="Reference Adapter permanently rejected scheduled admission.",
                    retryable=False,
                )
            )

        task_id = request.task_id
        external_id = f"python-{task_id}"
        if request.operation_name == "echo_sync":
            if arguments.get("message") == "__technical_failure__":
                await context.abort(grpc.StatusCode.INTERNAL, "injected synchronous technical failure")
            output = {"message": 42} if arguments.get("message") == "__invalid_output__" else arguments
            snapshot = self._snapshot_dict(
                task_id, external_id, "SUCCEEDED", 1, "SUCCESS", "Echo completed.", output, binding
            )
            execution = self._execution(
                binding, external_id, snapshot, snapshot, arguments, reservation_ref
            )
        elif request.operation_name == "flex_task" and arguments.get("scenario") in {
            "terminal",
            "terminal_invalid_output",
        }:
            output = (
                {"resourceId": 42, "completed": "yes"}
                if arguments.get("scenario") == "terminal_invalid_output"
                else {"resourceId": arguments.get("resourceId"), "completed": True}
            )
            snapshot = self._snapshot_dict(
                task_id,
                external_id,
                "SUCCEEDED",
                1,
                "SUCCESS",
                "Task-capable operation completed inline.",
                output,
                binding,
            )
            execution = self._execution(
                binding, external_id, snapshot, snapshot, arguments, reservation_ref
            )
        else:
            input_required = arguments.get("scenario") in {
                "input_required",
                "input_required_frozen",
                "multi_round_input",
            }
            snapshot = self._snapshot_dict(
                task_id,
                external_id,
                "WAITING_INPUT" if input_required else "RUNNING",
                1,
                "APPROVAL_REQUIRED" if input_required else "STARTED",
                "Approval input is required." if input_required else "Reference task is running.",
                None,
                binding,
            )
            if input_required:
                if arguments.get("scenario") == "input_required_frozen":
                    snapshot["mcp_input_requests"] = [
                        {
                            "key": "approval",
                            "method": "elicitation/create",
                            "params": {
                                "mode": "form",
                                "message": "Approve the reference operation.",
                                "requestedSchema": {"type": "boolean"},
                            },
                        }
                    ]
                else:
                    snapshot["input_requests"] = [
                        {
                            "key": "approval",
                            "description": "Approve the reference operation.",
                            "schema": {"type": "boolean"},
                            "required": True,
                        }
                    ]
            terminal = self._snapshot_dict(
                task_id,
                external_id,
                "SUCCEEDED",
                2,
                "SUCCESS",
                "Reference task completed.",
                {"resourceId": arguments.get("resourceId"), "completed": True},
                binding,
            )
            if arguments.get("scenario") == "output_invalid":
                terminal["result"] = {"resourceId": 42, "completed": "yes"}
            elif arguments.get("scenario") == "evidence_success":
                terminal["evidence"] = [
                    {
                        "evidence_id": f"evidence-{task_id}",
                        "evidence_type": "resource.completion",
                        "observed_at": datetime.now(timezone.utc)
                        .isoformat()
                        .replace("+00:00", "Z"),
                        "subject_ref": f"resource:{arguments.get('resourceId')}",
                        "payload_ref": {
                            "kind": "structured_content",
                            "json_pointer": "/resourceId",
                        },
                        "producer": [os.getenv("PROVIDER_ID", "mock-provider-python")],
                    }
                ]
            elif arguments.get("scenario") == "partial_valid":
                snapshot.update(
                    state="PARTIALLY_COMPLETED",
                    reason_code="PARTIAL_RESULT",
                    message="Reference task partially completed.",
                    result={"resourceId": arguments.get("resourceId"), "completed": False},
                )
            elif arguments.get("scenario") == "partial_invalid":
                snapshot.update(
                    state="PARTIALLY_COMPLETED",
                    reason_code="PARTIAL_RESULT",
                    message="Reference task returned an invalid partial payload.",
                    result={"resourceId": 42, "completed": "no"},
                )
            elif arguments.get("scenario") == "business_failure":
                snapshot.update(
                    state="BUSINESS_FAILED",
                    reason_code="BUSINESS_RULE_REJECTED",
                    message="Reference business rule rejected the operation.",
                    result={"detail": "business rejection"},
                )
            elif arguments.get("scenario") == "technical_failure":
                snapshot.update(
                    state="TECHNICAL_FAILED",
                    reason_code="ADAPTER_EXECUTION_FAILED",
                    message="Reference Adapter reported a technical failure.",
                )
            execution = self._execution(
                binding, external_id, snapshot, terminal, arguments, reservation_ref
            )
            execution["waiting_for_input"] = input_required
            execution["input_round"] = 1 if arguments.get("scenario") == "multi_round_input" else 0

        self.store.set(task_id, execution)
        if arguments.get("scenario") == "response_loss":
            await context.abort(grpc.StatusCode.UNAVAILABLE, "injected StartOperation response loss")
        return self._accepted(execution)

    async def GetExecution(self, request, context):  # noqa: N802
        execution = self.store.get(request.task_id)
        if execution is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, "execution does not exist")
        if execution["arguments"].get("scenario") == "get_transient_failure":
            await context.abort(grpc.StatusCode.UNAVAILABLE, "injected GetExecution transient failure")
        if not execution.get("waiting_for_input") and not execution.get("hold_snapshot"):
            execution["snapshot"] = execution["terminal_snapshot"]
            self.store.set(request.task_id, execution)
        return self._snapshot(execution["snapshot"])

    async def ReconcileExecution(self, request, context):  # noqa: N802
        del context
        execution = self.store.get(request.task_id)
        if execution is None:
            return adapter_pb2.ReconcileExecutionResponse(
                status=adapter_pb2.NOT_FOUND,
                reason_code="EXECUTION_NOT_FOUND",
                message="No execution is bound to this taskId.",
            )
        if execution["arguments"].get("scenario") == "get_transient_failure":
            return adapter_pb2.ReconcileExecutionResponse(
                status=adapter_pb2.TRANSIENT_UNAVAILABLE,
                reason_code="ADAPTER_TRANSIENT_UNAVAILABLE",
                message="Injected Adapter outage.",
                retryable=True,
            )
        if (
            execution["binding"] != self._binding(request)
            or (request.external_execution_id and request.external_execution_id != execution["external_execution_id"])
        ):
            return adapter_pb2.ReconcileExecutionResponse(
                status=adapter_pb2.CONFLICT,
                reason_code="ARGUMENT_HASH_CONFLICT",
                message="The taskId is bound to different arguments.",
            )
        return adapter_pb2.ReconcileExecutionResponse(
            status=adapter_pb2.FOUND,
            snapshot=self._snapshot(execution["snapshot"]),
            external_execution_id=execution["external_execution_id"],
            reason_code="EXECUTION_FOUND",
            message="Execution recovered.",
        )

    async def RequestCancel(self, request, context):  # noqa: N802
        execution = self.store.get(request.identity.task_id)
        if execution is None:
            return self._ack(False, "EXECUTION_NOT_FOUND", "Execution does not exist.", request)
        key = f"cancel:{request.identity.command_sequence}"
        existing = execution["command_acks"].get(key)
        if existing is not None:
            return adapter_pb2.CommandAck(**existing)
        execution["cancel_attempts"] = execution.get("cancel_attempts", 0) + 1
        scenario = execution["arguments"].get("scenario")
        if scenario == "cancel_permanent_reject":
            self.store.set(request.identity.task_id, execution)
            return self._ack(
                False,
                "CANCEL_NOT_PERMITTED",
                "Reference execution rejected user cancellation.",
                request,
            )
        if scenario == "cancel_retryable_reject" and execution["cancel_attempts"] == 1:
            self.store.set(request.identity.task_id, execution)
            return self._ack(
                False,
                "TRANSIENT_UNAVAILABLE",
                "Reference execution requests a retry.",
                request,
            )
        if scenario == "cancel_transport_failure":
            self.store.set(request.identity.task_id, execution)
            await context.abort(grpc.StatusCode.UNAVAILABLE, "injected cancel transport failure")
        if execution["arguments"].get("scenario") == "natural_completion":
            execution["snapshot"] = execution["terminal_snapshot"]
        else:
            revision = int(execution["snapshot"]["revision"]) + 1
            execution["snapshot"] = self._snapshot_dict(
                request.identity.task_id,
                execution["external_execution_id"],
                "CANCELLED",
                revision,
                "SAFE_STOP_CONFIRMED",
                "Reference execution safely stopped.",
                None,
                execution["binding"],
            )
            execution["terminal_snapshot"] = execution["snapshot"]
        ack = self._ack_dict(True, "STOP_ACCEPTED", "Safe stop accepted.", request)
        if scenario == "command_sequence_mismatch":
            ack["command_sequence"] = int(request.identity.command_sequence) + 1
        execution["command_acks"][key] = ack
        self.store.set(request.identity.task_id, execution)
        if execution["arguments"].get("scenario") == "cancel_response_loss":
            await context.abort(grpc.StatusCode.UNAVAILABLE, "injected RequestCancel response loss")
        return adapter_pb2.CommandAck(**ack)

    async def UpdateExecution(self, request, context):  # noqa: N802
        del context
        execution = self.store.get(request.identity.task_id)
        if execution is None:
            return self._ack(False, "EXECUTION_NOT_FOUND", "Execution does not exist.", request)
        key = f"update:{request.identity.command_sequence}"
        existing = execution["command_acks"].get(key)
        if existing is not None:
            return adapter_pb2.CommandAck(**existing)
        expected = "comment" if execution.get("input_round") == 2 else "approval"
        if request.input_responses:
            accepted = execution.get("waiting_for_input") and all(
                value.key == expected
                and MessageToDict(value.result).get("action") == "accept"
                for value in request.input_responses
            )
        else:
            accepted = execution.get("waiting_for_input") and all(
                value.input_request_key == expected for value in request.inputs
            )
        if accepted and execution["arguments"].get("scenario") == "multi_round_input" and expected == "approval":
            execution["input_round"] = 2
            execution["snapshot"] = self._snapshot_dict(
                request.identity.task_id,
                execution["external_execution_id"],
                "WAITING_INPUT",
                2,
                "COMMENT_REQUIRED",
                "A second input round is required.",
                None,
                execution["binding"],
            )
            execution["snapshot"]["input_requests"] = [
                {
                    "key": "comment",
                    "description": "Provide an audit comment.",
                    "schema": {"type": "string", "minLength": 1},
                    "required": True,
                }
            ]
            execution["snapshot"]["mcp_input_requests"] = []
        elif accepted:
            execution["waiting_for_input"] = False
            revision = 3 if execution.get("input_round") == 2 else 2
            execution["snapshot"] = self._snapshot_dict(
                request.identity.task_id,
                execution["external_execution_id"],
                "RUNNING",
                revision,
                "INPUT_ACCEPTED",
                "Input accepted; execution resumed.",
                None,
                execution["binding"],
            )
            execution["terminal_snapshot"]["revision"] = revision + 1
        ack = self._ack_dict(
            bool(accepted),
            "INPUT_ACCEPTED" if accepted else "INPUT_REJECTED",
            "Input accepted." if accepted else "Input was not expected.",
            request,
        )
        execution["command_acks"][key] = ack
        self.store.set(request.identity.task_id, execution)
        return adapter_pb2.CommandAck(**ack)

    async def PauseExecution(self, request, context):  # noqa: N802
        del context
        return self._pause_resume(request, "PAUSED", "pause")

    async def ResumeExecution(self, request, context):  # noqa: N802
        del context
        return self._pause_resume(request, "RESUMING", "resume")

    def _pause_resume(self, request, state: str, command: str):
        execution = self.store.get(request.identity.task_id)
        if execution is None:
            return self._ack(False, "EXECUTION_NOT_FOUND", "Execution does not exist.", request)
        key = f"{command}:{request.identity.command_sequence}"
        existing = execution["command_acks"].get(key)
        if existing is not None:
            return adapter_pb2.CommandAck(**existing)
        revision = int(execution["snapshot"]["revision"]) + 1
        execution["snapshot"] = self._snapshot_dict(
            request.identity.task_id,
            execution["external_execution_id"],
            state,
            revision,
            "PAUSED_BY_CLIENT" if command == "pause" else "RESUMED_BY_CLIENT",
            "Execution paused." if command == "pause" else "Execution resuming.",
            None,
            execution["binding"],
        )
        execution["hold_snapshot"] = command == "pause"
        if command == "resume":
            execution["terminal_snapshot"]["revision"] = revision + 1
        ack = self._ack_dict(True, f"{command.upper()}_ACCEPTED", f"{command} accepted.", request)
        execution["command_acks"][key] = ack
        self.store.set(request.identity.task_id, execution)
        return adapter_pb2.CommandAck(**ack)

    @staticmethod
    def _binding(request) -> dict[str, Any]:
        return {
            "operation_name": request.operation_name,
            "argument_hash": request.argument_hash,
            "authorization_context_hash": request.execution_context.authorization_context_hash,
            "execution_mode": request.execution_context.execution_mode,
            "simulation_id": request.execution_context.simulation_id,
        }

    @staticmethod
    def _execution(binding, external_id, snapshot, terminal, arguments, reservation_ref):
        return {
            "binding": binding,
            "external_execution_id": external_id,
            "snapshot": snapshot,
            "terminal_snapshot": terminal,
            "arguments": arguments,
            "reservation_ref": reservation_ref,
            "waiting_for_input": False,
            "hold_snapshot": False,
            "input_round": 0,
            "command_acks": {},
        }

    @staticmethod
    def _snapshot_dict(task_id, external_id, state, revision, reason, message, result=None, binding=None):
        binding = binding or {}
        return {
            "task_id": task_id,
            "external_execution_id": external_id,
            "state": state,
            "revision": revision,
            "reason_code": reason,
            "message": message,
            "retryable": False,
            "result": result,
            "input_requests": [],
            "mcp_input_requests": [],
            "evidence": [],
            "operation_name": binding.get("operation_name", ""),
            "argument_hash": binding.get("argument_hash", ""),
            "execution_context": {
                "authorization_context_hash": binding.get("authorization_context_hash", ""),
                "execution_mode": binding.get("execution_mode", 0),
                "simulation_id": binding.get("simulation_id", ""),
            },
        }

    @staticmethod
    def _snapshot(value):
        requests = [
            adapter_pb2.InputRequest(
                key=item["key"],
                description=item["description"],
                input_schema=json_struct(item["schema"]),
                required=item["required"],
            )
            for item in value.get("input_requests", [])
        ]
        mcp_requests = [
            adapter_pb2.McpTaskInputRequest(
                key=item["key"],
                method=item["method"],
                params=json_struct(item["params"]),
            )
            for item in value.get("mcp_input_requests", [])
        ]
        evidence = [
            adapter_pb2.EvidenceItem(
                evidence_id=item["evidence_id"],
                evidence_type=item["evidence_type"],
                observed_at=item["observed_at"],
                payload_ref=adapter_pb2.EvidencePayloadRef(**item["payload_ref"]),
                producer=item.get("producer", []),
                **(
                    {"subject_ref": item["subject_ref"]}
                    if item.get("subject_ref") is not None
                    else {}
                ),
            )
            for item in value.get("evidence", [])
        ]
        return adapter_pb2.ExecutionSnapshot(
            task_id=value["task_id"],
            external_execution_id=value["external_execution_id"],
            state=getattr(adapter_pb2, value["state"]),
            revision=value["revision"],
            reason_code=value["reason_code"],
            message=value["message"],
            retryable=value.get("retryable", False),
            result=json_struct(value["result"] or {}),
            input_requests=requests,
            mcp_input_requests=mcp_requests,
            evidence=evidence,
            observed_at=now_timestamp(),
            operation_name=value["operation_name"],
            argument_hash=value["argument_hash"],
            execution_context=adapter_pb2.ExecutionContext(**value["execution_context"]),
        )

    def _accepted(self, execution):
        return adapter_pb2.StartOperationResponse(
            accepted=adapter_pb2.ExecutionAccepted(
                external_execution_id=execution["external_execution_id"],
                initial_snapshot=self._snapshot(execution["snapshot"]),
            )
        )

    @staticmethod
    def _ack_dict(accepted, reason, message, request):
        return {
            "accepted": accepted,
            "reason_code": reason,
            "message": message,
            "command_sequence": request.identity.command_sequence,
            "identity": {
                "task_id": request.identity.task_id,
                "external_execution_id": request.identity.external_execution_id,
                "operation_name": request.identity.operation_name,
                "argument_hash": request.identity.argument_hash,
                "execution_context": {
                    "authorization_context_hash": request.identity.execution_context.authorization_context_hash,
                    "execution_mode": request.identity.execution_context.execution_mode,
                    "simulation_id": request.identity.execution_context.simulation_id,
                },
                "command_sequence": request.identity.command_sequence,
            },
        }

    def _ack(self, accepted, reason, message, request):
        return adapter_pb2.CommandAck(**self._ack_dict(accepted, reason, message, request))

    @staticmethod
    def _echo_operation():
        return adapter_pb2.OperationDefinition(
            name="echo_sync",
            description="Returns the supplied message synchronously.",
            execution=adapter_pb2.SYNCHRONOUS,
            input_schema=json_struct(
                {
                    "type": "object",
                    "properties": {"message": {"type": "string"}},
                    "required": ["message"],
                    "additionalProperties": False,
                }
            ),
            output_schema=json_struct(
                {
                    "type": "object",
                    "properties": {"message": {"type": "string"}},
                    "required": ["message"],
                    "additionalProperties": False,
                }
            ),
            capabilities=adapter_pb2.OperationCapabilities(availability=True, idempotency=True),
            resource_binding=adapter_pb2.ResourceBinding(mode=adapter_pb2.ResourceBinding.NONE),
        )

    @staticmethod
    def _task_operation():
        return adapter_pb2.OperationDefinition(
            name="durable_task",
            description="Python durable reference task.",
            execution=adapter_pb2.TASK_REQUIRED,
            input_schema=json_struct(
                {
                    "type": "object",
                    "properties": {
                        "resourceId": {"type": "string"},
                        "scenario": {"type": "string"},
                    },
                    "required": ["resourceId"],
                    "additionalProperties": False,
                }
            ),
            output_schema=json_struct(
                {
                    "type": "object",
                    "properties": {
                        "resourceId": {"type": "string"},
                        "completed": {"type": "boolean"},
                    },
                    "required": ["resourceId", "completed"],
                    "additionalProperties": False,
                }
            ),
            capabilities=adapter_pb2.OperationCapabilities(
                availability=True,
                scheduling=True,
                max_elapsed=True,
                cancel=True,
                pause_resume=True,
                input_required=True,
                idempotency=True,
                observations=True,
            ),
            resource_binding=adapter_pb2.ResourceBinding(
                mode=adapter_pb2.ResourceBinding.ARGUMENT_REFERENCE,
                resource_id_json_pointer="/resourceId",
            ),
        )

    @staticmethod
    def _flex_operation():
        return adapter_pb2.OperationDefinition(
            name="flex_task",
            description="Python task-capable reference operation.",
            execution=adapter_pb2.TASK_CAPABLE,
            input_schema=json_struct(
                {
                    "type": "object",
                    "properties": {
                        "resourceId": {"type": "string"},
                        "scenario": {
                            "type": "string",
                            "enum": ["terminal", "terminal_invalid_output", "running"],
                        },
                    },
                    "required": ["resourceId", "scenario"],
                    "additionalProperties": False,
                }
            ),
            output_schema=json_struct(
                {
                    "type": "object",
                    "properties": {
                        "resourceId": {"type": "string"},
                        "completed": {"type": "boolean"},
                    },
                    "required": ["resourceId", "completed"],
                    "additionalProperties": False,
                }
            ),
            capabilities=adapter_pb2.OperationCapabilities(
                availability=True, idempotency=True, observations=True
            ),
            resource_binding=adapter_pb2.ResourceBinding(
                mode=adapter_pb2.ResourceBinding.ARGUMENT_REFERENCE,
                resource_id_json_pointer="/resourceId",
            ),
        )


async def serve() -> None:
    host = os.getenv("ADAPTER_HOST", "0.0.0.0")
    port = int(os.getenv("ADAPTER_PORT", "7001"))
    state_path = os.getenv("ADAPTER_STATE_PATH", "/tmp/sdar-python-adapter-state.json")
    server = grpc.aio.server()
    adapter_pb2_grpc.add_ResourceProviderAdapterServicer_to_server(
        ReferenceAdapter(DurableStore(state_path)), server
    )
    server.add_insecure_port(f"{host}:{port}")
    await server.start()
    logging.info("Python mock Adapter listening on %s:%d", host, port)
    await server.wait_for_termination()


if __name__ == "__main__":
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    asyncio.run(serve())

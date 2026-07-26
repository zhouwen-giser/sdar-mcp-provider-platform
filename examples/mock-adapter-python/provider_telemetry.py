"""Provider-to-Runtime telemetry example; no OpenTelemetry SDK is required."""

from __future__ import annotations

import argparse
import json
import uuid
from dataclasses import dataclass

import grpc
from google.protobuf.json_format import ParseDict
from google.protobuf.struct_pb2 import Struct
from google.protobuf.timestamp_pb2 import Timestamp

from generated import provider_telemetry_pb2, provider_telemetry_pb2_grpc


@dataclass(frozen=True)
class TaskTelemetryBinding:
    task_id: str
    external_execution_id: str
    operation_name: str


def json_struct(value: dict[str, object]) -> Struct:
    message = Struct()
    ParseDict(value, message)
    return message


def example_events(binding: TaskTelemetryBinding | None = None):
    occurred_at = Timestamp()
    occurred_at.GetCurrentTime()

    def event(event_type, payload):
        return provider_telemetry_pb2.ProviderTelemetryEvent(
            provider_event_id=str(uuid.uuid4()),
            event_type=event_type,
            resource_id="mock-resource-1",
            resource_type="mock.resource",
            occurred_at=occurred_at,
            attributes=json_struct({"source": "python-example"}),
            payload=json_struct(payload),
        )

    events = [
        event(
            provider_telemetry_pb2.RESOURCE_STATE,
            {"state": "ready", "reasonCode": "RESOURCE_READY"},
        ),
        event(
            provider_telemetry_pb2.RESOURCE_METRIC,
            {"metricName": "utilization", "value": 0.42, "unit": "ratio"},
        ),
        event(
            provider_telemetry_pb2.RESOURCE_HEALTH,
            {"health": "healthy", "reasonCode": "CHECK_OK"},
        ),
    ]
    if binding is not None:
        progress = event(
            provider_telemetry_pb2.EXECUTION_PROGRESS,
            {"current": 4, "total": 10, "percentage": 40, "unit": "items"},
        )
        progress.task_id = binding.task_id
        progress.external_execution_id = binding.external_execution_id
        progress.operation_name = binding.operation_name
        events.append(progress)
    for sequence, item in enumerate(events, start=1):
        item.provider_event_sequence = sequence
    return events


async def emit_with_duplicate_retry(endpoint: str, provider_id: str, events, credentials=None):
    channel = (
        grpc.aio.insecure_channel(endpoint)
        if credentials is None
        else grpc.aio.secure_channel(endpoint, credentials)
    )
    async with channel:
        stub = provider_telemetry_pb2_grpc.ProviderTelemetryIngressStub(channel)
        request = provider_telemetry_pb2.EmitProviderEventsRequest(
            provider_id=provider_id, events=events
        )
        first = await stub.EmitProviderEvents(request)
        duplicate = await stub.EmitProviderEvents(request)
        return first, duplicate


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args()
    if arguments.self_test:
        binding = TaskTelemetryBinding("task-example", "execution-example", "durable_task")
        events = example_events(binding)
        print(json.dumps({"eventCount": len(events), "types": [item.event_type for item in events]}))
        return
    raise SystemExit("Use this module from the Adapter or run with --self-test")


if __name__ == "__main__":
    main()

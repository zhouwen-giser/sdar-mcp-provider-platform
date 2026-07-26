FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /workspace
COPY examples/mock-adapter-python/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
COPY proto /workspace/proto
COPY examples/mock-adapter-python /workspace/examples/mock-adapter-python
RUN python -m grpc_tools.protoc \
      -I/workspace/proto/io/sdar/mcp/tasks/adapter/v1 \
      -I/usr/local/lib/python3.12/site-packages/grpc_tools/_proto \
      --python_out=/workspace/examples/mock-adapter-python/generated \
      --grpc_python_out=/workspace/examples/mock-adapter-python/generated \
      /workspace/proto/io/sdar/mcp/tasks/adapter/v1/adapter.proto \
    && sed -i 's/^import adapter_pb2/from . import adapter_pb2/' \
      /workspace/examples/mock-adapter-python/generated/adapter_pb2_grpc.py \
    && python -m grpc_tools.protoc \
      -I/workspace/proto/io/sdar/mcp/tasks/telemetry/v1 \
      -I/usr/local/lib/python3.12/site-packages/grpc_tools/_proto \
      --python_out=/workspace/examples/mock-adapter-python/generated \
      --grpc_python_out=/workspace/examples/mock-adapter-python/generated \
      /workspace/proto/io/sdar/mcp/tasks/telemetry/v1/provider_telemetry.proto \
    && sed -i 's/^import provider_telemetry_pb2/from . import provider_telemetry_pb2/' \
      /workspace/examples/mock-adapter-python/generated/provider_telemetry_pb2_grpc.py

WORKDIR /workspace/examples/mock-adapter-python
CMD ["python", "adapter.py"]

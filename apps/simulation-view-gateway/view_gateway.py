"""Project-owned CARLA view. No tick, vehicle control or externally owned camera mutation."""
import argparse
import base64
import datetime as dt
import fcntl
import hashlib
import hmac
import json
import math
import os
from pathlib import Path
import queue
import re
import resource
import signal
import struct
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import zlib
import uuid
from urllib.parse import unquote

PROTOCOL = "smpp.simulation-view/1"
ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")


class ViewError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def fail(condition, code):
    if not condition:
        raise ViewError(code)


def finite(v):
    return type(v) in (int, float) and math.isfinite(v)


def durable_json(path, value):
    temporary = path.with_suffix(".tmp")
    fd = os.open(temporary, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "w") as out:
        out.write(canonical(value))
        out.flush()
        os.fsync(out.fileno())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def thumbnail(image):
    """Bounded 128x72 PNG from actual BGRA bytes; no imaging dependency."""
    raw = bytes(image.raw_data)
    fail(len(raw) == image.width * image.height * 4, "ZMQ_VIEW_IMAGE_SIZE_INVALID")
    rows = bytearray()
    for y in range(72):
        rows.append(0)
        for x in range(128):
            offset = (int(y * image.height / 72) * image.width + int(x * image.width / 128)) * 4
            rows.extend((raw[offset + 2], raw[offset + 1], raw[offset]))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 128, 72, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(rows))) + chunk(b"IEND", b"")
    return {"mediaType": "image/png", "width": 128, "height": 72,
            "sha256": digest(png), "base64": base64.b64encode(png).decode("ascii")}


class ViewGateway:
    def __init__(self, config, api):
        required = {"resourceId", "viewId", "ownershipId", "apiVersion", "worldId",
                    "parentActorId", "parentRoleName", "carlaHost", "carlaPort",
                    "stateDir", "tokenFile", "port", "transform", "width", "height",
                    "minFovDeg", "maxFovDeg"}
        fail(type(config) is dict and set(config) == required, "ZMQ_VIEW_CONFIG_INVALID")
        for name in ("resourceId", "viewId", "ownershipId"):
            fail(isinstance(config[name], str) and ID.fullmatch(config[name]), "ZMQ_VIEW_CONFIG_INVALID")
        fail(str(uuid.UUID(config["ownershipId"])) == config["ownershipId"], "ZMQ_VIEW_CONFIG_INVALID")
        for name in ("parentRoleName", "apiVersion"):
            fail(isinstance(config[name], str) and 0 < len(config[name]) <= 128 and
                 all(ord(c) >= 32 for c in config[name]), "ZMQ_VIEW_CONFIG_INVALID")
        fail(isinstance(config["worldId"], str) and re.fullmatch(r"0|[1-9][0-9]{0,19}", config["worldId"]) and int(config["worldId"]) <= 18446744073709551615, "ZMQ_VIEW_CONFIG_INVALID")
        fail(type(config["parentActorId"]) is int and config["parentActorId"] > 0, "ZMQ_VIEW_CONFIG_INVALID")
        fail(type(config["carlaPort"]) is int and 1 <= config["carlaPort"] <= 65535, "ZMQ_VIEW_CONFIG_INVALID")
        fail(type(config["port"]) is int and 1024 <= config["port"] <= 65535, "ZMQ_VIEW_CONFIG_INVALID")
        fail(isinstance(config["carlaHost"], str) and re.fullmatch(r"[A-Za-z0-9.-]{1,253}", config["carlaHost"]), "ZMQ_VIEW_CONFIG_INVALID")
        fail(type(config["width"]) is int and 128 <= config["width"] <= 1920 and
             type(config["height"]) is int and 72 <= config["height"] <= 1080, "ZMQ_VIEW_CONFIG_INVALID")
        fail(finite(config["minFovDeg"]) and finite(config["maxFovDeg"]) and
             5 <= config["minFovDeg"] <= config["maxFovDeg"] <= 160, "ZMQ_VIEW_CONFIG_INVALID")
        fail(type(config["transform"]) is dict and set(config["transform"]) ==
             {"x", "y", "z", "pitch", "yaw", "roll"} and
             all(finite(v) and abs(v) <= 360 for v in config["transform"].values()), "ZMQ_VIEW_CONFIG_INVALID")
        self.config, self.api = config, api
        self.root = Path(config["stateDir"])
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        fail(not self.root.stat().st_mode & 0o077, "ZMQ_VIEW_PRIVATE_STATE_REQUIRED")
        self.lock_file = (self.root / ".owner.lock").open("a")
        fcntl.flock(self.lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        secret = Path(config["tokenFile"])
        fail(not secret.stat().st_mode & 0o077, "ZMQ_VIEW_PRIVATE_TOKEN_REQUIRED")
        self.token = secret.read_text().strip()
        fail(len(self.token) >= 32, "ZMQ_VIEW_TOKEN_INVALID")
        self.mutex = threading.Lock()
        self.sensors = {}
        self.close_errors = []
        self.client = api.Client(config["carlaHost"], config["carlaPort"])
        self.client.set_timeout(1.5)

    def close(self):
        # Closing the service never destroys actors or reapplies commands.
        for sensor in self.sensors.values():
            try:
                sensor.stop()
            except Exception:
                self.close_errors.append("ZMQ_VIEW_LISTENER_CLOSE_FAILED")
        self.sensors.clear()
        self.lock_file.close()

    def source(self):
        c = self.config
        # Reject mismatched SDK before get_world: incompatible native deserialization can abort.
        fail(self.client.get_client_version() == c["apiVersion"] and
             self.client.get_server_version() == c["apiVersion"], "ZMQ_VIEW_API_VERSION_MISMATCH")
        world = self.client.get_world()
        fail(str(world.id) == c["worldId"], "ZMQ_VIEW_WORLD_CHANGED")
        parent = world.get_actor(c["parentActorId"])
        fail(parent is not None and parent.is_alive and parent.type_id.startswith("vehicle.") and
             parent.attributes.get("role_name") == c["parentRoleName"], "ZMQ_VIEW_PARENT_MISMATCH")
        return world, parent

    def status(self):
        world, parent = self.source()
        return {"protocol": PROTOCOL, "viewId": self.config["viewId"],
                "ownershipId": self.config["ownershipId"], "resourceId": self.config["resourceId"],
                "apiVersion": self.config["apiVersion"], "worldId": str(world.id),
                "parentActorId": parent.id, "parentRoleName": self.config["parentRoleName"],
                "minFovDeg": self.config["minFovDeg"], "maxFovDeg": self.config["maxFovDeg"],
                "ownership": "project_owned", "eoRecognitionAffected": False, "observedAt": utc()}

    def validate(self, request):
        c = self.config
        fail(type(request) is dict and set(request) == {
            "protocol", "requestId", "resourceId", "ownershipId", "expectedApiVersion",
            "expectedWorldId", "parentActorId", "parentRoleName", "deadlineAt", "parameters"
        }, "ZMQ_VIEW_REQUEST_INVALID")
        fail(isinstance(request["requestId"], str) and ID.fullmatch(request["requestId"]), "ZMQ_VIEW_REQUEST_INVALID")
        for key, expected in (("protocol", PROTOCOL), ("resourceId", c["resourceId"]),
                              ("ownershipId", c["ownershipId"]), ("expectedApiVersion", c["apiVersion"]),
                              ("expectedWorldId", c["worldId"]), ("parentActorId", c["parentActorId"]),
                              ("parentRoleName", c["parentRoleName"])):
            fail(type(request[key]) is type(expected) and request[key] == expected, "ZMQ_VIEW_BINDING_MISMATCH")
        p = request["parameters"]
        fail(type(p) is dict and set(p) == {"viewId", "horizontalFovDeg", "acknowledgeCameraRecreation"}, "ZMQ_VIEW_PARAMETERS_INVALID")
        fail(p["viewId"] == c["viewId"] and p["acknowledgeCameraRecreation"] is True and
             finite(p["horizontalFovDeg"]) and c["minFovDeg"] <= p["horizontalFovDeg"] <= c["maxFovDeg"], "ZMQ_VIEW_PARAMETERS_INVALID")
        fail(isinstance(request["deadlineAt"], str) and request["deadlineAt"].endswith("Z"), "ZMQ_VIEW_DEADLINE_INVALID")
        deadline = dt.datetime.fromisoformat(request["deadlineAt"].replace("Z", "+00:00")).timestamp()
        fail(0 < deadline - time.time() <= 300, "ZMQ_VIEW_DEADLINE_EXPIRED")
        return deadline

    def path(self, request_id):
        fail(isinstance(request_id, str) and ID.fullmatch(request_id), "ZMQ_VIEW_REQUEST_INVALID")
        return self.root / (digest(request_id.encode()) + ".json")

    def query(self, request_id):
        path = self.path(request_id)
        fail(path.exists(), "ZMQ_VIEW_COMMAND_NOT_FOUND")
        saved = json.loads(path.read_text())
        return saved["reply"]

    def apply(self, request):
        # Check identity before exposing a prior receipt, but not an old deadline for duplicates.
        request_id = request.get("requestId") if isinstance(request, dict) else None
        path = self.path(request_id)
        request_hash = digest(canonical(request).encode())
        fail(self.mutex.acquire(blocking=False), "ZMQ_VIEW_BUSY")
        try:
            if path.exists():
                saved = json.loads(path.read_text())
                fail(saved["requestHash"] == request_hash, "ZMQ_VIEW_COMMAND_ID_CONFLICT")
                return saved["reply"]
            deadline = self.validate(request)
            reply = {"protocol": PROTOCOL, "requestId": request_id, "requestHash": request_hash,
                     "status": "unknown", "reasonCode": "ZMQ_VIEW_ATTEMPT_OUTCOME_UNKNOWN",
                     "attempted": False, "evidence": None, "missingEvidence": ["VIEW_APPLICATION_UNCONFIRMED"]}

            def save():
                durable_json(path, {"requestHash": request_hash, "request": request, "reply": reply})

            save()
            try:
                world, parent = self.source()
                current = self.root / "current.json"
                previous = None
                if current.exists():
                    identity = json.loads(current.read_text())
                    fail(identity["worldId"] == str(world.id) and identity["ownershipId"] == self.config["ownershipId"], "ZMQ_VIEW_PREVIOUS_IDENTITY_CONFLICT")
                    previous = world.get_actor(identity["cameraActorId"])
                    fail(previous is not None and previous.is_alive and previous.parent is not None and
                         previous.parent.id == parent.id and previous.type_id == "sensor.camera.rgb" and
                         previous.attributes.get("role_name") == identity["roleName"], "ZMQ_VIEW_PREVIOUS_OWNERSHIP_CONFLICT")
                prefix = "smpp-view:" + self.config["ownershipId"] + ":"
                known = previous.id if previous else None
                fail(not any(a.id != known and a.attributes.get("role_name", "").startswith(prefix)
                             for a in world.get_actors().filter("sensor.camera.rgb")), "ZMQ_VIEW_UNRECONCILED_OWN_CAMERA")
                baseline = world.get_snapshot().frame
                blueprint = world.get_blueprint_library().find("sensor.camera.rgb")
                role = prefix + request_id
                for key, value in {"role_name": role, "fov": request["parameters"]["horizontalFovDeg"],
                                   "image_size_x": self.config["width"], "image_size_y": self.config["height"],
                                   "sensor_tick": 0.5}.items():
                    blueprint.set_attribute(key, str(value))
                t = self.config["transform"]
                transform = self.api.Transform(self.api.Location(x=t["x"], y=t["y"], z=t["z"]),
                                               self.api.Rotation(pitch=t["pitch"], yaw=t["yaw"], roll=t["roll"]))
                fail(time.time() < deadline, "ZMQ_VIEW_DEADLINE_EXPIRED")
                reply["attempted"] = True
                save()  # Durable fence before spawn. Unknown attempts never spawn again.
                camera = world.spawn_actor(blueprint, transform, attach_to=parent,
                                           attachment_type=self.api.AttachmentType.Rigid)
                self.sensors[camera.id] = camera
                images = queue.Queue(maxsize=1)

                def receive(image):
                    if image.frame > baseline:
                        try:
                            images.put_nowait(image)
                        except queue.Full:
                            pass

                camera.listen(receive)
                remaining = min(4.0, deadline - time.time())
                fail(remaining > 0, "ZMQ_VIEW_DEADLINE_EXPIRED")
                try:
                    image = images.get(timeout=remaining)
                except queue.Empty:
                    raise ViewError("ZMQ_VIEW_NEW_FRAME_TIMEOUT") from None
                fail(time.time() < deadline, "ZMQ_VIEW_DEADLINE_EXPIRED")
                actual = float(camera.attributes["fov"])
                requested = request["parameters"]["horizontalFovDeg"]
                fail(finite(actual) and finite(image.fov) and abs(actual-requested) <= 0.01 and
                     abs(image.fov-actual) <= 0.01 and image.width == self.config["width"] and
                     image.height == self.config["height"], "ZMQ_VIEW_FRAME_CONFLICT")
                world_now, _ = self.source()
                fail(world_now.id == world.id and camera.parent is not None and camera.parent.id == parent.id and
                     camera.attributes.get("role_name") == role, "ZMQ_VIEW_SOURCE_CHANGED")
                fx = image.width / (2 * math.tan(math.radians(actual) / 2))
                evidence = {"schemaVersion": "smpp.simulation-view-evidence/1", "ownership": "project_owned",
                            "eoRecognitionAffected": False, "viewId": self.config["viewId"],
                            "ownershipId": self.config["ownershipId"], "worldId": str(world.id),
                            "apiVersion": self.config["apiVersion"], "parentActorId": parent.id,
                            "parentRoleName": self.config["parentRoleName"], "cameraActorId": camera.id,
                            "replacedCameraActorId": previous.id if previous else None, "cameraRevision": request_id,
                            "actualHorizontalFovDeg": actual, "imageFovDeg": image.fov,
                            "imageWidth": image.width, "imageHeight": image.height, "baselineFrame": baseline,
                            "frame": {"frameId": image.frame, "simulationTimeSeconds": image.timestamp,
                                      "receivedAt": utc(), "rawSha256": digest(bytes(image.raw_data)),
                                      "thumbnail": thumbnail(image)},
                            "intrinsics": {"fx": fx, "fy": fx, "cx": image.width/2, "cy": image.height/2,
                                           "source": "derived_from_simulator_attributes", "geolocation": "not_provided"},
                            "previousCameraReleased": previous is None}
                reply.update(status="partial", reasonCode="ZMQ_VIEW_PREVIOUS_RELEASE_UNCONFIRMED", evidence=evidence,
                             missingEvidence=["PREVIOUS_VIEW_RELEASE_UNCONFIRMED"])
                save()  # New-frame evidence is durable before attempting to release the old view.
                if previous:
                    # Recheck exact ownership immediately before destroy.
                    fail(previous.attributes.get("role_name") == prefix + identity["requestId"], "ZMQ_VIEW_PREVIOUS_OWNERSHIP_CONFLICT")
                    previous.stop()
                    evidence["previousCameraReleased"] = previous.destroy() is True
                    if evidence["previousCameraReleased"]:
                        self.sensors.pop(previous.id, None)
                if evidence["previousCameraReleased"]:
                    reply.update(status="applied", reasonCode="ZMQ_VIEW_APPLIED", missingEvidence=[])
                durable_json(current, {"worldId": str(world.id), "ownershipId": self.config["ownershipId"],
                                       "cameraActorId": camera.id, "roleName": role, "requestId": request_id})
                save()
            except Exception as error:
                if not reply["attempted"]:
                    reply.update(status="rejected", missingEvidence=[])
                reply["reasonCode"] = error.code if isinstance(error, ViewError) else "ZMQ_VIEW_BACKEND_FAILED"
                save()
            return reply
        finally:
            self.mutex.release()


def server(gateway):
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def log_message(self, *_args):
            pass

        def handle_request(self):
            try:
                fail(hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + gateway.token), "ZMQ_VIEW_UNAUTHORIZED")
                if self.command == "GET" and self.path == "/v1/status":
                    result = gateway.status()
                elif self.command == "GET" and self.path.startswith("/v1/commands/"):
                    result = gateway.query(unquote(self.path[len("/v1/commands/"):], errors="strict"))
                elif self.command == "POST" and self.path == "/v1/commands":
                    length = int(self.headers.get("Content-Length", "0"))
                    fail(self.headers.get("Content-Type") == "application/json" and 0 < length <= 8192,
                         "ZMQ_VIEW_BODY_INVALID")
                    result = gateway.apply(json.loads(self.rfile.read(length)))
                else:
                    raise ViewError("ZMQ_VIEW_ROUTE_NOT_FOUND")
                status = 200
            except Exception as error:
                code = error.code if isinstance(error, ViewError) else "ZMQ_VIEW_REQUEST_FAILED"
                status = 401 if code == "ZMQ_VIEW_UNAUTHORIZED" else 409
                result = {"error": code}
            data = canonical(result).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        do_GET = handle_request
        do_POST = handle_request

    return ThreadingHTTPServer(("127.0.0.1", gateway.config["port"]), Handler)


if __name__ == "__main__":
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--probe", action="store_true")
    args = parser.parse_args()
    import carla  # Deployment installs the exact matching SDK; never imported by isolated unit tests.
    service = ViewGateway(json.loads(Path(args.config).read_text()), carla)
    http = None

    def terminate(_signal, _frame):
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, terminate)
    try:
        if args.probe:
            print(canonical(service.status()))
        else:
            http = server(service)
            http.serve_forever()
    finally:
        if http:
            http.server_close()
        service.close()

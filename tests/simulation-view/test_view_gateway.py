import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import types
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch
import datetime as dt
import queue

source = Path(__file__).resolve().parents[2] / "apps/simulation-view-gateway/view_gateway.py"
spec = importlib.util.spec_from_file_location("view_gateway", source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Actors(list):
    def filter(self, _pattern):
        return Actors(a for a in self if a.type_id == "sensor.camera.rgb" and a.is_alive)


class Blueprint:
    def __init__(self):
        self.attributes = {}

    def set_attribute(self, name, value):
        self.attributes[name] = value


class Sensor:
    type_id = "sensor.camera.rgb"
    is_alive = True

    def __init__(self, world, blueprint, parent):
        self.id = 100 + world.spawns
        self.parent, self.world = parent, world
        self.attributes = dict(blueprint.attributes)
        self.destroy_count = self.stop_count = 0

    def listen(self, callback):
        actual = float(self.attributes["fov"])
        image = types.SimpleNamespace(frame=self.world.image_frame, timestamp=12.5,
                                      fov=actual + self.world.fov_conflict,
                                      width=128, height=72, raw_data=bytes((20, 30, 40, 255))*128*72)
        callback(image)

    def stop(self):
        self.stop_count += 1

    def destroy(self):
        self.destroy_count += 1
        if not self.world.release:
            return False
        self.is_alive = False
        return True


class World:
    id = 7

    def __init__(self):
        self.parent = types.SimpleNamespace(id=1, type_id="vehicle.test", is_alive=True,
                                            attributes={"role_name": "isolated-vehicle"})
        self.actors = Actors([self.parent])
        self.spawns = self.fov_conflict = 0
        self.image_frame = 43
        self.release = True

    def get_actor(self, actor_id):
        return next((a for a in self.actors if a.id == actor_id and a.is_alive), None)

    def get_actors(self):
        return self.actors

    def get_snapshot(self):
        return types.SimpleNamespace(frame=42)

    def get_blueprint_library(self):
        return types.SimpleNamespace(find=lambda _: Blueprint())

    def spawn_actor(self, blueprint, _transform, attach_to, attachment_type):
        self.spawns += 1
        sensor = Sensor(self, blueprint, attach_to)
        self.actors.append(sensor)
        return sensor


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.token = self.root / "token"
        self.token.write_text("isolated-test-token-" + "x"*32)
        self.token.chmod(0o600)
        self.config = dict(resourceId="isolated-ugv", viewId="test-view",
                           ownershipId="12345678-1234-4234-8234-123456789abc", apiVersion="isolated-api",
                           worldId="7", parentActorId=1, parentRoleName="isolated-vehicle", carlaHost="127.0.0.1",
                           carlaPort=2000, stateDir=str(self.root / "state"), tokenFile=str(self.token), port=19107,
                           transform=dict(x=0, y=0, z=1.5, pitch=0, yaw=0, roll=0), width=128, height=72,
                           minFovDeg=5, maxFovDeg=160)
        self.world = World()
        self.world_reads = 0
        self.version = "isolated-api"

        def get_world():
            self.world_reads += 1
            return self.world

        client = types.SimpleNamespace(set_timeout=lambda _: None,
                                       get_client_version=lambda: self.version,
                                       get_server_version=lambda: "isolated-api", get_world=get_world)
        self.api = types.SimpleNamespace(Client=lambda *_: client,
                                         Location=lambda **kw: kw, Rotation=lambda **kw: kw,
                                         Transform=lambda *args: args, AttachmentType=types.SimpleNamespace(Rigid=0))
        self.gateway = module.ViewGateway(self.config, self.api)

    def tearDown(self):
        self.gateway.close()
        self.temp.cleanup()

    def request(self, request_id="req-test"):
        return dict(protocol=module.PROTOCOL, requestId=request_id, resourceId="isolated-ugv",
                    ownershipId=self.config["ownershipId"], expectedApiVersion="isolated-api",
                    expectedWorldId=self.config["worldId"], parentActorId=1, parentRoleName="isolated-vehicle",
                    deadlineAt=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(seconds=30)).isoformat().replace("+00:00", "Z"),
                    parameters=dict(viewId="test-view", horizontalFovDeg=60, acknowledgeCameraRecreation=True))

    def test_real_backend_algorithm_proves_attributes_new_frame_and_thumbnail(self):
        r = self.gateway.apply(self.request())
        self.assertEqual(r["status"], "applied")
        e = r["evidence"]
        self.assertEqual(e["actualHorizontalFovDeg"], 60)
        self.assertGreater(e["frame"]["frameId"], e["baselineFrame"])
        self.assertEqual(e["ownership"], "project_owned")
        self.assertFalse(e["eoRecognitionAffected"])
        self.assertTrue(e["previousCameraReleased"])
        self.assertLess(len(e["frame"]["thumbnail"]["base64"]), 65536)
        self.assertEqual(self.world.spawns, 1)

    def test_duplicate_restart_and_conflict_do_not_respawn(self):
        request = self.request()
        result = self.gateway.apply(request)
        self.assertEqual(self.gateway.apply(request), result)
        self.gateway.close()
        self.gateway = module.ViewGateway(self.config, self.api)
        self.assertEqual(self.gateway.query(request["requestId"]), result)
        self.assertEqual(self.gateway.apply(request), result)
        conflicting = {**request, "parameters": {**request["parameters"], "horizontalFovDeg": 80}}
        with self.assertRaisesRegex(module.ViewError, "COMMAND_ID_CONFLICT"):
            self.gateway.apply(conflicting)
        self.assertEqual(self.world.spawns, 1)

    def test_recreation_only_releases_exact_owned_camera_after_new_frame(self):
        first = self.gateway.apply(self.request("first"))
        old = self.world.get_actor(first["evidence"]["cameraActorId"])
        second = self.gateway.apply(self.request("second:with-colon"))
        self.assertEqual(second["status"], "applied")
        self.assertEqual(second["evidence"]["replacedCameraActorId"], old.id)
        self.assertEqual(old.destroy_count, 1)

    def test_uint64_world_identity_is_never_rounded_through_json(self):
        self.world.id = 1152921504606846977
        self.config["worldId"] = str(self.world.id)
        result = self.gateway.apply(self.request())
        self.assertEqual(result["status"], "applied")
        self.assertEqual(result["evidence"]["worldId"], "1152921504606846977")

    def test_sdk_mismatch_rejects_before_native_world_deserialization(self):
        self.version = "different-sdk"
        r = self.gateway.apply(self.request())
        self.assertEqual(r["status"], "rejected")
        self.assertFalse(r["attempted"])
        self.assertEqual(r["reasonCode"], "ZMQ_VIEW_API_VERSION_MISMATCH")
        self.assertEqual(self.world_reads, 0)
        self.assertEqual(self.world.spawns, 0)

    def test_source_and_input_rejections_never_spawn(self):
        for field, value in (("expectedWorldId", 8), ("parentActorId", 99), ("ownershipId", "other")):
            with self.assertRaises(module.ViewError):
                self.gateway.apply({**self.request(field), field: value})
        r = self.request("invalid")
        r["parameters"]["horizontalFovDeg"] = float("nan")
        with self.assertRaises(module.ViewError):
            self.gateway.apply(r)
        self.world.parent.attributes["role_name"] = "external-vehicle"
        r = self.gateway.apply(self.request("wrong-parent"))
        self.assertEqual(r["status"], "rejected")
        self.assertEqual(self.world.spawns, 0)

    def test_stale_frame_or_actual_fov_conflict_remains_unknown_and_never_replays(self):
        self.world.fov_conflict = 5
        r = self.request()
        result = self.gateway.apply(r)
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(result["reasonCode"], "ZMQ_VIEW_FRAME_CONFLICT")
        self.assertIsNone(result["evidence"])
        self.assertEqual(self.gateway.apply(r), result)
        self.assertEqual(self.world.spawns, 1)

    def test_new_frame_timeout_does_not_destroy_previous_camera(self):
        first = self.gateway.apply(self.request("first"))
        old = self.world.get_actor(first["evidence"]["cameraActorId"])
        self.world.image_frame = 42
        with patch.object(module.queue.Queue, "get", side_effect=queue.Empty):
            result = self.gateway.apply(self.request("timeout"))
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(result["reasonCode"], "ZMQ_VIEW_NEW_FRAME_TIMEOUT")
        self.assertEqual(old.destroy_count, 0)
        self.assertEqual(self.world.spawns, 2)

    def test_foreign_camera_is_never_destroyed(self):
        self.gateway.apply(self.request("first"))
        current = self.gateway.root / "current.json"
        data = json.loads(current.read_text())
        old = self.world.get_actor(data["cameraActorId"])
        old.attributes["role_name"] = "external-EO-camera"
        r = self.gateway.apply(self.request("second"))
        self.assertEqual(r["status"], "rejected")
        self.assertEqual(old.destroy_count, 0)
        self.assertEqual(self.world.spawns, 1)

    def test_cleanup_failure_is_partial(self):
        self.gateway.apply(self.request("first"))
        self.world.release = False
        r = self.gateway.apply(self.request("second"))
        self.assertEqual(r["status"], "partial")
        self.assertFalse(r["evidence"]["previousCameraReleased"])

    def test_authenticated_http_and_read_only_start(self):
        http = module.server(self.gateway)
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        try:
            url = "http://127.0.0.1:" + str(http.server_port)
            with self.assertRaises(urllib.error.HTTPError) as e:
                urllib.request.urlopen(url + "/v1/status")
            self.assertEqual(e.exception.code, 401)
            self.assertEqual(self.world.spawns, 0)
            headers = {"Authorization": "Bearer " + self.gateway.token, "Content-Type": "application/json"}
            req = urllib.request.Request(url + "/v1/commands", data=json.dumps(self.request()).encode(), headers=headers)
            with urllib.request.urlopen(req) as response:
                self.assertEqual(json.load(response)["status"], "applied")
            with urllib.request.urlopen(urllib.request.Request(url + "/v1/commands/req-test", headers=headers)) as response:
                self.assertEqual(json.load(response)["status"], "applied")
            self.assertEqual(self.world.spawns, 1)
        finally:
            http.shutdown()
            http.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()

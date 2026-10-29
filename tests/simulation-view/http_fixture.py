"""Isolated API double for the real gateway algorithm; never imports CARLA or reaches a site."""
import argparse
import json
from pathlib import Path
import signal
import sys
import time
import types
from test_view_gateway import module, World

parser = argparse.ArgumentParser()
parser.add_argument("--root", required=True)
args = parser.parse_args()
root = Path(args.root)
config = json.loads((root / "config.json").read_text())
world = World()


def control():
    path = root / "control.json"
    return json.loads(path.read_text()) if path.exists() else {}


spawn_original = world.spawn_actor


def spawn(*args, **kwargs):
    world.fov_conflict = control().get("fovConflict", 0)
    camera = spawn_original(*args, **kwargs)
    module.durable_json(root / "counts.json", {"spawns": world.spawns})
    return camera


world.spawn_actor = spawn
client = types.SimpleNamespace(set_timeout=lambda _: None,
                               get_client_version=lambda: control().get("apiVersion", "isolated-api"),
                               get_server_version=lambda: "isolated-api", get_world=lambda: world)
api = types.SimpleNamespace(Client=lambda *_: client, Location=lambda **kw: kw, Rotation=lambda **kw: kw,
                            Transform=lambda *args: args, AttachmentType=types.SimpleNamespace(Rigid=0))
gateway = module.ViewGateway(config, api)
apply_original = gateway.apply


def apply(request):
    result = apply_original(request)
    time.sleep(control().get("replyDelayMs", 0) / 1000)
    return result


gateway.apply = apply
gateway.config["port"] = 0  # Only this isolated fixture overrides the validated deployment port.
http = module.server(gateway)
print(json.dumps({"port": http.server_port}), flush=True)
signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
try:
    http.serve_forever()
finally:
    http.server_close()
    gateway.close()

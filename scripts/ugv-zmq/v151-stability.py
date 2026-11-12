#!/usr/bin/env python3
"""1.5.1 readonly soak plus explicit chassis and V2 route-preview probes. No motion."""
import argparse
import base64
import datetime
import hashlib
import json
import pathlib
import subprocess
import time
import urllib.request
import uuid


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def docker(*args):
    return subprocess.check_output(['docker', *args], timeout=30).decode()


def inspect(names):
    return [{
        'name': c['Name'].lstrip('/'), 'id': c['Id'], 'image': c['Image'],
        'running': c['State']['Running'], 'oomKilled': c['State']['OOMKilled'],
        'restartCount': c['RestartCount'], 'startedAt': c['State']['StartedAt'],
        'health': c['State'].get('Health', {}).get('Status'),
    } for c in json.loads(docker('inspect', *names))]


META = {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientInfo': {'name': 'smpp-v15-stability', 'version': '1.0.0'},
    'io.modelcontextprotocol/clientCapabilities': {'extensions': {
        'io.modelcontextprotocol/tasks': {},
        'io.sdar/taskExecution': {'profileVersion': '1.0'},
        'io.sdar/taskBusiness': {'profileVersion': '1.0-rc2'},
        'io.sdar/businessEvents': {'profileVersion': '1.0'},
    }},
}


def get_health(url):
    with urllib.request.urlopen(url, timeout=10) as response:
        response.read(65536)
        return response.status


def tool(url, name, arguments):
    if name not in {'vehicle_get_state', 'vehicle_get_capabilities', 'vehicle_zmq_get_frame', 'vehicle_zmq_plan_route'}:
        raise RuntimeError('MONITOR_NON_READ_ONLY_TOOL_REJECTED')
    body = json.dumps({'jsonrpc': '2.0', 'id': str(uuid.uuid4()), 'method': 'tools/call',
                       'params': {'name': name, 'arguments': arguments, '_meta': META}}).encode()
    request = urllib.request.Request(url, data=body, headers={
        'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2026-07-28', 'MCP-Method': 'tools/call', 'MCP-Name': name,
        'X-Sdar-Execution-Mode': 'live',
    })
    with urllib.request.urlopen(request, timeout=15) as response:
        raw = response.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024:
            raise RuntimeError('MONITOR_RESPONSE_TOO_LARGE')
        envelope = json.loads(raw)
    if 'error' in envelope:
        raise RuntimeError('MONITOR_MCP_RPC_ERROR')
    result = envelope['result']
    if result.get('isError'):
        raise RuntimeError(str(result.get('structuredContent', {}).get('reasonCode', 'MCP_TOOL_FAILED')))
    return result['structuredContent']


def frame_sample(url, resource_id, state):
    headers = [o for o in state.get('observations', [])
               if o.get('receiptFresh') and o['observation']['key'] == 'frame_header']
    if not headers:
        return {'status': 'not_observed', 'reason': 'NO_FRESH_FRAME_HEADER'}
    header = headers[0]['observation']['data']
    first = tool(url, 'vehicle_zmq_get_frame', {
        'resourceId': resource_id, 'cameraId': header['camera_id'], 'frameId': header['frame_id'],
    })
    block, total, blocks, digest = first, 0, 0, hashlib.sha256()
    while True:
        if blocks >= 64 or block['retrievalId'] != first['retrievalId'] or block['sha256'] != first['sha256']:
            raise RuntimeError('MONITOR_FRAME_ASSOCIATION_INVALID')
        data = base64.b64decode(block['dataBase64'], validate=True)
        if len(data) > 262144 or block['offset'] != total or block['chunkBytes'] != len(data) or sha(data) != block['chunkSha256']:
            raise RuntimeError('MONITOR_FRAME_CHUNK_INVALID')
        digest.update(data)
        total += len(data)
        blocks += 1
        if total > 16 * 1024 * 1024:
            raise RuntimeError('MONITOR_FRAME_TOO_LARGE')
        if block['nextOffset'] is None:
            break
        if block['nextOffset'] != total:
            raise RuntimeError('MONITOR_FRAME_OFFSET_INVALID')
        block = tool(url, 'vehicle_zmq_get_frame', {
            'resourceId': resource_id, 'retrievalId': first['retrievalId'], 'offset': total,
        })
    if total != first['byteLength'] or digest.hexdigest() != first['sha256']:
        raise RuntimeError('MONITOR_FRAME_HASH_INVALID')
    return {'status': 'verified', 'byteLength': total, 'sha256': first['sha256'],
            'metadata': first['metadata'], 'blocks': blocks, 'imagePersisted': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, type=pathlib.Path)
    parser.add_argument('--output', required=True, type=pathlib.Path)
    parser.add_argument('--once', action='store_true', help='one diagnostic sample; never passes a soak gate')
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    url = config.get('mcpUrl', 'http://127.0.0.1:19110/mcp')
    # This operator tool cannot be pointed at an arbitrary remote host.
    if url != 'http://127.0.0.1:19110/mcp':
        raise RuntimeError('MONITOR_REQUIRES_LOOPBACK_CANDIDATE')
    if config['healthUrls'] != {'runtime': 'http://127.0.0.1:19110/health/ready',
                                'console': 'http://127.0.0.1:19111/health/ready'}:
        raise RuntimeError('MONITOR_HEALTH_ENDPOINTS_INVALID')
    interval = config.get('intervalSeconds', 60)
    duration = config.get('durationSeconds', 86400)
    if not 10 <= interval <= 300 or not 86400 <= duration <= 172800:
        raise RuntimeError('MONITOR_DURATION_OR_INTERVAL_INVALID')
    args.output.mkdir(parents=True, exist_ok=True)
    journal = args.output / 'samples.ndjson'
    if journal.exists():
        raise RuntimeError('MONITOR_OUTPUT_ALREADY_EXISTS_USE_NEW_RUN_DIRECTORY')
    names = [c['name'] for c in config['containers']]
    baseline = inspect(names)
    for expected, actual in zip(config['containers'], baseline):
        if expected['image'] != actual['image'] or expected['id'] != actual['id']:
            raise RuntimeError('MONITOR_EXPECTED_CONTAINER_MISMATCH')
    started, clock_start, count, previous_hash = utc(), time.monotonic(), 0, '0' * 64
    metadata = {'schemaVersion': 'ugv.zmq-v151-soak/1', 'startedAt': started,
                'sourceCommit': config['sourceCommit'], 'durationSeconds': duration,
                'intervalSeconds': interval, 'containers': baseline, 'physicalControlActions': 0,
                'diagnosticOnly': args.once, 'nativeAcceptanceSeparate': True,
                'monitorSha256': sha(pathlib.Path(__file__).read_bytes()),
                'configSha256': sha(args.config.read_bytes())}
    write_json(args.output / 'run.json', metadata)
    failures = []
    planner_checks, planner_failures, last_planner = 0, 0, {'status': 'not_checked'}
    with journal.open('x', buffering=1) as stream:
        while True:
            sample_start = time.monotonic()
            sample = {'sample': count, 'at': utc(), 'elapsedSeconds': sample_start - clock_start,
                      'previousSha256': previous_hash}
            try:
                current = inspect(names)
                sample['containers'] = current
                for old, new in zip(baseline, current):
                    if new['id'] != old['id'] or new['image'] != old['image'] or new['startedAt'] != old['startedAt']:
                        raise RuntimeError('MONITOR_CONTAINER_REPLACED_OR_RESTARTED')
                    if new['restartCount'] != old['restartCount'] or new['oomKilled'] or not new['running']:
                        raise RuntimeError('MONITOR_CONTAINER_NOT_CONTINUOUSLY_HEALTHY')
                    if new['health'] not in {None, 'healthy'}:
                        raise RuntimeError('MONITOR_CONTAINER_HEALTH_FAILED')
                sample['resources'] = [json.loads(line) for line in docker(
                    'stats', '--no-stream', '--format', '{{json .}}', *names).splitlines()]
                sample['http'] = {name: get_health(endpoint) for name, endpoint in config['healthUrls'].items()}
                state = tool(url, 'vehicle_get_state', {'resourceId': config['resourceId']})
                sample.update({k: state.get(k) for k in ['sessionId', 'partitionHash', 'archive', 'channels']})
                if state['archive']['status'] != 'running':
                    raise RuntimeError('MONITOR_ARCHIVE_NOT_HEALTHY')
                channels = state['channels']
                sample['nativeAcceptance'] = {
                    'allComponentsFresh': all(channels.get(c, {}).get('receiptFresh') is True
                                              for c in ['chassis', 'eo', 'simulationEffect']),
                    'protocols': sorted({o['component'] + '@' + o['observation']['protocolVersion']
                                         for o in state.get('observations', [])}),
                }
                caps = tool(url, 'vehicle_get_capabilities', {'resourceId': config['resourceId']})
                wire = caps.get('chassisWire', {})
                if caps.get('catalogProfile') != 'zmq_v1_5_1_readonly_15' or caps.get('controlAvailable') is not False:
                    raise RuntimeError('MONITOR_CATALOG_OR_READONLY_DRIFT')
                if wire.get('publicationFraming') != config['publicationFraming'] or wire.get('commandFraming') != 'prefix_wire_length_crc':
                    raise RuntimeError('MONITOR_EXPLICIT_CHASSIS_FRAMING_DRIFT')
                localization = next((o for o in state.get('observations', []) if o.get('component') == 'chassis'
                                     and o['observation']['key'] == 'localization' and o.get('receiptFresh') is True), None)
                expected_protocol = '2.1-site-rx/1' if config['publicationFraming'] == 'prefix_business_length_crc' else '2.1'
                sample['nativeAcceptance']['chassisContractVerified'] = bool(localization and localization['observation']['protocolVersion'] == expected_protocol)
                sample['nativeAcceptance']['chassisWire'] = wire
                if count % 10 == 0:
                    planner_checks += 1
                    try:
                        if not localization:
                            raise RuntimeError('MONITOR_PLANNER_FRESH_START_MISSING')
                        position = localization['observation']['position']
                        result = tool(url, 'vehicle_zmq_plan_route', {
                            'resourceId': config['resourceId'],
                            'start': {'longitude': position['longitude'], 'latitude': position['latitude']},
                            'waypoints': config['plannerProbe']['waypoints'], 'density': 'adaptive',
                        })
                        if (result.get('schemaVersion') != 'ugv.zmq-route-preview/2'
                                or result.get('adoption') != 'preview_only'
                                or result.get('correlation') != 'request_id_epoch_context_and_geometry'
                                or result.get('taskId') is not None
                                or sha(result['sourceMessage'].encode()) != result['sourceMessageSha256']):
                            raise RuntimeError('MONITOR_PLANNER_PREVIEW_INVALID')
                        last_planner = {'status': 'verified', 'planningRequestId': result['planningRequestId'],
                            'previewId': result['previewId'], 'context': result['context'],
                            'routePoints': len(result['waypoints']), 'sourceMessageSha256': result['sourceMessageSha256'],
                            'transformSha256': result['transform']['sha256'], 'at': sample['at']}
                    except Exception as error:
                        planner_failures += 1
                        code = str(error)
                        last_planner = {'status': 'blocked', 'reason': code if code.startswith(('MONITOR_', 'ZMQ_', 'UGV_')) else type(error).__name__, 'at': sample['at']}
                    sample['planner'] = last_planner
                sample['nativeAcceptance']['plannerLastCheck'] = last_planner
                sample['nativeAcceptance']['plannerChecks'] = planner_checks
                sample['nativeAcceptance']['plannerFailures'] = planner_failures
                sample['nativeAcceptance']['siteReadOnlyQualified'] = bool(sample['nativeAcceptance']['allComponentsFresh']
                    and sample['nativeAcceptance']['chassisContractVerified'] and last_planner.get('status') == 'verified')
                if count % 10 == 0:
                    sample['frame'] = frame_sample(url, config['resourceId'], tool(url, 'vehicle_get_state', {'resourceId': config['resourceId']}))
            except Exception as error:
                # Do not expose request headers, credentials, raw messages or pixels.
                reason = str(error)
                sample['error'] = reason if reason.startswith(('MONITOR_', 'ZMQ_', 'UGV_')) else type(error).__name__
                failures.append({'sample': count, 'at': sample['at'], 'reason': sample['error']})
            line = json.dumps(sample, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
            stream.write(line + '\n')
            previous_hash = sha(line.encode())
            count += 1
            elapsed = time.monotonic() - clock_start
            done = elapsed >= duration or args.once or bool(failures)
            summary = {**metadata, 'updatedAt': utc(), 'samples': count, 'elapsedSeconds': elapsed,
                       'lastSampleSha256': previous_hash, 'failures': failures,
                       'status': 'failed' if failures else 'diagnostic' if args.once else 'passed' if done else 'running',
                       'lastNativeAcceptance': sample.get('nativeAcceptance'),
                       'formalCutoverAuthorizedByThisReport': False}
            write_json(args.output / 'summary.json', summary)
            if done:
                break
            time.sleep(max(0, interval - (time.monotonic() - sample_start)))
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())

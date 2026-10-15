#!/usr/bin/env python3
"""Exercise the extracted five-component package without starting containers."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from united_bundle import checked_package, extract, sha, read_archive

ROOT = Path(__file__).resolve().parents[1]


def run(args, cwd=None, *, success=True):
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if (result.returncode == 0) != success:
        raise RuntimeError('Verification command returned an unexpected status: ' + str(args[0])
            + '\n' + result.stdout + result.stderr)
    return result.stdout + result.stderr


def update_env(file, values):
    text = file.read_text()
    for key, value in values.items():
        text, count = re.subn('^' + re.escape(key) + '=.*$', lambda _: f"{key}='{value}'", text, flags=re.M)
        if count != 1:
            raise ValueError('Expected one configuration entry: ' + key)
    file.write_text(text)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--build-smpp-source', action='store_true')
    args = parser.parse_args()
    data, (_, files, _) = checked_package(args.archive)
    manifest = json.loads(files['UNION.json'])
    specification = importlib.util.spec_from_file_location('wsgs_packager', ROOT / 'scripts/package-wsgs-united-deployment.py')
    packager = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(packager)
    upstream_data = files[manifest['wsgsUnion']['path']]
    if sha(upstream_data) != manifest['wsgsUnion']['sha256']:
        raise ValueError('WSGS unified input changed')
    _, _, _, _, _, gowm = packager.upstream_contents(upstream_data)
    _, smpp, _ = read_archive(files[manifest['smpp']['path']], rooted=False, inventory=False)
    packager.verify_storage(smpp, gowm)
    print('Archive closure and SMPP/GOWM storage contracts: PASS', file=sys.stderr, flush=True)
    for name in smpp:
        parts = Path(name).parts
        if any(part in {'node_modules', 'dist', 'secrets', '.git', '__pycache__', 'reports', 'state'} for part in parts):
            raise ValueError('Generated or private directory in SMPP package: ' + name)
        leaf = Path(name).name
        if ((leaf.startswith('.env') and leaf not in {'.env.example', '.env.gowm.example'})
                or (leaf.endswith(('.pem', '.key', '.token', '.pyc', '.pyo', '.log', '.tsbuildinfo'))
                    and name != 'contracts/ugv-trajectory-history/v1/examples/SIMULATED_PUBLIC_KEY.pem')
                or name.startswith('deploy/development/server/config/')):
            raise ValueError('Private or generated file in SMPP package: ' + name)
    before = sorted(run(['docker', 'ps', '-aq']).splitlines())
    with tempfile.TemporaryDirectory(prefix='smpp-wsgs-united-verify-') as temporary:
        root = extract(data, temporary)
        deploy = str(root / 'deploy')
        if 'JOINT_ARCHIVE_PASS' not in run([deploy, 'verify']):
            raise ValueError('Joint archive verification did not complete')
        if 'JOINT_INITIALIZED' not in run([deploy, 'init']):
            raise ValueError('Joint initialization did not complete')
        print('Fresh extracted initialization: PASS', file=sys.stderr, flush=True)
        upstream_root = root / '.runtime/wsgs-united' / manifest['wsgsUnion']['root']
        identity = upstream_root / '.runtime/identity.json'
        key = upstream_root / '.runtime/delegation-private.pem'
        identity_bytes, key_bytes = identity.read_bytes(), key.read_bytes()
        update_env(root / 'upstream.env', {'UGV_MQTT_INGEST_ENABLED': 'false'})
        update_env(root / 'wsgs.env', {'WSGS_MODEL_POLICY': 'MODEL_OPTIONAL',
            'MODEL_BASE_URL': '', 'MODEL_API_KEY': '', 'MODEL_NAME': ''})
        update_env(root / 'smpp.env', {'DEPLOY_PORT': '29100'})
        smpp_env = (root / 'smpp.env').read_bytes()
        run([deploy, 'init'])
        if identity_bytes != identity.read_bytes() or key_bytes != key.read_bytes() or smpp_env != (root / 'smpp.env').read_bytes():
            raise ValueError('Repeat initialization changed credentials or user SMPP configuration')
        if 'JOINT_CONFIGURATION_PASS' not in run([deploy, 'config-check']):
            raise ValueError('Joint configuration check did not complete')
        print('Repeated initialization and Compose configuration: PASS', file=sys.stderr, flush=True)
        for name in ('upstream.env', 'wsgs.env', 'smpp.env'):
            if (root / name).stat().st_mode & 0o777 != 0o600:
                raise ValueError('Configuration permissions differ')
        for file in (identity, key):
            if file.stat().st_mode & 0o777 != 0o600:
                raise ValueError('Private identity permissions differ')
        compose = json.loads((root / 'smpp/deploy/development/server/state/compose.json').read_text())
        state = json.loads(identity.read_text())
        if (compose['name'] != state['upstreamProject'] + '-smpp'
                or compose['networks']['gowm']['name'] != state['upstreamProject'] + '_default'
                or set(compose['services']) != {'adapter', 'runtime'}
                or compose['services']['adapter']['environment']['UGV_FIRE_ENABLED'] != 'false'):
            raise ValueError('SMPP shared database/network/project mapping differs')
        site = json.loads((root / 'smpp/deploy/development/server/gowm-site.json').read_text())
        upstream_public = json.loads(run(['node', '--input-type=module', '-e',
            "import {readFileSync} from 'node:fs'; import {parseEnv} from 'node:util'; const e=parseEnv(readFileSync(process.argv[1],'utf8')); console.log(JSON.stringify(Object.fromEntries(['UGV_DATA_SCOPE_KEY','UGV_DEVICE_ID','GOWM_DEVICE_ID'].map(k=>[k,e[k]??null]))));",
            str(root / 'upstream.env')]))
        if (site['dataScopeKey'] != (upstream_public['UGV_DATA_SCOPE_KEY'] or 'airport-sim-ugv-01')
                or site['deviceId'] != (upstream_public['GOWM_DEVICE_ID'] or 'ugv:' + (upstream_public['UGV_DEVICE_ID'] or 'ugv'))):
            raise ValueError('SMPP device mapping differs from upstream UGV bootstrap')
        update_env(root / 'wsgs.env', {'WSGS_API_PORT': '29100'})
        if 'WSGS_SMPP_PORT_CONFLICT' not in run([deploy, 'config-check'], success=False):
            raise ValueError('Cross-project API port conflict was not blocked')
        update_env(root / 'wsgs.env', {'WSGS_API_PORT': '8080'})
        if 'SMPP_REQUIRES_GOWM_UGV_INGEST_AND_DEVICE_BOOTSTRAP' not in run([deploy, 'up'], success=False):
            raise ValueError('Disabled UGV deployment was not blocked before startup')
        print('Port conflicts and disabled UGV startup guards: PASS', file=sys.stderr, flush=True)
        if args.build_smpp_source:
            source = root / 'smpp'
            print('Installing frozen dependencies and building extracted SMPP source', file=sys.stderr, flush=True)
            run(['corepack', 'pnpm', 'install', '--frozen-lockfile'], source)
            run(['corepack', 'pnpm', 'run', 'build'], source)
            print('Extracted SMPP source build: PASS', file=sys.stderr, flush=True)
    if before != sorted(run(['docker', 'ps', '-aq']).splitlines()):
        raise ValueError('Container inventory changed during packaging verification')
    report = {'status': 'PASS', 'package': args.archive.name, 'sha256': sha(data),
        'checks': {'archiveAndNestedInventories': 'PASS', 'originalWsgsPackagePreserved': 'PASS',
            'smppGowmStorageCompatibility': 'PASS', 'credentialAndGeneratedFileExclusions': 'PASS',
            'freshInit': 'PASS', 'repeatInitPreservesCredentialsAndUserConfiguration': 'PASS',
            'composeConfiguration': 'PASS', 'sharedDatabaseAndNetworkMapping': 'PASS',
            'privateFilePermissions': 'PASS', 'apiPortConflictBlocked': 'PASS',
            'disabledUgvBlockedBeforeStartup': 'PASS', 'noContainersStarted': 'PASS',
            'extractedSmppSourceBuild': 'PASS' if args.build_smpp_source else 'NOT_RUN'},
        'configurationFixture': {'ugvIngestEnabled': False, 'modelPolicy': 'MODEL_OPTIONAL', 'smppPort': 29100},
        'delivery': 'ONLINE_SOURCE_BUILD', 'siteAcceptance': 'NOT_RUN',
        'realModel': 'NOT_RUN', 'realMqtt': 'NOT_RUN', 'deviceControl': 'NOT_RUN', 'credentialsIncluded': False}
    file = args.archive.with_name(args.archive.name.removesuffix('.tar.gz') + '.verification.json')
    file.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()

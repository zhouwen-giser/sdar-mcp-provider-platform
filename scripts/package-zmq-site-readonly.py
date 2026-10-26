#!/usr/bin/env python3
"""Export the exact SMPP read-only source, evidence and three pinned Docker images."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--provider-image', required=True)
parser.add_argument('--runtime-image', required=True)
parser.add_argument('--console-image', required=True)
parser.add_argument('--evidence-root', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
output = args.output.resolve()
if output.exists():
    raise SystemExit('SITE_PACKAGE_OUTPUT_ALREADY_EXISTS')
output.parent.mkdir(parents=True, exist_ok=True)


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


entries = []
paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
for name in sorted(set(filter(None, paths))):
    relative = Path(name)
    if relative.is_absolute() or '..' in relative.parts:
        raise SystemExit('SITE_SOURCE_PATH_INVALID')
    if any(p in {'node_modules', 'secrets', '.local', '__pycache__'} for p in relative.parts):
        continue
    if relative.parts[0] in {'dist', 'coverage', 'artifacts', '.codex', '.git'}:
        continue
    if name.startswith(('reports/runtime-semantic-closure/', 'reports/verification/', 'reports/ugv-zmq-phase5/', 'reports/ugv-zmq-site-readonly-')):
        continue
    template = relative.name.startswith('.env.') and relative.name.endswith(('.example', '.sample', '.template'))
    if (relative.name.startswith('.env') and not template) or (relative.suffix in {'.pem', '.key', '.p12', '.pfx', '.tsbuildinfo'} and name != 'contracts/ugv-trajectory-history/v1/examples/SIMULATED_PUBLIC_KEY.pem'):
        continue
    path = root / relative
    if path.is_file() and not path.is_symlink():
        entries.append(('smpp/' + name, path))
required = ['apps/ugv-zmq-provider-adapter/src/site-bootstrap.ts', 'packages/vehicle-zmq-control/src/site-catalog.ts',
            'contracts/ugv-zmq/provider-v1.1.0-readonly/catalog.json', 'deploy/ugv-zmq/site-readonly/compose.yaml',
            'apps/ugv-control-console/web/SiteReadonlyConsole.tsx']
if any('smpp/' + p not in {name for name, _ in entries} for p in required):
    raise SystemExit('SITE_REQUIRED_SOURCE_NOT_TRACKED')
evidence = args.evidence_root.resolve()
if not (evidence / 'REPORT.md').is_file():
    raise SystemExit('SITE_ACCEPTANCE_REPORT_REQUIRED')
for path in sorted(evidence.rglob('*')):
    if path.is_symlink():
        raise SystemExit('SITE_EVIDENCE_SYMLINK_FORBIDDEN')
    if path.is_file():
        entries.append(('evidence/' + path.relative_to(evidence).as_posix(), path))
with tempfile.TemporaryDirectory(prefix='site-package-', dir=output.parent) as temp:
    images = []
    for role, tag in [('provider', args.provider_image), ('runtime', args.runtime_image), ('console', args.console_image)]:
        identity = json.loads(subprocess.check_output(['docker', 'image', 'inspect', tag]))[0]
        images.append({'role': role, 'tag': tag, 'id': identity['Id'], 'revision': identity['Config'].get('Labels', {}).get('org.opencontainers.image.revision')})
    image_file = Path(temp) / 'images.tar'
    subprocess.run(['docker', 'save', '-o', str(image_file), args.provider_image, args.runtime_image, args.console_image], check=True)
    entries.append(('images/images.tar', image_file))
    records = [{'path': name, 'bytes': path.stat().st_size, 'sha256': digest(path), 'mode': 0o755 if path.stat().st_mode & 0o111 else 0o644} for name, path in entries]
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root).decode().strip()
    manifest = {'schemaVersion': 'ugv.zmq-site-readonly-bundle/1', 'sourceCommit': commit,
                'profile': 'zmq_v1_1_0_readonly_13', 'controlQualified': False, 'automaticDeployment': False,
                'sourceAuthority': 'exact_tracked_files_by_sha256', 'images': images, 'files': records}
    meta = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
    sums = ''.join(f"{r['sha256']}  {r['path']}\n" for r in records).encode()
    with output.open('wb') as target:
        with gzip.GzipFile(filename='', mode='wb', fileobj=target, mtime=0, compresslevel=6) as compressed:
            with tarfile.open(fileobj=compressed, mode='w') as archive:
                for record, (_, path) in zip(records, entries):
                    info = tarfile.TarInfo(record['path'])
                    info.size, info.mode, info.mtime = record['bytes'], record['mode'], 0
                    with path.open('rb') as stream:
                        archive.addfile(info, stream)
                for name, data in [('bundle-manifest.json', meta), ('SHA256SUMS', sums)]:
                    info = tarfile.TarInfo(name)
                    info.size, info.mode, info.mtime = len(data), 0o644, 0
                    archive.addfile(info, io.BytesIO(data))
    expected = {r['path']: r for r in records}
    with tarfile.open(output, 'r:gz') as archive:
        for member in archive:
            if not member.isfile() or member.name.startswith('/') or '..' in Path(member.name).parts:
                raise SystemExit('SITE_PACKAGE_MEMBER_INVALID')
            if member.name in {'bundle-manifest.json', 'SHA256SUMS'}:
                continue
            record = expected.pop(member.name, None)
            actual = hashlib.sha256()
            source = archive.extractfile(member)
            for block in iter(lambda: source.read(1024 * 1024), b''):
                actual.update(block)
            source.close()
            if not record or record['sha256'] != actual.hexdigest() or record['mode'] != member.mode:
                raise SystemExit('SITE_PACKAGE_INTEGRITY_FAILED')
    if expected:
        raise SystemExit('SITE_PACKAGE_MEMBER_MISSING')
receipt = {'schemaVersion': manifest['schemaVersion'], 'sourceCommit': commit, 'fileCount': len(records),
           'path': str(output), 'bytes': output.stat().st_size, 'sha256': digest(output), 'images': images, 'controlQualified': False}
output.with_name(output.name + '.receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(receipt, ensure_ascii=False))

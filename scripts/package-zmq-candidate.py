#!/usr/bin/env python3
"""Export two exact source snapshots for qualification. Never updates a running service."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument('--sdar-root', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--image', help='Optional existing image tag to export with docker save')
args = parser.parse_args()
smpp = Path(__file__).resolve().parents[1]
sdar = args.sdar_root.resolve()
if smpp == sdar or not (sdar / 'packages/ugv-profile/src/zmq-provider-profile.ts').is_file():
    raise SystemExit('ZMQ_SDAR_SOURCE_REQUIRED')
args.output.parent.mkdir(parents=True, exist_ok=True)
if args.output.exists():
    raise SystemExit('ZMQ_PACKAGE_OUTPUT_ALREADY_EXISTS')

def sha(value):
    return hashlib.sha256(value).hexdigest()


def source_files(root):
    paths = subprocess.check_output(['git', 'ls-files', '--cached', '-z'], cwd=root).decode().split('\0')
    for name in sorted(set(filter(None, paths))):
        path = Path(name)
        if path.is_absolute() or '..' in path.parts or path.parts[0] in {'reports', 'artifacts', 'dist', 'coverage', 'node_modules', '.codex', '.git'}:
            continue
        if any(part in {'node_modules', 'secrets', '.local', '__pycache__'} for part in path.parts):
            continue
        env_template = path.name.startswith('.env.') and path.name.endswith(('.example', '.sample', '.template'))
        if (path.name.startswith('.env') and not env_template) or path.suffix in {'.pem', '.key', '.p12', '.pfx', '.log', '.tsbuildinfo'}:
            continue
        full = root / path
        if not full.is_file() or full.is_symlink():
            continue
        yield name, full.read_bytes(), 0o755 if full.stat().st_mode & 0o111 else 0o644


manifest = {'schemaVersion': 'ugv.zmq-source-candidate-bundle/1', 'releaseKind': 'qualification_candidate', 'fieldQualified': False, 'automaticDeployment': False, 'sources': {}, 'files': []}
entries = []
for label, root in [('smpp', smpp), ('sdar', sdar)]:
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root).decode().strip()
    manifest['sources'][label] = {'baseCommit': commit, 'sourceAuthority': 'exact_worktree_files_by_sha256'}
    for name, data, mode in source_files(root):
        member = f'{label}/{name}'
        entries.append((member, data, mode))
        manifest['files'].append({'path': member, 'bytes': len(data), 'sha256': sha(data), 'mode': mode})
required = {
    'smpp/apps/ugv-zmq-provider-adapter/src/bootstrap.ts',
    'smpp/contracts/ugv-zmq/provider-v1/catalog.json',
    'smpp/apps/ugv-control-console/shared/zmq-native-catalog.json',
    'smpp/deploy/ugv-zmq/compose.formal-candidate.yaml',
    'sdar/packages/ugv-profile/src/zmq-provider-profile.ts',
    'sdar/packages/ugv-profile/src/zmq-catalog-contract.json',
}
if required.difference(name for name, _, _ in entries):
    raise SystemExit('ZMQ_PACKAGE_REQUIRED_SOURCE_UNTRACKED_OR_MISSING')
canonical = json.dumps(manifest['files'], sort_keys=True, separators=(',', ':')).encode()
manifest['inputSha256'] = sha(canonical)
with args.output.open('wb') as stream:
    with gzip.GzipFile(filename='', mode='wb', fileobj=stream, mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w', format=tarfile.PAX_FORMAT) as archive:
            for name, data, mode in entries + [('MANIFEST.json', (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode(), 0o644)]:
                info = tarfile.TarInfo(name)
                info.size = len(data)
                info.mode = mode
                info.mtime = 0
                archive.addfile(info, io.BytesIO(data))
# Re-read every member and reject unexpected files, traversal, links and content drift.
expected = {name: (sha(data), mode) for name, data, mode in entries}
with tarfile.open(args.output, 'r:gz') as archive:
    for member in archive:
        if not member.isfile() or member.name.startswith('/') or '..' in Path(member.name).parts:
            raise SystemExit('ZMQ_PACKAGE_MEMBER_INVALID')
        if member.name == 'MANIFEST.json':
            continue
        if expected.pop(member.name, None) != (sha(archive.extractfile(member).read()), member.mode):
            raise SystemExit('ZMQ_PACKAGE_INTEGRITY_FAILED')
if expected:
    raise SystemExit('ZMQ_PACKAGE_MEMBER_MISSING')
receipt = {'schemaVersion': manifest['schemaVersion'], 'package': str(args.output.resolve()), 'sha256': sha(args.output.read_bytes()), 'bytes': args.output.stat().st_size, 'inputSha256': manifest['inputSha256'], 'fileCount': len(entries), 'fieldQualified': False}
if args.image:
    image_id = subprocess.check_output(['docker', 'image', 'inspect', '--format', '{{.Id}}', args.image]).decode().strip()
    image_file = args.output.with_name(args.output.name.removesuffix('.tar.gz') + '.image.tar')
    if image_file.exists():
        raise SystemExit('ZMQ_IMAGE_EXPORT_ALREADY_EXISTS')
    subprocess.run(['docker', 'save', '-o', str(image_file), args.image], check=True)
    digest = hashlib.sha256()
    with image_file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    receipt['image'] = {'tag': args.image, 'id': image_id, 'path': str(image_file.resolve()), 'sha256': digest.hexdigest(), 'bytes': image_file.stat().st_size}
receipt_path = args.output.with_name(args.output.name + '.receipt.json')
receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(receipt, ensure_ascii=False, indent=2))

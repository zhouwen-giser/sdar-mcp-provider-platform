#!/usr/bin/env python3
"""Private, append-only command receipts; never records environment values other than explicit paths/tooling."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

p = argparse.ArgumentParser()
p.add_argument('--id', required=True)
p.add_argument('--cwd', required=True)
p.add_argument('--env', action='append', default=[])
p.add_argument('argv', nargs=argparse.REMAINDER)
a = p.parse_args()
root = Path(__file__).resolve().parent
log = root / (a.id + '.log')
receipt = root / (a.id + '.receipt.json')
if log.exists() or receipt.exists():
    raise SystemExit('RECEIPT_ALREADY_EXISTS')
cmd = a.argv[1:] if a.argv[:1] == ['--'] else a.argv
if not cmd:
    raise SystemExit('COMMAND_REQUIRED')

def git(*args):
    return subprocess.check_output(['git', *args], cwd=a.cwd)

def source():
    h = hashlib.sha256()
    count = 0
    for raw in sorted(git('ls-files', '-z').split(b'\0')):
        if not raw:
            continue
        name = raw.decode()
        if name.startswith('reports/'):
            continue
        f = Path(a.cwd) / name
        if f.is_symlink():
            content = os.readlink(f).encode()
        elif f.is_file():
            content = f.read_bytes()
        else:
            raise RuntimeError('TRACKED_SOURCE_MISSING:' + name)
        h.update(raw + b'\0' + hashlib.sha256(content).digest())
        count += 1
    return {'commit': git('rev-parse', 'HEAD').decode().strip(),
            'branch': git('branch', '--show-current').decode().strip(),
            'trackedDiffSha256': hashlib.sha256(git('diff', '--binary', 'HEAD')).hexdigest(),
            'codeInputSha256': h.hexdigest(), 'trackedCodeFileCount': count,
            'codeInputExclusions': ['reports/**'],
            'status': git('status', '--short').decode().splitlines()}

before = source()
environment = os.environ.copy()
refs = {}
for item in a.env:
    key, value = item.split('=', 1)
    environment[key] = value
    refs[key] = value
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
clock = time.monotonic()
with log.open('xb') as stream:
    os.chmod(log, 0o600)
    child = subprocess.run(cmd, cwd=a.cwd, env=environment, stdout=stream, stderr=subprocess.STDOUT)
after = source()
record = {'schemaVersion': 'ugv.zmq-command-receipt/1', 'id': a.id, 'cwd': a.cwd,
          'argv': cmd, 'explicitEnvironmentPathsAndTooling': refs,
          'startedAt': started, 'completedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'elapsedSeconds': round(time.monotonic() - clock, 3), 'exitCode': child.returncode,
          'log': log.name, 'logSha256': hashlib.sha256(log.read_bytes()).hexdigest(),
          'sourceBefore': before, 'sourceAfter': after,
          'codeInputsUnchanged': before['codeInputSha256'] == after['codeInputSha256']}
receipt.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
os.chmod(receipt, 0o600)
print(json.dumps({'id': a.id, 'exitCode': child.returncode,
                  'codeInputsUnchanged': record['codeInputsUnchanged'], 'receipt': str(receipt)}))
sys.exit(child.returncode)

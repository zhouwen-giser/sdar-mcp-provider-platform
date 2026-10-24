"""Exercise actual two-repository archives, without Docker or deployment secrets."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest


class CandidatePackageTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.smpp, self.sdar = self.root / 'smpp', self.root / 'sdar'
        for project in (self.smpp, self.sdar):
            project.mkdir()
            subprocess.run(['git', 'init', '--quiet', str(project)], check=True)
        for project, paths in (
            (self.smpp, ['apps/ugv-zmq-provider-adapter/src/bootstrap.ts',
                         'contracts/ugv-zmq/provider-v1/catalog.json',
                         'apps/ugv-control-console/shared/zmq-native-catalog.json',
                         'deploy/ugv-zmq/compose.formal-candidate.yaml']),
            (self.sdar, ['packages/ugv-profile/src/zmq-provider-profile.ts',
                         'packages/ugv-profile/src/zmq-catalog-contract.json']),
        ):
            for name in paths:
                path = project / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('PUBLIC-CONTRACT\n')
        self.script = self.smpp / 'scripts/package-zmq-candidate.py'
        self.script.parent.mkdir()
        shutil.copyfile(Path(__file__).resolve().parents[2] / 'scripts/package-zmq-candidate.py', self.script)
        for name in ('.env', '.env.local', 'secrets/private.json', 'key.pem', 'untracked.txt'):
            path = self.smpp / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('MUST-NOT-SHIP\n')
        (self.smpp / '.env.example').write_text('PUBLIC_CONFIGURATION=example\n')
        for name in ('reports/frozen/contract.json', 'reports/verification/generated.json'):
            path = self.sdar / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('FROZEN-OR-GENERATED\n')
        executable = self.smpp / 'start.sh'
        executable.write_text('#!/bin/sh\nexit 0\n')
        executable.chmod(0o755)
        (self.smpp / 'external-link').symlink_to(executable)
        self.commit()

    def commit(self):
        for project in (self.smpp, self.sdar):
            subprocess.run(['git', 'add', '.'], cwd=project, check=True)
            if (project / 'untracked.txt').exists():
                subprocess.run(['git', 'reset', '--quiet', '--', 'untracked.txt'], cwd=project, check=True)
            subprocess.run(['git', '-c', 'user.name=Isolated fixture', '-c', 'user.email=fixture@example.invalid',
                            'commit', '--quiet', '--allow-empty', '-m', 'isolated fixture'], cwd=project, check=True)

    def package(self, name):
        output = self.root / name
        result = subprocess.run([sys.executable, str(self.script), '--sdar-root', str(self.sdar),
                                 '--output', str(output)], capture_output=True, text=True)
        return output, result

    def test_reproducible_members_permissions_and_secret_exclusion(self):
        first, result = self.package('first.tar.gz')
        self.assertEqual(result.returncode, 0, result.stderr)
        second, result = self.package('second.tar.gz')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(first.read_bytes(), second.read_bytes())
        with tarfile.open(first) as archive:
            names = archive.getnames()
            self.assertIn('smpp/.env.example', names)
            self.assertIn('sdar/reports/frozen/contract.json', names)
            self.assertNotIn('sdar/reports/verification/generated.json', names)
            self.assertEqual(archive.getmember('smpp/start.sh').mode, 0o755)
            self.assertFalse(any(n.endswith(('.env', '.env.local', 'private.json', 'key.pem',
                                              'external-link', 'untracked.txt')) for n in names))
            manifest = json.load(archive.extractfile('MANIFEST.json'))
            self.assertFalse(manifest['fieldQualified'])
            self.assertFalse(manifest['automaticDeployment'])
            self.assertEqual(set(names), {'MANIFEST.json'} | {f['path'] for f in manifest['files']})
            for entry in manifest['files']:
                data = archive.extractfile(entry['path']).read()
                self.assertEqual(hashlib.sha256(data).hexdigest(), entry['sha256'])
                self.assertEqual(len(data), entry['bytes'])
                self.assertEqual(archive.getmember(entry['path']).mode, entry['mode'])

    def test_missing_untracked_required_code_is_rejected_before_export(self):
        subprocess.run(['git', 'rm', '--quiet', '--cached', 'apps/ugv-zmq-provider-adapter/src/bootstrap.ts'],
                       cwd=self.smpp, check=True)
        output, result = self.package('missing.tar.gz')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('REQUIRED_SOURCE_UNTRACKED_OR_MISSING', result.stderr)
        self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()

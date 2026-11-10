"""Archive boundary regression checks for deployment inputs."""
import io
from pathlib import Path
import sys
import subprocess
import tarfile
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from united_bundle import checked_package, read_archive, write_archive


def archive(entries):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w:gz') as target:
        for name, content, kind in entries:
            info = tarfile.TarInfo(name)
            info.type = kind
            info.size = len(content)
            info.linkname = '../../outside' if kind == tarfile.SYMTYPE else ''
            target.addfile(info, io.BytesIO(content))
    return stream.getvalue()


class ArchiveInputs(unittest.TestCase):
    def test_traversal_is_rejected(self):
        for name in ('../outside', '/absolute', 'root/../../outside', 'root\\outside'):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'Unsafe archive path'):
                read_archive(archive([(name, b'x', tarfile.REGTYPE)]))

    def test_link_and_duplicate_members_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Unsafe or duplicate'):
            read_archive(archive([('root/link', b'', tarfile.SYMTYPE)]))
        with self.assertRaisesRegex(ValueError, 'Unsafe or duplicate'):
            read_archive(archive([('root/file', b'x', tarfile.REGTYPE)] * 2))

    def test_unlisted_payload_is_rejected(self):
        data = archive([('root/SHA256SUMS', b'', tarfile.REGTYPE), ('root/payload', b'x', tarfile.REGTYPE)])
        with self.assertRaisesRegex(ValueError, 'Incomplete archive inventory'):
            read_archive(data)

    def test_published_checksum_and_reproducibility(self):
        with tempfile.TemporaryDirectory() as folder:
            first, second = Path(folder) / 'first.tar.gz', Path(folder) / 'second.tar.gz'
            write_archive(first, 'root', {'deploy': b'#!/bin/sh\n', 'data.txt': b'fixed\n'}, executable=('deploy',))
            write_archive(second, 'root', {'data.txt': b'fixed\n', 'deploy': b'#!/bin/sh\n'}, executable=('deploy',))
            self.assertEqual(first.read_bytes(), second.read_bytes())
            _, (_, _, modes) = checked_package(first)
            self.assertEqual(modes['deploy'], 0o755)
            first.with_name(first.name + '.sha256').write_text('0' * 64 + '  first.tar.gz\n')
            with self.assertRaisesRegex(ValueError, 'checksum is invalid'):
                checked_package(first)

    def test_extractor_creates_private_parents_under_a_shared_umask(self):
        with tempfile.TemporaryDirectory() as folder:
            source, destination = Path(folder) / 'source.tar.gz', Path(folder) / 'snapshot'
            source.write_bytes(archive([('root/nested/config.txt', b'fixture', tarfile.REGTYPE)]))
            script = Path(__file__).resolve().parents[2] / 'deploy/united/extract.py'
            subprocess.run([sys.executable, str(script), str(source), str(destination)], check=True, umask=0o002)
            for directory in (destination, destination / 'root', destination / 'root/nested'):
                self.assertEqual(directory.stat().st_mode & 0o777, 0o700)


if __name__ == '__main__':
    unittest.main()

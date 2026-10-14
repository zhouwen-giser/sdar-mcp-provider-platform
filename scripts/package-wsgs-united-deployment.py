#!/usr/bin/env python3
"""Combine the published WSGS/GOWM/GDPS/GSAP package with current SMPP source."""
import argparse
import json
from pathlib import Path
import subprocess
from united_bundle import checked_package, read_archive, sha, write_archive

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT.parent / 'world-semantic-grounding-service/output/deployment/gowm-gdps-gsap-wsgs-dev-server-0.2.1.tar.gz'


def upstream_contents(data):
    root, files, _ = read_archive(data)
    manifest_bytes = files['deployment/MANIFEST.json']
    manifest = json.loads(manifest_bytes)
    if manifest['schemaVersion'] != 'gowm-gdps-gsap-wsgs-unified-deployment/1.0':
        raise ValueError('Unsupported WSGS unified deployment schema')
    components = manifest['components']
    for component in ('gsap', 'wsgs'):
        spec = components[component]
        if sha(files[spec['path']]) != spec['sha256']:
            raise ValueError('Component archive differs: ' + component)
    gsap_root, gsap, _ = read_archive(files[components['gsap']['path']])
    wsgs_root, wsgs, _ = read_archive(files[components['wsgs']['path']])
    if (gsap_root != components['gsap']['root'] or wsgs_root != components['wsgs']['root']):
        raise ValueError('Component root differs')
    source_bytes = gsap['deployment/SOURCE.json']
    source = json.loads(source_bytes)
    gdps_data = gsap['packages/' + source['packageName']]
    if sha(gdps_data) != source['sha256'] or sha(gdps_data) != components['gdps']['sha256']:
        raise ValueError('Nested GDPS checksum differs')
    _, gdps, _ = read_archive(gdps_data)
    lock = json.loads(gdps['deployment/gowm-dev-package-lock.json'])
    gowm_data = gdps['packages/' + lock['packageName']]
    if not (sha(gowm_data) == lock['sha256'] == source['nestedGowm']['sha256'] == components['gowm']['sha256']):
        raise ValueError('Nested GOWM checksum differs')
    _, gowm, _ = read_archive(gowm_data)
    snapshot = json.loads(wsgs['contracts/upstream/gowm-current/SNAPSHOT.json'])
    if (snapshot['analysisPackage']['sha256'] != components['gsap']['sha256']
            or snapshot['source']['combinedSha256'] != sha(gdps_data)
            or snapshot['source']['sha256'] != sha(gowm_data)
            or snapshot != manifest['upstreamSnapshot']):
        raise ValueError('WSGS consumer closure differs from packaged upstream')
    return root, manifest, manifest_bytes, gsap_root, source_bytes, gowm


def verify_storage(smpp, gowm):
    contract = json.loads(smpp['contracts/gowm-shared-storage/current/source.json'])
    actual = json.loads(gowm['database/shared-business-storage/install-manifest.json'])
    for entry in contract['entries']:
        if not any(e['family'] == entry['family'] and e['file'] == entry['file']
                   and e['generatedSha256'] == entry['generatedSha256'] for e in actual['entries']):
            raise ValueError('SMPP/GOWM storage contract differs: ' + entry['file'])
        if sha(gowm['database/shared-business-storage/' + entry['generatedPath']]) != entry['generatedSha256']:
            raise ValueError('GOWM generated migration differs')
    if sha(gowm['database/migrations/' + contract['core']['file']]) != contract['core']['sha256']:
        raise ValueError('SMPP/GOWM core migration differs')
    for overlay in contract['overlays']:
        if sha(gowm['database/shared-business-storage/' + overlay['path']]) != overlay['sha256']:
            raise ValueError('SMPP/GOWM overlay differs')
    if 'scripts/business-storage/accounts.ts' not in gowm:
        raise ValueError('GOWM managed business account initializer missing')
    if b'i.deviceId ?? `ugv:${i.identifier}`' not in gowm['packages/integrations/device-business-storage/src/bootstrap.ts']:
        raise ValueError('GOWM device bootstrap identity policy differs')
    return {'status': 'PASS', 'sharedStorageEntries': len(contract['entries']),
            'overlays': len(contract['overlays']), 'coreMigration': contract['core']['file']}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--wsgs-package', type=Path, default=DEFAULT_INPUT)
    parser.add_argument('--smpp-package', type=Path, help='Reuse an already generated sz-gowm source package')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'artifacts/united')
    args = parser.parse_args(argv)
    upstream, _ = checked_package(args.wsgs_package)
    upstream_root, upstream_manifest, upstream_manifest_bytes, gsap_root, source_bytes, gowm = upstream_contents(upstream)
    if args.smpp_package is None:
        output = subprocess.check_output(['node', str(ROOT / 'scripts/package-development-server.mjs'),
            '--site', 'sz-gowm', '--output-dir', str(args.output_dir / 'source')], cwd=ROOT, text=True)
        args.smpp_package = Path(next(line for line in output.splitlines() if line.endswith('.tar.gz')))
    smpp_data, (_, smpp, _) = checked_package(args.smpp_package, rooted=False, inventory=False)
    if smpp['DEPLOYMENT_PROFILE'].decode().strip() != 'sz-gowm':
        raise ValueError('SMPP shared GOWM deployment profile required')
    revision = smpp['SOURCE_REVISION'].decode().strip()
    storage = verify_storage(smpp, gowm)
    components = dict(upstream_manifest['components'])
    components['smpp'] = {'name': args.smpp_package.name, 'path': 'upstream/smpp.tar.gz',
        'sha256': sha(smpp_data), 'revision': revision, 'version': json.loads(smpp['package.json'])['version']}
    manifest = {'schemaVersion': 2, 'delivery': 'ONLINE_SOURCE_BUILD', 'siteAcceptance': 'NOT_RUN',
        'wsgsUnion': {'name': args.wsgs_package.name, 'path': 'upstream/wsgs-united.tar.gz',
            'root': upstream_root, 'sha256': sha(upstream), 'manifestSha256': sha(upstream_manifest_bytes)},
        'base': {'name': upstream_manifest['upstreamSnapshot']['analysisPackage']['name'], 'sha256': components['gsap']['sha256']},
        'baseRoot': gsap_root, 'baseSourceSha256': sha(source_bytes),
        'gowm': {'name': components['gowm']['packageName'], 'sha256': components['gowm']['sha256']},
        'smpp': components['smpp'], 'components': components, 'storageCompatibility': storage,
        'credentialPolicy': 'Generate private configuration on the target; reuse GOWM managed SMPP account',
        'ports': {'smpp': 19100, 'wsgs': 8080}, 'credentialsIncluded': False}
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
    name = 'smpp-gowm-gdps-gsap-wsgs-' + sha(manifest_bytes)[:16]
    files = {'UNION.json': manifest_bytes, 'upstream/wsgs-united.tar.gz': upstream,
        'upstream/smpp.tar.gz': smpp_data,
        'deploy': (ROOT / 'deploy/united-wsgs/deploy').read_bytes(),
        'deploy-full.mjs': (ROOT / 'deploy/united-wsgs/deploy-full.mjs').read_bytes(),
        'README.md': (ROOT / 'deploy/united-wsgs/README.md').read_bytes()}
    for filename in ('deploy.mjs', 'deploy.sh', 'extract.py'):
        files[filename] = (ROOT / 'deploy/united' / filename).read_bytes()
    archive = args.output_dir / (name + '.tar.gz')
    digest = write_archive(archive, name, files, executable=('deploy', 'deploy.sh'))
    report = {'status': 'PASS', 'archive': str(archive.resolve()), 'sha256': digest,
        'smppPackage': str(args.smpp_package.resolve()), 'components': components,
        'upstreamPackagePreserved': True, 'storageCompatibility': storage,
        'delivery': 'ONLINE_SOURCE_BUILD', 'siteAcceptance': 'NOT_RUN', 'credentialsIncluded': False}
    archive.with_name(name + '.build.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Publish SMPP + an intact GOWM/GDPS/GSAP union with pinned upstream bytes."""
import argparse, hashlib, io, json, pathlib, subprocess, tarfile, tempfile, gzip, shutil, os
ROOT=pathlib.Path(__file__).resolve().parents[1]
def digest(b): return hashlib.sha256(b).hexdigest()
def read_archive(p):
    with tarfile.open(fileobj=io.BytesIO(p) if isinstance(p,bytes) else None,name=None if isinstance(p,bytes) else p,mode='r:gz') as t:
        files={}
        for m in t:
            name=m.name.removeprefix('./').rstrip('/');path=pathlib.PurePosixPath(name)
            if path.is_absolute() or '..' in path.parts or '\\' in name or not(m.isfile() or m.isdir()): raise ValueError('Unsafe archive member')
            if m.isfile():
                if name in files: raise ValueError('Duplicate archive member')
                files[name]=t.extractfile(m).read()
        return files

def main():
    a=argparse.ArgumentParser();a.add_argument('--analysis-package',type=pathlib.Path,default=ROOT.parent/'gowm-spatiotemporal-analysis-providers/output/deployment/current/gowm-gdps-analysis-dev-server-0.1.0.tar.gz');a.add_argument('--gowm-package',type=pathlib.Path,default=ROOT.parent/'geospatial-operational-world-model/output/deployment/gowm-dev-server-0.7.1.tar.gz');a.add_argument('--output-dir',type=pathlib.Path,default=ROOT/'artifacts/united');args=a.parse_args()
    sources={}
    for key,p in [('analysis',args.analysis_package),('gowm',args.gowm_package)]:
        data=p.read_bytes();line=pathlib.Path(str(p)+'.sha256').read_text().strip().split();assert len(line)==2 and line[0]==digest(data) and line[1].lstrip('*')==p.name,'Input checksum mismatch'
        sources[key]={'name':p.name,'sha256':digest(data),'bytes':data}
    base=read_archive(sources['analysis']['bytes']);base_root=next(iter(base)).split('/')[0]
    source_file=base[base_root+'/deployment/SOURCE.json'];provenance=json.loads(source_file)
    assert provenance['nestedGowm']['sha256']==sources['gowm']['sha256'],'Analysis union must be rebuilt against this exact GOWM package; refusing silent replacement'
    gowm=read_archive(sources['gowm']['bytes']);groot=next(iter(gowm)).split('/')[0]
    assert groot+'/scripts/business-storage/accounts.ts' in gowm,'GOWM business account initializer missing'
    with tempfile.TemporaryDirectory(prefix='smpp-united-build-') as tmp:
        tmp=pathlib.Path(tmp)
        subprocess.run(['node',str(ROOT/'scripts/package-development-server.mjs'),'--site','sz-gowm','--output-dir',str(tmp)],cwd=ROOT,check=True)
        smpp=next(tmp.glob('*.tar.gz'));sd=smpp.read_bytes();sf=read_archive(sd);revision=sf['SOURCE_REVISION'].decode().strip()
        manifest={'schemaVersion':1,'base':{k:v for k,v in sources['analysis'].items() if k!='bytes'},'gowm':{k:v for k,v in sources['gowm'].items() if k!='bytes'},'baseRoot':base_root,'baseSourceSha256':digest(source_file),'smpp':{'name':smpp.name,'sha256':digest(sd),'revision':revision},'credentialPolicy':'Reuse upstream private business-connections.env; no passwords in archive','deploymentHost':'sz-gowm'}
        files={'UNION.json':json.dumps(manifest,indent=2).encode()+b'\n','upstream/analysis.tar.gz':sources['analysis']['bytes'],'upstream/gowm.tar.gz':sources['gowm']['bytes'],'upstream/smpp.tar.gz':sd}
        for p in sorted((ROOT/'deploy/united').iterdir()):
            if p.is_file():files[p.name]=p.read_bytes()
        files['SHA256SUMS']=''.join(f'{digest(v)}  {k}\n' for k,v in sorted(files.items())).encode()
        name='smpp-gowm-gdps-gsap-'+digest(files['UNION.json'])[:16]
        args.output_dir.mkdir(parents=True,exist_ok=True);archive=args.output_dir/(name+'.tar.gz')
        temp=tmp/'union.tar.gz'
        with temp.open('wb') as raw,gzip.GzipFile(fileobj=raw,filename='',mode='wb',mtime=0) as gz,tarfile.open(fileobj=gz,mode='w') as t:
            for k,v in sorted(files.items()):
                m=tarfile.TarInfo(name+'/'+k);m.size=len(v);m.mode=0o644;m.mtime=0;t.addfile(m,io.BytesIO(v))
        shutil.copyfile(temp,str(archive)+'.tmp');os.replace(str(archive)+'.tmp',archive)
        sha=digest(archive.read_bytes());pathlib.Path(str(archive)+'.sha256').write_text(f'{sha}  {archive.name}\n');pathlib.Path(str(archive)+'.json').write_text(json.dumps(manifest,indent=2)+'\n')
        print(json.dumps({'archive':str(archive),'sha256':sha,'revision':revision}))
if __name__=='__main__':main()

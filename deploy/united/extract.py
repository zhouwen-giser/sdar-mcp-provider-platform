import pathlib,tarfile,sys
src,dest=map(pathlib.Path,sys.argv[1:]);dest.mkdir(parents=True,exist_ok=False)
with tarfile.open(src) as t:
    seen=set()
    for m in t:
        p=pathlib.PurePosixPath(m.name)
        if p.is_absolute() or '..' in p.parts or m.name in seen or not (m.isfile() or m.isdir()): raise ValueError('Unsafe member')
        seen.add(m.name)
    t.extractall(dest,filter='data')

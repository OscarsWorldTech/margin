"""Create a small installation archive containing no source build or user data."""
import hashlib
import json
import zipfile
from pathlib import Path

root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text())['version']
out=root/'release'
out.mkdir(exist_ok=True)
archive=out/f'margin-v{version}-install.zip'
files=['compose.prebuilt.yml','compose.prebuilt.cpu.yml','compose.prebuilt.nvidia.yml',
       'setup.sh','doctor.sh','.env.example','LICENSE','docs/INSTALL.md','docs/HARDWARE.md']
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for name in files:
        target='README.md' if name=='docs/INSTALL.md' else name
        z.write(root/name,'margin/'+target)
        if name=='docs/INSTALL.md':
            z.write(root/name,'margin/'+name)
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
digest=hashlib.sha256(archive.read_bytes()).hexdigest()
(out/'SHA256SUMS').write_text(f'{digest}  {archive.name}\n')
print(archive.name)

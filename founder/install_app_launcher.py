"""Install a searchable local macOS app launcher. No bundling/signing of Electron."""
from pathlib import Path
import plistlib, subprocess, tempfile, shutil
ROOT=Path(__file__).resolve().parent
APP=Path('/Applications/Hermes App.app')
BUNDLE_ID='com.cartha.hermes-founder-launcher'
if APP.exists():
    info=APP/'Contents/Info.plist'
    if not info.exists() or plistlib.loads(info.read_bytes()).get('CFBundleIdentifier')!=BUNDLE_ID:
        raise SystemExit('A different Hermes App.app already exists; refusing to replace it')
contents=APP/'Contents'
(contents/'MacOS').mkdir(parents=True,exist_ok=True)
(contents/'Resources').mkdir(exist_ok=True)
launcher=contents/'MacOS/HermesApp'
launcher.write_text('#!/bin/sh\nexec "'+str(ROOT/'open_desktop.sh')+'"\n')
launcher.chmod(0o755)
info={'CFBundleName':'Hermes App','CFBundleDisplayName':'Hermes App','CFBundleIdentifier':BUNDLE_ID,
      'CFBundleExecutable':'HermesApp','CFBundlePackageType':'APPL','CFBundleVersion':'1',
      'CFBundleShortVersionString':'1.0','CFBundleIconFile':'HermesApp.icns',
      'LSApplicationCategoryType':'public.app-category.productivity','NSHighResolutionCapable':True}
(contents/'Info.plist').write_bytes(plistlib.dumps(info))
# Package the existing artwork into macOS icon sizes; no artistic changes.
with tempfile.TemporaryDirectory() as temp:
    icons=Path(temp)/'HermesApp.iconset';icons.mkdir()
    source=ROOT/'desktop/founder-dock-icon.png'
    for size in (16,32,128,256,512):
        for scale in (1,2):
            suffix='@2x' if scale==2 else ''
            out=icons/f'icon_{size}x{size}{suffix}.png'
            subprocess.run(['/usr/bin/sips','-z',str(size*scale),str(size*scale),str(source),'--out',str(out)],check=True,stdout=subprocess.DEVNULL)
    subprocess.run(['/usr/bin/iconutil','-c','icns',str(icons),'-o',str(contents/'Resources/HermesApp.icns')],check=True)
register='/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
subprocess.run([register,'-f',str(APP)],check=True)
subprocess.run(['/usr/bin/mdimport',str(APP)],check=True)
print('Installed and registered:',APP)

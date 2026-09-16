"""Install a searchable local macOS app launcher. Native consent-aware wrapper; never modifies or signs Electron."""
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
subprocess.run(['xcrun','swiftc',str(ROOT/'desktop/Launcher.swift'),
                '-framework','AppKit','-o',str(launcher)],check=True)
launcher.chmod(0o755)
info={'CFBundleName':'Hermes App','CFBundleDisplayName':'Hermes App','CFBundleIdentifier':BUNDLE_ID,
      'CFBundleExecutable':'HermesApp','CFBundlePackageType':'APPL','CFBundleVersion':'2',
      'CFBundleShortVersionString':'1.1','CFBundleIconFile':'HermesApp.icns',
      'LSApplicationCategoryType':'public.app-category.productivity','NSHighResolutionCapable':True,
      'HermesStartupScript':str(ROOT/'open_desktop.sh'),
      'NSDocumentsFolderUsageDescription':'Hermes needs to read its startup code and operations connector stored in your Documents folder.'}
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
# Use the normal local development identity; do not modify Electron signing.
import os
identity=os.environ.get('HERMES_LAUNCHER_SIGNING_IDENTITY')
if not identity:
    result=subprocess.run(['security','find-identity','-v','-p','codesigning'],check=True,capture_output=True,text=True)
    import re
    match=re.search(r'([A-F0-9]{40}) \"Apple Development:',result.stdout)
    if not match: raise SystemExit('No Apple Development identity; set HERMES_LAUNCHER_SIGNING_IDENTITY to a valid local identity')
    identity=match.group(1)
subprocess.run(['codesign','--force','--sign',identity,str(APP)],check=True)
subprocess.run(['codesign','--verify','--strict',str(APP)],check=True)
register='/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
subprocess.run([register,'-f',str(APP)],check=True)
subprocess.run(['/usr/bin/mdimport',str(APP)],check=True)
print('Installed and registered:',APP)

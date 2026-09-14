"""Reproducible local presentation overlay. Fails closed if upstream's anchor changes.
Only the fresh-draft intro for the founder profile is replaced; Bot Chat ownership stays untouched.
"""
from pathlib import Path
import shutil
ROOT=Path(__file__).resolve().parent
TARGET=Path.home()/'.hermes/hermes-agent/apps/desktop/src/components/chat'
intro=TARGET/'intro.tsx'
s=intro.read_text()
anchor='  const copy = resolveCopy(personality, mountSeed + (seed ?? 0))'
if "from './founder-home'" not in s:
    if s.count(anchor)!=1:raise RuntimeError('Upstream intro changed; review before applying')
    s="import { useStore } from '@nanostores/react'\nimport { $activeGatewayProfile } from '@/store/profile'\nimport { FounderHome } from './founder-home'\n"+s
    s=s.replace(anchor,anchor+"\n  const profile = useStore($activeGatewayProfile)\n  if (profile === 'founder') return <FounderHome />")
for name in ['founder-home.tsx','founder-home.css','founder-home.test.tsx']:
    shutil.copy2(ROOT/name,TARGET/name)
shutil.copytree(ROOT/'assets',TARGET/'assets',dirs_exist_ok=True)
intro.write_text(s)
report_dir=ROOT/'report'
if report_dir.exists():
    shutil.copytree(report_dir,TARGET/'report',dirs_exist_ok=True,ignore=shutil.ignore_patterns('*.png'))
    message=TARGET.parent/'assistant-ui/thread/assistant-message.tsx'
    content=message.read_text()
    marker='            {MESSAGE_PARTS}'
    if 'FounderReportMessage' not in content:
        if content.count(marker)!=1:raise RuntimeError('Upstream message renderer changed; review before applying')
        content="import { FounderReportMessage } from '@/components/chat/report/founder-report'\n"+content
        content=content.replace(marker,'            <FounderReportMessage>{MESSAGE_PARTS}</FounderReportMessage>')
        message.write_text(content)
icon_target=TARGET.parents[2]/'public/apple-touch-icon.png'
icon=ROOT/'founder-dock-icon.png'
if icon.exists():
    if icon_target.exists() and not (ROOT/'upstream-icon.backup.png').exists():
        shutil.copy2(icon_target,ROOT/'upstream-icon.backup.png')
    shutil.copy2(icon,icon_target)
print('Founder home overlay installed; other profiles retain their original intro.')

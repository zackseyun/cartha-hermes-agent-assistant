"""Install only the dedicated founder profile. Leaves legacy stack and other profiles alone."""
from pathlib import Path
import shutil
import yaml
ROOT=Path(__file__).resolve().parent
HOME=Path.home()/'.hermes/profiles/founder'
PYTHON=Path.home()/'.hermes/hermes-agent/venv/bin/python'
HOME.mkdir(parents=True,exist_ok=True)
config_path=HOME/'config.yaml'
config=yaml.safe_load(config_path.read_text()) if config_path.exists() else {}
config=config or {}
if config_path.exists(): shutil.copy2(config_path,HOME/'config.before-founder.yaml')
config.update({
 'max_concurrent_sessions':1,
 'model':{'provider':'openai-codex','default':'gpt-5.6-sol'},
 'timezone':'America/Los_Angeles',
 'fallback_providers':[],
 'agent':{'max_turns':12,'reasoning_effort':'medium','disabled_toolsets':['terminal','file','browser','code_execution','web','search','delegation','cronjob']},
 'platform_toolsets':{p:['skills','memory','session_search'] for p in ['cli','api_server','local','cron','telegram','whatsapp','discord','slack']},
 'auxiliary':{p:{'provider':'openai-codex','model':'gpt-5.6-sol'} for p in ['vision','web_extract','compression','session_search','title_generation']},
 'mcp_servers':{'cartha_ops':{'command':str(PYTHON),'args':[str(ROOT/'ops.py')],
   'env':{'CARTHA_OPS_HOME':str(HOME/'operations')},'sampling':{'enabled':False}}},
})
config.pop('fallback_model',None)
config_path.write_text(yaml.safe_dump(config,sort_keys=False));config_path.chmod(0o600)
shutil.copy2(ROOT/'SOUL.md',HOME/'SOUL.md')
shutil.copytree(ROOT/'skills',HOME/'skills',dirs_exist_ok=True)
launcher=Path.home()/'.local/bin/founder'
launcher.write_text('#!/bin/sh\nexec "'+str(PYTHON)+'" "'+str(ROOT/'run_founder.py')+'" "$@"\n')
launcher.chmod(0o700)
print('Installed isolated founder profile:',HOME)

"""Credential-minimal launcher: saved profile providers, no inherited API/cloud keys."""
import os
import subprocess
import sys
from pathlib import Path

def clean_environment(source):
    allowed={'HOME','PATH','USER','LOGNAME','SHELL','TERM','COLORTERM','TMPDIR','LANG','LC_ALL','LC_CTYPE'}
    env={k:v for k,v in source.items() if k in allowed}
    env['HERMES_HOME']=str(Path.home()/'.hermes/profiles/founder')
    env['HERMES_TIMEZONE']='America/Los_Angeles'
    return env

if __name__=='__main__':
    from codex_catalog import prepare_catalog
    try:
        prepare_catalog()
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(f'Codex catalog repair skipped: {error}', file=sys.stderr)
    exe=str(Path.home()/'.hermes/hermes-agent/venv/bin/hermes')
    os.execve(exe,[exe,*sys.argv[1:]],clean_environment(os.environ))

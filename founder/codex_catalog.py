"""Keep Hermes' account-scoped catalog compatible with the installed Codex client.

The backend's former 0.0.0 sentinel now omits GPT-6 models. Use the version
recorded by Codex itself, not a guessed model list. No credentials are read here.
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

VERSION = re.compile(r"\d+\.\d+\.\d+")
ASSIGNMENT = re.compile(r'^CODEX_UNGATED_CLIENT_VERSION = "(?:\d+\.\d+\.\d+)"$', re.MULTILINE)


def installed_version(codex_home, executable=None):
    cache = Path(codex_home) / 'models_cache.json'
    try:
        version = json.loads(cache.read_text()).get('client_version')
        if isinstance(version, str) and VERSION.fullmatch(version) and version != '0.0.0':
            return version
    except (OSError, ValueError, AttributeError):
        pass
    executable = executable or shutil.which('codex')
    if not executable:
        candidate = Path.home() / '.npm-global/bin/codex'
        executable = str(candidate) if candidate.is_file() else None
    if not executable:
        raise RuntimeError('Codex client/version unavailable; catalog left unchanged')
    result = subprocess.run([executable, '--version'], check=True, capture_output=True,
                            text=True, timeout=10)
    match = re.fullmatch(r'codex-cli (\d+\.\d+\.\d+)\s*', result.stdout)
    if not match:
        raise RuntimeError('Unrecognized Codex version; catalog left unchanged')
    return match.group(1)


def repair_catalog(hermes_root, version):
    if not VERSION.fullmatch(version) or version == '0.0.0':
        raise ValueError('A real Codex client version is required')
    target = Path(hermes_root) / 'agent/model_metadata.py'
    source = target.read_text()
    if len(ASSIGNMENT.findall(source)) != 1:
        raise RuntimeError('Hermes catalog layout changed; review before applying repair')
    updated = ASSIGNMENT.sub(f'CODEX_UNGATED_CLIENT_VERSION = "{version}"', source)
    if updated == source:
        return False
    # Both the model picker and context-window lookup import this shared URL.
    mode = target.stat().st_mode & 0o777
    fd, temporary = tempfile.mkstemp(dir=target.parent, prefix='.codex-catalog-')
    try:
        with os.fdopen(fd, 'w') as output:
            output.write(updated)
        os.chmod(temporary, mode)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return True


def prepare_catalog():
    codex_home = Path(os.environ.get('CODEX_HOME') or Path.home() / '.codex')
    version = installed_version(codex_home)
    changed = repair_catalog(Path.home() / '.hermes/hermes-agent', version)
    return version, changed


if __name__ == '__main__':
    version, changed = prepare_catalog()
    print(f'Hermes Codex catalog version: {version} (updated: {changed})')

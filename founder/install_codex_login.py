"""Apply a narrow local compatibility overlay; refuse unknown upstream anchors."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent
PATCHES = {
    'hermes_cli/auth_codex.py': [
        ('    auth_store = _load_auth_store_maybe_locked(_lock)\n',
         '    from hermes_cli.auth_codex_cli import uses_codex_login, resolve_codex_login\n'
         '    if uses_codex_login():\n'
         '        credentials = resolve_codex_login()\n'
         '        return {"tokens": {"access_token": credentials["api_key"]}, "last_refresh": credentials["last_refresh"]}\n'),
        ('    read_error: Optional[AuthError] = None\n',
         '    from hermes_cli.auth_codex_cli import uses_codex_login, resolve_codex_login\n'
         '    if uses_codex_login():\n'
         '        return resolve_codex_login(force_refresh=force_refresh)\n'),
    ],
    'agent/credential_pool.py': [
        ('    if provider in SINGLE_USE_REFRESH_POOL_PROVIDERS:\n        # One-time heal',
         '    if provider == "openai-codex":\n'
         '        from hermes_cli.auth_codex_cli import uses_codex_login\n'
         '        if uses_codex_login():\n'
         '            return CredentialPool(provider, [])\n'),
    ],
    'hermes_cli/model_switch_providers.py': [
        ('    try:\n        from agent.credential_pool import load_pool\n        pool = load_pool(provider)',
         '    if provider == "openai-codex":\n'
         '        from hermes_cli.auth_codex_cli import uses_codex_login, resolve_codex_login\n'
         '        if uses_codex_login():\n'
         '            try:\n'
         '                return bool(resolve_codex_login()["api_key"])\n'
         '            except Exception:\n'
         '                return False\n'),
    ],
    'hermes_cli/models.py': [
        ('    parts: list[str] = []\n    try:\n',
         '    if provider == "openai-codex":\n'
         '        from hermes_cli.auth_codex_cli import catalog_identity\n'
         '        parts.append(catalog_identity())\n'),
    ],
}


def install(hermes_root):
    root = Path(hermes_root)
    changes = {}
    for filename, patches in PATCHES.items():
        target = root / filename
        content = target.read_text()
        for anchor, insertion in patches:
            if insertion in content:
                continue
            if content.count(anchor) != 1:
                raise RuntimeError(f'Hermes {filename} changed; review login overlay before installing')
            # The cache identity belongs after its list declaration; other
            # overlays run before their existing branches.
            if filename == 'hermes_cli/models.py':
                content = content.replace(anchor, '    parts: list[str] = []\n' + insertion + '    try:\n')
            else:
                content = content.replace(anchor, insertion + anchor)
        changes[target] = content
    # All anchors are verified before changing anything. No auth store is edited.
    shutil.copy2(ROOT / 'codex_login.py', root / 'hermes_cli/auth_codex_cli.py')
    for target, content in changes.items():
        if target.read_text() != content:
            target.write_text(content)


if __name__ == '__main__':
    install(Path.home() / '.hermes/hermes-agent')
    print('Read-only Codex login bridge installed.')

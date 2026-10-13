"""Explicitly reuse Codex's login without copying or rotating its refresh token."""
import os
from pathlib import Path
import shutil


def uses_codex_login():
    from hermes_cli.config_effective import load_user_config_effective
    config = load_user_config_effective()
    return config.get('model', {}).get('codex_auth_source') == 'codex_cli'


def catalog_identity():
    """Cache provenance changes with the selected owner, without reading credentials."""
    if not uses_codex_login():
        return 'codex_auth_source=hermes'
    home = Path(os.environ.get('CODEX_HOME') or Path.home() / '.codex').expanduser()
    path = home / 'auth.json'
    try:
        stamp = path.stat().st_mtime_ns
    except FileNotFoundError:
        stamp = 'missing'
    return f'codex_auth_source=codex_cli:{path}:{stamp}'


def resolve_codex_login(*, force_refresh=False):
    from hermes_cli.auth_codex import _import_codex_cli_tokens, _codex_access_token_is_expiring
    from hermes_cli.auth_constants import DEFAULT_CODEX_BASE_URL, AuthError
    tokens = _import_codex_cli_tokens()
    if force_refresh or not tokens or _codex_access_token_is_expiring(tokens['access_token'], 300):
        # Only Codex's owning process may refresh its managed grant. No thread,
        # prompt, agent loop, shell command, or tool execution is started.
        from agent.transports.codex_app_server import CodexAppServerClient
        binary = shutil.which('codex') or str(Path.home() / '.npm-global/bin/codex')
        home = os.environ.get('CODEX_HOME') or str(Path.home() / '.codex')
        try:
            with CodexAppServerClient(codex_bin=binary, codex_home=home) as client:
                client.initialize(client_name='hermes-login-bridge', client_title='Hermes login bridge')
                client.request('account/read', {'refreshToken': True}, timeout=30)
        except Exception:
            raise AuthError('Codex could not renew its login. Open Codex and sign in.',
                            code='codex_cli_refresh_failed', relogin_required=True) from None
        tokens = _import_codex_cli_tokens()
    if not tokens:
        raise AuthError('No usable Codex login. Open Codex and sign in.',
                        code='codex_cli_auth_missing', relogin_required=True)
    return {'provider': 'openai-codex', 'api_key': tokens['access_token'],
            'base_url': DEFAULT_CODEX_BASE_URL, 'auth_mode': 'chatgpt',
            'source': 'codex_cli', 'last_refresh': tokens.get('last_refresh')}

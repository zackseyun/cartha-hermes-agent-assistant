"""Import an authorized OpenRouter key resolved at runtime, without logging it.

Run through asm-exec with OPENROUTER_API_KEY set to a dynamic reference.
Only a manually selected provider is enabled; the default/fallbacks stay intact.
"""
import logging
import os
from types import SimpleNamespace


def connect():
    logging.disable(logging.CRITICAL)
    import httpx
    from hermes_cli.auth_commands import auth_add_command
    from hermes_cli.models import clear_provider_models_cache

    key = os.environ.get('OPENROUTER_API_KEY', '').strip()
    if not key or '{{resolve:' in key:
        raise RuntimeError('OpenRouter key was not resolved')
    response = httpx.get('https://openrouter.ai/api/v1/key',
                         headers={'Authorization': 'Bearer ' + key}, timeout=20)
    if response.status_code != 200:
        raise RuntimeError(f'OpenRouter rejected the credential (HTTP {response.status_code})')
    auth_add_command(SimpleNamespace(provider='openrouter', auth_type='api_key',
                                    api_key=key, label='AWS OpenRouter', priority=None))
    clear_provider_models_cache('openrouter')
    print('OpenRouter connected; default model and automatic fallbacks unchanged.')


if __name__ == '__main__':
    try:
        connect()
    except Exception as error:
        # Upstream exceptions may contain request details: never emit them.
        print(f'OpenRouter connection failed ({type(error).__name__}); no credential printed.')
        raise SystemExit(1)

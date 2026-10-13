import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch


class CodexLoginTests(unittest.TestCase):
    def test_real_runtime_and_auxiliary_use_owner_without_copying_grant(self):
        from hermes_cli.auth_codex import resolve_codex_runtime_credentials
        from agent.credential_pool import load_pool
        from agent.auxiliary_client import _read_codex_access_token
        from hermes_cli.model_switch_providers import _credential_pool_is_usable
        from hermes_cli.runtime_provider import resolve_runtime_provider
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            (home / 'config.yaml').write_text('model:\n  provider: openai-codex\n  codex_auth_source: codex_cli\n')
            store = home / 'auth.json'
            store.write_text(json.dumps({'version': 1, 'providers': {}, 'credential_pool': {}}))
            original = store.read_bytes()
            tokens = {'access_token': 'fixture-access', 'refresh_token': 'must-never-be-copied'}
            with patch.dict(os.environ, {'HERMES_HOME': directory}), \
                    patch('hermes_cli.auth_codex._import_codex_cli_tokens', return_value=tokens):
                credentials = resolve_codex_runtime_credentials()
                self.assertEqual(credentials['api_key'], tokens['access_token'])
                self.assertNotIn('refresh_token', credentials)
                self.assertEqual(load_pool('openai-codex').entries(), [])
                self.assertEqual(_read_codex_access_token(), tokens['access_token'])
                self.assertTrue(_credential_pool_is_usable('openai-codex'))
                runtime = resolve_runtime_provider(requested='openai-codex', target_model='fixture-model')
                self.assertEqual(runtime['api_key'], tokens['access_token'])
            self.assertEqual(store.read_bytes(), original)

    def test_expiry_renews_through_owner_rpc_not_a_second_token_store(self):
        from hermes_cli.auth_codex_cli import resolve_codex_login
        client = MagicMock()
        client.__enter__.return_value = client
        with patch('hermes_cli.auth_codex._import_codex_cli_tokens',
                   side_effect=[None, {'access_token': 'renewed-access', 'refresh_token': 'private-owner-grant'}]), \
                patch('agent.transports.codex_app_server.CodexAppServerClient', return_value=client), \
                patch('hermes_cli.auth._save_auth_store') as save:
            credentials = resolve_codex_login()
            self.assertEqual(credentials['api_key'], 'renewed-access')
            self.assertNotIn('refresh_token', credentials)
            client.request.assert_called_once_with('account/read', {'refreshToken': True}, timeout=30)
            save.assert_not_called()


if __name__ == '__main__':
    unittest.main()

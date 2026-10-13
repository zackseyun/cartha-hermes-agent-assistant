import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


class CatalogIdentityTests(unittest.TestCase):
    def test_switching_credential_owner_invalidates_cached_model_list(self):
        from hermes_cli.models import _credential_fingerprint
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'HERMES_HOME': directory}):
            config = Path(directory) / 'config.yaml'
            config.write_text('model:\n  provider: openai-codex\n')
            before = _credential_fingerprint('openai-codex')
            config.write_text('model:\n  provider: openai-codex\n  codex_auth_source: codex_cli\n')
            after = _credential_fingerprint('openai-codex')
            self.assertNotEqual(before, after)
            self.assertEqual(after, _credential_fingerprint('openai-codex'))


if __name__ == '__main__':
    unittest.main()

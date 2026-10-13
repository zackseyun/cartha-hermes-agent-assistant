from pathlib import Path
import json
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from codex_catalog import installed_version, repair_catalog


class CatalogTests(unittest.TestCase):
    def test_installed_catalog_version_reaches_shared_url_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'models_cache.json').write_text(json.dumps({'client_version': '1.2.3'}))
            target = root / 'agent/model_metadata.py'
            target.parent.mkdir()
            target.write_text('CODEX_UNGATED_CLIENT_VERSION = "0.0.0"\n'
                              'CODEX_MODELS_CATALOG_URL = f"https://chatgpt.com/backend-api/codex/models?client_version={CODEX_UNGATED_CLIENT_VERSION}"\n')
            version = installed_version(root)
            self.assertTrue(repair_catalog(root, version))
            namespace = {}
            exec(compile(target.read_text(), str(target), 'exec'), namespace)
            self.assertTrue(namespace['CODEX_MODELS_CATALOG_URL'].endswith('client_version=' + version))
            self.assertFalse(repair_catalog(root, version))

    def test_invalid_version_or_changed_upstream_fails_without_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / 'agent/model_metadata.py'
            target.parent.mkdir()
            target.write_text('unexpected_layout = True\n')
            before = target.read_bytes()
            with self.assertRaises(ValueError):
                repair_catalog(root, '0.0.0')
            with self.assertRaises(RuntimeError):
                repair_catalog(root, '1.2.3')
            self.assertEqual(target.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()

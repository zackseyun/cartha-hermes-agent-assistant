import os
from pathlib import Path
import subprocess
import tempfile
import unittest

class LauncherTests(unittest.TestCase):
    def test_gui_path_and_arguments_without_shell_profile(self):
        script=Path(__file__).resolve().parents[1]/'open_desktop.sh'
        with tempfile.TemporaryDirectory() as home:
            stub=Path(home)/'.local/bin/founder';stub.parent.mkdir(parents=True)
            stub.write_text('#!/bin/sh\nprintf "%s\\n" "$PATH" "$@"\n');stub.chmod(0o700)
            subprocess.run(['/bin/sh',str(script)],env={'HOME':home,'PATH':'/usr/bin:/bin'},check=True)
            lines=(Path(home)/'.hermes/profiles/founder/logs/desktop-launcher.log').read_text().splitlines()
            paths=lines[0].split(':')
            self.assertIn('/opt/homebrew/bin',paths)
            self.assertLess(paths.index('/Users/zackseyun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin'),paths.index('/opt/homebrew/bin'))
            self.assertEqual(lines[1:],['desktop','--source','--skip-build'])

    def test_native_launcher_requests_normal_access_and_reports_failure(self):
        root=Path(__file__).resolve().parents[1]
        source=(root/'desktop/Launcher.swift').read_text()
        installer=(root/'install_app_launcher.py').read_text()
        self.assertIn('Data(contentsOf: URL(fileURLWithPath: path))', source)
        self.assertLess(source.index('Data(contentsOf: URL(fileURLWithPath: path))'),
                        source.index('try child.run()'))
        self.assertIn('child.currentDirectoryURL = home', source)
        self.assertIn('child.standardError = log', source)
        self.assertIn('task.terminationStatus != 0', source)
        self.assertIn('alert.runModal()', source)
        self.assertIn('NSDocumentsFolderUsageDescription', installer)
        self.assertIn("'--verify','--strict'", installer)
        for forbidden in ('tccutil', 'chmod 777', 'xattr -d', 'sudo'):
            self.assertNotIn(forbidden, source + installer)

if __name__=='__main__':unittest.main()

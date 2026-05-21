#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = process.cwd();
const project = 'ios/HermesClient/HermesClient.xcodeproj';
const scheme = 'HermesClient';
const bundleId = 'com.cartha.hermesclient';
const deviceId = process.env.HERMES_IOS_DEVICE_ID || process.argv[2] || '00008140-000138AE3C53001C';
const teamId = process.env.HERMES_IOS_TEAM_ID || 'XD2KQ98Z77';
const bridgeURL = process.env.HERMES_BRIDGE_URL || 'http://10.0.0.253:5138';

function readToken() {
  if (process.env.HERMES_MOBILE_TOKEN) return process.env.HERMES_MOBILE_TOKEN;
  const envPath = join(homedir(), '.hermes', '.env');
  const content = readFileSync(envPath, 'utf8');
  const line = content.split(/\r?\n/).find((entry) => entry.startsWith('HERMES_MOBILE_TOKEN='));
  if (!line) throw new Error(`Missing HERMES_MOBILE_TOKEN in ${envPath}`);
  return line.slice('HERMES_MOBILE_TOKEN='.length).trim();
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repo,
    stdio: options.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    if (options.allowFailure) return result;
    if (options.quiet) {
      process.stderr.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
    }
    process.exit(result.status ?? 1);
  }
  return result;
}

const tempDir = mkdtempSync(join(tmpdir(), 'hermes-ios-'));
const xcconfig = join(tempDir, 'LocalDefaults.xcconfig');
try {
  const token = readToken();
  writeFileSync(xcconfig, [
    `INFOPLIST_KEY_HERMESDefaultBridgeURL = ${bridgeURL}`,
    `INFOPLIST_KEY_HERMESDefaultBridgeToken = ${token}`,
    '',
  ].join('\n'));

  console.log(`Building Hermes Client for ${deviceId}…`);
  run('xcodebuild', [
    '-quiet',
    '-project', project,
    '-scheme', scheme,
    '-configuration', 'Debug',
    '-destination', `id=${deviceId}`,
    '-allowProvisioningUpdates',
    `DEVELOPMENT_TEAM=${teamId}`,
    '-xcconfig', xcconfig,
    'build',
  ]);

  const find = run('/bin/zsh', ['-lc', `find "$HOME/Library/Developer/Xcode/DerivedData" -path '*/Build/Products/Debug-iphoneos/HermesClient.app' -type d -print -quit`], { quiet: true });
  const appPath = find.stdout.trim();
  if (!appPath) throw new Error('Could not locate built HermesClient.app in DerivedData.');

  console.log('Installing on iPhone…');
  run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', deviceId, appPath]);

  console.log('Launching…');
  const launch = run('xcrun', ['devicectl', 'device', 'process', 'launch', '--device', deviceId, bundleId], { allowFailure: true, quiet: true });
  if (launch.status !== 0) {
    const output = `${launch.stdout || ''}${launch.stderr || ''}`;
    if (output.includes('Locked')) {
      console.log('Installed, but the iPhone is locked. Unlock it and run this script again to launch.');
    } else {
      process.stderr.write(output);
      console.log('Installed, but launch failed.');
    }
    process.exit(0);
  }
  console.log('Hermes Client is installed and launched.');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

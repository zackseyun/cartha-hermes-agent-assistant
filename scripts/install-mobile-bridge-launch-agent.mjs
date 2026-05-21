#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = process.env.HOME || os.homedir();
const plistPath = path.join(home, "Library", "LaunchAgents", "dev.hermes.mobile-bridge.plist");
const nodePath = process.execPath;
const bridgePath = path.join(repoDir, "scripts", "mobile-bridge.mjs");
const logsDir = path.join(repoDir, "logs");

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

await fs.mkdir(path.dirname(plistPath), { recursive: true });
await fs.mkdir(logsDir, { recursive: true });
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.hermes.mobile-bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(nodePath)}</string>
    <string>${xml(bridgePath)}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(repoDir)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(path.join(logsDir, "mobile-bridge.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(logsDir, "mobile-bridge.err.log"))}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HERMES_MOBILE_HOST</key><string>0.0.0.0</string>
    <key>HERMES_MOBILE_PORT</key><string>5138</string>
  </dict>
</dict>
</plist>
`;
await fs.writeFile(plistPath, plist);
await run("launchctl", ["bootout", `gui/${process.getuid()}`, plistPath]).catch(() => null);
await run("launchctl", ["bootstrap", `gui/${process.getuid()}`, plistPath]);
await run("launchctl", ["kickstart", "-k", `gui/${process.getuid()}/dev.hermes.mobile-bridge`]);
console.log(`Installed and started ${plistPath}`);

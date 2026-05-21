#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const HOME = process.env.HOME || os.homedir();
const envPath = path.join(HOME, ".hermes", ".env");

function lanAddresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}

function readDotenvValue(raw, key) {
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    if (trimmed.slice(0, eq).trim() !== key) continue;
    return trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/gu, "");
  }
  return "";
}

await fs.mkdir(path.dirname(envPath), { recursive: true });
let raw = await fs.readFile(envPath, "utf8").catch(() => "");
let token = readDotenvValue(raw, "HERMES_MOBILE_TOKEN");
if (!token) {
  token = crypto.randomBytes(32).toString("base64url");
  raw = raw.trimEnd();
  raw += `${raw ? "\n" : ""}HERMES_MOBILE_TOKEN=${token}\n`;
  await fs.writeFile(envPath, raw, { mode: 0o600 });
}

const port = process.env.HERMES_MOBILE_PORT || "5138";
console.log("Hermes Mobile Bridge configured.\n");
console.log(`Token: ${token}`);
console.log("Base URLs:");
for (const address of lanAddresses()) console.log(`  http://${address}:${port}`);
console.log("\nInstall/start:");
console.log("  npm run mobile:install-launch-agent");
console.log("  launchctl kickstart -k gui/$(id -u)/dev.hermes.mobile-bridge");
console.log("\nHealth check:");
console.log(`  curl -s http://127.0.0.1:${port}/health | python3 -m json.tool`);

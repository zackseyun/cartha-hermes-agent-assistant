#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const home = os.homedir();
const hermesHome = process.env.HERMES_HOME || path.join(home, ".hermes");
const launchDir = path.join(home, "Library", "LaunchAgents");
const domain = `gui/${process.getuid?.() || ""}`;
const force = process.argv.includes("--force");
const bootstrap = process.argv.includes("--bootstrap");

const heartbeatFiles = [
  ["templates/heartbeat/heartbeat.sh", "scripts/heartbeat.sh", 0o755],
  ["templates/heartbeat/heartbeat-agent.py", "scripts/heartbeat-agent.py", 0o755],
  ["templates/heartbeat/heartbeat-cleanup.sh", "scripts/heartbeat-cleanup.sh", 0o755],
  ["templates/heartbeat/heartbeat-system.sh", "scripts/heartbeat-system.sh", 0o755],
  ["templates/heartbeat-config/policy.json", "heartbeat-config/policy.json", 0o644],
];

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function copyIfNeeded(srcRel, destRel, mode) {
  const src = path.join(repoRoot, srcRel);
  const dest = path.join(hermesHome, destRel);
  mkdirp(path.dirname(dest));
  if (fs.existsSync(dest) && !force) {
    console.log(`kept existing ${dest}`);
    return;
  }
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, mode);
  console.log(`${fs.existsSync(dest) ? "installed" : "created"} ${dest}`);
}

function renderLaunchd(templateName, replacements) {
  const src = path.join(repoRoot, "templates", "launchd", templateName);
  let text = fs.readFileSync(src, "utf8");
  for (const [key, value] of Object.entries(replacements)) {
    text = text.replaceAll(`__${key}__`, value);
  }
  const dest = path.join(launchDir, templateName);
  mkdirp(launchDir);
  if (fs.existsSync(dest) && !force) {
    console.log(`kept existing ${dest}`);
    return dest;
  }
  fs.writeFileSync(dest, text, { mode: 0o644 });
  console.log(`installed ${dest}`);
  return dest;
}

function launchctl(args) {
  const result = spawnSync("launchctl", args, { stdio: "inherit" });
  return result.status ?? 1;
}

mkdirp(path.join(hermesHome, "scripts"));
mkdirp(path.join(hermesHome, "logs"));
mkdirp(path.join(hermesHome, "heartbeat-config"));

for (const [src, dest, mode] of heartbeatFiles) {
  copyIfNeeded(src, dest, mode);
}

const localBin = path.join(home, ".local", "bin");
const ollamaBin = process.env.OLLAMA_BIN || path.join(localBin, "ollama");
const pathValue = [
  localBin,
  path.join(home, ".npm-global", "bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
].join(":");

const ollamaPlist = renderLaunchd("dev.hermes.ollama.plist", {
  OLLAMA_BIN: ollamaBin,
  HERMES_HOME: hermesHome,
});
const llamaServerBin = process.env.LLAMA_SERVER_BIN || path.join(localBin, "llama-server");
const qwen36ModelPath =
  process.env.QWEN36_MODEL_PATH ||
  path.join(home, ".ollama", "models", "blobs", "sha256-ac0e2c1189e055faa36eff361580e79c5bd6f8e76bffb4ce547f167d53e31a61");
const qwen36Context = process.env.QWEN36_CONTEXT || "32768";
const qwen36Plist = renderLaunchd("dev.hermes.qwen36.plist", {
  LLAMA_SERVER_BIN: llamaServerBin,
  QWEN36_MODEL_PATH: qwen36ModelPath,
  QWEN36_CONTEXT: qwen36Context,
  HERMES_HOME: hermesHome,
});
const heartbeatPlist = renderLaunchd("dev.hermes.heartbeat.plist", {
  HERMES_HOME: hermesHome,
  PATH: pathValue,
});

if (bootstrap) {
  for (const [label, plist] of [
    ["dev.hermes.ollama", ollamaPlist],
    ["dev.hermes.qwen36", qwen36Plist],
    ["dev.hermes.heartbeat", heartbeatPlist],
  ]) {
    const printStatus = spawnSync("launchctl", ["print", `${domain}/${label}`], { stdio: "ignore" }).status ?? 1;
    if (printStatus !== 0) {
      launchctl(["bootstrap", domain, plist]);
    }
    launchctl(["kickstart", "-k", `${domain}/${label}`]);
  }
}

console.log("Heartbeat install complete.");
console.log(`Model expected by heartbeat: qwen3.6:35b-hermes-256k`);

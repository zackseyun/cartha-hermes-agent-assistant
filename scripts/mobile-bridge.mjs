#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";

const run = promisify(execFile);
const HOME = process.env.HOME || os.homedir();
const HOST = process.env.HERMES_MOBILE_HOST || "0.0.0.0";
const PORT = Number.parseInt(process.env.HERMES_MOBILE_PORT || "5138", 10);
const MAX_BODY_BYTES = Number.parseInt(process.env.HERMES_MOBILE_MAX_BODY_BYTES || "2000000", 10);
const HERMES_TASK_SH = process.env.HERMES_TASK_SH || path.join(HOME, ".hermes", "scripts", "hermes-task.sh");
const HERMES_TASK_CWD = process.env.HERMES_TASK_CWD || path.dirname(HERMES_TASK_SH);
const HERMES_REPLIES_PATH = process.env.HERMES_REPLIES_PATH || path.join(HOME, ".hermes", "heartbeat-replies.jsonl");

function readDotenvValue(raw, key) {
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    if (trimmed.slice(0, eq).trim() !== key) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return "";
}

let cachedToken = "";
async function getMobileToken() {
  if (process.env.HERMES_MOBILE_TOKEN) return process.env.HERMES_MOBILE_TOKEN;
  if (cachedToken) return cachedToken;
  const raw = await fs.readFile(path.join(HOME, ".hermes", ".env"), "utf8").catch(() => "");
  cachedToken = readDotenvValue(raw, "HERMES_MOBILE_TOKEN");
  return cachedToken;
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (!aa.length || aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

async function requireAuth(req, res) {
  const expected = await getMobileToken();
  if (!expected) {
    sendJson(res, 503, { ok: false, error: "HERMES_MOBILE_TOKEN is not configured" });
    return false;
  }
  const header = String(req.headers.authorization || "");
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : String(req.headers["x-hermes-token"] || "").trim();
  if (!safeEqual(token, expected)) {
    sendJson(res, 401, { ok: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJsonBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function clampText(value, max = 240) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonlTail(filePath, limit = 1) {
  const raw = await fs.readFile(filePath, "utf8").catch(() => "");
  if (!raw.trim()) return [];
  return raw
    .trim()
    .split(/\r?\n/u)
    .slice(-limit)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
}

function lanAddresses() {
  const addresses = [];
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      addresses.push(entry.address);
    }
  }
  return addresses;
}

async function copyToClipboard(text) {
  await new Promise((resolve, reject) => {
    const child = spawn("pbcopy", [], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr || `pbcopy exited ${code}`))));
    child.stdin.end(text);
  });
}

async function pasteIntoActiveMacApp(text) {
  await copyToClipboard(text);
  await run("osascript", ["-e", 'tell application "System Events" to keystroke "v" using command down'], { timeout: 5_000 });
}

async function queueHermesTask(command, metadata = {}) {
  if (!(await fileExists(HERMES_TASK_SH))) throw new Error(`Hermes task script missing: ${HERMES_TASK_SH}`);
  const title = clampText(metadata.title || "iPhone Hermes command", 80);
  const result = await run(HERMES_TASK_SH, [command], {
    timeout: 10_000,
    maxBuffer: 512 * 1024,
    cwd: HERMES_TASK_CWD,
    env: {
      ...process.env,
      CARTHA_TASK_SOURCE: "iphone-hermes-client",
      CARTHA_TASK_TITLE: title,
      CARTHA_TASK_MODE: clampText(metadata.mode || "iphone", 32).replace(/[^\w.-]/gu, "_") || "iphone",
      CARTHA_TASK_CWD: HERMES_TASK_CWD,
      CARTHA_TASK_CONFIRM_PREFIX: "iPhone Hermes queued:",
    },
  });
  const queued = await readJsonlTail(HERMES_REPLIES_PATH, 1);
  return {
    stdout: clampText(result.stdout || "iPhone Hermes queued the task.", 400),
    task: queued[0] || null,
  };
}

async function handleDispatch(req, res) {
  if (!(await requireAuth(req, res))) return;
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, err.status || 400, { ok: false, error: err.message || "Invalid JSON body" });
  }
  const command = String(body.command || body.text || body.prompt || "").trim();
  const mode = String(body.mode || "task").trim().toLowerCase();
  if (!command) return sendJson(res, 400, { ok: false, error: "Command text is required" });
  if (command.length > 8_000) return sendJson(res, 413, { ok: false, error: "Command text is too long" });

  try {
    if (mode === "clipboard") {
      await copyToClipboard(command);
      return sendJson(res, 200, { ok: true, mode, status: "copied", message: "Copied to Mac clipboard" });
    }
    if (mode === "paste") {
      await pasteIntoActiveMacApp(command);
      return sendJson(res, 200, { ok: true, mode, status: "pasted", message: "Pasted into active Mac app" });
    }
    if (mode !== "task") {
      return sendJson(res, 400, { ok: false, error: "Unsupported mode", allowedModes: ["task", "clipboard", "paste"] });
    }
    const queued = await queueHermesTask(command, body);
    return sendJson(res, 202, { ok: true, mode, status: "queued", ...queued });
  } catch (err) {
    return sendJson(res, 502, { ok: false, error: String(err?.message || err) });
  }
}

async function handleScreen(req, res, url) {
  if (!(await requireAuth(req, res))) return;
  const width = Math.min(2200, Math.max(320, Number.parseInt(url.searchParams.get("width") || "1280", 10) || 1280));
  const tmp = path.join(os.tmpdir(), `hermes-mobile-screen-${process.pid}-${Date.now()}.jpg`);
  try {
    await run("screencapture", ["-x", "-t", "jpg", tmp], { timeout: 8_000, maxBuffer: 256 * 1024 });
    await run("sips", ["-Z", String(width), tmp], { timeout: 8_000, maxBuffer: 256 * 1024 }).catch(() => null);
    const data = await fs.readFile(tmp);
    res.writeHead(200, {
      "Content-Type": "image/jpeg",
      "Cache-Control": "no-store",
      "Content-Length": data.length,
    });
    res.end(data);
  } catch (err) {
    sendJson(res, 502, {
      ok: false,
      error: "Could not capture Mac screen",
      detail: String(err?.stderr || err?.message || err),
      hint: "Grant Screen Recording permission to the terminal/Node process or the Hermes Mobile Bridge launch agent.",
    });
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => null);
  }
}

async function handleHealth(_req, res) {
  const tokenConfigured = Boolean(await getMobileToken());
  sendJson(res, tokenConfigured ? 200 : 503, {
    ok: tokenConfigured,
    service: "hermes-mobile-bridge",
    host: HOST,
    port: PORT,
    tokenConfigured,
    urls: lanAddresses().map((address) => `http://${address}:${PORT}`),
    modes: ["task", "clipboard", "paste"],
    screen: "/screen.jpg?width=1280",
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (req.method === "GET" && url.pathname === "/health") return handleHealth(req, res);
    if (req.method === "POST" && url.pathname === "/dispatch") return handleDispatch(req, res);
    if (req.method === "GET" && url.pathname === "/screen.jpg") return handleScreen(req, res, url);
    return sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (err) {
    console.error("mobile bridge request error", err);
    return sendJson(res, 500, { ok: false, error: "Internal server error", detail: String(err?.message || err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Hermes Mobile Bridge listening on http://${HOST}:${PORT}`);
  for (const address of lanAddresses()) console.log(`LAN URL: http://${address}:${PORT}`);
});

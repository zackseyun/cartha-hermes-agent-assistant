import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number.parseInt(process.env.HERMES_UI_PORT || "5128", 10);
const HOST = process.env.HERMES_UI_HOST || "127.0.0.1";
const HERMES_API_BASE = (process.env.HERMES_API_BASE || "http://127.0.0.1:8642/v1").replace(/\/+$/u, "");
const OLLAMA_API_BASE = (process.env.OLLAMA_API_BASE || "http://127.0.0.1:11434/v1").replace(/\/+$/u, "");
const OPENROUTER_API_BASE = (process.env.OPENROUTER_API_BASE || "https://openrouter.ai/api/v1").replace(/\/+$/u, "");
const HERMES_MODEL = process.env.HERMES_MODEL || "hermes-agent";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma4:31b-hermes";
const OPENROUTER_AGENT_MODEL = process.env.OPENROUTER_AGENT_MODEL || "xiaomi/mimo-v2.5-pro";
const OPENROUTER_SMALL_MODEL = process.env.OPENROUTER_SMALL_MODEL || "deepseek/deepseek-v4-flash";
const DEFAULT_BACKEND = process.env.HERMES_UI_BACKEND || "hermes";
const MAX_BODY_BYTES = Number.parseInt(process.env.HERMES_UI_MAX_BODY_BYTES || "32000000", 10);

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
]);

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

let cachedApiKey = null;
async function getApiKey() {
  if (process.env.API_SERVER_KEY) return process.env.API_SERVER_KEY;
  if (cachedApiKey) return cachedApiKey;
  const envPath = path.join(process.env.HOME || "", ".hermes", ".env");
  const raw = await fs.readFile(envPath, "utf8").catch(() => "");
  cachedApiKey = readDotenvValue(raw, "API_SERVER_KEY");
  return cachedApiKey;
}

let cachedOpenRouterKey = null;
async function getOpenRouterKey() {
  if (cachedOpenRouterKey) return cachedOpenRouterKey;

  const envPath = path.join(process.env.HOME || "", ".hermes", ".env");
  const rawEnv = await fs.readFile(envPath, "utf8").catch(() => "");
  cachedOpenRouterKey = readDotenvValue(rawEnv, "OPENROUTER_API_KEY");
  if (cachedOpenRouterKey) return cachedOpenRouterKey;

  // Prefer ~/.hermes/.env over the parent shell. Long-lived terminals often
  // carry stale provider keys; the Hermes home file is the runtime source of
  // truth created by scripts/install.mjs.
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;

  const authPath = path.join(process.env.HOME || "", ".hermes", "auth.json");
  try {
    const auth = JSON.parse(await fs.readFile(authPath, "utf8"));
    const pool = auth?.credential_pool?.openrouter;
    const token = Array.isArray(pool) ? pool.find((entry) => entry?.access_token)?.access_token : "";
    cachedOpenRouterKey = typeof token === "string" ? token : "";
  } catch {
    cachedOpenRouterKey = "";
  }
  return cachedOpenRouterKey;
}

async function getOpenRouterCreditRemaining(key) {
  if (!key) return null;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const total = Number(payload?.data?.total_credits);
    const usage = Number(payload?.data?.total_usage);
    if (!Number.isFinite(total) || !Number.isFinite(usage)) return null;
    return total - usage;
  } catch {
    return null;
  }
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

function sendError(res, status, message, detail) {
  sendJson(res, status, { ok: false, error: message, detail });
}

async function readJsonBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw Object.assign(new Error("Request body too large"), { status: 413 });
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStatic(_req, res, pathname) {
  const target = pathname === "/" ? "/index.html" : pathname;
  const decoded = decodeURIComponent(target);
  const filePath = path.resolve(PUBLIC_DIR, `.${decoded}`);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    return sendError(res, 403, "Forbidden");
  }
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES.get(ext) || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=60",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(data);
  } catch (err) {
    if (err?.code === "ENOENT") return sendError(res, 404, "Not found");
    console.error("static error", err);
    return sendError(res, 500, "Static asset error");
  }
}

function safeAssistantText(raw) {
  try {
    const json = JSON.parse(raw);
    return json?.choices?.[0]?.message?.content ?? "";
  } catch {
    return raw.slice(0, 500);
  }
}

function normalizeContentPart(part) {
  if (!part || typeof part !== "object") return null;
  if (part.type === "text" && typeof part.text === "string") {
    const text = part.text.trim();
    return text ? { type: "text", text } : null;
  }
  if (part.type === "image_url" && typeof part.image_url?.url === "string") {
    const url = part.image_url.url;
    if (!url.startsWith("data:image/")) return null;
    return { type: "image_url", image_url: { url } };
  }
  if (part.type === "input_audio" && typeof part.input_audio?.data === "string") {
    const format = String(part.input_audio.format || "wav").replace(/[^a-z0-9]/giu, "").slice(0, 12) || "wav";
    return { type: "input_audio", input_audio: { data: part.input_audio.data, format } };
  }
  return null;
}

function normalizeMessageContent(content) {
  if (typeof content === "string") return content.trim() || null;
  if (Array.isArray(content)) {
    const parts = content.map(normalizeContentPart).filter(Boolean);
    return parts.length ? parts : null;
  }
  return null;
}

function normalizeMessages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((message) => {
      const content = normalizeMessageContent(message?.content);
      if (!content) return null;
      return {
        role: typeof message?.role === "string" && ["system", "user", "assistant"].includes(message.role) ? message.role : "user",
        content,
      };
    })
    .filter(Boolean);
}

function messagesContainAudio(messages) {
  return messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "input_audio"));
}

function messagesContainAttachments(messages) {
  return messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type !== "text"));
}

async function handleStatus(_req, res) {
  const startedAt = Date.now();
  let hermesGateway = "unknown";
  try {
    const key = await getApiKey();
    const response = await fetch(`${HERMES_API_BASE.replace(/\/v1$/u, "")}/v1/capabilities`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(2_000),
    });
    hermesGateway = response.ok ? "online" : `http ${response.status}`;
  } catch {
    hermesGateway = "offline";
  }

  const openRouterKey = await getOpenRouterKey();
  const creditRemainingUsd = await getOpenRouterCreditRemaining(openRouterKey);
  let agentStatus = "missing-key";
  let agentSample = "";
  let agentHttpStatus = 0;
  if (openRouterKey) {
    try {
      // Do not burn model tokens on every status refresh. `/key` validates the
      // credential; real model/tool health is covered by `npm run smoke`.
      const response = await fetch(`${OPENROUTER_API_BASE}/key`, {
        headers: { Authorization: `Bearer ${openRouterKey}` },
        signal: AbortSignal.timeout(3_000),
      });
      agentHttpStatus = response.status;
      agentSample = response.ok ? "key ok" : (await response.text()).slice(0, 500);
      agentStatus = response.ok ? "online" : `http ${response.status}`;
    } catch (err) {
      agentStatus = `error: ${String(err?.message || err)}`;
    }
  }

  // Gemma is optional for the operator console. Do not let a local 31B runner
  // block the status badge; it can cold-load on demand for vision/chat.
  let gemmaStatus = "not checked";
  try {
    const response = await fetch(`${OLLAMA_API_BASE}/models`, { signal: AbortSignal.timeout(1_500) });
    gemmaStatus = response.ok ? "ollama online" : `ollama http ${response.status}`;
  } catch {
    gemmaStatus = "ollama offline";
  }

  const ok = hermesGateway === "online" || agentStatus === "online" || gemmaStatus === "ollama online";
  sendJson(res, ok ? 200 : 502, {
    ok,
    backend: DEFAULT_BACKEND,
    ollamaApiBase: OLLAMA_API_BASE,
    hermesApiBase: HERMES_API_BASE,
    openRouterApiBase: OPENROUTER_API_BASE,
    hermesGateway,
    agentStatus,
    gemmaStatus,
    model: OLLAMA_MODEL,
    agentModel: OPENROUTER_AGENT_MODEL,
    smallModel: OPENROUTER_SMALL_MODEL,
    creditRemainingUsd,
    hermesModel: HERMES_MODEL,
    latencyMs: Date.now() - startedAt,
    status: agentHttpStatus || (agentStatus === "online" ? 200 : 502),
    sample: agentSample,
  });
}

async function proxyStreamingRequest(req, res, upstreamUrl, headers, body) {
  const controller = new AbortController();
  // Abort only if the browser actually disconnects mid-stream. `req.close`
  // can fire after the request body is consumed, which made long agent runs
  // look like generic browser "network error" failures.
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    return sendError(res, 502, "Could not reach model backend", String(err?.message || err));
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return sendError(res, 502, "Model backend error", text.slice(0, 1500) || upstream.statusText);
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) await new Promise((resolve) => res.once("drain", resolve));
    }
  } catch (err) {
    if (!controller.signal.aborted) console.error("stream proxy error", err);
  } finally {
    res.end();
  }
}

async function proxyChat(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendError(res, err.status || 400, err.message || "Invalid JSON body");
  }

  const messages = normalizeMessages(body.messages);
  if (messages.length === 0) return sendError(res, 400, "At least one message is required");

  const backend = body.backend === "ollama" ? "ollama" : DEFAULT_BACKEND;
  const requestedBackend = body.backend === "openrouter" ? "openrouter" : backend;
  if (requestedBackend === "openrouter") {
    if (messagesContainAttachments(messages)) {
      return sendError(res, 400, "DeepSeek V4 Flash is text-only in this route", "Use Gemma 4 31B for image attachments, or send text-only prompts to DeepSeek V4 Flash.");
    }
    const key = await getOpenRouterKey();
    if (!key) return sendError(res, 500, "Missing OpenRouter API key", "Set OPENROUTER_API_KEY in ~/.hermes/.env or run `hermes auth add openrouter`.");
    return proxyStreamingRequest(
      req,
      res,
      `${OPENROUTER_API_BASE}/chat/completions`,
      {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "HTTP-Referer": "http://127.0.0.1:5128",
        "X-Title": "Hermes Local Agent Kit",
      },
      {
        model: OPENROUTER_SMALL_MODEL,
        messages,
        stream: true,
        temperature: 0.2,
        max_tokens: 2048,
        reasoning: { enabled: false },
      },
    );
  }

  if (requestedBackend === "hermes") {
    const key = await getApiKey();
    if (!key) return sendError(res, 500, "Missing API_SERVER_KEY in ~/.hermes/.env");
    return proxyStreamingRequest(
      req,
      res,
      `${HERMES_API_BASE}/chat/completions`,
      {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      { model: HERMES_MODEL, messages, stream: true },
    );
  }

  if (messagesContainAudio(messages)) {
    return sendError(
      res,
      400,
      "Gemma 4 31B audio is not exposed by this Ollama build",
      "This local 31B model reports vision/tools/thinking, not audio. Use image attachments here; audio needs a transcription route or the E4B audio-capable model.",
    );
  }

  return proxyStreamingRequest(
    req,
    res,
    `${OLLAMA_API_BASE}/chat/completions`,
    { "Content-Type": "application/json", Accept: "text/event-stream" },
    {
      model: OLLAMA_MODEL,
      messages,
      stream: true,
      temperature: 0.2,
      max_tokens: 4096,
      reasoning_effort: "none",
    },
  );
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (req.method === "GET" && url.pathname === "/api/status") return handleStatus(req, res);
    if (req.method === "POST" && url.pathname === "/api/chat") return proxyChat(req, res);
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res, url.pathname);
    return sendError(res, 405, "Method not allowed");
  } catch (err) {
    console.error("request error", err);
    return sendError(res, 500, "Internal server error", String(err?.message || err));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Hermes Local Agent Kit listening on http://${HOST}:${PORT}`);
  console.log(`Default backend: ${DEFAULT_BACKEND}; Ollama ${OLLAMA_MODEL} at ${OLLAMA_API_BASE}; Hermes at ${HERMES_API_BASE}`);
});

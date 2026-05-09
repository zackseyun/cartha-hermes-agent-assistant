import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number.parseInt(process.env.HERMES_UI_PORT || "5128", 10);
const HOST = process.env.HERMES_UI_HOST || "127.0.0.1";
const HERMES_API_BASE = (process.env.HERMES_API_BASE || "http://127.0.0.1:8642/v1").replace(/\/+$/u, "");
const DEFAULT_MODEL = process.env.HERMES_MODEL || "hermes-agent";
const MAX_BODY_BYTES = 1_000_000;

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

async function handleStatus(_req, res) {
  const key = await getApiKey();
  const startedAt = Date.now();
  try {
    const response = await fetch(`${HERMES_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [{ role: "user", content: "Reply exactly: ok" }],
        stream: false,
        max_tokens: 4,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const text = await response.text();
    sendJson(res, response.ok ? 200 : 502, {
      ok: response.ok,
      hermesApiBase: HERMES_API_BASE,
      model: DEFAULT_MODEL,
      latencyMs: Date.now() - startedAt,
      status: response.status,
      sample: response.ok ? safeAssistantText(text) : text.slice(0, 500),
    });
  } catch (err) {
    sendError(res, 502, "Hermes API unavailable", String(err?.message || err));
  }
}

function normalizeMessages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((message) => ({
      role: typeof message?.role === "string" ? message.role : "user",
      content: typeof message?.content === "string" ? message.content : "",
    }))
    .filter((message) => message.content.trim());
}

async function proxyChat(req, res) {
  const key = await getApiKey();
  if (!key) return sendError(res, 500, "Missing API_SERVER_KEY in ~/.hermes/.env");
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendError(res, err.status || 400, err.message || "Invalid JSON body");
  }
  const messages = normalizeMessages(body.messages);
  if (messages.length === 0) return sendError(res, 400, "At least one message is required");

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  let upstream;
  try {
    upstream = await fetch(`${HERMES_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ model: DEFAULT_MODEL, messages, stream: true }),
      signal: controller.signal,
    });
  } catch (err) {
    return sendError(res, 502, "Could not reach Hermes API", String(err?.message || err));
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return sendError(res, 502, "Hermes API error", text.slice(0, 1000) || upstream.statusText);
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
  console.log(`Cartha Hermes UI listening on http://${HOST}:${PORT}`);
  console.log(`Proxying Hermes API at ${HERMES_API_BASE}`);
});

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);
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
const HOME = process.env.HOME || "";
const HERMES_CONFIG_PATH = process.env.HERMES_CONFIG_PATH || path.join(HOME, ".hermes", "config.yaml");
const TESTFLIGHT_PROPOSALS_PATH =
  process.env.CARTHA_TESTFLIGHT_PROPOSALS_PATH || path.join(HOME, ".hermes", "cartha-testflight-proposals.json");
const CARTHA_GITHUB_REPO = process.env.CARTHA_GITHUB_REPO || "zackseyun/cartha.ai.mobile";
const IOS_TESTFLIGHT_SH = process.env.CARTHA_IOS_TESTFLIGHT_SH || path.join(HOME, ".hermes", "scripts", "cartha-ios-testflight.sh");
const HERMES_SESSIONS_DIR = process.env.HERMES_SESSIONS_DIR || path.join(HOME, ".hermes", "sessions");
const HERMES_REPLIES_PATH = process.env.HERMES_REPLIES_PATH || path.join(HOME, ".hermes", "heartbeat-replies.jsonl");
const HERMES_PROCESSED_REPLIES_PATH =
  process.env.HERMES_PROCESSED_REPLIES_PATH || path.join(HOME, ".hermes", "heartbeat-replies-processed.jsonl");
const HERMES_HEARTBEAT_JOURNAL_PATH =
  process.env.HERMES_HEARTBEAT_JOURNAL_PATH || path.join(HOME, ".hermes", "heartbeat-journal.md");
const HERMES_POLICY_PATH = process.env.HERMES_POLICY_PATH || path.join(HOME, ".hermes", "heartbeat-config", "policy.json");
const HERMES_TASK_SH = process.env.HERMES_TASK_SH || path.join(HOME, ".hermes", "scripts", "hermes-task.sh");
const HERMES_RESEARCH_DIR = process.env.HERMES_RESEARCH_DIR || path.join(HOME, ".hermes", "research-room");
const HERMES_RESEARCH_RUNS_PATH =
  process.env.HERMES_RESEARCH_RUNS_PATH || path.join(HERMES_RESEARCH_DIR, "runs.json");
const HERMES_RESEARCH_SEARXNG_URL = (process.env.HERMES_RESEARCH_SEARXNG_URL || process.env.HEARTBEAT_SEARXNG_URL || "http://127.0.0.1:8888").replace(/\/+$/u, "");
const HERMES_RESEARCH_MODEL = process.env.HERMES_RESEARCH_MODEL || "";
const HERMES_RESEARCH_CLOUD_FALLBACK = process.env.HERMES_RESEARCH_CLOUD_FALLBACK !== "0";
const HERMES_RESEARCH_MAX_RESULTS = Number.parseInt(process.env.HERMES_RESEARCH_MAX_RESULTS || "8", 10);
const HERMES_RESEARCH_MAX_FETCHES = Number.parseInt(process.env.HERMES_RESEARCH_MAX_FETCHES || "5", 10);
const HERMES_RESEARCH_FETCH_BYTES = Number.parseInt(process.env.HERMES_RESEARCH_FETCH_BYTES || "700000", 10);
const HERMES_RESEARCH_MODEL_TIMEOUT_MS = Number.parseInt(process.env.HERMES_RESEARCH_MODEL_TIMEOUT_MS || "140000", 10);
const CARTHA_VOICE_TOGGLE_SH =
  process.env.CARTHA_VOICE_TOGGLE_SH || path.join(HOME, ".hermes", "scripts", "cartha-voice-toggle.sh");
const CARTHA_VOICE_LISTENER =
  process.env.CARTHA_VOICE_LISTENER || path.join(HOME, ".hermes", "scripts", "cartha-voice-listener.py");
const CARTHA_WAKE_PROMPT = process.env.CARTHA_WAKE_PROMPT || "hey cartha";
const CARTHA_WHISPER_PORT = process.env.CARTHA_WHISPER_PORT || "18187";
const MAX_HISTORY_MESSAGES = Number.parseInt(process.env.HERMES_UI_MAX_HISTORY_MESSAGES || "80", 10);
const MAX_HISTORY_MESSAGE_CHARS = Number.parseInt(process.env.HERMES_UI_MAX_HISTORY_MESSAGE_CHARS || "12000", 10);

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
  // carry stale provider keys; the Hermes home file is the runtime source of truth.
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

let cachedHermesLocalModel = "";
async function getHermesLocalModel() {
  if (process.env.HERMES_LOCAL_MODEL) return process.env.HERMES_LOCAL_MODEL;
  if (cachedHermesLocalModel) return cachedHermesLocalModel;
  const raw = await fs.readFile(HERMES_CONFIG_PATH, "utf8").catch(() => "");
  let inModelBlock = false;
  for (const line of raw.split(/\r?\n/u)) {
    if (/^model:\s*$/u.test(line)) {
      inModelBlock = true;
      continue;
    }
    if (inModelBlock && /^\S/u.test(line)) break;
    const match = inModelBlock ? line.match(/^\s+default:\s*(.+?)\s*$/u) : null;
    if (match) {
      cachedHermesLocalModel = match[1].replace(/^['"]|['"]$/gu, "");
      return cachedHermesLocalModel;
    }
  }
  cachedHermesLocalModel = "qwen3.6:35b-hermes-256k";
  return cachedHermesLocalModel;
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

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(tmp, filePath);
}

function clampText(value, max = 220) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function slugifyResearchTitle(value) {
  const slug = String(value || "research")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 54);
  return slug || "research";
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/&#x([0-9a-f]+);/giu, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gu, (_match, num) => String.fromCodePoint(Number.parseInt(num, 10)));
}

function htmlToResearchText(html) {
  return decodeHtmlEntities(
    String(html || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/giu, " ")
      .replace(/<!--[\s\S]*?-->/gu, " ")
      .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/section|\/article|\/tr)\b[^>]*>/giu, "\n")
      .replace(/<[^>]+>/gu, " "),
  )
    .replace(/\u0000/gu, "")
    .replace(/[ \t\f\v]+/gu, " ")
    .replace(/\n\s+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function isPrivateResearchHostname(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local")) return true;
  if (/^(?:0|10|127)\./u.test(host)) return true;
  if (/^169\.254\./u.test(host)) return true;
  if (/^192\.168\./u.test(host)) return true;
  if (/^172\.(?:1[6-9]|2\d|3[01])\./u.test(host)) return true;
  if (host === "::1" || host === "[::1]" || host.startsWith("fc") || host.startsWith("fd")) return true;
  return false;
}

function isResearchUrlAllowed(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol)) return false;
    if (isPrivateResearchHostname(url.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

async function readResponseTextLimited(response, maxBytes = HERMES_RESEARCH_FETCH_BYTES) {
  const reader = response.body?.getReader?.();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    const remaining = maxBytes - size;
    if (remaining <= 0) break;
    chunks.push(chunk.length > remaining ? chunk.subarray(0, remaining) : chunk);
    size += Math.min(chunk.length, remaining);
    if (size >= maxBytes) break;
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function searxngSearch(query, maxResults = HERMES_RESEARCH_MAX_RESULTS) {
  const url = new URL(`${HERMES_RESEARCH_SEARXNG_URL}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("safesearch", "0");
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "CarthaResearchRoom/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`SearXNG HTTP ${response.status}`);
  const payload = await response.json();
  return (payload.results || [])
    .map((result, index) => ({
      id: `S${index + 1}`,
      title: clampText(result.title || result.url || "Untitled result", 180),
      url: String(result.url || ""),
      snippet: clampText(result.content || result.snippet || "", 420),
      engine: Array.isArray(result.engines) ? result.engines.join(", ") : String(result.engine || ""),
      score: Number(result.score || 0),
      position: index + 1,
      publishedDate: result.publishedDate || null,
    }))
    .filter((result) => result.url)
    .slice(0, maxResults);
}

function queryTerms(query) {
  return new Set(
    String(query || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((term) => term.length > 2 && !["the", "and", "for", "with", "from", "what", "how", "why", "are"].includes(term)),
  );
}

function scoreResearchSource(source, terms) {
  const haystack = `${source.title || ""} ${source.snippet || ""} ${source.text || ""}`.toLowerCase();
  let hits = 0;
  for (const term of terms) {
    if (haystack.includes(term)) hits += 1;
  }
  const textBonus = Math.min(2, Math.max(0, (source.textLength || 0) / 15_000));
  return Number(source.score || 0) + hits * 2 + textBonus;
}

async function fetchResearchSource(result, maxTextChars = 12_000) {
  if (!isResearchUrlAllowed(result.url)) {
    return {
      ...result,
      fetched: false,
      error: "Skipped private or unsupported URL",
      text: result.snippet || "",
      textLength: 0,
    };
  }
  try {
    const response = await fetch(result.url, {
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,application/json;q=0.7,*/*;q=0.4",
        "User-Agent": "CarthaResearchRoom/1.0 (+local Hermes research)",
      },
      signal: AbortSignal.timeout(18_000),
    });
    const type = response.headers.get("content-type") || "";
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (type && !/(text\/|html|json|xml|javascript)/iu.test(type)) {
      throw new Error(`Unsupported content type: ${type}`);
    }
    const raw = await readResponseTextLimited(response);
    const text = htmlToResearchText(raw).slice(0, maxTextChars);
    return {
      ...result,
      fetched: true,
      contentType: type,
      text,
      textLength: text.length,
      excerpt: clampText(text || result.snippet, 900),
    };
  } catch (err) {
    return {
      ...result,
      fetched: false,
      error: String(err?.message || err),
      text: result.snippet || "",
      textLength: 0,
      excerpt: result.snippet || "",
    };
  }
}

function sourceHost(source) {
  try {
    return new URL(source.url).hostname.replace(/^www\./u, "");
  } catch {
    return "";
  }
}

function buildResearchPrompt(run) {
  const sources = run.sources
    .map((source, index) => {
      const label = source.id || `S${index + 1}`;
      return [
        `[${label}] ${source.title}`,
        `URL: ${source.url}`,
        source.publishedDate ? `Published: ${source.publishedDate}` : "",
        source.snippet ? `Search snippet: ${source.snippet}` : "",
        `Extracted text:\n${(source.text || source.excerpt || "").slice(0, 9_000)}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");
  return [
    {
      role: "system",
      content:
        "You are Cartha Research Room, a careful web research analyst. Use only the supplied source pack. Be concise but substantive. Cite factual claims with bracketed source IDs like [S1]. If sources disagree or are weak, say so plainly. Do not invent citations.",
    },
    {
      role: "user",
      content: `Research question: ${run.query}\n\nMode: ${run.mode}\n\nSource pack:\n${sources}\n\nWrite a markdown answer with:\n1. a direct answer first,\n2. 3-6 key findings with citations,\n3. source notes / caveats,\n4. suggested follow-up searches if useful.`,
    },
  ];
}

async function callResearchModel(run) {
  const messages = buildResearchPrompt(run);
  const localModel = HERMES_RESEARCH_MODEL || (await getHermesLocalModel());
  const candidates = [
    {
      label: "local",
      url: `${OLLAMA_API_BASE}/chat/completions`,
      headers: { "Content-Type": "application/json" },
      body: { model: localModel, messages, temperature: 0.2, max_tokens: 2200 },
    },
  ];

  if (HERMES_RESEARCH_CLOUD_FALLBACK) {
    const key = await getOpenRouterKey();
    if (key) {
      candidates.push({
        label: "openrouter",
        url: `${OPENROUTER_API_BASE}/chat/completions`,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: {
          model: process.env.HERMES_RESEARCH_FALLBACK_MODEL || OPENROUTER_SMALL_MODEL,
          messages,
          temperature: 0.2,
          max_tokens: 2200,
        },
      });
    }
  }

  const errors = [];
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.url, {
        method: "POST",
        headers: candidate.headers,
        body: JSON.stringify(candidate.body),
        signal: AbortSignal.timeout(HERMES_RESEARCH_MODEL_TIMEOUT_MS),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`${candidate.label} HTTP ${response.status}: ${text.slice(0, 500)}`);
      const payload = JSON.parse(text);
      const content = payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.delta?.content || "";
      if (!String(content).trim()) throw new Error(`${candidate.label} returned no content`);
      return { answer: String(content).trim(), model: candidate.body.model, backend: candidate.label };
    } catch (err) {
      errors.push(`${candidate.label}: ${err?.message || err}`);
    }
  }
  throw new Error(errors.join(" | ") || "No research model candidate succeeded");
}

function buildExtractiveResearchAnswer(run, modelError = "") {
  const topSources = run.sources.filter((source) => source.excerpt || source.snippet).slice(0, 5);
  const bullets = topSources
    .map((source) => `- **${source.title || sourceHost(source) || source.id}**: ${clampText(source.excerpt || source.snippet, 360)} [${source.id}]`)
    .join("\n");
  const caveat = modelError ? `\n\n_Model synthesis fallback: ${clampText(modelError, 260)}_` : "";
  return `## Direct answer\nI found ${run.sources.length} search results and read ${run.sources.filter((source) => source.fetched).length} pages. The model synthesis step was unavailable, so this is an extractive source brief.\n\n## Source brief\n${bullets || "- No readable source text was available."}\n\n## Caveats\nUse this as a source map, not a final synthesized answer. Re-run when the local model is warm if you want a fuller cited synthesis.${caveat}`;
}

function publicResearchRun(run, includeDetails = false) {
  return {
    id: run.id,
    query: run.query,
    title: run.title,
    mode: run.mode,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    durationMs: run.durationMs,
    backend: run.backend,
    model: run.model,
    error: run.error,
    answer: includeDetails ? run.answer : clampText(run.answer || "", 420),
    sources: (run.sources || []).map((source) => ({
      id: source.id,
      title: source.title,
      url: source.url,
      host: sourceHost(source),
      snippet: source.snippet,
      excerpt: includeDetails ? source.excerpt : clampText(source.excerpt || source.snippet || "", 260),
      fetched: source.fetched,
      error: source.error,
      score: source.score,
      rankScore: source.rankScore,
      engine: source.engine,
    })),
  };
}

async function readResearchRuns() {
  const runs = await readJsonFile(HERMES_RESEARCH_RUNS_PATH, []);
  return Array.isArray(runs) ? runs : [];
}

async function writeResearchRun(run) {
  const existing = await readResearchRuns();
  const without = existing.filter((item) => item?.id !== run.id);
  await writeJsonFile(HERMES_RESEARCH_RUNS_PATH, [run, ...without].slice(0, 60));
}

async function buildResearchRun(input) {
  const started = Date.now();
  const query = String(input.query || input.prompt || "").trim();
  if (!query) throw Object.assign(new Error("Research query is required"), { status: 400 });
  if (query.length > 1_200) throw Object.assign(new Error("Research query is too long"), { status: 413 });
  const mode = ["quick", "deep"].includes(String(input.mode || "")) ? String(input.mode) : "quick";
  const maxResults = clampNumber(input.maxResults, 3, 12, mode === "deep" ? Math.max(8, HERMES_RESEARCH_MAX_RESULTS) : HERMES_RESEARCH_MAX_RESULTS);
  const maxFetches = clampNumber(input.maxFetches, 2, 8, mode === "deep" ? Math.max(6, HERMES_RESEARCH_MAX_FETCHES) : HERMES_RESEARCH_MAX_FETCHES);
  const now = new Date().toISOString();
  const run = {
    id: `rr_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`,
    query,
    title: clampText(input.title || query, 90),
    slug: slugifyResearchTitle(input.title || query),
    mode,
    status: "running",
    createdAt: now,
    updatedAt: now,
    sources: [],
    answer: "",
  };
  await writeResearchRun(run);

  try {
    const searchResults = await searxngSearch(query, maxResults);
    const fetched = await Promise.all(searchResults.slice(0, maxFetches).map((result) => fetchResearchSource(result, mode === "deep" ? 18_000 : 11_000)));
    const unfetched = searchResults.slice(maxFetches).map((result) => ({
      ...result,
      fetched: false,
      text: result.snippet || "",
      excerpt: result.snippet || "",
      textLength: 0,
    }));
    const terms = queryTerms(query);
    run.sources = [...fetched, ...unfetched]
      .map((source, index) => ({ ...source, id: `S${index + 1}`, rankScore: scoreResearchSource(source, terms) }))
      .sort((a, b) => b.rankScore - a.rankScore)
      .map((source, index) => ({ ...source, id: `S${index + 1}` }));
    try {
      const synthesis = await callResearchModel(run);
      run.answer = synthesis.answer;
      run.model = synthesis.model;
      run.backend = synthesis.backend;
      run.status = "completed";
    } catch (err) {
      run.answer = buildExtractiveResearchAnswer(run, String(err?.message || err));
      run.error = String(err?.message || err);
      run.backend = "extractive-fallback";
      run.status = "completed_with_fallback";
    }
  } catch (err) {
    run.status = "failed";
    run.error = String(err?.message || err);
    run.answer = `Research failed before sources could be collected: ${run.error}`;
  }

  run.durationMs = Date.now() - started;
  run.updatedAt = new Date().toISOString();
  await writeResearchRun(run);
  return run;
}

async function buildResearchStatus() {
  const [runs, searxng] = await Promise.all([
    readResearchRuns(),
    fetch(`${HERMES_RESEARCH_SEARXNG_URL}/`, {
      signal: AbortSignal.timeout(2_500),
      headers: { Accept: "text/html,application/json" },
    })
      .then((response) => ({ ok: response.ok, status: response.status }))
      .catch((err) => ({ ok: false, error: String(err?.message || err) })),
  ]);
  return {
    ok: true,
    searxng: {
      url: HERMES_RESEARCH_SEARXNG_URL,
      ready: searxng.ok === true,
      status: searxng.status || null,
      error: searxng.error || null,
    },
    model: HERMES_RESEARCH_MODEL || (await getHermesLocalModel()),
    cloudFallback: HERMES_RESEARCH_CLOUD_FALLBACK,
    runsPath: HERMES_RESEARCH_RUNS_PATH,
    recentRuns: runs.slice(0, 10).map((run) => publicResearchRun(run, false)),
  };
}

function messageText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function historyMessageText(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.content === "string") return part.content;
        if (part?.type === "image_url") return "[image attachment]";
        if (part?.type === "input_audio") return "[audio attachment]";
        try {
          return JSON.stringify(part);
        } catch {
          return "";
        }
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (content && typeof content === "object") {
    try {
      return JSON.stringify(content, null, 2);
    } catch {
      return String(content);
    }
  }
  return String(content || "").trim();
}

function publicHistoryMessage(message, index) {
  const raw = historyMessageText(message?.content ?? message?.text ?? message?.output ?? "");
  const truncated = raw.length > MAX_HISTORY_MESSAGE_CHARS;
  const content = truncated ? `${raw.slice(0, MAX_HISTORY_MESSAGE_CHARS).trim()}\n\n…truncated in cockpit view…` : raw;
  return {
    index,
    role: typeof message?.role === "string" ? message.role : typeof message?.type === "string" ? message.type : "message",
    content,
    name: typeof message?.name === "string" ? message.name : "",
    created_at: message?.created_at || message?.timestamp || null,
    truncated,
  };
}

function cleanSessionPreview(text) {
  return clampText(
    String(text || "")
      .replace(/^\[IMPORTANT:[\s\S]*?\]\s*/u, "")
      .replace(/^DELIVERY:[\s\S]*?\. /u, ""),
    240,
  );
}

function sessionKind(fileName, sessionId) {
  const value = `${fileName} ${sessionId || ""}`.toLowerCase();
  if (value.includes("cron_") || value.includes("session_cron")) return "scheduled";
  if (value.includes("session_api")) return "api";
  return "direct";
}

function publicHermesSession(filePath, stat, data) {
  const fileName = path.basename(filePath);
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  const lastUser =
    [...messages].reverse().find((message) => message?.role === "user" && !messageText(message.content).trim().startsWith("[IMPORTANT:")) ||
    [...messages].reverse().find((message) => message?.role === "user");
  const lastAssistant = [...messages].reverse().find((message) => message?.role === "assistant");
  const sessionId = String(data?.session_id || fileName.replace(/\.json$/u, ""));
  const kind = sessionKind(fileName, sessionId);
  const title =
    (messageText(lastUser?.content).trim().startsWith("[IMPORTANT:") ? "" : cleanSessionPreview(messageText(lastUser?.content))) ||
    clampText(String(data?.title || data?.summary || ""), 120) ||
    (kind === "scheduled" ? `Scheduled run · ${sessionId}` : "") ||
    sessionId;

  return {
    id: sessionId,
    file: fileName,
    path: filePath,
    kind,
    model: data?.model || "",
    platform: data?.platform || "",
    title,
    last_user: cleanSessionPreview(messageText(lastUser?.content)),
    last_assistant: cleanSessionPreview(messageText(lastAssistant?.content)),
    message_count: Number(data?.message_count) || messages.length,
    started_at: data?.session_start || data?.created_at || null,
    updated_at: data?.last_updated || new Date(stat.mtimeMs).toISOString(),
    mtime_ms: stat.mtimeMs,
  };
}

async function readRecentSessions(limit = 36) {
  const entries = await fs.readdir(HERMES_SESSIONS_DIR, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(HERMES_SESSIONS_DIR, entry.name);
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat) files.push({ filePath, stat });
  }
  files.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  const sessions = [];
  for (const item of files.slice(0, limit)) {
    try {
      const data = JSON.parse(await fs.readFile(item.filePath, "utf8"));
      sessions.push(publicHermesSession(item.filePath, item.stat, data));
    } catch {
      sessions.push({
        id: path.basename(item.filePath, ".json"),
        file: path.basename(item.filePath),
        path: item.filePath,
        kind: "unreadable",
        title: path.basename(item.filePath),
        last_user: "",
        last_assistant: "",
        message_count: 0,
        updated_at: new Date(item.stat.mtimeMs).toISOString(),
        mtime_ms: item.stat.mtimeMs,
      });
    }
  }
  return sessions;
}

function safeSessionPath(value) {
  if (!value) return "";
  const root = path.resolve(HERMES_SESSIONS_DIR);
  const candidate = path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return "";
  return candidate;
}

async function readPublicSessionAtPath(filePath) {
  const safePath = safeSessionPath(filePath);
  if (!safePath) return null;
  const stat = await fs.stat(safePath).catch(() => null);
  if (!stat?.isFile?.()) return null;
  const data = JSON.parse(await fs.readFile(safePath, "utf8"));
  return publicHermesSession(safePath, stat, data);
}

async function readJsonlTail(filePath, limit = 8) {
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

async function readTextTail(filePath, limit = 8) {
  const raw = await fs.readFile(filePath, "utf8").catch(() => "");
  if (!raw.trim()) return [];
  return raw
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .slice(-limit)
    .map((line) => clampText(line, 220));
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function commandOk(command, args, options = {}) {
  try {
    await run(command, args, { timeout: 2_500, ...options });
    return true;
  } catch {
    return false;
  }
}

function publicProposal(proposal) {
  return {
    id: proposal.id,
    sha: proposal.sha,
    short_sha: proposal.short_sha,
    channel: proposal.channel || "ios_testflight",
    channel_label: proposal.channel_label || "iOS TestFlight",
    workflow: proposal.workflow || "deploy-ios.yml",
    subject: proposal.subject,
    author: proposal.author,
    committed_at: proposal.committed_at,
    changed_files: Array.isArray(proposal.changed_files) ? proposal.changed_files.slice(0, 20) : [],
    recommendation: proposal.recommendation,
    confidence: proposal.confidence,
    reason: proposal.reason,
    source: proposal.source,
    status: proposal.status,
    created_at: proposal.created_at,
    updated_at: proposal.updated_at,
    approved_at: proposal.approved_at,
    skipped_at: proposal.skipped_at,
    deploy_requested_at: proposal.deploy_requested_at,
    deploy_stdout: proposal.deploy_stdout,
    deploy_error: proposal.deploy_error,
  };
}

async function handleTestFlightProposals(_req, res) {
  const proposals = await readJsonFile(TESTFLIGHT_PROPOSALS_PATH, []);
  const list = Array.isArray(proposals) ? proposals : [];
  sendJson(res, 200, {
    ok: true,
    path: TESTFLIGHT_PROPOSALS_PATH,
    proposals: list.map(publicProposal),
  });
}

async function handleTestFlightAction(req, res, id, action) {
  let body = {};
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendError(res, err.status || 400, err.message || "Invalid JSON body");
  }

  const proposals = await readJsonFile(TESTFLIGHT_PROPOSALS_PATH, []);
  if (!Array.isArray(proposals)) return sendError(res, 500, "Proposal store is malformed");
  const index = proposals.findIndex((proposal) => proposal?.id === id);
  if (index < 0) return sendError(res, 404, "Proposal not found");

  const proposal = proposals[index];
  const now = new Date().toISOString();
  if (action === "skip") {
    proposals[index] = {
      ...proposal,
      status: "skipped",
      skipped_at: now,
      updated_at: now,
    };
    await writeJsonFile(TESTFLIGHT_PROPOSALS_PATH, proposals);
    return sendJson(res, 200, { ok: true, proposal: publicProposal(proposals[index]) });
  }

  if (action !== "approve") return sendError(res, 404, "Unknown TestFlight action");
  if (!/^[0-9a-f]{40}$/iu.test(String(proposal.sha || ""))) {
    return sendError(res, 400, "Proposal has an invalid commit SHA");
  }

  const workflow = String(proposal.workflow || "deploy-ios.yml");
  if (!/^[\w.-]+\.ya?ml$/u.test(workflow)) {
    return sendError(res, 400, "Proposal has an invalid workflow");
  }

  const channelLabel = proposal.channel_label || "Apple upload";
  const reason = String(body.reason || `Cartha Agent approved ${channelLabel} for ${proposal.short_sha}: ${proposal.reason || proposal.subject}`).slice(0, 250);
  try {
    let stdout = "";
    let stderr = "";
    if ((proposal.channel || "ios_testflight") === "ios_testflight") {
      const result = await run(IOS_TESTFLIGHT_SH, ["approve", proposal.id, reason], { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
      stdout = result.stdout || "";
      stderr = result.stderr || "";
    } else {
      const result = await run(
        "gh",
        [
          "workflow",
          "run",
          workflow,
          "--repo",
          CARTHA_GITHUB_REPO,
          "--ref",
          "main",
          "-f",
          `sha=${proposal.sha}`,
          "-f",
          `reason=${reason}`,
        ],
        { timeout: 30_000, maxBuffer: 1024 * 1024 },
      );
      stdout = result.stdout || "";
      stderr = result.stderr || "";
    }
    const refreshed = await readJsonFile(TESTFLIGHT_PROPOSALS_PATH, []);
    const refreshedIndex = Array.isArray(refreshed) ? refreshed.findIndex((item) => item?.id === id) : -1;
    if (refreshedIndex >= 0) {
      refreshed[refreshedIndex] = {
        ...refreshed[refreshedIndex],
        status: "deploy_requested",
        approved_at: refreshed[refreshedIndex].approved_at || now,
        deploy_requested_at: refreshed[refreshedIndex].deploy_requested_at || now,
        deploy_stdout: refreshed[refreshedIndex].deploy_stdout || `${stdout || ""}${stderr || ""}`.trim(),
        deploy_error: "",
        updated_at: new Date().toISOString(),
      };
      await writeJsonFile(TESTFLIGHT_PROPOSALS_PATH, refreshed);
      return sendJson(res, 200, { ok: true, proposal: publicProposal(refreshed[refreshedIndex]) });
    }
    proposals[index] = {
      ...proposal,
      status: "deploy_requested",
      approved_at: now,
      deploy_requested_at: now,
      deploy_stdout: `${stdout || ""}${stderr || ""}`.trim(),
      deploy_error: "",
      updated_at: now,
    };
    await writeJsonFile(TESTFLIGHT_PROPOSALS_PATH, proposals);
    return sendJson(res, 200, { ok: true, proposal: publicProposal(proposals[index]) });
  } catch (err) {
    proposals[index] = {
      ...proposal,
      status: "approval_failed",
      deploy_error: String(err?.stderr || err?.stdout || err?.message || err).slice(0, 1500),
      updated_at: now,
    };
    await writeJsonFile(TESTFLIGHT_PROPOSALS_PATH, proposals);
    return sendError(res, 502, "Could not dispatch TestFlight workflow", proposals[index].deploy_error);
  }
}

function taskStatusFromJournal(task, heartbeatLines = []) {
  const reply = String(task.reply || task.text || task.title || "").trim();
  const joined = heartbeatLines.join("\n").toLowerCase();
  if (reply && joined.includes("[autonomy-blocked]") && joined.includes(reply.toLowerCase().slice(0, 80))) return "blocked";
  if (joined.includes("needs_approval") || joined.includes("needs approval")) return "needs_approval";
  return "completed";
}

function publicHarnessTask(task, status, index = 0) {
  const id = String(task.id || `${status}-${task.ts || task.updated_at || index}`).replace(/\s+/gu, "-");
  const title = clampText(String(task.title || task.mode || "Cartha Agent task"), 80);
  const summary = clampText(String(task.reply || task.text || task.raw || task.last_user || task.last_assistant || ""), 220);
  const createdAt = task.ts || task.started_at || task.updated_at || null;
  const updatedAt = task.updated_at || task.ts || task.started_at || null;
  return {
    id: id || `${status}-${index}`,
    title,
    summary,
    status,
    source: task.source || task.platform || "cartha",
    mode: task.mode || task.kind || "task",
    kind: task.kind || "task",
    createdAt,
    updatedAt,
    detail: clampText(String(task.detail || task.last_assistant || task.path || ""), 260),
    sessionId: task.session_id || task.sessionId || "",
    sessionFile: task.session_file || task.sessionFile || task.file || "",
    sessionPath: task.session_path || task.sessionPath || task.path || "",
  };
}

function sessionToHarnessTask(session, index = 0) {
  let status = "completed";
  const assistant = String(session.last_assistant || "").trim();
  const ageMs = Date.now() - Number(session.mtime_ms || 0);
  if (!assistant && ageMs < 45 * 60 * 1000) status = "running";
  if (!assistant && ageMs >= 45 * 60 * 1000) status = "blocked";
  if (/needs[_\s-]?approval|approval required/iu.test(assistant)) status = "needs_approval";
  return publicHarnessTask(
    {
      id: session.id,
      title: session.title || "Hermes session",
      reply: session.last_user || session.title || "",
      last_assistant: assistant,
      source: session.platform || "session",
      mode: session.kind || "session",
      kind: session.kind || "session",
      started_at: session.started_at,
      updated_at: session.updated_at,
      path: session.path,
      file: session.file,
      session_id: session.id,
      session_file: session.file,
      session_path: session.path,
    },
    status,
    index,
  );
}

async function readHarnessTasks(limit = 36) {
  const [queued, processed, sessions, heartbeatLines] = await Promise.all([
    readJsonlTail(HERMES_REPLIES_PATH, 20),
    readJsonlTail(HERMES_PROCESSED_REPLIES_PATH, 40),
    readRecentSessions(24),
    readTextTail(HERMES_HEARTBEAT_JOURNAL_PATH, 20),
  ]);

  const tasks = [];
  queued.forEach((task, index) => tasks.push(publicHarnessTask(task, "queued", index)));
  processed
    .slice()
    .reverse()
    .forEach((task, index) => tasks.push(publicHarnessTask(task, taskStatusFromJournal(task, heartbeatLines), index)));
  sessions.forEach((session, index) => {
    if (session.kind === "api" || session.kind === "direct" || session.kind === "scheduled") {
      tasks.push(sessionToHarnessTask(session, index));
    }
  });

  const seen = new Set();
  return tasks
    .filter((task) => {
      const key = `${task.id}:${task.status}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0))
    .slice(0, limit);
}

async function readPolicySummary() {
  const policy = await readJsonFile(HERMES_POLICY_PATH, {});
  const trusted = policy?.trusted_autonomy || {};
  const note = trusted._note || "Standing authorization allows routine local work inside approved roots while destructive operations still require approval.";
  return {
    enabled: trusted.enabled === true,
    phase: String(policy?.phase || "local-first"),
    maxSteps: Number(trusted.max_steps || trusted.maxSteps || 0) || null,
    maxTotalSeconds: Number(trusted.max_total_seconds || trusted.maxTotalSeconds || 0) || null,
    allowedRoots: Array.isArray(trusted.allowed_roots) ? trusted.allowed_roots.slice(0, 8) : [],
    note,
    approvals: [
      "Secrets, sudo, broad deletes, force-pushes, package publishing, store submissions, cloud mutation, and destructive DB ops remain gated.",
      "Apple upload lanes stay approval-driven; direct-download Mac publishing is unchanged.",
    ],
  };
}

async function readToolCapabilities(statusPayload = null, wakePayload = null) {
  const status = statusPayload || (await buildStatusPayload().catch(() => null));
  const wake = wakePayload || (await buildWakePayload().catch(() => null));
  const [agentBrowser, cuaDriver, taskScript, researchStatus] = await Promise.all([
    commandOk("which", ["agent-browser"]),
    commandOk("which", ["cua-driver"]),
    fileExists(HERMES_TASK_SH),
    buildResearchStatus().catch((err) => ({ searxng: { ready: false, error: String(err?.message || err) } })),
  ]);
  return [
    {
      id: "gateway",
      label: "Hermes gateway",
      status: status?.hermesGateway === "online" ? "ready" : "check",
      ready: status?.hermesGateway === "online",
      icon: "network",
      detail: status?.hermesGateway === "online" ? `${HERMES_API_BASE}` : `Gateway ${status?.hermesGateway || "unknown"}`,
    },
    {
      id: "local_model",
      label: "Local model",
      status: status?.gemmaStatus === "ollama online" ? "ready" : "offline",
      ready: status?.gemmaStatus === "ollama online",
      icon: "cpu",
      detail: status?.localAgentModel || status?.model || "Local model not detected",
    },
    {
      id: "wake",
      label: "Voice wake",
      status: wake?.active ? "listening" : "muted",
      ready: wake?.active === true,
      icon: "waveform",
      detail: wake?.active ? `“${wake.wakePrompt || CARTHA_WAKE_PROMPT}” listener is active` : "Manual and Alfred tasks still work",
    },
    {
      id: "durable_tasks",
      label: "Durable task queue",
      status: taskScript ? "ready" : "missing",
      ready: taskScript,
      icon: "checklist",
      detail: taskScript ? HERMES_TASK_SH : "hermes-task.sh is missing",
    },
    {
      id: "research_room",
      label: "Research Room",
      status: researchStatus?.searxng?.ready ? "ready" : "check",
      ready: researchStatus?.searxng?.ready === true,
      icon: "sparkle.magnifyingglass",
      detail: researchStatus?.searxng?.ready
        ? `SearXNG ready · ${researchStatus.model || "local model"}`
        : `Search backend unavailable: ${researchStatus?.searxng?.error || HERMES_RESEARCH_SEARXNG_URL}`,
    },
    {
      id: "browser",
      label: "Browser automation",
      status: agentBrowser ? "installed" : "not installed",
      ready: agentBrowser,
      icon: "globe",
      detail: agentBrowser ? "agent-browser binary is available" : "Source support exists, but agent-browser is not installed on this Mac",
    },
    {
      id: "computer_use",
      label: "Native computer use",
      status: cuaDriver ? "installed" : "not installed",
      ready: cuaDriver,
      icon: "cursorarrow.click",
      detail: cuaDriver ? "cua-driver binary is available" : "Desktop control is intentionally shown as not ready until cua-driver is installed",
    },
  ];
}

async function buildOperatorOverview() {
  const [status, wake, proposalStore, sessions, tasks, activeWorkPayload, policy] = await Promise.all([
    buildStatusPayload().catch((err) => ({ ok: false, hermesGateway: "offline", lastError: String(err?.message || err) })),
    buildWakePayload().catch((err) => ({ ok: false, active: false, toggleText: String(err?.message || err), guardrails: [] })),
    readJsonFile(TESTFLIGHT_PROPOSALS_PATH, []),
    readRecentSessions(12),
    readHarnessTasks(24),
    Promise.all([readJsonlTail(HERMES_PROCESSED_REPLIES_PATH, 8), readTextTail(HERMES_HEARTBEAT_JOURNAL_PATH, 8)]),
    readPolicySummary(),
  ]);
  const proposals = Array.isArray(proposalStore) ? proposalStore.map(publicProposal) : [];
  const pendingProposals = proposals.filter((proposal) => proposal.status === "pending");
  const tools = await readToolCapabilities(status, wake);
  return {
    ok: status.ok !== false,
    generatedAt: new Date().toISOString(),
    status,
    wake,
    proposals,
    sessions,
    tasks,
    tools,
    policy,
    activeWork: {
      pendingAppleUploads: pendingProposals.length,
      pendingAppleUploadLabels: pendingProposals.slice(0, 4).map((proposal) => `${proposal.channel_label || "Apple upload"} · ${proposal.short_sha || ""}`),
      recentTasks: activeWorkPayload[0].map((task) => ({
        id: task.id || "",
        ts: task.ts || "",
        source: task.source || "",
        mode: task.mode || "",
        title: task.title || "Cartha Agent task",
        text: clampText(task.reply || task.raw || "", 180),
      })),
      heartbeatLines: activeWorkPayload[1],
    },
  };
}

async function handleOperatorOverview(_req, res) {
  sendJson(res, 200, await buildOperatorOverview());
}

async function handleOperatorTasks(_req, res) {
  sendJson(res, 200, {
    ok: true,
    path: HERMES_REPLIES_PATH,
    processedPath: HERMES_PROCESSED_REPLIES_PATH,
    tasks: await readHarnessTasks(48),
  });
}

function normalizedTaskNeedle(value) {
  return String(value || "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase()
    .slice(0, 120);
}

function findLikelySessionForTask(task, sessions) {
  const needle = normalizedTaskNeedle(task?.summary || task?.title || "");
  if (needle.length < 4) return null;
  const taskTime = Date.parse(task?.updatedAt || task?.createdAt || "") || 0;
  const matches = sessions
    .map((session) => {
      const haystack = normalizedTaskNeedle(`${session.title || ""} ${session.last_user || ""}`);
      const direct = haystack.includes(needle) || needle.includes(haystack.slice(0, Math.min(haystack.length, 80)));
      if (!direct) return null;
      const sessionTime = Date.parse(session.updated_at || "") || Number(session.mtime_ms || 0) || 0;
      const distance = taskTime && sessionTime ? Math.abs(taskTime - sessionTime) : 0;
      return { session, distance };
    })
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance);
  return matches[0]?.session || null;
}

async function readSessionHistory(session) {
  if (!session?.path) return { messages: [], omitted: 0 };
  const data = JSON.parse(await fs.readFile(session.path, "utf8"));
  const rawMessages = Array.isArray(data?.messages) ? data.messages : [];
  const tail = rawMessages.slice(-Math.max(1, MAX_HISTORY_MESSAGES));
  const messages = tail.map(publicHistoryMessage).filter((message) => message.content);
  return {
    messages,
    omitted: Math.max(0, rawMessages.length - tail.length),
  };
}

async function handleOperatorTaskHistory(_req, res, url) {
  const id = String(url.searchParams.get("id") || "").trim();
  if (!id) return sendError(res, 400, "Task id is required");

  const tasks = await readHarnessTasks(120);
  let task = tasks.find((item) => item.id === id || item.sessionId === id || item.sessionFile === id || item.sessionPath === id) || null;

  let session = null;
  const directCandidates = [
    task?.sessionPath,
    task?.sessionFile,
    id.endsWith(".json") ? id : "",
    id.startsWith("session_") || id.startsWith("session_api") || id.startsWith("session_cron") ? `${id.replace(/\.json$/u, "")}.json` : "",
  ].filter(Boolean);
  for (const candidate of directCandidates) {
    session = await readPublicSessionAtPath(candidate).catch(() => null);
    if (session) break;
  }

  let sessions = [];
  if (!session) {
    sessions = await readRecentSessions(200);
    session =
      sessions.find(
        (item) =>
          item.id === id ||
          item.file === id ||
          item.path === id ||
          (task?.sessionId && item.id === task.sessionId) ||
          (task?.sessionFile && item.file === task.sessionFile) ||
          (task?.sessionPath && item.path === task.sessionPath),
      ) || null;
  }

  if (!task && session) task = sessionToHarnessTask(session);
  if (!session && task) {
    if (sessions.length === 0) sessions = await readRecentSessions(80);
    session = findLikelySessionForTask(task, sessions);
  }

  if (session) {
    try {
      const history = await readSessionHistory(session);
      return sendJson(res, 200, {
        ok: true,
        task,
        session,
        messages: history.messages,
        omitted: history.omitted,
        note: history.omitted ? `Showing the latest ${history.messages.length} messages.` : "",
      });
    } catch (err) {
      return sendJson(res, 200, {
        ok: true,
        task,
        session,
        messages: [
          {
            index: 0,
            role: "system",
            content: `Could not read linked session history: ${String(err?.message || err)}`,
            name: "",
            created_at: null,
            truncated: false,
          },
        ],
        omitted: 0,
      });
    }
  }

  if (task) {
    return sendJson(res, 200, {
      ok: true,
      task,
      session: null,
      messages: [
        {
          index: 0,
          role: "user",
          content: task.summary || task.title || "Cartha task",
          name: "",
          created_at: task.createdAt || null,
          truncated: false,
        },
        {
          index: 1,
          role: "system",
          content:
            "No Hermes session file is linked to this task yet. If it is still queued/running, the transcript will appear here after the agent writes its session file.",
          name: "",
          created_at: task.updatedAt || null,
          truncated: false,
        },
      ],
      omitted: 0,
    });
  }

  return sendError(res, 404, "Task history was not found");
}

async function handleOperatorTools(_req, res) {
  const [status, wake] = await Promise.all([buildStatusPayload().catch(() => null), buildWakePayload().catch(() => null)]);
  sendJson(res, 200, {
    ok: true,
    tools: await readToolCapabilities(status, wake),
    policy: await readPolicySummary(),
  });
}

async function handleOperatorTaskSubmit(req, res) {
  let body = {};
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendError(res, err.status || 400, err.message || "Invalid JSON body");
  }
  const task = String(body.task || body.prompt || "").trim();
  if (!task) return sendError(res, 400, "Task text is required");
  if (task.length > 8_000) return sendError(res, 413, "Task is too long");
  if (!(await fileExists(HERMES_TASK_SH))) return sendError(res, 500, "Task queue script is missing", HERMES_TASK_SH);

  const title = clampText(String(body.title || "Cartha Operator task"), 80);
  const mode = clampText(String(body.mode || "task"), 32).replace(/[^\w.-]/gu, "_") || "task";
  try {
    const result = await run(HERMES_TASK_SH, [task], {
      timeout: 10_000,
      maxBuffer: 512 * 1024,
      env: {
        ...process.env,
        CARTHA_TASK_SOURCE: "native-operator",
        CARTHA_TASK_TITLE: title,
        CARTHA_TASK_MODE: mode,
        CARTHA_TASK_CONFIRM_PREFIX: "Cartha Operator queued:",
      },
    });
    const queued = await readJsonlTail(HERMES_REPLIES_PATH, 1);
    const publicTask = queued[0] ? publicHarnessTask(queued[0], "queued", 0) : null;
    sendJson(res, 202, {
      ok: true,
      id: publicTask?.id || "",
      status: "queued",
      message: clampText((result.stdout || "Cartha Operator queued the task.").trim(), 220),
      task: publicTask,
    });
  } catch (err) {
    return sendError(res, 502, "Could not queue Cartha task", String(err?.stderr || err?.stdout || err?.message || err));
  }
}

async function handleResearchStatus(_req, res) {
  sendJson(res, 200, await buildResearchStatus());
}

async function handleResearchRuns(_req, res) {
  const runs = await readResearchRuns();
  sendJson(res, 200, {
    ok: true,
    runsPath: HERMES_RESEARCH_RUNS_PATH,
    runs: runs.map((run) => publicResearchRun(run, false)),
  });
}

async function handleResearchRunDetail(_req, res, id) {
  const runs = await readResearchRuns();
  const run = runs.find((item) => item?.id === id);
  if (!run) return sendError(res, 404, "Research run not found");
  sendJson(res, 200, { ok: true, run: publicResearchRun(run, true) });
}

async function handleResearchRunCreate(req, res) {
  let body = {};
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendError(res, err.status || 400, err.message || "Invalid JSON body");
  }
  try {
    const run = await buildResearchRun(body);
    sendJson(res, 200, {
      ok: run.status !== "failed",
      run: publicResearchRun(run, true),
    });
  } catch (err) {
    return sendError(res, err.status || 500, "Could not run research", String(err?.message || err));
  }
}

async function handleHermesSessions(_req, res) {
  const [sessions, recentTasks, heartbeatLines, proposals] = await Promise.all([
    readRecentSessions(48),
    readJsonlTail(HERMES_PROCESSED_REPLIES_PATH, 8),
    readTextTail(HERMES_HEARTBEAT_JOURNAL_PATH, 8),
    readJsonFile(TESTFLIGHT_PROPOSALS_PATH, []),
  ]);
  const pendingProposals = Array.isArray(proposals) ? proposals.filter((proposal) => proposal?.status === "pending") : [];
  const activeSessions = sessions.filter((session) => Date.now() - Number(session.mtime_ms || 0) < 3 * 60 * 60 * 1000);

  sendJson(res, 200, {
    ok: true,
    sessionsDir: HERMES_SESSIONS_DIR,
    sessionCount: sessions.length,
    activeSessionCount: activeSessions.length,
    sessions,
    activeWork: {
      pendingAppleUploads: pendingProposals.length,
      pendingAppleUploadLabels: pendingProposals.slice(0, 4).map((proposal) => `${proposal.channel_label || "Apple upload"} · ${proposal.short_sha || ""}`),
      recentTasks: recentTasks.map((task) => ({
        id: task.id || "",
        ts: task.ts || "",
        source: task.source || "",
        mode: task.mode || "",
        title: task.title || "Cartha Agent task",
        text: clampText(task.reply || task.raw || "", 180),
      })),
      heartbeatLines,
    },
  });
}

async function buildWakePayload() {
  const listenerRunning = await commandOk("pgrep", ["-f", CARTHA_VOICE_LISTENER]);
  const launchd = await run("launchctl", ["print", `gui/${process.getuid?.() || ""}/dev.cartha.voice`], { timeout: 2_500, maxBuffer: 256 * 1024 })
    .then((result) => result.stdout || "")
    .catch(() => "");
  const launchdRunning = /state = running/u.test(launchd);
  const whisperRunning = await commandOk("pgrep", ["-f", `whisper-server .*--port ${CARTHA_WHISPER_PORT}`]);
  const toggleText = await run(CARTHA_VOICE_TOGGLE_SH, ["status"], { timeout: 5_000, maxBuffer: 256 * 1024 })
    .then((result) => (result.stdout || "").trim())
    .catch((err) => String(err?.stderr || err?.stdout || err?.message || err).trim());

  return {
    ok: true,
    active: listenerRunning || launchdRunning,
    listenerRunning,
    launchdRunning,
    whisperRunning,
    wakePrompt: CARTHA_WAKE_PROMPT,
    toggleText,
    guardrails: [
      "Only the phrase “Hey Cartha” wakes the agent; bare “Cartha” is not a wake phrase.",
      "Wake/reply triggers are suppressed while the Fn/globe key is held, so local dictation gets priority.",
      "Alfred/URL/manual task submission stays available even when wake listening is muted.",
      "Destructive local autonomy still goes through the Hermes trusted-autonomy policy gates.",
    ],
  };
}

async function handleWakeStatus(_req, res) {
  sendJson(res, 200, await buildWakePayload());
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

async function buildStatusPayload() {
  const startedAt = Date.now();
  const localAgentModel = await getHermesLocalModel();
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

  // Hermes is now local-first: the stack is healthy when the local gateway
  // or local Ollama runner is reachable. OpenRouter is only an optional fallback
  // credential and should not make the native Swift surface look broken.
  const stackHealthy = hermesGateway === "online" || gemmaStatus === "ollama online" || agentStatus === "online";

  return {
    ok: stackHealthy,
    backend: DEFAULT_BACKEND,
    ollamaApiBase: OLLAMA_API_BASE,
    hermesApiBase: HERMES_API_BASE,
    openRouterApiBase: OPENROUTER_API_BASE,
    hermesGateway,
    agentStatus,
    gemmaStatus,
    model: OLLAMA_MODEL,
    localAgentModel,
    agentModel: OPENROUTER_AGENT_MODEL,
    smallModel: OPENROUTER_SMALL_MODEL,
    creditRemainingUsd,
    hermesModel: HERMES_MODEL,
    latencyMs: Date.now() - startedAt,
    status: agentHttpStatus || (agentStatus === "online" ? 200 : 502),
    sample: agentSample,
  };
}

async function handleStatus(_req, res) {
  const payload = await buildStatusPayload();
  sendJson(res, payload.ok ? 200 : 502, payload);
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
        "X-Title": "Cartha Hermes Local",
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
    if (req.method === "GET" && url.pathname === "/api/sessions") return handleHermesSessions(req, res);
    if (req.method === "GET" && url.pathname === "/api/wake-status") return handleWakeStatus(req, res);
    if (req.method === "GET" && url.pathname === "/api/testflight/proposals") return handleTestFlightProposals(req, res);
    if (req.method === "GET" && url.pathname === "/api/operator/overview") return handleOperatorOverview(req, res);
    if (req.method === "GET" && url.pathname === "/api/operator/task-history") return handleOperatorTaskHistory(req, res, url);
    if (req.method === "GET" && url.pathname === "/api/operator/tasks") return handleOperatorTasks(req, res);
    if (req.method === "GET" && url.pathname === "/api/operator/tools") return handleOperatorTools(req, res);
    if (req.method === "POST" && url.pathname === "/api/operator/tasks") return handleOperatorTaskSubmit(req, res);
    if (req.method === "GET" && url.pathname === "/api/research/status") return handleResearchStatus(req, res);
    if (req.method === "GET" && url.pathname === "/api/research/runs") return handleResearchRuns(req, res);
    if (req.method === "POST" && url.pathname === "/api/research/runs") return handleResearchRunCreate(req, res);
    const researchRunDetail = url.pathname.match(/^\/api\/research\/runs\/([^/]+)$/u);
    if (req.method === "GET" && researchRunDetail) return handleResearchRunDetail(req, res, decodeURIComponent(researchRunDetail[1]));
    const testFlightAction = url.pathname.match(/^\/api\/testflight\/proposals\/([^/]+)\/(approve|skip)$/u);
    if (req.method === "POST" && testFlightAction) {
      return handleTestFlightAction(req, res, decodeURIComponent(testFlightAction[1]), testFlightAction[2]);
    }
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
  console.log(`Default backend: ${DEFAULT_BACKEND}; Ollama ${OLLAMA_MODEL} at ${OLLAMA_API_BASE}; Hermes at ${HERMES_API_BASE}`);
});

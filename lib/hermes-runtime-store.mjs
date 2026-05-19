import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DEFAULT_RUNTIME_DIR = path.join(os.homedir(), ".hermes", "runtime");

function runtimePath(runtimeDir, name) {
  return path.join(runtimeDir || DEFAULT_RUNTIME_DIR, name);
}

function clampText(value, max = 220) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function safeTaskId(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_.:-]/gu, "-")
    .slice(0, 160);
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function readJsonlFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8").catch(() => "");
  if (!raw.trim()) return [];
  return raw
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { type: "runtime.unreadable", payload: { raw: line } };
      }
    });
}

export function publicRuntimeTask(task = {}) {
  const id = safeTaskId(task.id || task.task_id);
  const createdAt = task.created_at || task.createdAt || null;
  const updatedAt = task.updated_at || task.updatedAt || createdAt;
  return {
    id,
    taskId: id,
    title: clampText(task.title || task.mode || "Cartha task", 96),
    summary: clampText(task.summary || task.task_text || task.text || task.reply || "", 260),
    status: String(task.status || "unknown"),
    source: task.source || "cartha",
    mode: task.mode || "task",
    createdAt,
    updatedAt,
    startedAt: task.started_at || task.startedAt || null,
    completedAt: task.completed_at || task.completedAt || null,
    runId: task.run_id || task.runId || "",
    cwd: task.cwd || "",
    details: clampText(task.details || "", 500),
    nextSteps: Array.isArray(task.next_steps) ? task.next_steps.slice(0, 6) : [],
    artifactPath: task.artifact_path || task.artifactPath || "",
    eventCount: Number(task.event_count || task.eventCount || 0),
    kind: "durable_task",
  };
}

export async function readRuntimeTasks({ runtimeDir = DEFAULT_RUNTIME_DIR, limit = 50 } = {}) {
  const tasks = await readJsonFile(runtimePath(runtimeDir, "tasks.json"), []);
  if (!Array.isArray(tasks)) return [];
  return tasks
    .map(publicRuntimeTask)
    .filter((task) => task.id)
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0))
    .slice(0, Math.max(1, limit));
}

export async function readRuntimeTaskTimeline(taskId, { runtimeDir = DEFAULT_RUNTIME_DIR, limit = 200 } = {}) {
  const safeId = safeTaskId(taskId);
  if (!safeId) return { task: null, events: [] };
  const tasks = await readRuntimeTasks({ runtimeDir, limit: 500 });
  const task = tasks.find((item) => item.id === safeId) || null;
  const events = (await readJsonlFile(runtimePath(runtimeDir, "events.jsonl")))
    .filter((event) => safeTaskId(event.task_id || event.taskId) === safeId)
    .sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0))
    .slice(-Math.max(1, limit))
    .map((event) => ({
      seq: Number(event.seq || 0),
      ts: event.ts || event.created_at || null,
      type: event.type || "runtime.event",
      status: event.status || "",
      title: clampText(event.title || "", 120),
      itemId: event.item_id || event.itemId || "",
      runId: event.run_id || event.runId || "",
      payload: event.payload && typeof event.payload === "object" ? event.payload : {},
    }));
  return { task, events };
}

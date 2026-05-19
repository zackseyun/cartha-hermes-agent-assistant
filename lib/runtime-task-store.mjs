import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const RUNTIME_TASK_STORE_SCHEMA_VERSION = 1;
export const DEFAULT_RUNTIME_TASK_STORE_DIR = path.join(os.homedir(), ".hermes", "runtime");
export const FINAL_TASK_STATUSES = new Set(["completed", "succeeded", "failed", "cancelled", "blocked"]);
export const DEFAULT_RUNTIME_DIR = DEFAULT_RUNTIME_TASK_STORE_DIR;

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const EVENT_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_STALE_LOCK_MS = 30_000;

export class RuntimeTaskStoreError extends Error {
  constructor(message, code, detail = undefined) {
    super(message);
    this.name = "RuntimeTaskStoreError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

export class RuntimeTaskStore {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.HERMES_RUNTIME_STORE_DIR || process.env.HERMES_RUNTIME_DIR || DEFAULT_RUNTIME_TASK_STORE_DIR);
    this.tasksDir = path.join(this.rootDir, "tasks");
    this.eventsDir = path.join(this.rootDir, "events");
    this.tasksJsonPath = path.join(this.rootDir, "tasks.json");
    this.eventsJsonlPath = path.join(this.rootDir, "events.jsonl");
    this.locksDir = path.join(this.rootDir, ".locks");
    this.lockTimeoutMs = positiveInteger(options.lockTimeoutMs, DEFAULT_LOCK_TIMEOUT_MS);
    this.staleLockMs = positiveInteger(options.staleLockMs, DEFAULT_STALE_LOCK_MS);
    this.idFactory = typeof options.idFactory === "function" ? options.idFactory : defaultTaskId;
    this.now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
    this._mutationQueue = Promise.resolve();
  }

  async ensureReady() {
    await Promise.all([
      fs.mkdir(this.tasksDir, { recursive: true, mode: 0o700 }),
      fs.mkdir(this.eventsDir, { recursive: true, mode: 0o700 }),
      fs.mkdir(this.locksDir, { recursive: true, mode: 0o700 }),
    ]);
  }

  async createTask(payload = {}) {
    const normalized = normalizeTaskPayload(payload);
    return this._mutate(async () => {
      const createdAt = normalizeTimestamp(normalized.created_at || normalized.createdAt || this.now());
      const id = validateTaskId(normalized.id || this.idFactory({ createdAt, payload: normalized }));
      const taskPath = this._taskPath(id);
      const exists = await fileExists(taskPath);
      if (exists) {
        throw new RuntimeTaskStoreError(`Task already exists: ${id}`, "TASK_EXISTS", { id });
      }

      const title = clampText(normalized.title || normalized.input || "Hermes task", 160);
      const task = {
        schema_version: RUNTIME_TASK_STORE_SCHEMA_VERSION,
        id,
        title,
        status: clampToken(normalized.status || "queued", "queued"),
        kind: clampToken(normalized.kind || normalized.mode || "task", "task"),
        source: clampToken(normalized.source || "cartha", "cartha"),
        created_at: createdAt,
        updated_at: createdAt,
        final_status: null,
        final_at: null,
        event_count: 1,
        input: toJsonValue(normalized.input ?? null, "input"),
        metadata: toJsonValue(normalized.metadata || {}, "metadata"),
      };

      const event = createEventRecord({
        taskId: id,
        seq: 1,
        type: "task.created",
        createdAt,
        item: {
          title: task.title,
          status: task.status,
          kind: task.kind,
          source: task.source,
          input: task.input,
          metadata: task.metadata,
        },
      });

      await writeJsonAtomic(taskPath, task);
      await appendJsonl(this._eventsPath(id), event);
      return task;
    });
  }

  async appendEvent(taskId, type, item = {}, options = {}) {
    const id = validateTaskId(taskId);
    const eventType = validateEventType(type);
    return this._mutate(async () => {
      const task = await this._readTaskUnlocked(id);
      const events = await this._readEventsUnlocked(id);
      const createdAt = normalizeTimestamp(options.created_at || options.createdAt || options.at || this.now());
      const event = createEventRecord({
        taskId: id,
        seq: events.length + 1,
        type: eventType,
        createdAt,
        item,
      });

      const nextTask = {
        ...task,
        updated_at: createdAt,
        event_count: event.seq,
      };
      if (options.status !== undefined) nextTask.status = clampToken(options.status, task.status || "queued");

      await appendJsonl(this._eventsPath(id), event);
      await writeJsonAtomic(this._taskPath(id), nextTask);
      return event;
    });
  }

  async appendItem(taskId, type, item = {}, options = {}) {
    return this.appendEvent(taskId, type, item, options);
  }

  async recordFinalStatus(taskId, status, item = {}, options = {}) {
    const id = validateTaskId(taskId);
    const finalStatus = validateFinalStatus(status);
    return this._mutate(async () => {
      const task = await this._readTaskUnlocked(id);
      if (task.final_status) {
        if (task.final_status === finalStatus) {
          return { task, event: null, alreadyFinal: true };
        }
        throw new RuntimeTaskStoreError(`Task ${id} is already final as ${task.final_status}`, "TASK_FINALIZED", {
          id,
          final_status: task.final_status,
          requested_status: finalStatus,
        });
      }

      const events = await this._readEventsUnlocked(id);
      const finalAt = normalizeTimestamp(options.created_at || options.createdAt || options.at || this.now());
      const event = createEventRecord({
        taskId: id,
        seq: events.length + 1,
        type: options.type ? validateEventType(options.type) : "task.final_status",
        createdAt: finalAt,
        item: {
          ...objectItem(item, "final status item"),
          status: finalStatus,
        },
      });
      const nextTask = {
        ...task,
        status: finalStatus,
        final_status: finalStatus,
        final_at: finalAt,
        updated_at: finalAt,
        event_count: event.seq,
      };

      await appendJsonl(this._eventsPath(id), event);
      await writeJsonAtomic(this._taskPath(id), nextTask);
      return { task: nextTask, event, alreadyFinal: false };
    });
  }

  async listTasks(options = {}) {
    await this.ensureReady();
    const entries = await fs.readdir(this.tasksDir, { withFileTypes: true }).catch((err) => {
      if (err?.code === "ENOENT") return [];
      throw err;
    });

    const statusFilter = normalizeStatusFilter(options.status || options.statuses);
    const sourceFilter = options.source ? String(options.source) : "";
    const kindFilter = options.kind ? String(options.kind) : "";
    const tasks = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.endsWith(".tmp")) continue;
      const task = await readJsonStrict(path.join(this.tasksDir, entry.name));
      if (!task?.id) continue;
      if (statusFilter && !statusFilter.has(task.status)) continue;
      if (sourceFilter && task.source !== sourceFilter) continue;
      if (kindFilter && task.kind !== kindFilter) continue;
      tasks.push(task);
    }

    const direction = options.order === "asc" ? 1 : -1;
    tasks.sort((a, b) => direction * (Date.parse(a.updated_at || a.created_at || 0) - Date.parse(b.updated_at || b.created_at || 0)));
    if (options.includeMirrors !== false) {
      const mirror = await this._readMirrorTasksUnlocked();
      const seen = new Set(tasks.map((task) => task.id));
      for (const task of mirror) {
        if (task?.id && !seen.has(task.id)) {
          seen.add(task.id);
          tasks.push(task);
        }
      }
      tasks.sort((a, b) => direction * (Date.parse(a.updated_at || a.updatedAt || a.created_at || a.createdAt || 0) - Date.parse(b.updated_at || b.updatedAt || b.created_at || b.createdAt || 0)));
    }
    const limit = options.limit === undefined ? tasks.length : positiveInteger(options.limit, tasks.length);
    return tasks.slice(0, limit);
  }

  async readTask(taskId) {
    await this.ensureReady();
    const id = validateTaskId(taskId);
    return this._readTaskUnlocked(id).catch(async (err) => {
      if (err?.code !== "TASK_NOT_FOUND") throw err;
      const mirror = await this._readMirrorTasksUnlocked();
      const task = mirror.find((item) => item?.id === id);
      if (!task) throw err;
      return task;
    });
  }

  async readTaskTimeline(taskId, options = {}) {
    await this.ensureReady();
    const id = validateTaskId(taskId);
    const [task, storeEvents, mirrorEvents] = await Promise.all([
      this.readTask(id),
      this._readEventsUnlocked(id),
      this._readMirrorEventsUnlocked(id),
    ]);
    const allEvents = mergeEventsBySeq([...storeEvents, ...mirrorEvents]);
    const sinceSeq = options.sinceSeq === undefined ? 0 : positiveInteger(options.sinceSeq, 0);
    const filtered = allEvents.filter((event) => Number(event.seq || 0) > sinceSeq);
    const limit = options.limit === undefined ? filtered.length : positiveInteger(options.limit, filtered.length);
    return {
      task,
      events: limit === 0 ? [] : filtered.slice(-limit),
    };
  }

  _taskPath(id) {
    return path.join(this.tasksDir, `${validateTaskId(id)}.json`);
  }

  _eventsPath(id) {
    return path.join(this.eventsDir, `${validateTaskId(id)}.jsonl`);
  }

  async _readTaskUnlocked(id) {
    try {
      return await readJsonStrict(this._taskPath(id));
    } catch (err) {
      if (err?.code === "ENOENT") {
        throw new RuntimeTaskStoreError(`Task not found: ${id}`, "TASK_NOT_FOUND", { id });
      }
      throw err;
    }
  }

  async _readEventsUnlocked(id) {
    const filePath = this._eventsPath(id);
    const raw = await fs.readFile(filePath, "utf8").catch((err) => {
      if (err?.code === "ENOENT") return "";
      throw err;
    });
    if (!raw.trim()) return [];
    return raw
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line, index) => parseJsonLine(filePath, line, index + 1));
  }

  async _readMirrorTasksUnlocked() {
    try {
      const raw = await readJsonStrict(this.tasksJsonPath);
      return Array.isArray(raw) ? raw : [];
    } catch (err) {
      if (err?.code === "ENOENT") return [];
      throw err;
    }
  }

  async _readMirrorEventsUnlocked(id) {
    const filePath = this.eventsJsonlPath;
    const raw = await fs.readFile(filePath, "utf8").catch((err) => {
      if (err?.code === "ENOENT") return "";
      throw err;
    });
    if (!raw.trim()) return [];
    return raw
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line, index) => parseJsonLine(filePath, line, index + 1))
      .filter((event) => String(event.task_id || event.taskId || "") === id);
  }

  async _mutate(fn) {
    const run = async () => {
      await this.ensureReady();
      const release = await this._acquireLock("store");
      try {
        return await fn();
      } finally {
        await release();
      }
    };
    const result = this._mutationQueue.then(run, run);
    this._mutationQueue = result.catch(() => undefined);
    return result;
  }

  async _acquireLock(name) {
    const lockName = `${validateLockName(name)}.lock`;
    const lockDir = path.join(this.locksDir, lockName);
    const deadline = Date.now() + this.lockTimeoutMs;

    while (true) {
      try {
        await fs.mkdir(lockDir, { mode: 0o700 });
        await writeJsonAtomic(path.join(lockDir, "owner.json"), {
          pid: process.pid,
          created_at: new Date().toISOString(),
          root_dir: this.rootDir,
        });
        return async () => {
          await fs.rm(lockDir, { recursive: true, force: true });
        };
      } catch (err) {
        if (err?.code !== "EEXIST") throw err;
        const stat = await fs.stat(lockDir).catch(() => null);
        if (stat && Date.now() - stat.mtimeMs > this.staleLockMs) {
          await fs.rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
          continue;
        }
        if (Date.now() > deadline) {
          throw new RuntimeTaskStoreError(`Timed out waiting for runtime task store lock: ${lockName}`, "LOCK_TIMEOUT", {
            lock: lockDir,
          });
        }
        await sleep(35);
      }
    }
  }
}

export async function readRuntimeTasks(options = {}) {
  const store = createRuntimeTaskStore({ rootDir: options.runtimeDir || options.rootDir });
  const tasks = await store.listTasks({ ...options, includeMirrors: true });
  return tasks.map((task) => publicRuntimeTask(task));
}

export async function readRuntimeTaskTimeline(taskId, options = {}) {
  const store = createRuntimeTaskStore({ rootDir: options.runtimeDir || options.rootDir });
  const timeline = await store.readTaskTimeline(taskId, options);
  return {
    task: timeline.task ? publicRuntimeTask(timeline.task) : null,
    events: (timeline.events || []).map(publicRuntimeEvent),
  };
}

export function createRuntimeTaskStore(options = {}) {
  return new RuntimeTaskStore(options);
}

export function publicRuntimeTask(task = {}) {
  const id = String(task.id || task.task_id || task.taskId || "").trim();
  const inputSummary = clampText(task.input ?? task.task_text ?? task.taskText ?? task.text ?? task.prompt ?? "", 260);
  const metadata = task.metadata && typeof task.metadata === "object" ? task.metadata : {};
  return {
    id,
    taskId: id,
    title: clampText(task.title || metadata.title || inputSummary || "Durable Hermes task", 96),
    summary: clampText(task.summary || task.details || task.reply || inputSummary || "", 260),
    status: String(task.status || task.final_status || "unknown"),
    source: task.source || metadata.source || "cartha",
    mode: task.mode || task.kind || metadata.mode || "task",
    kind: "durable_task",
    createdAt: task.created_at || task.createdAt || null,
    updatedAt: task.updated_at || task.updatedAt || task.final_at || task.finalAt || null,
    startedAt: task.started_at || task.startedAt || null,
    completedAt: task.completed_at || task.completedAt || task.final_at || task.finalAt || null,
    runId: task.run_id || task.runId || metadata.run_id || "",
    cwd: task.cwd || metadata.cwd || "",
    details: clampText(task.details || "", 500),
    nextSteps: Array.isArray(task.next_steps) ? task.next_steps.slice(0, 6) : [],
    artifactPath: task.artifact_path || task.artifactPath || "",
    eventCount: Number(task.event_count || task.eventCount || 0),
  };
}

export function publicRuntimeEvent(event = {}) {
  const item = event.item && typeof event.item === "object" ? event.item : event.payload && typeof event.payload === "object" ? event.payload : {};
  return {
    id: event.id || `event-${event.seq || 0}`,
    seq: Number(event.seq || 0),
    ts: event.created_at || event.createdAt || event.ts || null,
    type: event.type || "runtime.event",
    status: event.status || item.status || "",
    title: clampText(event.title || item.title || item.command || "", 120),
    taskId: event.task_id || event.taskId || "",
    itemId: event.item_id || event.itemId || "",
    runId: event.run_id || event.runId || item.run_id || "",
    payload: item,
    item,
  };
}

function normalizeTaskPayload(payload) {
  if (typeof payload === "string") {
    return { input: payload, title: clampText(payload, 160) };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new RuntimeTaskStoreError("Task payload must be an object or string", "INVALID_TASK_PAYLOAD");
  }
  return { ...payload };
}

function createEventRecord({ taskId, seq, type, createdAt, item }) {
  return {
    schema_version: RUNTIME_TASK_STORE_SCHEMA_VERSION,
    id: `evt_${String(seq).padStart(6, "0")}_${crypto.randomBytes(4).toString("hex")}`,
    task_id: validateTaskId(taskId),
    seq,
    type: validateEventType(type),
    created_at: normalizeTimestamp(createdAt),
    item: toJsonValue(item ?? {}, "event item"),
  };
}

function defaultTaskId() {
  const timestamp = new Date().toISOString().replace(/[^0-9]/gu, "").slice(0, 17);
  return `task_${timestamp}_${crypto.randomBytes(4).toString("hex")}`;
}

function validateTaskId(value) {
  const id = String(value || "").trim();
  if (!TASK_ID_PATTERN.test(id)) {
    throw new RuntimeTaskStoreError("Invalid task id. Use 1-128 letters, numbers, dot, underscore, colon, or dash characters.", "INVALID_TASK_ID", {
      value: id,
    });
  }
  return id;
}

function validateEventType(value) {
  const type = String(value || "").trim();
  if (!EVENT_TYPE_PATTERN.test(type)) {
    throw new RuntimeTaskStoreError("Invalid event type. Use 1-128 letters, numbers, dot, underscore, colon, or dash characters, starting with a letter.", "INVALID_EVENT_TYPE", {
      value: type,
    });
  }
  return type;
}

function validateFinalStatus(value) {
  const status = clampToken(value, "");
  if (!FINAL_TASK_STATUSES.has(status)) {
    throw new RuntimeTaskStoreError(`Invalid final status: ${status || "(empty)"}`, "INVALID_FINAL_STATUS", {
      allowed: [...FINAL_TASK_STATUSES],
    });
  }
  return status;
}

function validateLockName(value) {
  return String(value || "store").replace(/[^A-Za-z0-9_.:-]/gu, "_").slice(0, 80) || "store";
}

function normalizeTimestamp(value) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new RuntimeTaskStoreError(`Invalid timestamp: ${value}`, "INVALID_TIMESTAMP");
  }
  return date.toISOString();
}

function clampText(value, max) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function clampToken(value, fallback) {
  const token = String(value || fallback || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]/gu, "_")
    .replace(/_+/gu, "_")
    .slice(0, 80);
  return token || fallback;
}

function objectItem(value, label) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    return { value: toJsonValue(value, label) };
  }
  return toJsonValue(value, label);
}

function toJsonValue(value, label) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    throw new RuntimeTaskStoreError(`${label} must be JSON serializable`, "NOT_JSON_SERIALIZABLE", String(err?.message || err));
  }
}

function normalizeStatusFilter(value) {
  if (!value) return null;
  const values = Array.isArray(value) ? value : [value];
  return new Set(values.map((item) => clampToken(item, "")).filter(Boolean));
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonStrict(filePath) {
  let raw = "";
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new RuntimeTaskStoreError(`Could not read JSON file: ${filePath}`, "INVALID_JSON", String(err?.message || err));
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

async function appendJsonl(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

function parseJsonLine(filePath, line, lineNumber) {
  try {
    return JSON.parse(line);
  } catch (err) {
    throw new RuntimeTaskStoreError(`Invalid JSONL in ${filePath}:${lineNumber}`, "INVALID_JSONL", String(err?.message || err));
  }
}

function mergeEventsBySeq(events) {
  const seen = new Set();
  return events
    .filter((event) => {
      const key = `${event.id || ""}:${event.seq || ""}:${event.type || ""}:${event.ts || event.created_at || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const seqDelta = Number(a.seq || 0) - Number(b.seq || 0);
      if (seqDelta) return seqDelta;
      return Date.parse(a.created_at || a.ts || 0) - Date.parse(b.created_at || b.ts || 0);
    });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

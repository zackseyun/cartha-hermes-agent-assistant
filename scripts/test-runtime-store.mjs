#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readRuntimeTasks, readRuntimeTaskTimeline } from "../lib/hermes-runtime-store.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-runtime-store-test-"));
await fs.writeFile(path.join(dir, "tasks.json"), JSON.stringify([
  {
    id: "task-1",
    title: "Patch mobile app",
    status: "running",
    source: "alfred",
    mode: "task",
    task_text: "please patch it",
    created_at: "2026-05-19T01:00:00Z",
    updated_at: "2026-05-19T01:02:00Z",
    event_count: 2
  }
], null, 2));
await fs.writeFile(path.join(dir, "events.jsonl"), [
  JSON.stringify({ seq: 1, task_id: "task-1", type: "task.created", status: "queued", ts: "2026-05-19T01:00:00Z", payload: { source: "alfred" } }),
  JSON.stringify({ seq: 2, task_id: "task-1", type: "command.completed", status: "completed", ts: "2026-05-19T01:02:00Z", payload: { exit_code: 0 } })
].join("\n") + "\n");

const tasks = await readRuntimeTasks({ runtimeDir: dir });
assert.equal(tasks.length, 1);
assert.equal(tasks[0].id, "task-1");
assert.equal(tasks[0].status, "running");
assert.equal(tasks[0].eventCount, 2);
const timeline = await readRuntimeTaskTimeline("task-1", { runtimeDir: dir });
assert.equal(timeline.task.id, "task-1");
assert.deepEqual(timeline.events.map((event) => event.type), ["task.created", "command.completed"]);
console.log("hermes-runtime-store test ok");

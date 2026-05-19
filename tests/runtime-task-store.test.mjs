import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRuntimeTaskStore } from "../lib/runtime-task-store.mjs";

async function withTempStore(fn) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-runtime-store-"));
  try {
    const clock = makeClock();
    const store = createRuntimeTaskStore({
      rootDir,
      idFactory: () => "task_test",
      now: clock,
    });
    await fn(store, rootDir);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

function makeClock() {
  let seconds = 0;
  return () => new Date(Date.UTC(2026, 4, 18, 17, 0, seconds++)).toISOString();
}

test("creates tasks, appends events, lists tasks, reads timelines, and records final status", async () => {
  await withTempStore(async (store, rootDir) => {
    const task = await store.createTask({
      title: "Ship durable runtime store",
      input: { prompt: "Make Hermes tasks durable" },
      source: "test-suite",
      kind: "runtime",
      metadata: { lane: "local" },
    });

    assert.equal(task.id, "task_test");
    assert.equal(task.status, "queued");
    assert.equal(task.event_count, 1);

    const progress = await store.appendEvent(task.id, "agent.progress", { message: "Writing JSONL" }, { status: "running" });
    assert.equal(progress.seq, 2);
    assert.equal(progress.type, "agent.progress");

    const final = await store.recordFinalStatus(task.id, "completed", { summary: "Store is ready" });
    assert.equal(final.alreadyFinal, false);
    assert.equal(final.task.status, "completed");
    assert.equal(final.event.seq, 3);

    const listed = await store.listTasks({ status: "completed" });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, task.id);
    assert.equal(listed[0].final_status, "completed");

    const timeline = await store.readTaskTimeline(task.id);
    assert.equal(timeline.task.status, "completed");
    assert.deepEqual(
      timeline.events.map((event) => event.type),
      ["task.created", "agent.progress", "task.final_status"],
    );
    assert.equal(timeline.events[2].item.summary, "Store is ready");
    assert.equal((await store.readTaskTimeline(task.id, { limit: 0 })).events.length, 0);

    const eventFile = await fs.readFile(path.join(rootDir, "events", "task_test.jsonl"), "utf8");
    assert.equal(eventFile.trim().split(/\r?\n/u).length, 3);
  });
});

test("keeps final status idempotent and prevents conflicting final rewrites", async () => {
  await withTempStore(async (store) => {
    const task = await store.createTask("Short prompt");
    await store.recordFinalStatus(task.id, "failed", { reason: "boom" });

    const same = await store.recordFinalStatus(task.id, "failed", { reason: "boom again" });
    assert.equal(same.alreadyFinal, true);
    assert.equal(same.event, null);

    await assert.rejects(() => store.recordFinalStatus(task.id, "completed"), { code: "TASK_FINALIZED" });
  });
});

test("validates task ids, event types, final statuses, and missing tasks", async () => {
  await withTempStore(async (store) => {
    await assert.rejects(() => store.createTask({ id: "../bad", title: "bad" }), { code: "INVALID_TASK_ID" });
    await assert.rejects(() => store.appendEvent("missing", "agent.progress", {}), { code: "TASK_NOT_FOUND" });

    const task = await store.createTask({ id: "task_ok", title: "ok" });
    await assert.rejects(() => store.appendEvent(task.id, "1.bad", {}), { code: "INVALID_EVENT_TYPE" });
    await assert.rejects(() => store.recordFinalStatus(task.id, "done-ish"), { code: "INVALID_FINAL_STATUS" });
  });
});

test("reads Python runtime JSON mirrors from the same runtime directory", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-runtime-mirror-"));
  try {
    const store = createRuntimeTaskStore({ rootDir });
    await fs.writeFile(
      path.join(rootDir, "tasks.json"),
      JSON.stringify(
        [
          {
            id: "mirror_task",
            title: "Mirror task",
            status: "running",
            source: "alfred",
            mode: "task",
            task_text: "check the durable ledger",
            created_at: "2026-05-18T17:00:00.000Z",
            updated_at: "2026-05-18T17:01:00.000Z",
            event_count: 2,
          },
        ],
        null,
        2,
      ),
    );
    await fs.writeFile(
      path.join(rootDir, "events.jsonl"),
      [
        JSON.stringify({ seq: 1, task_id: "mirror_task", type: "task.created", status: "queued", ts: "2026-05-18T17:00:00.000Z", payload: { source: "alfred" } }),
        JSON.stringify({ seq: 2, task_id: "mirror_task", type: "command.completed", status: "running", ts: "2026-05-18T17:01:00.000Z", payload: { command: "git status" } }),
      ].join("\n") + "\n",
    );

    const tasks = await store.listTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].id, "mirror_task");
    const timeline = await store.readTaskTimeline("mirror_task");
    assert.equal(timeline.task.title, "Mirror task");
    assert.deepEqual(
      timeline.events.map((event) => event.type),
      ["task.created", "command.completed"],
    );
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

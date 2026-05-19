# Hermes runtime task store

`lib/runtime-task-store.mjs` is a tiny durable store for local Hermes/Cartha runtime tasks. It intentionally uses only Node built-ins, so it fits the current dependency-free `package.json`.

## What it stores

By default the store writes under `~/.hermes/runtime`:

```text
runtime/
  hermes.db                 # Python bridge authoritative SQLite ledger
  tasks.json                # compact JSON mirror for list views
  events.jsonl              # append-only global timeline mirror
  tasks/<task-id>.json      # Node store current task summary/status
  events/<task-id>.jsonl    # Node store append-only typed timeline
  .locks/store.lock/        # short-lived cross-process write lock
```

The Python runtime bridge writes `hermes.db`, `tasks.json`, and `events.jsonl`; the Node store writes per-task JSON/JSONL under `tasks/` and `events/`. Both live in the same directory, and the reader merges them so the operator console hydrates from one OS layer.

## API sketch

```js
import { createRuntimeTaskStore } from "./lib/runtime-task-store.mjs";

const store = createRuntimeTaskStore();

const task = await store.createTask({
  title: "Run durable Hermes task",
  input: { prompt: "Summarize the last build failure" },
  source: "native-operator",
  kind: "task",
  metadata: { priority: "normal" },
});

await store.appendEvent(task.id, "agent.progress", { message: "Started investigation" }, { status: "running" });
await store.appendEvent(task.id, "tool.result", { tool: "terminal", ok: true });
await store.recordFinalStatus(task.id, "completed", { summary: "Build failure was fixed" });

const recent = await store.listTasks({ limit: 20 });
const timeline = await store.readTaskTimeline(task.id);
```

Supported final statuses are `completed`, `succeeded`, `failed`, `cancelled`, and `blocked`. Recording the same final status twice is idempotent; trying to rewrite a completed task to a different final status throws `TASK_FINALIZED`.

## Validation

Focused validation:

```bash
node --check lib/runtime-task-store.mjs
node --test tests/runtime-task-store.test.mjs
```

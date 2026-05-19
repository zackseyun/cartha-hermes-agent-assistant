# Operator Durable Task OS API

The local console now has a thin operator-facing seam for durable Hermes/Cartha tasks. It is intentionally read-first: The durable runtime store owns task/event writes, while this surface lists tasks and reads timelines without mutating runtime state.

## Store loading

`server.mjs` dynamically tries these local modules:

- `./lib/runtime-task-store.mjs` — durable `RuntimeTaskStore` API (`createRuntimeTaskStore`, `listTasks`, `readTaskTimeline`).
- `./lib/hermes-runtime-store.mjs` — JSON mirror reader for the Python event bridge (`~/.hermes/runtime/tasks.json` + `events.jsonl`).

If either module is missing, the API stays up and reports a `stub` source in the response. That lets the UI ship before the store lands, and it hydrates automatically after the module exists and the server restarts.

## Endpoints

```http
GET /api/operator/tasks?limit=24
GET /api/operator/tasks?status=running,queued&source=native-operator
GET /api/operator/tasks/:id/timeline
GET /api/operator/task-timeline?id=:id&store=runtime-mirror
```

`GET /api/operator/tasks` returns:

- `tasks` — merged operator list: durable tasks first, then legacy harness/session tasks.
- `durableTasks` — only durable runtime tasks.
- `harnessTasks` — the pre-existing heartbeat/session-derived task list.
- `durableStore` — source availability, mode, module path, root directory, and any stub/error note.

`GET /api/operator/tasks/:id/timeline` returns:

- `task` — normalized durable task summary.
- `events` — append-only timeline events with `seq`, `type`, `status`, `ts`, `summary`, and `item`.
- `sources` — store source metadata for debugging.

## UI hooks

The Cartha Canvas sidebar includes a **Durable Task OS** card. It calls `/api/operator/tasks`, shows the current store state, renders recent durable tasks, and opens `/api/operator/tasks/:id/timeline` when a task is selected.

This is meant to be the minimum stable seam for the durable task OS: Runtime code writes tasks and events; the operator console reads and renders them. 🚀

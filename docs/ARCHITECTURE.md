# Architecture

Hermes Local Agent Kit intentionally does not fork Hermes Agent or Hermes Workspace. It packages the operational glue around them:

1. **Provider/model defaults** for a practical OpenRouter-powered agent stack.
2. **Gateway auth bridging** from `API_SERVER_KEY` to Workspace's `HERMES_API_TOKEN` / `CLAUDE_API_TOKEN` names.
3. **Launchd ownership** so gateway, dashboard, workspace, and the small console are started consistently.
4. **Smoke tests** that validate the real path: browser/API -> Workspace/console -> Hermes gateway -> model -> tool call.
5. **Small local console** for quick diagnostics and local vision experiments.

## Ports

| Port | Service |
| --- | --- |
| `8642` | Hermes Agent OpenAI-compatible gateway |
| `9119` | Native Hermes dashboard |
| `3000` | Hermes Workspace |
| `5128` | This repo's local console |
| `11434` | Ollama OpenAI-compatible local model endpoint, optional |

## Why a separate local console?

Hermes Workspace is the full-featured UI. The included console is intentionally small: it gives fast status visibility, a direct Hermes-agent path, a direct small-model path, and a direct local-vision path. It is useful for proving whether a failure is model, tool, gateway, auth, or UI related.

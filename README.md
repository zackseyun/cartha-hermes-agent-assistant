# Cartha Hermes Agent Assistant

A batteries-included local AI assistant stack for macOS, built on the open-source Hermes Agent:

- **Hermes Agent gateway** on `127.0.0.1:8642` for OpenAI-compatible agent/tool calls.
- **Native Hermes dashboard** on `127.0.0.1:9119` for config, providers, sessions, skills, and diagnostics.
- **Hermes Workspace** on `127.0.0.1:3000` for the richer chat/workspace UI.
- **Small local operator console** on `127.0.0.1:5128` for quick status checks, image tests, and smoke-testing the agent path.
- **Autonomous heartbeat custodian** that runs every 30 min — system observability, idle-app cleanup proposals, factual web search, and pending-task triage. Local-first; only escalates to the cloud "senior" model for genuine multi-step reasoning.
- **Self-hosted SearXNG** web search backend on `127.0.0.1:8888` so the heartbeat can answer factual questions without OpenRouter calls.
- **launchd service templates** so the stack survives terminal closes and reboots.

This repo packages the glue that made the local Hermes setup reliable: token propagation, launchd process ownership, OpenRouter model defaults, simple smoke tests, the heartbeat custodian, the SearXNG search backend, and an optional lightweight UI.

## Default model routing

The defaults are intentionally editable:

| Role | Default | Why |
| --- | --- | --- |
| Agent brain | `xiaomi/mimo-v2.5-pro` via OpenRouter | Popular with Hermes-style agent workloads and large context. |
| Smaller/fallback tasks | `deepseek/deepseek-v4-flash` via OpenRouter | Fast, cheaper backup route for smaller tool/task calls. |
| Local vision test path | `gemma4:31b-hermes` via Ollama | Local multimodal/vision experimentation. |

Gemma 4 31B vision support depends on the Ollama/model build you install. Audio should usually be transcribed first, or routed through an audio-capable local model, then handed to the main agent/model for reasoning.

## Quick start

```bash
git clone https://github.com/zackseyun/cartha-hermes-agent-assistant.git
cd cartha-hermes-agent-assistant
npm install
node scripts/install.mjs

# (optional) stand up the SearXNG web-search backend for the heartbeat
npm run searxng:start
```

Then add your OpenRouter key:

```bash
$EDITOR ~/.hermes/.env
# set:
OPENROUTER_API_KEY=sk-or-...
```

Restart services and smoke test:

```bash
launchctl kickstart -k gui/$(id -u)/ai.hermes.gateway
launchctl kickstart -k gui/$(id -u)/dev.hermes.local-dashboard
launchctl kickstart -k gui/$(id -u)/dev.hermes.workspace
launchctl kickstart -k gui/$(id -u)/dev.hermes.local-console
npm run smoke
```

Open:

- Local console: <http://127.0.0.1:5128>
- Hermes Workspace: <http://127.0.0.1:3000>
- Native Hermes dashboard: <http://127.0.0.1:9119>

## Installation options

```bash
node scripts/install.mjs --help
```

Common examples:

```bash
# Use a different workspace root for terminal/file tools
node scripts/install.mjs --workspace-cwd "$HOME/Documents/GitHub"

# Use different OpenRouter models
node scripts/install.mjs \
  --agent-model xiaomi/mimo-v2.5-pro \
  --small-model deepseek/deepseek-v4-flash

# Only write config/templates; do not clone upstream repos
node scripts/install.mjs --no-clone

# See what would happen without writing files/services
node scripts/install.mjs --dry-run
```

## What the installer does

1. Creates `~/.hermes/.env` if needed.
2. Adds a random `API_SERVER_KEY` for the Hermes gateway.
3. Clones/updates:
   - `https://github.com/NousResearch/hermes-agent.git` into `~/.hermes/hermes-agent`
   - `https://github.com/outsourc-e/hermes-workspace.git` into `~/hermes-workspace`
4. Installs Hermes Agent into a Python virtualenv.
5. Installs Hermes Workspace dependencies with `pnpm`.
6. Patches `~/.hermes/config.yaml` with the model, fallback, terminal cwd, and API-server toolset settings.
7. Writes launchd services into `~/Library/LaunchAgents`.

## Security model

- The browser never receives OpenRouter or Hermes gateway secrets from this console.
- The Workspace UI is password/cookie protected when `HERMES_PASSWORD` is set.
- The gateway uses `API_SERVER_KEY`; the Workspace process receives the same value as `HERMES_API_TOKEN` / `CLAUDE_API_TOKEN`.
- Terminal/file tools run with the permissions of your macOS user. Start read-only and be careful before asking the agent to delete or mutate files.

## Useful commands

```bash
# Status
launchctl list | grep hermes
curl -s http://127.0.0.1:8642/health/detailed | python3 -m json.tool
curl -s http://127.0.0.1:5128/api/status | python3 -m json.tool

# Logs
tail -f ~/.hermes/logs/gateway.log
tail -f ~/.hermes/logs/gateway.error.log
tail -f ~/.hermes/logs/hermes-workspace.log
tail -f logs/local-console.log

# Reset stale OpenRouter exhaustion state after topping up credits
npm run reset:openrouter

# Run local console manually
npm start
```

## Heartbeat custodian (Phase 2 — local-first agentic loop)

The kit ships a 30-minute autonomous heartbeat that lives in `templates/heartbeat/`:

- `heartbeat.sh` — collects recent activity, OpenClaw context, pending agent-sync jobs, and a system snapshot, then pipes the bundle into `heartbeat-agent.py`.
- `heartbeat-agent.py` — local model (default: `qwen3.6:35b-hermes-256k` on Ollama) picks exactly one tool. Tools include `noop`, `journal_entry`, `notify_user`, `show_visual`, `notify_user_dialog`, `set_timer`, `mark_job_done`, `web_search`, `safe_shell_query`, `fetch_url`, `read_calendar_today`, `read_mail_recent`, `escalate`, `propose_quit_app`, `propose_cleanup`.
- `heartbeat-cleanup.sh` — gated cleanup executor (empty trash, Xcode DerivedData, iOS simulator caches, etc.).
- `heartbeat-config/policy.json` — phase + allowlist + denylist + cleanup actions + `trusted_autonomy` block for direct edit/test/build/git tasks in allowed roots.

Phase 2 means destructive actions (quit app, cleanup) require concurrence from a cloud "senior" model (default `deepseek/deepseek-v4-flash` via OpenRouter). The heartbeat is **engineered to avoid over-escalation** — the system prompt walks an explicit decision tree that prefers local tools (web search, shell query, URL fetch) before reaching for the cloud, and a pre-deepseek content-fingerprint dedup skips identical-situation escalations.

Install:

```bash
cp templates/heartbeat/*.sh templates/heartbeat/*.py ~/.hermes/scripts/
mkdir -p ~/.hermes/heartbeat-config
cp templates/heartbeat-config/policy.json ~/.hermes/heartbeat-config/
chmod +x ~/.hermes/scripts/heartbeat*.sh ~/.hermes/scripts/heartbeat-agent.py
# Schedule via launchd or cron — see policy.json _comment for phase semantics.
```

## Microsoft 365 (calendar + mail) integration

The heartbeat's `read_calendar_today` and `read_mail_recent` tools talk to your Microsoft 365 (Outlook) account via the open-source [`@softeria/ms-365-mcp-server`](https://github.com/softeria/ms-365-mcp-server). The integration uses **stdio transport per call** rather than running a persistent service:

- Spawns the MCP server, does the JSON-RPC handshake, calls one tool, exits.
- ~3-5 s per call — fine at heartbeat cadence.
- Reuses MSAL-cached credentials from a prior `--login` (device-code flow, no Azure app registration needed).
- Read-only mode hardcoded — no accidental sends or deletes.
- Resilient: no long-running socket, no port to claim, no OAuth client plumbing; each call independent.

Install + log in once:

```bash
npm install -g @softeria/ms-365-mcp-server
~/.npm-global/bin/ms-365-mcp-server --login   # device-code flow in your browser
~/.npm-global/bin/ms-365-mcp-server --verify-login
```

Until you've logged in, the heartbeat tools will gracefully degrade with a "ms365 not logged in — run X" message in the journal/bubble rather than crashing.

## SearXNG web search backend

The heartbeat's `web_search` tool calls a localhost SearXNG instance — no API key, no rate limit, no cloud calls for factual questions. Settings template + bootstrap script live in `templates/searxng/`:

```bash
# Requires Docker (Colima, Docker Desktop, or Orbstack) running.
npm run searxng:start
# Bound to 127.0.0.1:8888, restarts unless explicitly stopped.

curl 'http://127.0.0.1:8888/search?q=test&format=json' | jq '.results | .[0]'
```

The script seeds `~/.hermes/searxng/settings.yml` from `templates/searxng/settings.yml` on first run with a freshly-generated secret key. Re-runs are idempotent (restart existing container).

## Stand-up guide

See [`docs/STANDUP.md`](docs/STANDUP.md) for a more detailed from-zero setup and [`docs/OPERATIONS.md`](docs/OPERATIONS.md) for debugging auth, model, launchd, and OpenRouter credit issues.

## License

MIT. This package glues together upstream Hermes Agent and Hermes Workspace projects; those projects keep their own licenses.

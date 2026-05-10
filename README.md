# Hermes Local Agent Kit

A batteries-included, open-source local Hermes Agent stack for macOS:

- **Hermes Agent gateway** on `127.0.0.1:8642` for OpenAI-compatible agent/tool calls.
- **Native Hermes dashboard** on `127.0.0.1:9119` for config, providers, sessions, skills, and diagnostics.
- **Hermes Workspace** on `127.0.0.1:3000` for the richer chat/workspace UI.
- **Small local operator console** on `127.0.0.1:5128` for quick status checks, image tests, and smoke-testing the agent path.
- **launchd service templates** so the stack survives terminal closes and reboots.

This repo packages the glue that made the local Hermes setup reliable: token propagation, launchd process ownership, OpenRouter model defaults, simple smoke tests, and an optional lightweight UI.

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
git clone https://github.com/zackseyun/hermes-local-agent-kit.git
cd hermes-local-agent-kit
npm install
node scripts/install.mjs
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

## Stand-up guide

See [`docs/STANDUP.md`](docs/STANDUP.md) for a more detailed from-zero setup and [`docs/OPERATIONS.md`](docs/OPERATIONS.md) for debugging auth, model, launchd, and OpenRouter credit issues.

## License

MIT. This package glues together upstream Hermes Agent and Hermes Workspace projects; those projects keep their own licenses.

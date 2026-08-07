# Cartha Hermes Agent Assistant

A batteries-included local AI assistant stack for macOS, built on the open-source Hermes Agent:

- **Hermes Agent gateway** on `127.0.0.1:8642` for OpenAI-compatible agent/tool calls.
- **Native Hermes dashboard** on `127.0.0.1:9119` for config, providers, sessions, skills, and diagnostics.
- **Cartha Hermes native Swift app** as the primary user surface: top-right Swift bubble, native operator panel, wake controls, approvals, and embedded Workspace bridge.
- **Hermes Workspace** on `127.0.0.1:3000` for the richer chat/workspace UI while capabilities are progressively ported into Swift.
- **Small local operator console/API** on `127.0.0.1:5128` for status checks, native app APIs, image tests, and smoke-testing the agent path.
- **Delegation-enabled API agent** on the native/API surface, so Hermes can call `delegate_task` and run up to three parallel child agents by default.
- **Autonomous heartbeat custodian** that runs every 30 min — system observability, idle-app cleanup proposals, factual web search, and pending-task triage. Local-first; only escalates to the cloud "senior" model for genuine multi-step reasoning.
- **Self-hosted SearXNG** web search backend on `127.0.0.1:8888` so the heartbeat can answer factual questions without OpenRouter calls.
- **launchd service templates** so the stack survives terminal closes and reboots.

This repo packages the glue that made the local Hermes setup reliable: token propagation, launchd process ownership, OpenRouter model defaults, simple smoke tests, the heartbeat custodian, the SearXNG search backend, and an optional lightweight UI.

## Adaptive thinking

The Ask surface now picks a reasoning effort per prompt before it talks to Hermes:

- **Low** for quick/simple prompts (`quick`, `brief`, `short answer`, `define`, `rewrite`, `translate`).
- **Medium** for normal day-to-day asks.
- **High** for analysis, debugging, architecture, robust implementation, investigation, or design review.
- **Extra high (`xhigh`)** for explicit deep-thinking phrases like `think hard`, `think carefully`, `go deep`, `reason through`, `be thoughtful`, `root cause`, or `best possible`.
- **Off (`none`)** only when explicitly asked with phrases like `no thinking` or `disable reasoning`.

You can force a turn with inline syntax such as `thinking: low`, `reasoning: xhigh`, or `/think high`. The native cockpit shows the selected level in Activity, and the local console writes it into `~/.hermes/config.yaml` immediately before the Hermes request so the gateway uses the right level for that turn. Set `HERMES_ADAPTIVE_THINKING=0` to disable this, or `HERMES_ADAPTIVE_THINKING_WRITE_CONFIG=0` to preview/pass request metadata without changing the Hermes config.

## Default model routing

The installed runtime is **local-first**:

| Role | Default | Why |
| --- | --- | --- |
| Main Hermes agent | `qwen3.6:35b-hermes-256k` via local Ollama/OpenAI-compatible API (`127.0.0.1:11434/v1`) | Primary private/local reasoning path for Hermes. |
| Local console / vision test path | `gemma4:31b-hermes` via local Ollama | Local multimodal/vision experimentation. |
| Emergency fallback only | `deepseek/deepseek-v4-flash` via OpenRouter | Optional recovery route if the local model/gateway fails. Remove `fallback_providers` from `~/.hermes/config.yaml` for strict local-only mode. |

Gemma 4 31B vision support depends on the Ollama/model build you install. Audio should usually be transcribed first, or routed through an audio-capable local model, then handed to the main agent/model for reasoning.

## Cross-repository Cartha agents

This repository is also the shared control plane for the Cartha engineering
estate. The checked-in registry at `config/cartha-projects.json` describes:

- `peoples-open-bible` — textual provenance and AWS CodeBuild operations;
- `cartha.ai.mobile` — Flutter clients and self-hosted release workflows;
- `cartha.website` — Next.js/static export and CodePipeline delivery;
- `CarthaCdkService` — APIs, CDK, EKS services, and infrastructure pipelines;
- this assistant — the local Hermes runtime and operator surface.

Seven project-aware specialists are available: orchestrator, Bible steward,
mobile engineer, web engineer, platform engineer, quality engineer, and release
engineer. They reuse each repository's existing `CLAUDE.md`/canonical docs and
native CI/CD instead of imposing a generic replacement pipeline.

```bash
# Inventory agents and repositories
npm run agents:list
npm run agents:status
npm run agents:check

# Inspect the exact prompt/context without starting a model
npm run agents -- prompt \
  --agent orchestrator \
  --projects pob,web,mobile \
  --task "Plan a cross-platform Bible Reader change"

# Run a specialist in an isolated Hermes git worktree (default)
npm run agents -- run \
  --agent mobile-engineer \
  --projects mobile \
  --task "Implement the approved mobile reader change and run focused checks"

# Print a repository's native validation plan; add --execute to run it
npm run agents -- validate --project pob
```

Repositories are expected as siblings of this checkout. Set
`CARTHA_PROJECTS_ROOT=/path/to/parent` when they live elsewhere. Executable
agent runs accept exactly one project and are worktree-first; multi-project
prompts are planning artifacts only. Cross-repository edits use separate scoped
runs so each repository gets its own branch, validation, and commit.
The runner never authorizes deploys, production pushes, cloud mutations,
package publishing, or app-store submission by itself. Those actions still
require an explicit task-level approval.

Worktree isolation protects Git state, but it is not an OS filesystem sandbox.
Hermes tools still run with the operator's account permissions. Use a container
or another OS-level sandbox when processing untrusted repositories; prompt rules
must not be treated as a hard host-filesystem security boundary.

### CI/CD design rule

The control plane validates its registry and runner through this repository's
existing Node 22 GitHub Actions job (`npm run check`). It does **not** turn
GitHub Actions back on for People's Open Bible or duplicate Cartha's release
pipelines. Each project keeps its native topology: CodeBuild/CodePipeline for
POB and web operations, hybrid GitHub Actions + CodeBuild + self-hosted macOS
for mobile, and CodePipeline/CodeBuild plus targeted workflows for platform.

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

- Native Swift app: `npm run native:open`
- Local console/API fallback: <http://127.0.0.1:5128>
- Hermes Workspace: <http://127.0.0.1:3000>
- Native Hermes dashboard: <http://127.0.0.1:9119>

## Native Swift app

The Swift app is the default human-facing shell. It opens as a small non-focus-stealing bubble in the upper-right corner and includes a fuller native panel with:

- Cartha Operator cockpit: Apple-like glass shell, animated aurora, sound/haptic polish, live dashboard, task ledger, tool readiness, sessions, approvals, and wake health.
- Operator chat through the local Hermes API.
- Two-mode composer: `Ask` for immediate streaming chat, `Run Task` for durable Cartha autonomy tasks.
- Embedded Hermes Workspace bridge so the existing Workspace UI is available inside the app while it is ported to native Swift.
- `Hey Cartha` wake listener status and controls.
- Native Apple upload approval decisions.

Native/operator **Run Task** results stay inside the app thread and Tasks tab;
they no longer summon the legacy centered Cartha Agent reply bubble. Alfred,
URL, and voice tasks still use that bubble because they do not have a native
task thread to update.

Commands:

```bash
npm run native:build
npm run native:open
npm run native:install-launch-agent
```

The web console remains a fallback/API daemon; routine user interaction should go through Swift.

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
- `hermes-task.sh` — Alfred/operator/voice task intake. It queues the old heartbeat reply and now creates the durable runtime task first.
- `hermes-runtime-event.py` — durable task/event bridge. Alfred, voice, and operator tasks get a persistent `~/.hermes/runtime` task row plus append-only events so the cockpit can recover long-running work after pauses/restarts.
- `heartbeat-cleanup.sh` — gated cleanup executor (empty trash, Xcode DerivedData, iOS simulator caches, etc.).
- `heartbeat-config/policy.json` — phase + allowlist + denylist + cleanup actions + `trusted_autonomy` block for direct edit/test/build/git tasks in allowed roots.

Phase 2 means destructive actions (quit app, cleanup) require concurrence from a cloud "senior" model (default `deepseek/deepseek-v4-flash` via OpenRouter). The heartbeat is **engineered to avoid over-escalation** — the system prompt walks an explicit decision tree that prefers local tools (web search, shell query, URL fetch) before reaching for the cloud, and a pre-deepseek content-fingerprint dedup skips identical-situation escalations.

Install:

```bash
cp templates/heartbeat/*.sh templates/heartbeat/*.py ~/.hermes/scripts/
mkdir -p ~/.hermes/heartbeat-config
cp templates/heartbeat-config/policy.json ~/.hermes/heartbeat-config/
chmod +x ~/.hermes/scripts/heartbeat*.sh ~/.hermes/scripts/heartbeat-agent.py
chmod +x ~/.hermes/scripts/hermes-runtime-event.py ~/.hermes/scripts/cartha-trusted-autonomy.py
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

## Research Room

The console and native Swift app include a **Research Room** for Perplexity-style local research:

- Search: local SearXNG at `127.0.0.1:8888`.
- Reading: safe public HTTP/HTTPS page fetches with private/local URL blocking.
- Synthesis: local Hermes/Ollama model first, optional OpenRouter fallback, and an extractive source brief if models time out.
- History: runs are persisted in `~/.hermes/research-room/runs.json`.

APIs:

```bash
curl -s http://127.0.0.1:5128/api/research/status | jq
curl -s http://127.0.0.1:5128/api/research/runs | jq
curl -s -X POST http://127.0.0.1:5128/api/research/runs \
  -H 'Content-Type: application/json' \
  -d '{"query":"best open-source Perplexity alternatives","mode":"quick"}' | jq
```

Useful env overrides:

- `HERMES_RESEARCH_SEARXNG_URL` — search backend URL.
- `HERMES_RESEARCH_MODEL` — local synthesis model override.
- `HERMES_RESEARCH_CLOUD_FALLBACK=0` — strict local/extractive-only mode.
- `HERMES_RESEARCH_MAX_RESULTS` / `HERMES_RESEARCH_MAX_FETCHES` — source breadth.

## Stand-up guide

See [`docs/STANDUP.md`](docs/STANDUP.md) for a more detailed from-zero setup and [`docs/OPERATIONS.md`](docs/OPERATIONS.md) for debugging auth, model, launchd, and OpenRouter credit issues.

## License

MIT. This package glues together upstream Hermes Agent and Hermes Workspace projects; those projects keep their own licenses.

## Cartha local console additions

This checkout also includes Zack's newer Cartha-facing operator console polish:

- **Release gate card + modal** for Apple upload approvals.
- **Cartha Canvas** companion panel for Alfred sessions, wake-listener state, active work, and recent Hermes sessions.
- **Research Room** for local SearXNG search, safe source reading, cited synthesis, and saved research history.
- **Wake listener health checks** for the `dev.cartha.voice` launchd path and local whisper server.
- **Non-secret server-side routing** for Hermes/OpenRouter/Ollama requests; browser JS never receives provider keys.

## Apple upload approval gate

The console can act as the local approval modal for scarce Apple upload lanes. By default the local commit hook asks only about **iOS TestFlight** to avoid duplicate Apple prompts; run the watcher with `--channel all` or `--channel macos_appstore` when Mac App Store proposals are wanted too.

1. Local Git hooks in `cartha.ai.mobile` run `scripts/testflight_proposal_watcher.mjs --commit <sha>` after commits, merges, rewrites, and main pushes.
2. Every commit gets a tiny top-right Cartha Agent bubble with **Deploy iOS** and **Skip** chips. It does not auto-focus and disappears if ignored.
3. If Zack ignores it, Cartha Agent waits a random 10-20 minutes. If no newer commit appears and the Mac has been AFK for at least 10 minutes, it dispatches `deploy-ios.yml` for that exact SHA automatically.
4. The daily cap is 6 iOS TestFlight uploads total. After the cap is hit, Cartha Agent stops dispatching uploads for the day.

Install or repair the hooks:

```bash
./scripts/install_cartha_testflight_commit_hook.sh
```

Useful env overrides:

```bash
CARTHA_MOBILE_REPO="/path/to/cartha.ai.mobile"
CARTHA_TESTFLIGHT_USE_HERMES=0       # force heuristic-only proposals
CARTHA_TESTFLIGHT_CHANNEL=all        # opt back into iOS + Mac proposal prompts
CARTHA_TESTFLIGHT_BUBBLE=0           # disable the tiny Cartha Agent bubble
CARTHA_TESTFLIGHT_MAX_DAILY_UPLOADS=6
CARTHA_TESTFLIGHT_QUIET_MIN_SECONDS=600
CARTHA_TESTFLIGHT_QUIET_MAX_SECONDS=1200
CARTHA_TESTFLIGHT_AFK_SECONDS=600
CARTHA_TESTFLIGHT_HERMES_MODEL="deepseek/deepseek-v4-flash"
```

## Local LaunchAgent

The local LaunchAgent is installed at `~/Library/LaunchAgents/com.cartha.hermes-ui.plist` and runs `node server.mjs` on port 5128.

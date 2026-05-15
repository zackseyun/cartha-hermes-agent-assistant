# Cartha Hermes Local

A from-scratch local operator console for Zack's Hermes + Gemma experiments.

This is intentionally a thin console, not a full Open WebUI clone. The default
path is "ask Hermes to do real work with tools"; the Gemma path is kept for
local vision/model testing.

## Runtime

- UI: <http://127.0.0.1:5128>
- Default agent backend: Hermes API server at <http://127.0.0.1:8642/v1>
- Local vision/model backend: Ollama OpenAI-compatible API at <http://127.0.0.1:11434/v1>
- Small/swarm comparison backend: OpenRouter `deepseek/deepseek-v4-flash`
- Agent model: Hermes is configured to use OpenRouter `xiaomi/mimo-v2.5-pro`.
- Vision model: `gemma4:31b-hermes` via Ollama.
- Browser security: Hermes/OpenRouter keys are read server-side from `~/.hermes/.env`
  and are never exposed to browser JS.
- Native Hermes dashboard: <http://127.0.0.1:9119>
- Mature chat UI option: Open WebUI can connect to Hermes at `http://127.0.0.1:8642/v1`.

## Modes

- **Hermes agent mode**: default. Routes through Hermes Agent's API server for
  terminal/file/browser/memory/skills/tool use.
- **Gemma vision chat**: direct local Gemma 4 31B chat/vision path. Best for
  image understanding and local model testing, not agentic work.
- **DeepSeek small chat**: direct OpenRouter-hosted text path for smaller/swarm-style tasks. Useful for
  isolating whether a failure is Hermes/tooling vs model quality.

## Multimodal

- Vision: supported in the UI with image attachments.
- Audio: the installed `gemma4:31b` reports `completion`, `vision`, `tools`, and `thinking`, but not `audio`. Audio-awareness should be routed through local speech-to-text or the smaller Gemma 4 E4B audio-capable model, then handed to 31B for reasoning.

## MiMo V2.5 Pro notes

- Current default agent model: `xiaomi/mimo-v2.5-pro` on OpenRouter.
- Hermes config uses the model's 1M-token context (`model.context_length: 1048576`) with `model.max_tokens: 256` and a lean API-server toolset (`terminal`, `file`, `todo`) because the current OpenRouter credit balance rejects larger tool prompts/output reservations.
- MiMo is cloud-routed through OpenRouter here. Gemma 4 31B remains the local vision backend.

## Commands

```bash
npm start
npm run check
npm run smoke
```

## Apple upload approval gate

The console can now act as the local approval modal for scarce Apple upload
lanes. By default the local commit hook asks only about **iOS TestFlight**
(to avoid duplicate Apple prompts); run the watcher with `--channel all` or
`--channel macos_appstore` when Mac App Store proposals are wanted too.

1. Local Git hooks in `cartha.ai.mobile` run
   `scripts/testflight_proposal_watcher.mjs --commit <sha>` after commits,
   merges, rewrites, and main pushes.
2. Every commit gets a tiny top-right Cartha Agent bubble with **Deploy iOS**
   and **Skip** chips. It does not auto-focus and disappears if ignored.
3. If Zack ignores it, Cartha Agent waits a random 10-20 minutes. If no newer
   commit appears and the Mac has been AFK for at least 10 minutes, it
   dispatches `deploy-ios.yml` for that exact SHA automatically.
4. The daily cap is 6 iOS TestFlight uploads total. After the cap is hit,
   Cartha Agent stops dispatching uploads for the day.

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

## LaunchAgent

The local LaunchAgent is installed at `~/Library/LaunchAgents/com.cartha.hermes-ui.plist` and runs `node server.mjs` on port 5128.

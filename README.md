# Cartha Hermes Local

A from-scratch local operator console for Zack's Hermes + Gemma experiments.

This is intentionally a thin console, not a full Open WebUI clone. The default
path is "ask Hermes to do real work with tools"; the Gemma path is kept for
local vision/model testing.

## Runtime

- UI: <http://127.0.0.1:5128>
- Default agent backend: Hermes API server at <http://127.0.0.1:8642/v1>
- Local vision/model backend: Ollama OpenAI-compatible API at <http://127.0.0.1:11434/v1>
- Cloud work-agent comparison backend: OpenRouter `deepseek/deepseek-v4-flash`
- Agent model: Hermes is configured to use OpenRouter `deepseek/deepseek-v4-flash`.
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
- **DeepSeek chat**: direct OpenRouter-hosted text comparison path. Useful for
  isolating whether a failure is Hermes/tooling vs model quality.

## Multimodal

- Vision: supported in the UI with image attachments.
- Audio: the installed `gemma4:31b` reports `completion`, `vision`, `tools`, and `thinking`, but not `audio`. Audio-awareness should be routed through local speech-to-text or the smaller Gemma 4 E4B audio-capable model, then handed to 31B for reasoning.

## DeepSeek V4 Flash local quant notes

- Best Apple-Silicon quant found: `mlx-community/DeepSeek-V4-Flash-4bit` (MLX, 151 GB).
- Smallest GGUF path found: `batiai/DeepSeek-V4-Flash-GGUF:Q3_K_M` (127 GB, early access; notes say current Ollama/mainline llama.cpp compatibility is still moving).
- On a 128 GB Mac, those local quants are possible only at the edge of memory pressure. The safer proof path is OpenRouter first, then a deliberate local-quant benchmark if we want to spend the disk/time and accept swap risk.

## Commands

```bash
npm start
npm run check
npm run smoke
```

## LaunchAgent

The local LaunchAgent is installed at `~/Library/LaunchAgents/com.cartha.hermes-ui.plist` and runs `node server.mjs` on port 5128.

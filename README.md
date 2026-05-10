# Cartha Hermes Local

A from-scratch local UI for Zack's Gemma/Hermes experiments.

## Runtime

- UI: <http://127.0.0.1:5128>
- Fast default backend: local Ollama OpenAI-compatible API at <http://127.0.0.1:11434/v1>
- Agent harness backend: Hermes API server at <http://127.0.0.1:8642/v1>
- Cloud work-agent comparison backend: OpenRouter `deepseek/deepseek-v4-flash`
- Main model: `gemma4:31b-hermes` via Ollama, kept warm with a 65K context for Hermes compatibility.
- Browser security: the Hermes API key is read server-side from `~/.hermes/.env` (`API_SERVER_KEY`) and is never exposed to browser JS.

## Modes

- **Fast Gemma chat**: direct local Gemma 4 31B chat/vision path. This is the default and is best for interactive testing.
- **DeepSeek V4 Flash**: OpenRouter-hosted text/tool-work comparison path. Requires a valid `OPENROUTER_API_KEY`.
- **Hermes agent mode**: routes through Hermes Agent's API server for the full harness/tool loop. On Gemma 4 31B dense this can be much slower than the direct path.

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

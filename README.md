# Cartha Hermes Local

A from-scratch local UI for Zack's Hermes Agent harness, backed by local Ollama Qwen through Hermes' OpenAI-compatible API server.

## Runtime

- UI: <http://127.0.0.1:5128>
- Hermes API server: <http://127.0.0.1:8642/v1>
- Model: `qwen3.6:35b-hermes` via Ollama
- API key: read server-side from `~/.hermes/.env` (`API_SERVER_KEY`), never exposed to browser JS.

## Commands

```bash
npm start
npm run check
npm run smoke
```

## LaunchAgent

The local LaunchAgent is installed at `~/Library/LaunchAgents/com.cartha.hermes-ui.plist` and runs `node server.mjs` on port 5128.

# Stand up Hermes Local Agent Kit

## 1. Prerequisites

macOS is the primary target because this package ships launchd templates.

Install:

```bash
brew install git node python pnpm
```

Optional local vision runtime:

```bash
brew install ollama
ollama serve
ollama pull gemma4:31b
```

## 2. Clone and install

```bash
git clone https://github.com/zackseyun/hermes-local-agent-kit.git
cd hermes-local-agent-kit
npm install
node scripts/install.mjs --workspace-cwd "$HOME/Documents/GitHub"
```

If your repos live somewhere else, pass that directory to `--workspace-cwd`. That path becomes the default working directory for terminal/file tools.

## 3. Add provider credentials

Edit `~/.hermes/.env`:

```bash
OPENROUTER_API_KEY=sk-or-...
```

The installer creates the gateway token automatically:

```bash
grep '^API_SERVER_KEY=' ~/.hermes/.env
```

Do not commit this file.

## 4. Start or restart services

```bash
launchctl kickstart -k gui/$(id -u)/ai.hermes.gateway
launchctl kickstart -k gui/$(id -u)/dev.hermes.local-dashboard
launchctl kickstart -k gui/$(id -u)/dev.hermes.workspace
launchctl kickstart -k gui/$(id -u)/dev.hermes.local-console
```

## 5. Verify

```bash
curl -s http://127.0.0.1:8642/health/detailed | python3 -m json.tool
curl -s http://127.0.0.1:5128/api/status | python3 -m json.tool
npm run smoke
```

A good smoke test shows:

- gateway health is `ok`
- local console status is `ok`
- small OpenRouter model responds
- Hermes agent can use a terminal tool and return the configured cwd

## 6. Open the UIs

- <http://127.0.0.1:5128> — small local console and model/vision smoke tests
- <http://127.0.0.1:3000> — Hermes Workspace
- <http://127.0.0.1:9119> — native Hermes dashboard

## 7. Login to Hermes Workspace

The installer writes a generated password into `~/hermes-workspace/.env`:

```bash
grep '^HERMES_PASSWORD=' ~/hermes-workspace/.env | cut -d= -f2-
```

Use that password on `http://127.0.0.1:3000`.

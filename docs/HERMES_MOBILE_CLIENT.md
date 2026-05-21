# Hermes Mobile Client prototype

This prototype lets an iPhone app dispatch commands to the Mac-hosted Hermes stack and fetch low-rate Mac screen frames for operator visibility.

## Mac bridge

The mobile bridge is intentionally smaller than the full local console. It exposes only:

- `GET /health` — bridge status and LAN URLs.
- `POST /dispatch` — authenticated command dispatch.
- `GET /screen.jpg?width=1280` — authenticated one-shot Mac screen capture.

Commands require `Authorization: Bearer $HERMES_MOBILE_TOKEN`.

Dispatch modes:

- `task` — queue text through `~/.hermes/scripts/hermes-task.sh` as an iPhone-originated Hermes task.
- `clipboard` — copy text into the Mac clipboard.
- `paste` — copy text and send `⌘V` to the active Mac app via System Events.

`paste` requires macOS Accessibility permission for the Node/launchd process. `screen.jpg` requires Screen Recording permission.

## Setup

```bash
npm run mobile:configure
npm run mobile:install-launch-agent
curl -s http://127.0.0.1:5138/health | python3 -m json.tool
```

The configure command prints a token and LAN base URL to paste into the iPhone app.

## iPhone client

Open `ios/HermesClient/HermesClient.xcodeproj` in Xcode, set your signing team, then run on the iPhone 16 Pro Max.

The app currently supports:

- saving the Mac bridge URL + token locally,
- dispatching command text as a Hermes task, clipboard copy, or Mac paste,
- polling `/screen.jpg` as a simple screen-stream prototype,
- an App Shortcut / Action Button entry point that opens the client.

Local MLX Qwen dictation is the next layer: the client shell and dispatch channel are ready, and the ASR engine can be wired into the command box when the Swift/MLX Qwen path is ported.

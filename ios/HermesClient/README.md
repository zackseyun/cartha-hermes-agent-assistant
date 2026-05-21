# Hermes Client for iPhone

Local iPhone prototype for controlling the Mac-hosted Hermes stack.

## Run on iPhone

1. Start the Mac bridge:

   ```bash
   npm run mobile:configure
   npm run mobile:install-launch-agent
   ```

2. Open `HermesClient.xcodeproj` in Xcode.
3. Select the `HermesClient` target, set your Apple signing team, and run on the iPhone 16 Pro Max.
4. In the app, paste the LAN base URL and mobile token printed by `npm run mobile:configure`.
5. Set the iPhone Action Button to the `Hermes Client` App Shortcut in Settings.

## Current prototype

- Dispatch command text to Hermes as a queued task.
- Copy command text to the Mac clipboard.
- Paste command text into the active Mac app via macOS Accessibility.
- Poll the Mac screen as JPEG frames once Screen Recording is granted to the bridge process.

## Next layer

Wire local Swift/MLX Qwen3-ASR 0.6B into the command box so the Action Button opens a local dictation surface before dispatch.

## Fast local deploy

From the repo root, run:

```bash
npm run mobile:deploy-ios
```

The deploy helper reads `HERMES_MOBILE_TOKEN` from `~/.hermes/.env`, bakes the local bridge URL/token into the debug build Info.plist, installs the app on Zack's paired iPhone, and launches it when the phone is unlocked.

## Current UX

The client now opens as a full-screen Hermes remote:

- one large voice-dispatch button: tap once to listen, tap again to send to Hermes;
- simple Mac connection status with bundled local bridge defaults;
- manual command dispatch, paste-to-Mac, clipboard, and task modes;
- Mac screen preview/stream controls;
- app icon + launch screen metadata so it behaves like a real full-screen iPhone app.

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

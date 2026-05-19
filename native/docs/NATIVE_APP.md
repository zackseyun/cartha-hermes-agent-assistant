# Cartha Hermes Native Mac App

The native app is the new primary local surface for Hermes/Cartha.

- **Excellent app icon:** generated from `scripts/generate-native-icon.py` and bundled as `AppIcon.icns`.
- **Manual launch is visible:** opening `/Applications/Cartha Hermes.app` shows the full native panel and Swift bubble.
- **Login launch is quiet:** the LaunchAgent passes `--bubble-only`, so login starts only the non-focus-stealing top-right bubble.
- **Native lifecycle log:** app-level launch/reopen/deep-link events write to `~/.hermes/logs/hermes-native-app.log`.
- **Local-first model status:** the panel reads `~/.hermes/config.yaml` and shows the primary local Hermes model separately from optional OpenRouter fallbacks.
- **Swift bubble first:** launches as a non-focus-stealing top-right Swift bubble.
- **Native operator panel:** chat interface that talks to the existing local Hermes API at `127.0.0.1:5128` / gateway `127.0.0.1:8642`.
- **Workspace bridge:** embeds the current Hermes Workspace (`127.0.0.1:3000`) inside the Mac app so we can progressively port capabilities to native Swift.
- **Wake controls:** reads/toggles the existing `Hey Cartha` listener through `~/.hermes/scripts/cartha-voice-toggle.sh`.
- **Apple upload approvals:** surfaces pending TestFlight/App Store proposals in a native tab; future prompts should use Swift bubbles by default.

Build, install, and open:

```bash
./scripts/build-native-app.sh
./scripts/install-native-launch-agent.sh
./scripts/open-native-app.sh
```

Bundle paths:

```text
native/dist/Cartha Hermes.app      # reproducible build output
/Applications/Cartha Hermes.app    # installed user-facing app
```

The LaunchAgent opens `/Applications/Cartha Hermes.app`. The old web console remains as a fallback/API daemon only.

Native deep links:

```text
cartha-hermes://panel
cartha-hermes://bubble
cartha-hermes://workspace
cartha-hermes://approvals
cartha-hermes://sessions
cartha-hermes://wake
```

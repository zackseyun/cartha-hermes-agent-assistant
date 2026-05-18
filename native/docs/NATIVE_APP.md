# Cartha Hermes Native Mac App

The native app is the new primary local surface for Hermes/Cartha.

- **Swift bubble first:** launches as a non-focus-stealing top-right Swift bubble.
- **Native operator panel:** chat interface that talks to the existing local Hermes API at `127.0.0.1:5128` / gateway `127.0.0.1:8642`.
- **Workspace bridge:** embeds the current Hermes Workspace (`127.0.0.1:3000`) inside the Mac app so we can progressively port capabilities to native Swift.
- **Wake controls:** reads/toggles the existing `Hey Cartha` listener through `~/.hermes/scripts/cartha-voice-toggle.sh`.
- **Apple upload approvals:** surfaces pending TestFlight/App Store proposals in a native tab; future prompts should use Swift bubbles by default.

Build and open:

```bash
./scripts/build-native-app.sh
./scripts/open-native-app.sh
```

Output bundle:

```text
native/dist/Cartha Hermes.app
```

The old web console remains as a fallback only.

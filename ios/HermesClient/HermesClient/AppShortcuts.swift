import AppIntents

struct OpenHermesClientIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Hermes Client"
    static let description = IntentDescription("Open the Hermes iPhone client for local Qwen dictation and Mac command dispatch.")
    static let openAppWhenRun = true

    func perform() async throws -> some IntentResult {
        .result()
    }
}

struct HermesClientShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: OpenHermesClientIntent(),
            phrases: [
                "Open \(.applicationName)",
                "Start Hermes Dictation in \(.applicationName)",
                "Dispatch to Hermes with \(.applicationName)"
            ],
            shortTitle: "Hermes Client",
            systemImageName: "sparkles"
        )
    }
}

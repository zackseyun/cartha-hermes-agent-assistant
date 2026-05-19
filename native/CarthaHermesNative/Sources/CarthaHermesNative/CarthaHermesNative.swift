import AppKit
import Combine
import Foundation
import SwiftUI
import WebKit

enum NativeLog {
    static private var url: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".hermes/logs/hermes-native-app.log")
    }

    static func write(_ message: String) {
        let line = "[\(ISO8601DateFormatter().string(from: Date()))] \(message)\n"
        guard let data = line.data(using: .utf8) else { return }
        let directory = url.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        if FileManager.default.fileExists(atPath: url.path),
           let handle = try? FileHandle(forWritingTo: url) {
            _ = try? handle.seekToEnd()
            handle.write(data)
            try? handle.close()
        } else {
            try? data.write(to: url, options: .atomic)
        }
    }
}

// MARK: - Models

struct HermesStatus: Decodable {
    let ok: Bool?
    let backend: String?
    let hermesGateway: String?
    let agentStatus: String?
    let gemmaStatus: String?
    let model: String?
    let agentModel: String?
    let smallModel: String?
    let hermesModel: String?
    let creditRemainingUsd: Double?
    let latencyMs: Int?
}

struct WakeStatus: Decodable {
    let ok: Bool?
    let active: Bool?
    let listenerRunning: Bool?
    let launchdRunning: Bool?
    let whisperRunning: Bool?
    let wakePrompt: String?
    let toggleText: String?
    let guardrails: [String]?
}

struct ProposalResponse: Decodable {
    let ok: Bool?
    let proposals: [UploadProposal]
}

struct SessionResponse: Decodable {
    let ok: Bool?
    let sessionsDir: String?
    let sessionCount: Int?
    let activeSessionCount: Int?
    let sessions: [HermesSession]
}

struct HermesSession: Identifiable, Decodable {
    let id: String
    let file: String?
    let path: String?
    let kind: String?
    let model: String?
    let platform: String?
    let title: String?
    let last_user: String?
    let last_assistant: String?
    let message_count: Int?
    let updated_at: String?
}

struct UploadProposal: Identifiable, Decodable {
    let id: String
    let short_sha: String?
    let channel_label: String?
    let subject: String?
    let recommendation: String?
    let reason: String?
    let status: String?
    let changed_files: [String]?
    let created_at: String?
}

struct ChatMessage: Identifiable, Equatable {
    let id = UUID()
    let role: String
    var content: String
}

enum NativeTab: String, Hashable {
    case operatorChat
    case workspace
    case approvals
    case sessions
    case wake
}

struct WireMessage: Encodable {
    let role: String
    let content: String
}

struct ChatRequest: Encodable {
    let backend: String
    let messages: [WireMessage]
}

struct ServerError: Decodable {
    let error: String?
    let detail: String?
}

// MARK: - Service

@MainActor
final class HermesService: ObservableObject {
    @Published var status: HermesStatus?
    @Published var wake: WakeStatus?
    @Published var proposals: [UploadProposal] = []
    @Published var sessions: [HermesSession] = []
    @Published var sessionCount = 0
    @Published var activeSessionCount = 0
    @Published var selectedTab: NativeTab = .operatorChat
    @Published var messages: [ChatMessage] = [
        ChatMessage(role: "system", content: "Cartha Hermes native shell is ready. This window talks to the local Hermes stack and keeps the Swift bubble as the primary surface.")
    ]
    @Published var isSending = false
    @Published var lastError: String?

    let baseURL = URL(string: "http://127.0.0.1:5128")!
    let workspaceURL = URL(string: "http://127.0.0.1:3000")!

    var gatewaySummary: String {
        let gateway = status?.hermesGateway ?? "unknown"
        let local = status?.gemmaStatus ?? "unknown"
        let model = status?.model ?? "local model"
        return "Hermes gateway \(gateway) · \(local) · \(model)"
    }

    var wakeSummary: String {
        guard let wake else { return "Wake status unknown" }
        let prompt = wake.wakePrompt ?? "hey cartha"
        if wake.active == true {
            return "Active — “\(prompt)”"
        }
        return "Muted — Alfred/manual tasks still work"
    }

    var pendingProposals: [UploadProposal] {
        proposals.filter { $0.status == "pending" }
    }

    func refreshAll() async {
        async let a: Void = refreshStatus()
        async let b: Void = refreshWake()
        async let c: Void = refreshProposals()
        async let d: Void = refreshSessions()
        _ = await (a, b, c, d)
    }

    func refreshStatus() async {
        do {
            status = try await getJSON(HermesStatus.self, path: "/api/status")
            lastError = nil
        } catch {
            lastError = "Status: \(error.localizedDescription)"
        }
    }

    func refreshWake() async {
        do {
            wake = try await getJSON(WakeStatus.self, path: "/api/wake-status")
            lastError = nil
        } catch {
            lastError = "Wake: \(error.localizedDescription)"
        }
    }

    func refreshProposals() async {
        do {
            let response = try await getJSON(ProposalResponse.self, path: "/api/testflight/proposals")
            proposals = response.proposals
            lastError = nil
        } catch {
            lastError = "Approvals: \(error.localizedDescription)"
        }
    }

    func refreshSessions() async {
        do {
            let response = try await getJSON(SessionResponse.self, path: "/api/sessions")
            sessions = response.sessions
            sessionCount = response.sessionCount ?? response.sessions.count
            activeSessionCount = response.activeSessionCount ?? 0
            lastError = nil
        } catch {
            lastError = "Sessions: \(error.localizedDescription)"
        }
    }

    func send(_ text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isSending else { return }
        messages.append(ChatMessage(role: "user", content: trimmed))
        messages.append(ChatMessage(role: "assistant", content: "Thinking locally…"))
        let assistantIndex = messages.count - 1
        isSending = true
        defer { isSending = false }

        do {
            var request = URLRequest(url: baseURL.appendingPathComponent("/api/chat"))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let history = messages
                .filter { $0.role == "user" || $0.role == "assistant" }
                .dropLast()
                .suffix(12)
                .map { WireMessage(role: $0.role, content: $0.content) }
            let body = ChatRequest(backend: "hermes", messages: Array(history) + [WireMessage(role: "user", content: trimmed)])
            request.httpBody = try JSONEncoder().encode(body)
            let (data, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
                let serverError = try? JSONDecoder().decode(ServerError.self, from: data)
                throw NSError(
                    domain: "CarthaHermesNative",
                    code: http.statusCode,
                    userInfo: [NSLocalizedDescriptionKey: serverError?.detail ?? serverError?.error ?? "HTTP \(http.statusCode)"]
                )
            }
            let raw = String(data: data, encoding: .utf8) ?? ""
            let reply = Self.parseStreamingReply(raw)
            messages[assistantIndex].content = reply.isEmpty ? "Hermes responded without visible text." : reply
            lastError = nil
        } catch {
            messages[assistantIndex].content = "⚠️ \(error.localizedDescription)"
            lastError = error.localizedDescription
        }
    }

    func setWake(_ mode: String) async {
        do {
            _ = try await runScript(path: NSHomeDirectory() + "/.hermes/scripts/cartha-voice-toggle.sh", arguments: [mode])
            await refreshWake()
        } catch {
            lastError = "Wake toggle: \(error.localizedDescription)"
        }
    }

    func actOnProposal(_ proposal: UploadProposal, action: String) async {
        do {
            var request = URLRequest(url: baseURL.appendingPathComponent("/api/testflight/proposals/\(proposal.id)/\(action)"))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = Data("{}".utf8)
            let (data, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
                let serverError = try? JSONDecoder().decode(ServerError.self, from: data)
                throw NSError(domain: "CarthaHermesNative", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: serverError?.detail ?? serverError?.error ?? "HTTP \(http.statusCode)"])
            }
            await refreshProposals()
        } catch {
            lastError = "Approval: \(error.localizedDescription)"
        }
    }

    func openWebConsole() {
        NSWorkspace.shared.open(baseURL)
    }

    func openWorkspaceExternal() {
        NSWorkspace.shared.open(workspaceURL)
    }

    private func getJSON<T: Decodable>(_ type: T.Type, path: String) async throws -> T {
        let (data, _) = try await URLSession.shared.data(from: baseURL.appendingPathComponent(path))
        return try JSONDecoder().decode(type, from: data)
    }

    private func runScript(path: String, arguments: [String]) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let process = Process()
                process.executableURL = URL(fileURLWithPath: path)
                process.arguments = arguments
                let pipe = Pipe()
                process.standardOutput = pipe
                process.standardError = pipe
                do {
                    try process.run()
                    process.waitUntilExit()
                    let data = pipe.fileHandleForReading.readDataToEndOfFile()
                    let output = String(data: data, encoding: .utf8) ?? ""
                    if process.terminationStatus == 0 {
                        continuation.resume(returning: output)
                    } else {
                        continuation.resume(throwing: NSError(domain: "CarthaHermesNative", code: Int(process.terminationStatus), userInfo: [NSLocalizedDescriptionKey: output]))
                    }
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    static func parseStreamingReply(_ raw: String) -> String {
        var result = ""
        for rawLine in raw.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            guard line.hasPrefix("data:") else { continue }
            let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
            guard payload != "[DONE]", let data = payload.data(using: .utf8) else { continue }
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let choices = json["choices"] as? [[String: Any]],
               let first = choices.first {
                if let delta = first["delta"] as? [String: Any], let content = delta["content"] as? String {
                    result += content
                } else if let message = first["message"] as? [String: Any], let content = message["content"] as? String {
                    result += content
                } else if let text = first["text"] as? String {
                    result += text
                }
            }
        }
        if result.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           let data = raw.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let choices = json["choices"] as? [[String: Any]],
           let content = (choices.first?["message"] as? [String: Any])?["content"] as? String {
            return content
        }
        return result.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

// MARK: - Views

struct BubbleView: View {
    @ObservedObject var service: HermesService
    let openPanel: () -> Void
    let refresh: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                ZStack {
                    Circle().fill(LinearGradient(colors: [.cyan, .mint], startPoint: .topLeading, endPoint: .bottomTrailing))
                    Image(systemName: "sparkles").font(.system(size: 15, weight: .bold)).foregroundStyle(.black.opacity(0.78))
                }
                .frame(width: 34, height: 34)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Cartha Hermes")
                        .font(.system(size: 15, weight: .black, design: .rounded))
                    Text(service.wakeSummary)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                statusPill
            }

            Text(service.gatewaySummary)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.secondary)
                .lineLimit(2)

            if !service.pendingProposals.isEmpty {
                Text("\(service.pendingProposals.count) Apple upload decision\(service.pendingProposals.count == 1 ? "" : "s") pending")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.orange)
            }

            HStack(spacing: 8) {
                Button("Ask") { openPanel() }
                    .buttonStyle(.borderedProminent)
                Button(service.wake?.active == true ? "Mute wake" : "Wake on") {
                    Task { await service.setWake(service.wake?.active == true ? "off" : "on") }
                }
                .buttonStyle(.bordered)
                Button(action: refresh) { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(.borderless)
            }
        }
        .padding(16)
        .frame(width: 390)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(.cyan.opacity(0.22), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.32), radius: 28, x: 0, y: 16)
    }

    private var statusPill: some View {
        let online = service.status?.hermesGateway == "online"
        return HStack(spacing: 5) {
            Circle().fill(online ? Color.green : Color.orange).frame(width: 7, height: 7)
            Text(online ? "local" : "check")
                .font(.system(size: 10, weight: .black))
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(.black.opacity(0.18), in: Capsule())
    }
}

struct OperatorView: View {
    @ObservedObject var service: HermesService
    @State private var prompt = ""

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(service.messages) { message in
                            MessageBubble(message: message)
                                .id(message.id)
                        }
                    }
                    .padding(18)
                }
                .onChange(of: service.messages) { _ in
                    if let last = service.messages.last?.id {
                        proxy.scrollTo(last, anchor: .bottom)
                    }
                }
            }
            Divider()
            HStack(alignment: .bottom, spacing: 10) {
                TextField("Ask Hermes to do something…", text: $prompt, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...4)
                    .onSubmit { send() }
                Button(service.isSending ? "Thinking…" : "Send") { send() }
                    .disabled(service.isSending || prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .keyboardShortcut(.return, modifiers: [.command])
            }
            .padding(14)
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "sparkles.rectangle.stack.fill")
                .font(.title2)
                .foregroundStyle(.cyan)
            VStack(alignment: .leading, spacing: 3) {
                Text("Native Hermes Operator")
                    .font(.headline)
                Text(service.gatewaySummary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Refresh") { Task { await service.refreshAll() } }
            Button("Web fallback") { service.openWebConsole() }
        }
        .padding(14)
    }

    private func send() {
        let text = prompt
        prompt = ""
        Task { await service.send(text) }
    }
}

struct MessageBubble: View {
    let message: ChatMessage
    var body: some View {
        HStack {
            if message.role == "user" { Spacer(minLength: 40) }
            Text(message.content)
                .font(.system(size: 13.5))
                .textSelection(.enabled)
                .padding(12)
                .background(background, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(.white.opacity(0.08)))
            if message.role != "user" { Spacer(minLength: 40) }
        }
    }

    private var background: Color {
        switch message.role {
        case "user": return .cyan.opacity(0.22)
        case "system": return .purple.opacity(0.16)
        default: return .white.opacity(0.08)
        }
    }
}

struct WakeView: View {
    @ObservedObject var service: HermesService

    var body: some View {
        Form {
            Section("Wake phrase") {
                Text(service.wakeSummary)
                HStack {
                    Button("Turn on") { Task { await service.setWake("on") } }
                    Button("Mute") { Task { await service.setWake("off") } }
                    Button("Toggle") { Task { await service.setWake("toggle") } }
                    Button("Refresh") { Task { await service.refreshWake() } }
                }
            }
            Section("Guardrails") {
                ForEach(service.wake?.guardrails ?? [], id: \.self) { item in
                    Label(item, systemImage: "checkmark.shield")
                }
            }
        }
        .padding()
    }
}

struct SessionsView: View {
    @ObservedObject var service: HermesService

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading) {
                    Text("Hermes sessions")
                        .font(.title3.bold())
                    Text("\(service.sessionCount) total · \(service.activeSessionCount) active")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Refresh") { Task { await service.refreshSessions() } }
            }
            List(service.sessions) { session in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(session.title ?? session.id)
                            .font(.headline)
                            .lineLimit(1)
                        Spacer()
                        Text(session.kind ?? "session")
                            .font(.caption.bold())
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .background(.white.opacity(0.08), in: Capsule())
                    }
                    HStack(spacing: 10) {
                        Text(session.model ?? "unknown model")
                        Text(session.platform ?? "local")
                        Text("\(session.message_count ?? 0) messages")
                    }
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    if let last = session.last_assistant, !last.isEmpty {
                        Text(last)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    } else if let last = session.last_user, !last.isEmpty {
                        Text(last)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                    HStack {
                        Button("Open JSON") {
                            if let path = session.path {
                                NSWorkspace.shared.open(URL(fileURLWithPath: path))
                            }
                        }
                        .disabled(session.path == nil)
                        Button("Open web session") {
                            if let file = session.file {
                                var components = URLComponents(url: service.baseURL, resolvingAgainstBaseURL: false)
                                components?.queryItems = [URLQueryItem(name: "session", value: file)]
                                components?.fragment = "canvas"
                                if let url = components?.url { NSWorkspace.shared.open(url) }
                            }
                        }
                        .disabled(session.file == nil)
                    }
                }
                .padding(.vertical, 8)
            }
        }
        .padding()
    }
}

struct ApprovalsView: View {
    @ObservedObject var service: HermesService

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Apple upload approvals")
                    .font(.title3.bold())
                Spacer()
                Button("Refresh") { Task { await service.refreshProposals() } }
            }
            if service.pendingProposals.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "checkmark.circle")
                        .font(.system(size: 44))
                        .foregroundStyle(.green)
                    Text("No pending upload decisions")
                        .font(.headline)
                    Text("Hermes will surface future TestFlight/App Store choices here as native Swift prompts.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(service.pendingProposals) { proposal in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(proposal.channel_label ?? "Apple upload")
                                .font(.headline)
                            Text(proposal.short_sha ?? "")
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text(proposal.recommendation ?? "hold")
                                .font(.caption.bold())
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(.orange.opacity(0.16), in: Capsule())
                        }
                        Text(proposal.subject ?? "Untitled commit").font(.subheadline.bold())
                        Text(proposal.reason ?? "No reason recorded.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        HStack {
                            Button("Yes, upload") { Task { await service.actOnProposal(proposal, action: "approve") } }
                                .buttonStyle(.borderedProminent)
                            Button("No, skip") { Task { await service.actOnProposal(proposal, action: "skip") } }
                        }
                    }
                    .padding(.vertical, 8)
                }
            }
        }
        .padding()
    }
}

struct WorkspaceWebView: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}
}

struct MainPanelView: View {
    @ObservedObject var service: HermesService

    var body: some View {
        TabView(selection: $service.selectedTab) {
            OperatorView(service: service)
                .tabItem { Label("Operator", systemImage: "sparkles") }
                .tag(NativeTab.operatorChat)
            WorkspaceWebView(url: service.workspaceURL)
                .tabItem { Label("Workspace", systemImage: "rectangle.3.group") }
                .tag(NativeTab.workspace)
            ApprovalsView(service: service)
                .tabItem { Label("Approvals", systemImage: "checkmark.seal") }
                .tag(NativeTab.approvals)
            SessionsView(service: service)
                .tabItem { Label("Sessions", systemImage: "clock.arrow.circlepath") }
                .tag(NativeTab.sessions)
            WakeView(service: service)
                .tabItem { Label("Wake", systemImage: "waveform") }
                .tag(NativeTab.wake)
        }
        .frame(minWidth: 900, minHeight: 620)
    }
}

// MARK: - Windowing

@MainActor
final class NativeBubbleController {
    private var panel: NSPanel?
    private let service: HermesService
    private let openPanel: () -> Void

    init(service: HermesService, openPanel: @escaping () -> Void) {
        self.service = service
        self.openPanel = openPanel
    }

    func show() {
        if let panel {
            panel.orderFrontRegardless()
            position(panel)
            return
        }
        let view = BubbleView(
            service: service,
            openPanel: openPanel,
            refresh: { [weak service] in Task { await service?.refreshAll() } }
        )
        let host = NSHostingController(rootView: view)
        let size = NSSize(width: 390, height: 182)
        let panel = NSPanel(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]
        panel.ignoresMouseEvents = false
        panel.contentViewController = host
        self.panel = panel
        position(panel)
        panel.orderFrontRegardless()
    }

    func hide() {
        panel?.orderOut(nil)
    }

    private func position(_ panel: NSPanel) {
        let frame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let size = panel.frame.size
        panel.setFrame(NSRect(x: frame.maxX - size.width - 28, y: frame.maxY - size.height - 28, width: size.width, height: size.height), display: true)
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let service = HermesService()
    private var statusItem: NSStatusItem?
    private var bubble: NativeBubbleController?
    private var mainWindow: NSWindow?

    private var bubbleOnlyLaunch: Bool {
        CommandLine.arguments.contains("--bubble-only") || CommandLine.arguments.contains("--login-item")
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Manual launches from /Applications should visibly open the Mac app.
        // Login/LaunchAgent starts pass --bubble-only and stay out of the Dock.
        NSApp.setActivationPolicy(bubbleOnlyLaunch ? .accessory : .regular)
        NativeLog.write("launch mode=\(bubbleOnlyLaunch ? "bubble-only" : "visible") args=\(CommandLine.arguments.joined(separator: " "))")
        buildMenuBar()
        bubble = NativeBubbleController(service: service) { [weak self] in self?.showMainWindow() }
        bubble?.show()
        if !bubbleOnlyLaunch {
            showMainWindow()
        }
        Task { await service.refreshAll() }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            handleDeepLink(url)
        }
    }

    private func handleDeepLink(_ url: URL) {
        let command = (url.host?.isEmpty == false ? url.host : url.pathComponents.dropFirst().first) ?? "panel"
        NativeLog.write("deep-link command=\(command) url=\(url.absoluteString)")
        switch command.lowercased() {
        case "bubble":
            bubble?.show()
        case "workspace":
            service.selectedTab = .workspace
            showMainWindow()
        case "approvals", "approval":
            service.selectedTab = .approvals
            showMainWindow()
        case "sessions", "session":
            service.selectedTab = .sessions
            showMainWindow()
        case "wake", "voice":
            service.selectedTab = .wake
            showMainWindow()
        default:
            service.selectedTab = .operatorChat
            showMainWindow()
        }
    }

    private func buildMenuBar() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.image = NSImage(systemSymbolName: "sparkles", accessibilityDescription: "Cartha Hermes")
        item.button?.title = " Hermes"
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Open Hermes Panel", action: #selector(showMainWindowMenu), keyEquivalent: "h"))
        menu.addItem(NSMenuItem(title: "Show Swift Bubble", action: #selector(showBubbleMenu), keyEquivalent: "b"))
        menu.addItem(NSMenuItem(title: "Refresh Status", action: #selector(refreshMenu), keyEquivalent: "r"))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Open Web Console Fallback", action: #selector(openWebFallbackMenu), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Open Workspace in Browser", action: #selector(openWorkspaceMenu), keyEquivalent: ""))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q"))
        for menuItem in menu.items { menuItem.target = self }
        item.menu = menu
        statusItem = item
    }

    @objc private func showMainWindowMenu() {
        service.selectedTab = .operatorChat
        showMainWindow()
    }
    @objc private func showBubbleMenu() { bubble?.show() }
    @objc private func refreshMenu() { Task { await service.refreshAll() } }
    @objc private func openWebFallbackMenu() { service.openWebConsole() }
    @objc private func openWorkspaceMenu() { service.openWorkspaceExternal() }
    @objc private func quit() { NSApp.terminate(nil) }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        // If the login item is already running in bubble-only mode and the user
        // opens the app from /Applications, promote it into a visible Mac app.
        NSApp.setActivationPolicy(.regular)
        NativeLog.write("reopen visibleWindows=\(flag)")
        showMainWindow()
        return true
    }

    func showMainWindow() {
        if mainWindow == nil {
            NativeLog.write("create-main-window")
            let content = MainPanelView(service: service)
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 980, height: 680), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            window.title = "Cartha Hermes"
            window.center()
            window.contentView = NSHostingView(rootView: content)
            mainWindow = window
        }
        NSApp.activate(ignoringOtherApps: true)
        mainWindow?.makeKeyAndOrderFront(nil)
    }
}

@main
struct CarthaHermesNativeApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        Settings { EmptyView() }
    }
}

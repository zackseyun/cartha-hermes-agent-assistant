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

enum OperatorSound {
    private static let enabledKey = "cartha.operator.sounds.enabled"

    static var isEnabled: Bool {
        UserDefaults.standard.object(forKey: enabledKey) == nil || UserDefaults.standard.bool(forKey: enabledKey)
    }

    static func setEnabled(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: enabledKey)
    }

    static func play(_ name: String, haptic: NSHapticFeedbackManager.FeedbackPattern = .alignment) {
        guard isEnabled else { return }
        NSSound(named: NSSound.Name(name))?.play()
        NSHapticFeedbackManager.defaultPerformer.perform(haptic, performanceTime: .now)
    }

    static func navigate() { play("Tink", haptic: .alignment) }
    static func send() { play("Pop", haptic: .alignment) }
    static func receive() { play("Glass", haptic: .levelChange) }
    static func success() { play("Hero", haptic: .generic) }
    static func warning() { play("Funk", haptic: .generic) }
}

// MARK: - Models

struct HermesStatus: Decodable {
    let ok: Bool?
    let backend: String?
    let hermesGateway: String?
    let agentStatus: String?
    let gemmaStatus: String?
    let model: String?
    let localAgentModel: String?
    let agentModel: String?
    let smallModel: String?
    let hermesModel: String?
    let creditRemainingUsd: Double?
    let latencyMs: Int?
    let status: Int?
    let sample: String?
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
    let activeWork: ActiveWork?
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
    let started_at: String?
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

struct ActiveWork: Decodable {
    let pendingAppleUploads: Int?
    let pendingAppleUploadLabels: [String]?
    let recentTasks: [ActiveTask]?
    let heartbeatLines: [String]?
}

struct ActiveTask: Identifiable, Decodable {
    let id: String?
    let ts: String?
    let source: String?
    let mode: String?
    let title: String?
    let text: String?

    var safeID: String { id?.isEmpty == false ? id! : UUID().uuidString }
}

struct PolicySummary: Decodable {
    let enabled: Bool?
    let phase: String?
    let maxSteps: Int?
    let maxTotalSeconds: Int?
    let allowedRoots: [String]?
    let note: String?
    let approvals: [String]?
}

struct ToolCapability: Identifiable, Decodable {
    let id: String
    let label: String
    let status: String?
    let detail: String?
    let ready: Bool?
    let icon: String?
}

struct HarnessTask: Identifiable, Decodable {
    let id: String
    let title: String?
    let summary: String?
    let status: String?
    let source: String?
    let mode: String?
    let kind: String?
    let createdAt: String?
    let updatedAt: String?
    let detail: String?
    let sessionId: String?
    let sessionFile: String?
    let sessionPath: String?
}

struct TaskResponse: Decodable {
    let ok: Bool?
    let tasks: [HarnessTask]
}

struct TaskHistoryMessage: Identifiable, Decodable {
    let index: Int
    let role: String
    let content: String
    let name: String?
    let createdAt: String?
    let truncated: Bool?

    var id: String { "\(index)-\(role)-\(name ?? "")" }

    enum CodingKeys: String, CodingKey {
        case index
        case role
        case content
        case name
        case createdAt = "created_at"
        case truncated
    }
}

struct TaskHistoryResponse: Decodable {
    let ok: Bool?
    let task: HarnessTask?
    let session: HermesSession?
    let messages: [TaskHistoryMessage]
    let omitted: Int?
    let note: String?
}

struct OperatorOverview: Decodable {
    let ok: Bool?
    let generatedAt: String?
    let status: HermesStatus?
    let wake: WakeStatus?
    let proposals: [UploadProposal]?
    let sessions: [HermesSession]?
    let tasks: [HarnessTask]?
    let tools: [ToolCapability]?
    let policy: PolicySummary?
    let activeWork: ActiveWork?
}

struct TaskSubmitRequest: Encodable {
    let task: String
    let title: String
    let source: String
    let mode: String
}

struct TaskSubmitResponse: Decodable {
    let ok: Bool?
    let id: String?
    let status: String?
    let message: String?
    let task: HarnessTask?
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

struct ChatMessage: Identifiable, Equatable {
    let id = UUID()
    let role: String
    var content: String
}

enum NativeTab: String, CaseIterable, Hashable {
    case now
    case operatorChat
    case tasks
    case approvals
    case sessions
    case wake
    case workspace

    var title: String {
        switch self {
        case .now: return "Now"
        case .operatorChat: return "Ask"
        case .tasks: return "Tasks"
        case .approvals: return "Approvals"
        case .sessions: return "Sessions"
        case .wake: return "Voice"
        case .workspace: return "Workspace"
        }
    }

    var subtitle: String {
        switch self {
        case .now: return "Live operator cockpit"
        case .operatorChat: return "Chat or launch durable work"
        case .tasks: return "Queued, running, blocked, and completed work"
        case .approvals: return "Apple upload gates"
        case .sessions: return "Recent Hermes conversations"
        case .wake: return "Hey Cartha listener and guardrails"
        case .workspace: return "Embedded fallback bridge"
        }
    }

    var icon: String {
        switch self {
        case .now: return "sparkles.rectangle.stack"
        case .operatorChat: return "text.bubble"
        case .tasks: return "checklist"
        case .approvals: return "checkmark.seal"
        case .sessions: return "clock.arrow.circlepath"
        case .wake: return "waveform"
        case .workspace: return "rectangle.3.group"
        }
    }
}

enum ComposerMode: String, CaseIterable, Hashable {
    case ask = "Ask"
    case task = "Run Task"
}

// MARK: - Service

@MainActor
final class HermesService: ObservableObject {
    @Published var overview: OperatorOverview?
    @Published var status: HermesStatus?
    @Published var wake: WakeStatus?
    @Published var proposals: [UploadProposal] = []
    @Published var sessions: [HermesSession] = []
    @Published var tasks: [HarnessTask] = []
    @Published var tools: [ToolCapability] = []
    @Published var policy: PolicySummary?
    @Published var activeWork: ActiveWork?
    @Published var sessionCount = 0
    @Published var activeSessionCount = 0
    @Published var selectedTab: NativeTab = .now
    @Published var selectedTaskForHistory: HarnessTask?
    @Published var taskHistory: TaskHistoryResponse?
    @Published var isLoadingTaskHistory = false
    @Published var taskHistoryError: String?
    @Published var messages: [ChatMessage] = [
        ChatMessage(role: "system", content: "Cartha Operator is ready. Ask a quick question, or switch the composer to Run Task for durable agent work.")
    ]
    @Published var isSending = false
    @Published var isSubmittingTask = false
    @Published var lastError: String?

    let baseURL = URL(string: "http://127.0.0.1:5128")!
    let workspaceURL = URL(string: "http://127.0.0.1:3000")!

    var pendingProposals: [UploadProposal] { proposals.filter { $0.status == "pending" } }
    var runningTasks: [HarnessTask] { tasks.filter { ["queued", "running", "needs_approval"].contains($0.status ?? "") } }
    var blockedTasks: [HarnessTask] { tasks.filter { $0.status == "blocked" } }

    var gatewaySummary: String {
        let gateway = status?.hermesGateway ?? "unknown"
        let local = status?.gemmaStatus ?? "unknown"
        let primary = status?.localAgentModel ?? status?.hermesModel ?? "local agent"
        return "Gateway \(gateway) · \(primary) · \(local)"
    }

    var wakeSummary: String {
        guard let wake else { return "Wake status unknown" }
        let prompt = wake.wakePrompt ?? "hey cartha"
        return wake.active == true ? "Listening for “\(prompt)”" : "Wake muted · manual tasks still work"
    }

    var isStackReady: Bool {
        status?.ok == true || status?.hermesGateway == "online" || status?.gemmaStatus == "ollama online"
    }

    func refreshAll() async {
        await refreshOverview()
    }

    func refreshOverview() async {
        do {
            let payload = try await getJSON(OperatorOverview.self, path: "/api/operator/overview")
            overview = payload
            status = payload.status
            wake = payload.wake
            proposals = payload.proposals ?? []
            sessions = payload.sessions ?? []
            tasks = payload.tasks ?? []
            tools = payload.tools ?? []
            policy = payload.policy
            activeWork = payload.activeWork
            sessionCount = sessions.count
            activeSessionCount = sessions.filter { session in
                guard let updated = parseDate(session.updated_at) else { return false }
                return abs(updated.timeIntervalSinceNow) < 3 * 60 * 60
            }.count
            lastError = nil
        } catch {
            lastError = "Overview: \(error.localizedDescription)"
        }
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
            activeWork = response.activeWork
            lastError = nil
        } catch {
            lastError = "Sessions: \(error.localizedDescription)"
        }
    }

    func refreshTasks() async {
        do {
            let response = try await getJSON(TaskResponse.self, path: "/api/operator/tasks")
            tasks = response.tasks
            lastError = nil
        } catch {
            lastError = "Tasks: \(error.localizedDescription)"
        }
    }

    func openTaskHistory(_ task: HarnessTask) async {
        selectedTaskForHistory = task
        taskHistory = nil
        taskHistoryError = nil
        isLoadingTaskHistory = true
        defer { isLoadingTaskHistory = false }
        do {
            let response = try await getJSON(
                TaskHistoryResponse.self,
                url: endpoint("/api/operator/task-history", queryItems: [URLQueryItem(name: "id", value: task.id)])
            )
            taskHistory = response
            taskHistoryError = nil
        } catch {
            taskHistoryError = error.localizedDescription
            lastError = "Task history: \(error.localizedDescription)"
        }
    }

    func clearTaskHistory() {
        selectedTaskForHistory = nil
        taskHistory = nil
        taskHistoryError = nil
        isLoadingTaskHistory = false
    }

    func send(_ text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isSending else { return }
        OperatorSound.send()
        messages.append(ChatMessage(role: "user", content: trimmed))
        messages.append(ChatMessage(role: "assistant", content: "Thinking locally…"))
        let assistantIndex = messages.count - 1
        isSending = true
        defer { isSending = false }

        do {
            var request = URLRequest(url: endpoint("/api/chat"))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let history = messages
                .filter { $0.role == "user" || $0.role == "assistant" }
                .dropLast()
                .suffix(12)
                .map { WireMessage(role: $0.role, content: $0.content) }
            let body = ChatRequest(backend: "hermes", messages: Array(history) + [WireMessage(role: "user", content: trimmed)])
            request.httpBody = try JSONEncoder().encode(body)
            request.timeoutInterval = 120
            let (bytes, response) = try await URLSession.shared.bytes(for: request)
            if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
                var errorBody = ""
                for try await line in bytes.lines {
                    errorBody += line
                }
                let data = Data(errorBody.utf8)
                let serverError = try? JSONDecoder().decode(ServerError.self, from: data)
                throw NSError(
                    domain: "CarthaHermesNative",
                    code: http.statusCode,
                    userInfo: [NSLocalizedDescriptionKey: serverError?.detail ?? serverError?.error ?? "HTTP \(http.statusCode)"]
                )
            }
            var reply = ""
            var raw = ""
            for try await line in bytes.lines {
                raw += line + "\n"
                let delta = Self.deltaFromSSELine(line)
                if !delta.isEmpty {
                    reply += delta
                    messages[assistantIndex].content = reply
                }
            }
            if reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                reply = Self.parseStreamingReply(raw)
                messages[assistantIndex].content = reply.isEmpty ? "Hermes responded without visible text." : reply
            }
            OperatorSound.receive()
            lastError = nil
            await refreshOverview()
        } catch is CancellationError {
            messages[assistantIndex].content = "Stopped."
            lastError = nil
        } catch {
            messages[assistantIndex].content = "⚠️ \(error.localizedDescription)"
            OperatorSound.warning()
            lastError = error.localizedDescription
        }
    }

    func submitTask(_ text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isSubmittingTask else { return }
        OperatorSound.send()
        isSubmittingTask = true
        defer { isSubmittingTask = false }
        do {
            let request = TaskSubmitRequest(task: trimmed, title: "Cartha Operator task", source: "native-operator", mode: "task")
            let response = try await postJSON(TaskSubmitResponse.self, path: "/api/operator/tasks", body: request)
            let confirmation = response.message ?? "Cartha queued this as durable agent work."
            messages.append(ChatMessage(role: "system", content: "✅ \(confirmation)"))
            OperatorSound.success()
            lastError = nil
            await refreshOverview()
        } catch {
            messages.append(ChatMessage(role: "system", content: "⚠️ Could not queue task: \(error.localizedDescription)"))
            OperatorSound.warning()
            lastError = "Task: \(error.localizedDescription)"
        }
    }

    func setWake(_ mode: String) async {
        do {
            _ = try await runScript(path: NSHomeDirectory() + "/.hermes/scripts/cartha-voice-toggle.sh", arguments: [mode])
            OperatorSound.success()
            await refreshOverview()
        } catch {
            OperatorSound.warning()
            lastError = "Wake toggle: \(error.localizedDescription)"
        }
    }

    func actOnProposal(_ proposal: UploadProposal, action: String) async {
        do {
            var request = URLRequest(url: endpoint("/api/testflight/proposals/\(proposal.id)/\(action)"))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = Data("{}".utf8)
            let (data, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
                let serverError = try? JSONDecoder().decode(ServerError.self, from: data)
                throw NSError(domain: "CarthaHermesNative", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: serverError?.detail ?? serverError?.error ?? "HTTP \(http.statusCode)"])
            }
            OperatorSound.success()
            await refreshOverview()
        } catch {
            OperatorSound.warning()
            lastError = "Approval: \(error.localizedDescription)"
        }
    }

    func openWebConsole() {
        NSWorkspace.shared.open(baseURL)
    }

    func openWorkspaceExternal() {
        NSWorkspace.shared.open(workspaceURL)
    }

    private func endpoint(_ path: String) -> URL {
        baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
    }

    private func endpoint(_ path: String, queryItems: [URLQueryItem]) -> URL {
        var components = URLComponents(url: endpoint(path), resolvingAgainstBaseURL: false)!
        components.queryItems = queryItems
        return components.url ?? endpoint(path)
    }

    private func getJSON<T: Decodable>(_ type: T.Type, path: String) async throws -> T {
        try await getJSON(type, url: endpoint(path))
    }

    private func getJSON<T: Decodable>(_ type: T.Type, url: URL) async throws -> T {
        let (data, response) = try await URLSession.shared.data(from: url)
        if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
            let serverError = try? JSONDecoder().decode(ServerError.self, from: data)
            throw NSError(domain: "CarthaHermesNative", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: serverError?.detail ?? serverError?.error ?? "HTTP \(http.statusCode)"])
        }
        return try JSONDecoder().decode(type, from: data)
    }

    private func postJSON<T: Decodable, B: Encodable>(_ type: T.Type, path: String, body: B) async throws -> T {
        var request = URLRequest(url: endpoint(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
            let serverError = try? JSONDecoder().decode(ServerError.self, from: data)
            throw NSError(domain: "CarthaHermesNative", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: serverError?.detail ?? serverError?.error ?? "HTTP \(http.statusCode)"])
        }
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

    static func deltaFromSSELine(_ line: String) -> String {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("data:") else { return "" }
        let payload = trimmed.dropFirst(5).trimmingCharacters(in: .whitespaces)
        guard payload != "[DONE]", let data = payload.data(using: .utf8) else { return "" }
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let choices = json["choices"] as? [[String: Any]],
              let first = choices.first else { return "" }
        if let delta = first["delta"] as? [String: Any], let content = delta["content"] as? String {
            return content
        }
        if let message = first["message"] as? [String: Any], let content = message["content"] as? String {
            return content
        }
        if let text = first["text"] as? String {
            return text
        }
        return ""
    }
}

// MARK: - Design helpers

let operatorBackground = LinearGradient(
    colors: [
        Color(red: 0.93, green: 0.97, blue: 1.0),
        Color(red: 0.96, green: 0.93, blue: 1.0),
        Color(red: 0.94, green: 0.98, blue: 0.96)
    ],
    startPoint: .topLeading,
    endPoint: .bottomTrailing
)

struct AmbientAuroraView: View {
    @State private var drift = false

    var body: some View {
        ZStack {
            operatorBackground
            GeometryReader { proxy in
                ZStack {
                    Circle()
                        .fill(.cyan.opacity(0.24))
                        .blur(radius: 86)
                        .frame(width: 390, height: 390)
                        .offset(x: drift ? -proxy.size.width * 0.28 : -proxy.size.width * 0.42,
                                y: drift ? -proxy.size.height * 0.30 : -proxy.size.height * 0.44)
                    Circle()
                        .fill(.purple.opacity(0.20))
                        .blur(radius: 96)
                        .frame(width: 470, height: 470)
                        .offset(x: drift ? proxy.size.width * 0.24 : proxy.size.width * 0.38,
                                y: drift ? -proxy.size.height * 0.40 : -proxy.size.height * 0.18)
                    Circle()
                        .fill(.mint.opacity(0.18))
                        .blur(radius: 90)
                        .frame(width: 420, height: 420)
                        .offset(x: drift ? proxy.size.width * 0.34 : proxy.size.width * 0.15,
                                y: drift ? proxy.size.height * 0.34 : proxy.size.height * 0.20)
                    Circle()
                        .stroke(.white.opacity(0.30), lineWidth: 1)
                        .blur(radius: 1)
                        .frame(width: drift ? 620 : 540, height: drift ? 620 : 540)
                        .offset(x: proxy.size.width * 0.18, y: proxy.size.height * 0.05)
                }
                .animation(.easeInOut(duration: 9).repeatForever(autoreverses: true), value: drift)
            }
        }
        .onAppear { drift = true }
    }
}

struct AnimatedLogo: View {
    @State private var sparkle = false

    var size: CGFloat = 50

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.36, style: .continuous)
                .fill(LinearGradient(colors: [.cyan, .mint], startPoint: .topLeading, endPoint: .bottomTrailing))
                .shadow(color: .cyan.opacity(sparkle ? 0.42 : 0.18), radius: sparkle ? 18 : 8, y: 8)
            Image(systemName: "sparkles")
                .font(.system(size: size * 0.42, weight: .black))
                .foregroundStyle(.black.opacity(0.78))
                .rotationEffect(.degrees(sparkle ? 8 : -5))
                .scaleEffect(sparkle ? 1.08 : 0.96)
        }
        .frame(width: size, height: size)
        .animation(.easeInOut(duration: 1.8).repeatForever(autoreverses: true), value: sparkle)
        .onAppear { sparkle = true }
    }
}

struct PulseDot: View {
    let color: Color
    @State private var pulse = false

    var body: some View {
        ZStack {
            Circle()
                .fill(color.opacity(0.22))
                .frame(width: pulse ? 22 : 8, height: pulse ? 22 : 8)
                .opacity(pulse ? 0 : 1)
            Circle().fill(color).frame(width: 7, height: 7)
        }
        .animation(.easeOut(duration: 1.55).repeatForever(autoreverses: false), value: pulse)
        .onAppear { pulse = true }
    }
}

struct TypingDots: View {
    @State private var phase = 0
    private let timer = Timer.publish(every: 0.35, on: .main, in: .common).autoconnect()

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(.secondary)
                    .frame(width: 5, height: 5)
                    .opacity(phase == index ? 1 : 0.35)
                    .scaleEffect(phase == index ? 1.25 : 0.9)
            }
        }
        .onReceive(timer) { _ in
            withAnimation(.spring(response: 0.28, dampingFraction: 0.74)) {
                phase = (phase + 1) % 3
            }
        }
    }
}

struct LivePulseBar: View {
    @State private var sweep = false

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.28))
                Capsule()
                    .fill(LinearGradient(colors: [.clear, .cyan.opacity(0.8), .mint.opacity(0.55), .clear], startPoint: .leading, endPoint: .trailing))
                    .frame(width: max(120, proxy.size.width * 0.32))
                    .offset(x: sweep ? proxy.size.width : -proxy.size.width * 0.36)
                    .blur(radius: 0.5)
            }
        }
        .frame(height: 3)
        .clipShape(Capsule())
        .onAppear {
            withAnimation(.linear(duration: 3.6).repeatForever(autoreverses: false)) {
                sweep = true
            }
        }
    }
}

func parseDate(_ value: String?) -> Date? {
    guard let value else { return nil }
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: value) { return date }
    return ISO8601DateFormatter().date(from: value)
}

func relativeTime(_ value: String?) -> String {
    guard let date = parseDate(value) else { return "just now" }
    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .abbreviated
    return formatter.localizedString(for: date, relativeTo: Date())
}

func statusColor(_ status: String?) -> Color {
    switch status?.lowercased() {
    case "ready", "online", "listening", "completed", "deploy_requested": return .green
    case "queued", "running", "pending", "needs_approval", "check": return .orange
    case "blocked", "offline", "missing", "approval_failed": return .red
    default: return .secondary
    }
}

struct GlassCard<Content: View>: View {
    var padding: CGFloat = 16
    @ViewBuilder var content: Content
    @State private var hovering = false

    var body: some View {
        content
            .padding(padding)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .background(
                LinearGradient(colors: [.white.opacity(0.34), .white.opacity(0.08)], startPoint: .topLeading, endPoint: .bottomTrailing),
                in: RoundedRectangle(cornerRadius: 24, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .stroke(.white.opacity(0.46), lineWidth: 1)
            )
            .overlay(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .stroke(LinearGradient(colors: [.white.opacity(0.85), .clear], startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 1)
                    .blendMode(.screen)
            }
            .shadow(color: .black.opacity(0.08), radius: 24, x: 0, y: 14)
            .scaleEffect(hovering ? 1.006 : 1)
            .shadow(color: hovering ? .cyan.opacity(0.10) : .clear, radius: hovering ? 20 : 0)
            .animation(.spring(response: 0.28, dampingFraction: 0.82), value: hovering)
            .onHover { hovering = $0 }
    }
}

struct StatusPill: View {
    let text: String
    var color: Color = .green
    var icon: String? = nil

    var body: some View {
        HStack(spacing: 6) {
            if let icon { Image(systemName: icon).font(.system(size: 10, weight: .bold)) }
            PulseDot(color: color).frame(width: 10, height: 10)
            Text(text)
                .font(.system(size: 11, weight: .bold, design: .rounded))
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(color.opacity(0.12), in: Capsule())
        .overlay(Capsule().stroke(color.opacity(0.25)))
        .foregroundStyle(color)
    }
}

struct SoundToggleButton: View {
    @State private var enabled = OperatorSound.isEnabled

    var body: some View {
        Button {
            enabled.toggle()
            OperatorSound.setEnabled(enabled)
            if enabled { OperatorSound.success() }
        } label: {
            Image(systemName: enabled ? "speaker.wave.2" : "speaker.slash")
        }
        .help(enabled ? "Sound effects on" : "Sound effects off")
    }
}

struct MetricTile: View {
    let title: String
    let value: String
    let detail: String
    let icon: String
    let color: Color

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Image(systemName: icon)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(color)
                        .frame(width: 36, height: 36)
                        .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    Spacer()
                }
                Text(title.uppercased())
                    .font(.system(size: 10, weight: .black, design: .rounded))
                    .foregroundStyle(.secondary)
                    .tracking(1.1)
                Text(value)
                    .font(.system(size: 24, weight: .black, design: .rounded))
                    .lineLimit(1)
                Text(detail)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
    }
}

struct EmptyState: View {
    let icon: String
    let title: String
    let detail: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 42, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(title).font(.headline)
            Text(detail)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)
        }
        .frame(maxWidth: .infinity, minHeight: 220)
    }
}

// MARK: - Bubble

struct BubbleView: View {
    @ObservedObject var service: HermesService
    let openPanel: () -> Void
    let refresh: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(LinearGradient(colors: [.cyan, .mint], startPoint: .topLeading, endPoint: .bottomTrailing))
                    Image(systemName: "sparkles")
                        .font(.system(size: 15, weight: .black))
                        .foregroundStyle(.black.opacity(0.76))
                }
                .frame(width: 38, height: 38)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Cartha Operator")
                        .font(.system(size: 16, weight: .black, design: .rounded))
                    Text(service.wakeSummary)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                StatusPill(text: service.isStackReady ? "local" : "check", color: service.isStackReady ? .green : .orange)
            }

            Text(service.gatewaySummary)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.secondary)
                .lineLimit(2)

            if !service.pendingProposals.isEmpty || !service.runningTasks.isEmpty {
                HStack(spacing: 8) {
                    if !service.runningTasks.isEmpty {
                        StatusPill(text: "\(service.runningTasks.count) active", color: .orange, icon: "checklist")
                    }
                    if !service.pendingProposals.isEmpty {
                        StatusPill(text: "\(service.pendingProposals.count) approval", color: .purple, icon: "checkmark.seal")
                    }
                }
            }

            HStack(spacing: 9) {
                Button("Open cockpit") { OperatorSound.navigate(); openPanel() }
                    .buttonStyle(.borderedProminent)
                Button(service.wake?.active == true ? "Mute wake" : "Wake on") {
                    OperatorSound.navigate()
                    Task { await service.setWake(service.wake?.active == true ? "off" : "on") }
                }
                .buttonStyle(.bordered)
                Button(action: { OperatorSound.navigate(); refresh() }) { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(.borderless)
            }
        }
        .padding(17)
        .frame(width: 420)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .stroke(.white.opacity(0.55), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.22), radius: 30, x: 0, y: 18)
    }
}

// MARK: - Shell

struct MainPanelView: View {
    @ObservedObject var service: HermesService

    var body: some View {
        ZStack {
            AmbientAuroraView().ignoresSafeArea()
            HStack(spacing: 0) {
                SidebarView(service: service)
                Divider().opacity(0.25)
                ContentPane(service: service)
            }
            .padding(14)
        }
        .frame(minWidth: 1120, minHeight: 720)
        .task { await service.refreshAll() }
    }
}

struct SidebarView: View {
    @ObservedObject var service: HermesService

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                AnimatedLogo(size: 50)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Cartha")
                        .font(.system(size: 24, weight: .black, design: .rounded))
                    Text("Operator cockpit")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.bottom, 4)

            VStack(spacing: 7) {
                ForEach(NativeTab.allCases, id: \.self) { tab in
                    SidebarNavItem(
                        tab: tab,
                        selected: service.selectedTab == tab,
                        badge: badgeText(for: tab),
                        badgeColor: tab == .approvals ? .purple : .orange
                    ) {
                        service.selectedTab = tab
                    }
                }
            }

            GlassCard(padding: 14) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("System")
                            .font(.system(size: 12, weight: .black, design: .rounded))
                            .foregroundStyle(.secondary)
                            .tracking(1)
                        Spacer()
                        StatusPill(text: service.isStackReady ? "ready" : "check", color: service.isStackReady ? .green : .orange)
                    }
                    Text(service.gatewaySummary)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                    Text(service.wakeSummary)
                        .font(.system(size: 12, weight: .semibold))
                        .lineLimit(2)
                }
            }

            if let lastError = service.lastError {
                GlassCard(padding: 12) {
                    Label(lastError, systemImage: "exclamationmark.triangle")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.orange)
                        .lineLimit(3)
                }
            }

            Spacer()

            HStack(spacing: 8) {
                Button {
                    OperatorSound.navigate()
                    Task { await service.refreshAll() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                Button {
                    OperatorSound.navigate()
                    service.openWebConsole()
                } label: {
                    Image(systemName: "safari")
                }
                .help("Open web fallback")
                .buttonStyle(.bordered)
                SoundToggleButton()
                    .buttonStyle(.bordered)
            }
        }
        .padding(18)
        .frame(width: 270)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 30, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 30, style: .continuous).stroke(.white.opacity(0.46)))
    }

    private func badgeText(for tab: NativeTab) -> String? {
        if tab == .tasks, !service.runningTasks.isEmpty { return "\(service.runningTasks.count)" }
        if tab == .approvals, !service.pendingProposals.isEmpty { return "\(service.pendingProposals.count)" }
        return nil
    }
}

struct SidebarNavItem: View {
    let tab: NativeTab
    let selected: Bool
    let badge: String?
    let badgeColor: Color
    let action: () -> Void

    var body: some View {
        Button {
            OperatorSound.navigate()
            withAnimation(.spring(response: 0.32, dampingFraction: 0.82)) {
                action()
            }
        } label: {
            HStack(spacing: 11) {
                Image(systemName: tab.icon).frame(width: 20)
                Text(tab.title)
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                Spacer()
                if let badge {
                    Text(badge)
                        .font(.caption2.bold())
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(badgeColor.opacity(0.18), in: Capsule())
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
        .background(selected ? Color.white.opacity(0.56) : Color.white.opacity(0.16), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 15, style: .continuous).stroke(selected ? Color.white.opacity(0.8) : Color.white.opacity(0.16)))
    }
}

struct ContentPane: View {
    @ObservedObject var service: HermesService

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(service.selectedTab.title)
                        .font(.system(size: 32, weight: .black, design: .rounded))
                    Text(service.selectedTab.subtitle)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if let generated = service.overview?.generatedAt {
                    Text("Updated \(relativeTime(generated))")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                Button {
                    OperatorSound.navigate()
                    Task { await service.refreshAll() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 20)
            LivePulseBar()
                .padding(.horizontal, 24)
                .padding(.bottom, 8)

            Group {
                switch service.selectedTab {
                case .now:
                    NowView(service: service)
                case .operatorChat:
                    OperatorView(service: service)
                case .tasks:
                    TasksView(service: service)
                case .approvals:
                    ApprovalsView(service: service)
                case .sessions:
                    SessionsView(service: service)
                case .wake:
                    WakeView(service: service)
                case .workspace:
                    WorkspaceWebView(url: service.workspaceURL)
                        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                        .padding(.horizontal, 24)
                        .padding(.bottom, 24)
                }
            }
            .id(service.selectedTab)
            .transition(.opacity.combined(with: .scale(scale: 0.985, anchor: .top)).combined(with: .move(edge: .trailing)))
            .animation(.spring(response: 0.42, dampingFraction: 0.86), value: service.selectedTab)
        }
        .sheet(item: $service.selectedTaskForHistory, onDismiss: {
            service.clearTaskHistory()
        }) { task in
            TaskHistorySheet(service: service, task: task)
                .frame(minWidth: 680, idealWidth: 760, minHeight: 560, idealHeight: 680)
        }
    }
}

// MARK: - Now dashboard

struct NowView: View {
    @ObservedObject var service: HermesService
    private let columns = [GridItem(.adaptive(minimum: 230), spacing: 14)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                GlassCard(padding: 22) {
                    HStack(spacing: 18) {
                        VStack(alignment: .leading, spacing: 9) {
                            HStack(spacing: 8) {
                                StatusPill(text: service.isStackReady ? "local stack ready" : "needs attention", color: service.isStackReady ? .green : .orange)
                                StatusPill(text: service.wake?.active == true ? "voice on" : "voice muted", color: service.wake?.active == true ? .green : .secondary)
                            }
                            Text("Your local Cartha agent is ready to supervise work.")
                                .font(.system(size: 28, weight: .black, design: .rounded))
                                .lineLimit(2)
                            Text("Ask for quick answers, queue durable tasks, review Apple upload gates, and keep an eye on local tool readiness from one native surface.")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(.secondary)
                                .lineLimit(3)
                        }
                        Spacer()
                        VStack(spacing: 10) {
                            Button { OperatorSound.navigate(); service.selectedTab = .operatorChat } label: { Label("Ask or run task", systemImage: "text.bubble") }
                                .buttonStyle(.borderedProminent)
                            Button { OperatorSound.navigate(); service.selectedTab = .tasks } label: { Label("Review tasks", systemImage: "checklist") }
                                .buttonStyle(.bordered)
                            Button { OperatorSound.navigate(); service.selectedTab = .approvals } label: { Label("Apple approvals", systemImage: "checkmark.seal") }
                                .buttonStyle(.bordered)
                        }
                    }
                }

                LazyVGrid(columns: columns, spacing: 14) {
                    MetricTile(title: "Gateway", value: service.status?.hermesGateway ?? "unknown", detail: service.status?.localAgentModel ?? "Hermes agent", icon: "network", color: service.status?.hermesGateway == "online" ? .green : .orange)
                    MetricTile(title: "Wake", value: service.wake?.active == true ? "Listening" : "Muted", detail: service.wakeSummary, icon: "waveform", color: service.wake?.active == true ? .green : .secondary)
                    MetricTile(title: "Active work", value: "\(service.runningTasks.count)", detail: "Queued, running, or awaiting approval", icon: "checklist", color: service.runningTasks.isEmpty ? .secondary : .orange)
                    MetricTile(title: "Approvals", value: "\(service.pendingProposals.count)", detail: "Apple upload decisions pending", icon: "checkmark.seal", color: service.pendingProposals.isEmpty ? .green : .purple)
                }

                HStack(alignment: .top, spacing: 14) {
                    GlassCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Tool readiness")
                                .font(.headline)
                            ForEach(service.tools.prefix(6)) { tool in
                                HStack(spacing: 10) {
                                    Image(systemName: tool.icon ?? "wrench")
                                        .foregroundStyle(statusColor(tool.status))
                                        .frame(width: 22)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(tool.label).font(.system(size: 13, weight: .bold))
                                        Text(tool.detail ?? tool.status ?? "unknown")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                    }
                                    Spacer()
                                    StatusPill(text: tool.status ?? "unknown", color: statusColor(tool.status))
                                }
                            }
                            if service.tools.isEmpty {
                                EmptyState(icon: "wrench.and.screwdriver", title: "Tool readiness loading", detail: "Refresh once the local console is online.")
                            }
                        }
                    }
                    .frame(maxWidth: .infinity)

                    GlassCard {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Recent work")
                                .font(.headline)
                            if service.tasks.isEmpty {
                                EmptyState(icon: "tray", title: "No task ledger yet", detail: "Run a task from the Ask tab to start filling this in.")
                            } else {
                                ForEach(service.tasks.prefix(5)) { task in
                                    Button {
                                        OperatorSound.navigate()
                                        Task { await service.openTaskHistory(task) }
                                    } label: {
                                        TaskRow(task: task, showsDisclosure: true)
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel("Open task history for \(task.summary ?? task.title ?? "Cartha task")")
                                }
                            }
                        }
                    }
                    .frame(maxWidth: .infinity)
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Autonomy policy")
                            .font(.headline)
                        HStack {
                            StatusPill(text: service.policy?.enabled == true ? "trusted autonomy on" : "manual", color: service.policy?.enabled == true ? .green : .secondary)
                            if let maxSteps = service.policy?.maxSteps {
                                StatusPill(text: "max \(maxSteps) steps", color: .blue)
                            }
                        }
                        Text(service.policy?.note ?? "Policy details are loading.")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(.secondary)
                        ForEach(service.policy?.approvals ?? [], id: \.self) { item in
                            Label(item, systemImage: "lock.shield")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
    }
}

// MARK: - Operator chat

struct OperatorView: View {
    @ObservedObject var service: HermesService
    @State private var prompt = ""
    @State private var mode: ComposerMode = .ask

    var body: some View {
        VStack(spacing: 14) {
            GlassCard(padding: 0) {
                VStack(spacing: 0) {
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 12) {
                                ForEach(service.messages) { message in
                                    MessageBubble(message: message)
                                        .id(message.id)
                                        .transition(.asymmetric(insertion: .opacity.combined(with: .scale(scale: 0.96)).combined(with: .move(edge: message.role == "user" ? .trailing : .leading)), removal: .opacity))
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
                    Divider().opacity(0.35)
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Picker("Mode", selection: $mode) {
                                ForEach(ComposerMode.allCases, id: \.self) { mode in
                                    Text(mode.rawValue).tag(mode)
                                }
                            }
                            .pickerStyle(.segmented)
                            .frame(width: 220)
                            .onChange(of: mode) { _ in OperatorSound.navigate() }
                            Text(mode == .ask ? "Immediate streaming answer" : "Durable task queue through Cartha autonomy")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            Spacer()
                            Button("Clear") {
                                OperatorSound.navigate()
                                service.messages = [ChatMessage(role: "system", content: "New Cartha Operator session. Ask quickly or queue durable work.")]
                            }
                            .buttonStyle(.bordered)
                        }
                        QuickPromptStrip(prompt: $prompt, mode: $mode)
                        HStack(alignment: .bottom, spacing: 10) {
                            TextField(mode == .ask ? "Ask Cartha something…" : "Tell Cartha what to keep working on…", text: $prompt, axis: .vertical)
                                .textFieldStyle(.plain)
                                .lineLimit(2...6)
                                .padding(13)
                                .background(.white.opacity(0.54), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(.white.opacity(0.75)))
                                .onSubmit { send() }
                            Button(action: send) {
                                HStack {
                                    if service.isSending || service.isSubmittingTask { ProgressView().controlSize(.small) }
                                    Text(mode == .ask ? (service.isSending ? "Thinking…" : "Ask") : (service.isSubmittingTask ? "Queueing…" : "Run Task"))
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled((mode == .ask ? service.isSending : service.isSubmittingTask) || prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            .keyboardShortcut(.return, modifiers: [.command])
                        }
                    }
                    .padding(16)
                    .background(
                        LinearGradient(colors: [Color.white.opacity(0.18), Color.cyan.opacity(0.08)], startPoint: .top, endPoint: .bottom)
                    )
                }
            }
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 24)
    }

    private func send() {
        let text = prompt
        prompt = ""
        if mode == .ask {
            Task { await service.send(text) }
        } else {
            Task { await service.submitTask(text) }
        }
    }
}

struct QuickPromptStrip: View {
    @Binding var prompt: String
    @Binding var mode: ComposerMode

    private let suggestions: [(String, String, ComposerMode)] = [
        ("Health check", "Check the local Hermes/Cartha stack health and tell me anything that needs attention.", .task),
        ("Active work", "Summarize what Cartha is currently working on and what is blocked.", .ask),
        ("Workspace map", "Inspect the likely active GitHub workspaces and summarize what changed recently.", .task),
        ("Ship review", "Review pending release approvals and tell me whether anything should ship.", .ask)
    ]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(suggestions, id: \.0) { item in
                    Button {
                        OperatorSound.navigate()
                        withAnimation(.spring(response: 0.28, dampingFraction: 0.82)) {
                            prompt = item.1
                            mode = item.2
                        }
                    } label: {
                        Label(item.0, systemImage: item.2 == .task ? "bolt.badge.clock" : "sparkle.magnifyingglass")
                            .font(.caption.weight(.bold))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            }
            .padding(.vertical, 2)
        }
    }
}

struct MessageBubble: View {
    let message: ChatMessage

    var body: some View {
        HStack(alignment: .bottom) {
            if message.role == "user" { Spacer(minLength: 80) }
            VStack(alignment: .leading, spacing: 5) {
                Text(label)
                    .font(.caption2.weight(.black))
                    .foregroundStyle(.secondary)
                    .tracking(0.7)
                if message.content.hasPrefix("Thinking locally") {
                    HStack(spacing: 8) {
                        Text("Thinking locally")
                            .font(.system(size: 13.5, weight: .medium))
                        TypingDots()
                    }
                } else {
                    Text(message.content)
                        .font(.system(size: 13.5, weight: .medium))
                        .textSelection(.enabled)
                        .lineSpacing(2)
                }
            }
            .padding(13)
            .background(background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(.white.opacity(0.34)))
            .shadow(color: .black.opacity(0.04), radius: 12, y: 6)
            if message.role != "user" { Spacer(minLength: 80) }
        }
    }

    private var label: String {
        switch message.role {
        case "user": return "YOU"
        case "system": return "SYSTEM"
        default: return "CARTHA"
        }
    }

    private var background: AnyShapeStyle {
        switch message.role {
        case "user": return AnyShapeStyle(LinearGradient(colors: [.cyan.opacity(0.24), .mint.opacity(0.18)], startPoint: .topLeading, endPoint: .bottomTrailing))
        case "system": return AnyShapeStyle(Color.purple.opacity(0.12))
        default: return AnyShapeStyle(Color.white.opacity(0.58))
        }
    }
}

// MARK: - Tasks

struct TasksView: View {
    @ObservedObject var service: HermesService

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("Cartha keeps working here — queued, running, blocked, and completed.")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("Refresh tasks") { OperatorSound.navigate(); Task { await service.refreshTasks() } }
                        .buttonStyle(.bordered)
                }
                if service.tasks.isEmpty {
                    GlassCard {
                        EmptyState(icon: "checklist", title: "No tasks yet", detail: "Use Run Task in the Ask tab to hand Cartha durable work.")
                    }
                } else {
                    ForEach(service.tasks) { task in
                        Button {
                            OperatorSound.navigate()
                            Task { await service.openTaskHistory(task) }
                        } label: {
                            TaskCard(task: task, showsDisclosure: true)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Open task history for \(task.summary ?? task.title ?? "Cartha task")")
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
    }
}

struct TaskRow: View {
    let task: HarnessTask
    var showsDisclosure = false

    var body: some View {
        HStack(spacing: 10) {
            Circle().fill(statusColor(task.status)).frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 2) {
                Text(task.summary?.isEmpty == false ? task.summary! : task.title ?? "Cartha task")
                    .font(.system(size: 12.5, weight: .bold))
                    .lineLimit(1)
                Text("\(task.status ?? "unknown") · \(task.source ?? "cartha") · \(relativeTime(task.updatedAt ?? task.createdAt))")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            if showsDisclosure {
                Image(systemName: "chevron.right")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 3)
        .contentShape(Rectangle())
    }
}

struct TaskCard: View {
    let task: HarnessTask
    var showsDisclosure = false

    var body: some View {
        GlassCard {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(statusColor(task.status))
                    .frame(width: 42, height: 42)
                    .background(statusColor(task.status).opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(task.summary?.isEmpty == false ? task.summary! : task.title ?? "Cartha task")
                            .font(.headline)
                            .lineLimit(2)
                        Spacer()
                        StatusPill(text: task.status ?? "unknown", color: statusColor(task.status))
                    }
                    HStack(spacing: 8) {
                        Text(task.source ?? "cartha")
                        Text("·")
                        Text(task.mode ?? task.kind ?? "task")
                        Text("·")
                        Text(relativeTime(task.updatedAt ?? task.createdAt))
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    if let detail = task.detail, !detail.isEmpty {
                        Text(detail)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(3)
                    }
                }
                if showsDisclosure {
                    Image(systemName: "chevron.right.circle.fill")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(.secondary.opacity(0.72))
                        .padding(.top, 2)
                }
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private var icon: String {
        switch task.status {
        case "queued": return "tray.and.arrow.down"
        case "running": return "figure.run.circle"
        case "blocked": return "exclamationmark.octagon"
        case "needs_approval": return "hand.raised"
        default: return "checkmark.circle"
        }
    }
}

struct TaskHistorySheet: View {
    @ObservedObject var service: HermesService
    let task: HarnessTask

    private var title: String {
        service.taskHistory?.session?.title
            ?? service.taskHistory?.task?.summary
            ?? task.summary
            ?? task.title
            ?? "Cartha task"
    }

    private var taskStatus: String {
        service.taskHistory?.task?.status ?? task.status ?? "unknown"
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: "text.bubble.fill")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(.cyan)
                    .frame(width: 42, height: 42)
                    .background(.cyan.opacity(0.14), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                VStack(alignment: .leading, spacing: 5) {
                    Text(title)
                        .font(.system(size: 22, weight: .black, design: .rounded))
                        .lineLimit(2)
                    HStack(spacing: 8) {
                        StatusPill(text: taskStatus, color: statusColor(taskStatus))
                        Text(service.taskHistory?.session?.kind ?? task.mode ?? task.kind ?? "task")
                        Text("·")
                        Text(relativeTime(service.taskHistory?.session?.updated_at ?? task.updatedAt ?? task.createdAt))
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    OperatorSound.navigate()
                    service.clearTaskHistory()
                } label: {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.bordered)
            }
            .padding(22)

            Divider().opacity(0.35)

            Group {
                if service.isLoadingTaskHistory {
                    VStack(spacing: 12) {
                        ProgressView()
                        Text("Loading chat history…")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = service.taskHistoryError {
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.largeTitle)
                            .foregroundStyle(.orange)
                        Text("Could not open this task history")
                            .font(.headline)
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(30)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let history = service.taskHistory {
                    TaskHistoryContent(service: service, history: history, fallbackTask: task)
                } else {
                    EmptyState(icon: "text.bubble", title: "No history loaded yet", detail: "Cartha is opening the matching session transcript.")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .background(operatorBackground)
    }
}

struct TaskHistoryContent: View {
    @ObservedObject var service: HermesService
    let history: TaskHistoryResponse
    let fallbackTask: HarnessTask

    var body: some View {
        VStack(spacing: 0) {
            if let note = history.note, !note.isEmpty {
                Label(note, systemImage: "info.circle")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 22)
                    .padding(.top, 14)
            }

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    if history.messages.isEmpty {
                        GlassCard {
                            EmptyState(icon: "text.bubble", title: "No transcript yet", detail: "This task exists, but no chat messages have been written for it yet.")
                        }
                    } else {
                        ForEach(history.messages) { message in
                            TaskHistoryMessageBubble(message: message)
                        }
                    }
                }
                .padding(22)
            }

            Divider().opacity(0.35)
            HStack {
                Text(history.session?.path ?? fallbackTask.sessionPath ?? fallbackTask.detail ?? "Task history")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer()
                if let path = history.session?.path ?? fallbackTask.sessionPath, !path.isEmpty {
                    Button("Open JSON") {
                        OperatorSound.navigate()
                        NSWorkspace.shared.open(URL(fileURLWithPath: path))
                    }
                    .buttonStyle(.bordered)
                }
                if let file = history.session?.file ?? fallbackTask.sessionFile, !file.isEmpty {
                    Button("Open web session") {
                        OperatorSound.navigate()
                        var components = URLComponents(url: service.baseURL, resolvingAgainstBaseURL: false)
                        components?.queryItems = [URLQueryItem(name: "session", value: file)]
                        components?.fragment = "canvas"
                        if let url = components?.url { NSWorkspace.shared.open(url) }
                    }
                    .buttonStyle(.bordered)
                }
            }
            .padding(16)
            .background(.ultraThinMaterial)
        }
    }
}

struct TaskHistoryMessageBubble: View {
    let message: TaskHistoryMessage

    private var isUser: Bool { message.role == "user" }
    private var label: String {
        if let name = message.name, !name.isEmpty { return "\(message.role.uppercased()) · \(name)" }
        return message.role.uppercased()
    }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 54) }
            VStack(alignment: .leading, spacing: 6) {
                Text(label)
                    .font(.caption2.weight(.black))
                    .foregroundStyle(.secondary)
                Text(message.content)
                    .font(.system(size: 13, weight: .medium))
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                if message.truncated == true {
                    Label("Long message clipped in cockpit view", systemImage: "scissors")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            .padding(12)
            .frame(maxWidth: 560, alignment: .leading)
            .background(bubbleBackground, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(.white.opacity(0.35)))
            if !isUser { Spacer(minLength: 54) }
        }
    }

    private var bubbleBackground: AnyShapeStyle {
        if isUser {
            return AnyShapeStyle(LinearGradient(colors: [.cyan.opacity(0.28), .mint.opacity(0.18)], startPoint: .topLeading, endPoint: .bottomTrailing))
        }
        if message.role == "tool" {
            return AnyShapeStyle(Color.orange.opacity(0.10))
        }
        if message.role == "system" {
            return AnyShapeStyle(Color.purple.opacity(0.12))
        }
        return AnyShapeStyle(Color.white.opacity(0.58))
    }
}

// MARK: - Approvals

struct ApprovalsView: View {
    @ObservedObject var service: HermesService

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if service.pendingProposals.isEmpty {
                    GlassCard {
                        EmptyState(icon: "checkmark.seal", title: "No pending Apple upload decisions", detail: "Cartha will surface future TestFlight and Mac App Store upload choices here. Direct-download Mac publishing stays automatic.")
                    }
                } else {
                    ForEach(service.pendingProposals) { proposal in
                        ProposalCard(service: service, proposal: proposal)
                    }
                }

                let recent = service.proposals.filter { $0.status != "pending" }.prefix(8)
                if !recent.isEmpty {
                    Text("Recent decisions")
                        .font(.headline)
                        .padding(.top, 6)
                    ForEach(Array(recent)) { proposal in
                        ProposalCard(service: service, proposal: proposal, compact: true)
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
    }
}

struct ProposalCard: View {
    @ObservedObject var service: HermesService
    let proposal: UploadProposal
    var compact = false

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 11) {
                HStack(spacing: 10) {
                    Image(systemName: "shippingbox.and.arrow.backward")
                        .foregroundStyle(.purple)
                        .frame(width: 38, height: 38)
                        .background(.purple.opacity(0.12), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(proposal.channel_label ?? "Apple upload")
                            .font(.headline)
                        Text("\(proposal.short_sha ?? "commit") · \(proposal.recommendation ?? "hold") · \(proposal.status ?? "unknown")")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    StatusPill(text: proposal.status ?? "pending", color: proposal.status == "pending" ? .purple : statusColor(proposal.status))
                }
                Text(proposal.subject ?? "Untitled commit")
                    .font(.system(size: compact ? 13 : 15, weight: .bold))
                if !compact {
                    Text(proposal.reason ?? "No reason recorded.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.secondary)
                    if let files = proposal.changed_files, !files.isEmpty {
                        Text("Changed files: \(files.prefix(6).joined(separator: ", "))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
                if proposal.status == "pending" {
                    HStack {
                        Button("Yes, upload") { OperatorSound.navigate(); Task { await service.actOnProposal(proposal, action: "approve") } }
                            .buttonStyle(.borderedProminent)
                        Button("No, skip") { OperatorSound.navigate(); Task { await service.actOnProposal(proposal, action: "skip") } }
                            .buttonStyle(.bordered)
                    }
                }
            }
        }
    }
}

// MARK: - Sessions

struct SessionsView: View {
    @ObservedObject var service: HermesService

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("\(service.sessions.count) recent sessions · \(service.activeSessionCount) active")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("Refresh sessions") { OperatorSound.navigate(); Task { await service.refreshSessions() } }
                        .buttonStyle(.bordered)
                }
                if service.sessions.isEmpty {
                    GlassCard {
                        EmptyState(icon: "clock", title: "No sessions found", detail: "Hermes session files will appear here after local agent work starts.")
                    }
                } else {
                    ForEach(service.sessions) { session in
                        SessionCard(service: service, session: session)
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
    }
}

struct SessionCard: View {
    @ObservedObject var service: HermesService
    let session: HermesSession

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 9) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(session.title ?? session.id)
                            .font(.headline)
                            .lineLimit(1)
                        Text("\(session.kind ?? "session") · \(session.model ?? "unknown model") · \(session.message_count ?? 0) messages · \(relativeTime(session.updated_at))")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    StatusPill(text: session.platform ?? "local", color: .blue)
                }
                if let user = session.last_user, !user.isEmpty {
                    Text("Ask: \(user)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                if let assistant = session.last_assistant, !assistant.isEmpty {
                    Text("Reply: \(assistant)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                HStack {
                    Button("Open JSON") {
                        OperatorSound.navigate()
                        if let path = session.path { NSWorkspace.shared.open(URL(fileURLWithPath: path)) }
                    }
                    .disabled(session.path == nil)
                    .buttonStyle(.bordered)
                    Button("Open web session") {
                        OperatorSound.navigate()
                        if let file = session.file {
                            var components = URLComponents(url: service.baseURL, resolvingAgainstBaseURL: false)
                            components?.queryItems = [URLQueryItem(name: "session", value: file)]
                            components?.fragment = "canvas"
                            if let url = components?.url { NSWorkspace.shared.open(url) }
                        }
                    }
                    .disabled(session.file == nil)
                    .buttonStyle(.bordered)
                }
            }
        }
    }
}

// MARK: - Wake

struct WakeView: View {
    @ObservedObject var service: HermesService

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                GlassCard(padding: 22) {
                    HStack(spacing: 18) {
                        Image(systemName: service.wake?.active == true ? "waveform.circle.fill" : "waveform.circle")
                            .font(.system(size: 46, weight: .semibold))
                            .foregroundStyle(service.wake?.active == true ? .green : .secondary)
                        VStack(alignment: .leading, spacing: 7) {
                            Text(service.wakeSummary)
                                .font(.system(size: 24, weight: .black, design: .rounded))
                            Text(service.wake?.toggleText ?? "Wake status is loading.")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        VStack(spacing: 9) {
                            Button("Turn on") { OperatorSound.navigate(); Task { await service.setWake("on") } }
                                .buttonStyle(.borderedProminent)
                            Button("Mute") { OperatorSound.navigate(); Task { await service.setWake("off") } }
                                .buttonStyle(.bordered)
                        }
                    }
                }

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 210), spacing: 14)], spacing: 14) {
                    MetricTile(title: "Listener", value: service.wake?.listenerRunning == true ? "Running" : "Stopped", detail: "Voice listener process", icon: "ear", color: service.wake?.listenerRunning == true ? .green : .orange)
                    MetricTile(title: "Launchd", value: service.wake?.launchdRunning == true ? "Running" : "Stopped", detail: "dev.cartha.voice", icon: "gearshape.2", color: service.wake?.launchdRunning == true ? .green : .orange)
                    MetricTile(title: "Whisper", value: service.wake?.whisperRunning == true ? "Online" : "Offline", detail: "Local transcription server", icon: "mic", color: service.wake?.whisperRunning == true ? .green : .orange)
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Guardrails")
                            .font(.headline)
                        ForEach(service.wake?.guardrails ?? [], id: \.self) { item in
                            Label(item, systemImage: "checkmark.shield")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
    }
}

// MARK: - Workspace

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
        let size = NSSize(width: 420, height: 214)
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
        for url in urls { handleDeepLink(url) }
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
        case "tasks", "task":
            service.selectedTab = .tasks
            showMainWindow()
        case "ask", "operator":
            service.selectedTab = .operatorChat
            showMainWindow()
        default:
            service.selectedTab = .now
            showMainWindow()
        }
    }

    private func buildMenuBar() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.image = NSImage(systemSymbolName: "sparkles", accessibilityDescription: "Cartha Operator")
        item.button?.title = " Cartha"
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Open Cartha Cockpit", action: #selector(showMainWindowMenu), keyEquivalent: "h"))
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
        service.selectedTab = .now
        showMainWindow()
    }
    @objc private func showBubbleMenu() { bubble?.show() }
    @objc private func refreshMenu() { Task { await service.refreshAll() } }
    @objc private func openWebFallbackMenu() { service.openWebConsole() }
    @objc private func openWorkspaceMenu() { service.openWorkspaceExternal() }
    @objc private func quit() { NSApp.terminate(nil) }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        NSApp.setActivationPolicy(.regular)
        NativeLog.write("reopen visibleWindows=\(flag)")
        showMainWindow()
        return true
    }

    func showMainWindow() {
        if mainWindow == nil {
            NativeLog.write("create-main-window")
            let content = MainPanelView(service: service)
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 760), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
            window.title = "Cartha Operator"
            window.titleVisibility = .hidden
            window.titlebarAppearsTransparent = true
            window.isMovableByWindowBackground = true
            window.backgroundColor = .clear
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

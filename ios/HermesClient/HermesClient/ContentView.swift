import SwiftUI

struct ContentView: View {
    @AppStorage("bridgeBaseURL") private var bridgeBaseURL = "http://10.0.0.253:5138"
    @AppStorage("bridgeToken") private var bridgeToken = ""
    @StateObject private var client = HermesBridgeClient()
    @StateObject private var voice = VoiceDispatchController()
    @State private var command = ""
    @State private var mode: DispatchMode = .task
    @State private var showingSettings = false

    private var trimmedCommand: String {
        command.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canDispatch: Bool {
        !trimmedCommand.isEmpty && !bridgeToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        ZStack {
            HermesBackground()
                .ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(spacing: 18) {
                    header
                    voiceCard
                    quickActions
                    commandCard
                    screenCard
                    statusCard
                }
                .padding(.horizontal, 20)
                .padding(.top, 18)
                .padding(.bottom, 34)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .preferredColorScheme(.dark)
        .fullScreenCover(isPresented: $showingSettings) {
            SettingsView(
                bridgeBaseURL: $bridgeBaseURL,
                bridgeToken: $bridgeToken,
                client: client
            )
        }
        .task {
            applyBundledDefaultsIfNeeded()
            await client.health(baseURL: bridgeBaseURL, token: bridgeToken)
        }
        .task(id: client.isStreaming) {
            guard client.isStreaming else { return }
            while client.isStreaming && !Task.isCancelled {
                await client.refreshScreen(baseURL: bridgeBaseURL, token: bridgeToken)
                try? await Task.sleep(for: .seconds(1.25))
            }
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 14) {
            AppGlyph(size: 52)
            VStack(alignment: .leading, spacing: 5) {
                Text("Hermes")
                    .font(.system(size: 38, weight: .black, design: .rounded))
                    .tracking(-1.2)
                Text("Voice remote for your Mac agent")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.white.opacity(0.68))
            }
            Spacer()
            Button {
                showingSettings = true
            } label: {
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 46, height: 46)
                    .background(.white.opacity(0.12), in: Circle())
                    .overlay(Circle().stroke(.white.opacity(0.12)))
            }
            .accessibilityLabel("Open connection settings")
        }
    }

    private var voiceCard: some View {
        VStack(spacing: 18) {
            HStack {
                StatusPill(isConnected: client.isConnected, text: client.isConnected ? "Mac online" : "Tap to connect")
                Spacer()
                if client.isBusy {
                    ProgressView()
                        .tint(.white)
                }
            }

            Button {
                Task { await handleVoiceButton() }
            } label: {
                VStack(spacing: 12) {
                    ZStack {
                        Circle()
                            .fill(voice.isListening ? .red.opacity(0.22) : .cyan.opacity(0.18))
                            .frame(width: 132, height: 132)
                            .blur(radius: voice.isListening ? 4 : 0)
                        Circle()
                            .fill(voice.isListening ? LinearGradient(colors: [.red, .orange], startPoint: .topLeading, endPoint: .bottomTrailing) : LinearGradient(colors: [.cyan, .blue], startPoint: .topLeading, endPoint: .bottomTrailing))
                            .frame(width: 104, height: 104)
                            .shadow(color: (voice.isListening ? Color.red : Color.cyan).opacity(0.35), radius: 24, y: 12)
                        Image(systemName: voice.isListening ? "stop.fill" : "mic.fill")
                            .font(.system(size: 38, weight: .black))
                            .foregroundStyle(.white)
                    }

                    Text(voice.isListening ? "Tap to send" : "One-tap voice dispatch")
                        .font(.title2.weight(.bold))
                    Text(voice.isListening ? "Speak naturally. I’ll send it to Hermes when you stop." : "Tap once, say the command, tap again to dispatch.")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.68))
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(bridgeToken.isEmpty)
            .accessibilityLabel(voice.isListening ? "Stop recording and dispatch" : "Start voice dispatch")

            if !voice.transcript.isEmpty {
                Text(voice.transcript)
                    .font(.body.weight(.medium))
                    .foregroundStyle(.white.opacity(0.88))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
        }
        .padding(20)
        .glassCard()
    }

    private var quickActions: some View {
        HStack(spacing: 10) {
            QuickActionButton(title: "Connect", icon: "bolt.horizontal.circle.fill") {
                Task { await client.health(baseURL: bridgeBaseURL, token: bridgeToken) }
            }
            QuickActionButton(title: "Paste Mac", icon: "doc.on.clipboard.fill") {
                Task { await pasteToMacNow() }
            }
            QuickActionButton(title: "Screen", icon: "display") {
                Task { await client.refreshScreen(baseURL: bridgeBaseURL, token: bridgeToken) }
            }
        }
    }

    private var commandCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("Dispatch", systemImage: "paperplane.fill")
                    .font(.headline)
                Spacer()
                Picker("Mode", selection: $mode) {
                    ForEach(DispatchMode.allCases) { mode in
                        Text(mode.label).tag(mode)
                    }
                }
                .pickerStyle(.menu)
                .tint(.white)
            }

            TextEditor(text: $command)
                .font(.body)
                .scrollContentBackground(.hidden)
                .foregroundStyle(.white)
                .frame(minHeight: 116)
                .padding(12)
                .background(.black.opacity(0.22), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(alignment: .topLeading) {
                    if command.isEmpty {
                        Text("Type a command, or use the voice button above…")
                            .font(.body)
                            .foregroundStyle(.white.opacity(0.35))
                            .padding(.horizontal, 18)
                            .padding(.vertical, 20)
                            .allowsHitTesting(false)
                    }
                }

            Button {
                Task { await dispatchCurrentCommand() }
            } label: {
                HStack {
                    Image(systemName: "sparkles")
                    Text("Send to Hermes")
                    Spacer()
                    Image(systemName: "arrow.right")
                }
                .font(.headline.weight(.bold))
                .foregroundStyle(.black)
                .padding(.horizontal, 18)
                .frame(height: 56)
                .background(canDispatch ? Color.white : Color.white.opacity(0.38), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
            .disabled(!canDispatch)
        }
        .padding(18)
        .glassCard()
    }

    private var screenCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("Mac screen", systemImage: "rectangle.on.rectangle")
                    .font(.headline)
                Spacer()
                Button(client.isStreaming ? "Stop" : "Stream") {
                    client.isStreaming.toggle()
                }
                .font(.subheadline.weight(.bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(.white.opacity(0.12), in: Capsule())
            }

            if let image = client.lastImage {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18).stroke(.white.opacity(0.12)))
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "display.trianglebadge.exclamationmark")
                        .font(.system(size: 30, weight: .semibold))
                    Text("Screen preview appears here")
                        .font(.headline)
                    Text("If it fails, grant Screen Recording to the Mac bridge process.")
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.58))
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity, minHeight: 148)
                .background(.black.opacity(0.18), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
        }
        .padding(18)
        .glassCard()
    }

    private var statusCard: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: client.isConnected ? "checkmark.seal.fill" : "info.circle.fill")
                .foregroundStyle(client.isConnected ? .green : .yellow)
            Text(client.statusMessage)
                .font(.footnote.weight(.medium))
                .foregroundStyle(.white.opacity(0.72))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func handleVoiceButton() async {
        if voice.isListening {
            voice.stop()
            command = voice.lastFinalTranscript
            await dispatchCurrentCommand()
        } else {
            await voice.start()
        }
    }

    private func dispatchCurrentCommand() async {
        let text = trimmedCommand
        guard !text.isEmpty else { return }
        await client.dispatch(baseURL: bridgeBaseURL, token: bridgeToken, command: text, mode: mode)
        if client.isConnected {
            command = ""
            voice.reset()
        }
    }

    private func pasteToMacNow() async {
        let text = trimmedCommand
        guard !text.isEmpty else {
            client.statusMessage = "Type or speak something first, then tap Paste Mac."
            return
        }
        await client.dispatch(baseURL: bridgeBaseURL, token: bridgeToken, command: text, mode: .paste)
        if client.isConnected { command = "" }
    }

    private func applyBundledDefaultsIfNeeded() {
        let info = Bundle.main.infoDictionary ?? [:]
        if let bundledURL = info["HERMESDefaultBridgeURL"] as? String,
           !bundledURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           !bundledURL.contains("$(") {
            bridgeBaseURL = bundledURL
        }
        if let bundledToken = info["HERMESDefaultBridgeToken"] as? String,
           !bundledToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           !bundledToken.contains("$(") {
            bridgeToken = bundledToken
        }
    }
}

private struct SettingsView: View {
    @Binding var bridgeBaseURL: String
    @Binding var bridgeToken: String
    @ObservedObject var client: HermesBridgeClient
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            HermesBackground().ignoresSafeArea()
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Connect Mac")
                            .font(.largeTitle.weight(.black))
                        Text("Usually this should already be filled in from the local build.")
                            .font(.subheadline)
                            .foregroundStyle(.white.opacity(0.65))
                    }
                    Spacer()
                    Button("Done") { dismiss() }
                        .font(.headline)
                        .foregroundStyle(.white)
                }

                VStack(spacing: 14) {
                    SettingsField(title: "Bridge URL", text: $bridgeBaseURL, placeholder: "http://10.0.0.253:5138")
                        .keyboardType(.URL)
                    SettingsSecureField(title: "Mobile token", text: $bridgeToken, placeholder: "Token from ~/.hermes/.env")
                    Button {
                        Task { await client.health(baseURL: bridgeBaseURL, token: bridgeToken) }
                    } label: {
                        Label("Check Connection", systemImage: "bolt.horizontal.circle.fill")
                            .font(.headline.weight(.bold))
                            .foregroundStyle(.black)
                            .frame(maxWidth: .infinity, minHeight: 54)
                            .background(.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    }
                }
                .padding(18)
                .glassCard()

                Spacer()

                Text(client.statusMessage)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.white.opacity(0.68))
            }
            .padding(20)
        }
        .preferredColorScheme(.dark)
    }
}

private struct SettingsField: View {
    let title: String
    @Binding var text: String
    let placeholder: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.caption.weight(.bold))
                .foregroundStyle(.white.opacity(0.58))
            TextField(placeholder, text: $text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(14)
                .background(.black.opacity(0.22), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        }
    }
}

private struct SettingsSecureField: View {
    let title: String
    @Binding var text: String
    let placeholder: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.caption.weight(.bold))
                .foregroundStyle(.white.opacity(0.58))
            SecureField(placeholder, text: $text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(14)
                .background(.black.opacity(0.22), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        }
    }
}

private struct QuickActionButton: View {
    let title: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.title3.weight(.bold))
                Text(title)
                    .font(.caption.weight(.bold))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 74)
            .background(.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(.white.opacity(0.1)))
        }
        .buttonStyle(.plain)
    }
}

private struct StatusPill: View {
    let isConnected: Bool
    let text: String

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(isConnected ? .green : .yellow)
                .frame(width: 8, height: 8)
            Text(text)
                .font(.caption.weight(.bold))
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.white.opacity(0.1), in: Capsule())
    }
}

private struct AppGlyph: View {
    let size: CGFloat

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.26, style: .continuous)
                .fill(LinearGradient(colors: [.cyan, .blue, .purple], startPoint: .topLeading, endPoint: .bottomTrailing))
            Image(systemName: "bolt.fill")
                .font(.system(size: size * 0.44, weight: .black))
                .foregroundStyle(.white)
                .shadow(radius: 8)
        }
        .frame(width: size, height: size)
        .shadow(color: .cyan.opacity(0.28), radius: 16, y: 8)
    }
}

private struct HermesBackground: View {
    var body: some View {
        LinearGradient(
            colors: [Color(red: 0.02, green: 0.03, blue: 0.08), Color(red: 0.05, green: 0.08, blue: 0.18), Color(red: 0.03, green: 0.02, blue: 0.08)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .overlay(alignment: .topTrailing) {
            Circle()
                .fill(.cyan.opacity(0.22))
                .frame(width: 260, height: 260)
                .blur(radius: 70)
                .offset(x: 90, y: -80)
        }
        .overlay(alignment: .bottomLeading) {
            Circle()
                .fill(.purple.opacity(0.18))
                .frame(width: 300, height: 300)
                .blur(radius: 90)
                .offset(x: -120, y: 110)
        }
    }
}

private extension View {
    func glassCard() -> some View {
        background(.white.opacity(0.105), in: RoundedRectangle(cornerRadius: 28, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).stroke(.white.opacity(0.12)))
            .shadow(color: .black.opacity(0.28), radius: 28, y: 18)
    }
}

#Preview {
    ContentView()
}

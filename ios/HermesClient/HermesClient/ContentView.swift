import SwiftUI

struct ContentView: View {
    @AppStorage("bridgeBaseURL") private var bridgeBaseURL = "http://10.0.0.253:5138"
    @AppStorage("bridgeToken") private var bridgeToken = ""
    @StateObject private var client = HermesBridgeClient()
    @State private var command = ""
    @State private var mode: DispatchMode = .task

    var body: some View {
        NavigationStack {
            Form {
                Section("Mac Bridge") {
                    TextField("Base URL", text: $bridgeBaseURL)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                    SecureField("Mobile token", text: $bridgeToken)
                        .textInputAutocapitalization(.never)
                    Button("Check Connection") {
                        Task { await client.health(baseURL: bridgeBaseURL, token: bridgeToken) }
                    }
                }

                Section("Dispatch") {
                    Picker("Mode", selection: $mode) {
                        ForEach(DispatchMode.allCases) { mode in
                            Text(mode.label).tag(mode)
                        }
                    }
                    TextEditor(text: $command)
                        .frame(minHeight: 120)
                    Button("Send to Hermes") {
                        Task { await client.dispatch(baseURL: bridgeBaseURL, token: bridgeToken, command: command, mode: mode) }
                    }
                    .disabled(command.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || bridgeToken.isEmpty)
                }

                Section("Mac Screen") {
                    HStack {
                        Button("Refresh Screen") {
                            Task { await client.refreshScreen(baseURL: bridgeBaseURL, token: bridgeToken) }
                        }
                        Spacer()
                        Button(client.isStreaming ? "Stop Stream" : "Start Stream") {
                            client.isStreaming.toggle()
                        }
                    }
                    if let image = client.lastImage {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    } else {
                        ContentUnavailableView("No screen frame", systemImage: "display", description: Text("Grant Screen Recording on the Mac, then refresh."))
                    }
                }

                Section("Local Qwen MLX") {
                    Label("Shell ready; ASR engine next", systemImage: "waveform")
                    Text("The iPhone client is ready for command dispatch. The next step is wiring the Swift/MLX Qwen3-ASR 0.6B engine into this command box.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Status") {
                    Text(client.statusMessage)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Hermes Client")
            .task(id: client.isStreaming) {
                guard client.isStreaming else { return }
                while client.isStreaming && !Task.isCancelled {
                    await client.refreshScreen(baseURL: bridgeBaseURL, token: bridgeToken)
                    try? await Task.sleep(for: .seconds(1.25))
                }
            }
        }
    }
}

#Preview {
    ContentView()
}

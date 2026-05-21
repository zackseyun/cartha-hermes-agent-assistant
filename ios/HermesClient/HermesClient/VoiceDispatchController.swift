import AVFoundation
import Foundation
import Speech

@MainActor
final class VoiceDispatchController: NSObject, ObservableObject {
    enum VoiceState: Equatable {
        case idle
        case requestingPermission
        case listening
        case failed(String)

        var label: String {
            switch self {
            case .idle: "Ready"
            case .requestingPermission: "Requesting mic access"
            case .listening: "Listening"
            case .failed(let message): message
            }
        }
    }

    @Published var state: VoiceState = .idle
    @Published var transcript = ""
    @Published var lastFinalTranscript = ""

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let audioEngine = AVAudioEngine()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?

    var isListening: Bool {
        if case .listening = state { return true }
        return false
    }

    func toggle() async {
        if isListening {
            stop()
        } else {
            await start()
        }
    }

    func start() async {
        guard !isListening else { return }
        state = .requestingPermission

        let speechAuthorized = await requestSpeechAuthorization()
        guard speechAuthorized else {
            state = .failed("Speech access needed")
            return
        }

        let micAuthorized = await requestMicrophoneAuthorization()
        guard micAuthorized else {
            state = .failed("Mic access needed")
            return
        }

        do {
            transcript = ""
            lastFinalTranscript = ""
            try startRecognition()
            state = .listening
        } catch {
            state = .failed(error.localizedDescription)
            cleanup()
        }
    }

    func stop() {
        guard isListening || audioEngine.isRunning else { return }
        lastFinalTranscript = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest = nil
        state = .idle
    }

    func reset() {
        transcript = ""
        lastFinalTranscript = ""
        state = .idle
    }

    private func startRecognition() throws {
        cleanup()

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if #available(iOS 16.0, *) {
            request.addsPunctuation = true
        }
        recognitionRequest = request

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak request] buffer, _ in
            request?.append(buffer)
        }

        audioEngine.prepare()
        try audioEngine.start()

        recognitionTask = recognizer?.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor in
                guard let self else { return }
                if let result {
                    self.transcript = result.bestTranscription.formattedString
                    if result.isFinal {
                        self.lastFinalTranscript = self.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
                    }
                }
                if let error {
                    self.state = .failed(error.localizedDescription)
                    self.cleanup()
                }
            }
        }
    }

    private func cleanup() {
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest = nil
    }

    private func requestSpeechAuthorization() async -> Bool {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
    }

    private func requestMicrophoneAuthorization() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { allowed in
                continuation.resume(returning: allowed)
            }
        }
    }
}

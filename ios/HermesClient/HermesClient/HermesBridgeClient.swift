import Foundation
import UIKit

enum DispatchMode: String, CaseIterable, Identifiable {
    case task
    case clipboard
    case paste

    var id: String { rawValue }

    var label: String {
        switch self {
        case .task: "Hermes Task"
        case .clipboard: "Mac Clipboard"
        case .paste: "Paste on Mac"
        }
    }
}

struct BridgeHealth: Decodable {
    let ok: Bool
    let service: String?
    let urls: [String]?
    let modes: [String]?
}

struct DispatchResponse: Decodable {
    let ok: Bool
    let status: String?
    let mode: String?
    let message: String?
    let error: String?
    let stdout: String?
}

@MainActor
final class HermesBridgeClient: ObservableObject {
    @Published var statusMessage = "Not connected"
    @Published var lastImage: UIImage?
    @Published var isStreaming = false

    func health(baseURL: String, token: String) async {
        do {
            var request = try makeRequest(baseURL: baseURL, path: "/health", token: token)
            request.httpMethod = "GET"
            let (data, response) = try await URLSession.shared.data(for: request)
            try validate(response: response, data: data)
            let health = try JSONDecoder().decode(BridgeHealth.self, from: data)
            statusMessage = health.ok ? "Bridge online" : "Bridge unavailable"
        } catch {
            statusMessage = "Health failed: \(error.localizedDescription)"
        }
    }

    func dispatch(baseURL: String, token: String, command: String, mode: DispatchMode) async {
        do {
            var request = try makeRequest(baseURL: baseURL, path: "/dispatch", token: token)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: [
                "command": command,
                "mode": mode.rawValue,
                "title": "iPhone Hermes command"
            ])
            let (data, response) = try await URLSession.shared.data(for: request)
            try validate(response: response, data: data)
            let payload = try JSONDecoder().decode(DispatchResponse.self, from: data)
            if payload.ok {
                statusMessage = payload.message ?? payload.stdout ?? "Dispatched"
            } else {
                statusMessage = payload.error ?? "Dispatch failed"
            }
        } catch {
            statusMessage = "Dispatch failed: \(error.localizedDescription)"
        }
    }

    func refreshScreen(baseURL: String, token: String) async {
        do {
            var components = URLComponents(string: normalized(baseURL) + "/screen.jpg")
            components?.queryItems = [URLQueryItem(name: "width", value: "1100")]
            guard let url = components?.url else { throw BridgeError.badURL }
            var request = URLRequest(url: url)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
            let (data, response) = try await URLSession.shared.data(for: request)
            try validate(response: response, data: data)
            guard let image = UIImage(data: data) else { throw BridgeError.badImage }
            lastImage = image
            statusMessage = "Screen refreshed"
        } catch {
            statusMessage = "Screen failed: \(error.localizedDescription)"
        }
    }

    private func makeRequest(baseURL: String, path: String, token: String) throws -> URLRequest {
        guard let url = URL(string: normalized(baseURL) + path) else { throw BridgeError.badURL }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 30
        return request
    }

    private func normalized(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    private func validate(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw BridgeError.http(http.statusCode, body)
        }
    }
}

enum BridgeError: LocalizedError {
    case badURL
    case badImage
    case http(Int, String)

    var errorDescription: String? {
        switch self {
        case .badURL: "Bad bridge URL"
        case .badImage: "Screen response was not an image"
        case .http(let code, let body): "HTTP \(code): \(body.prefix(220))"
        }
    }
}

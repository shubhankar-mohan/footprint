import Foundation

// Streams snapshots from the bridge: SSE when reachable, else a short poll on drop.
// Yields raw Data so a decode failure never kills the stream (the store decodes).
public struct BridgeClient {
  public init() {}

  public func stream() -> AsyncStream<Data> {
    AsyncStream { continuation in
      let task = Task {
        while !Task.isCancelled {
          guard let base = BridgePaths.baseURL() else {
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            continue
          }
          do {
            var req = URLRequest(url: base.appendingPathComponent("events"))
            req.timeoutInterval = .infinity
            req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
            let (bytes, _) = try await URLSession.shared.bytes(for: req)
            for try await line in bytes.lines where line.hasPrefix("data: ") {
              continuation.yield(Data(line.dropFirst(6).utf8))
            }
          } catch {
            // SSE dropped → poll once so the UI isn't stale, then retry shortly.
            if let base = BridgePaths.baseURL(),
              let (data, _) = try? await URLSession.shared.data(
                from: base.appendingPathComponent("state")) {
              continuation.yield(data)
            }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
          }
        }
        continuation.finish()
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  public func decide(id: String, decision: String, updatedInput: [String: JSONValue]? = nil) async {
    guard let base = BridgePaths.baseURL() else { return }
    var req = URLRequest(url: base.appendingPathComponent("decision"))
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    var body: [String: Any] = ["id": id, "decision": decision]
    if let ui = updatedInput, let data = try? JSONEncoder().encode(ui),
      let obj = try? JSONSerialization.jsonObject(with: data) {
      body["updatedInput"] = obj
    }
    req.httpBody = try? JSONSerialization.data(withJSONObject: body)
    _ = try? await URLSession.shared.data(for: req)
  }

  // Phase 3: own a session (tmux), send input, reveal its terminal.
  public func launch(cwd: String, flags: [String: Any]) async -> String? {
    guard let base = BridgePaths.baseURL() else { return nil }
    var req = URLRequest(url: base.appendingPathComponent("tmux/launch"))
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: ["cwd": cwd, "flags": flags])
    guard let (data, _) = try? await URLSession.shared.data(for: req),
      let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
    return obj["name"] as? String
  }

  public func sendInput(name: String, text: String) async {
    await post("tmux/send", ["name": name, "text": text])
  }

  public func setAutoResume(name: String, on: Bool) async {
    await post("autoresume", ["name": name, "on": on])
  }

  public func setAutoResumeGlobal(on: Bool) async {
    await post("autoresume", ["global": on])
  }

  public func reveal(
    sessionId: String? = nil, session: String?, tier: String?,
    app: String? = nil, pid: Int? = nil
  ) async {
    var body: [String: Any] = [:]
    if let sessionId { body["sessionId"] = sessionId }
    if let session { body["session"] = session }
    if let tier { body["tier"] = tier }
    if let app { body["app"] = app }
    if let pid { body["pid"] = pid }
    await post("reveal", body)
  }

  private func post(_ path: String, _ body: [String: Any]) async {
    guard let base = BridgePaths.baseURL() else { return }
    var req = URLRequest(url: base.appendingPathComponent(path))
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: body)
    _ = try? await URLSession.shared.data(for: req)
  }
}

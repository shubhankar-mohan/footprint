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
}

import Foundation

/// What arrives on the event stream. A heartbeat carries no data but is the only
/// proof, between snapshots, that the bridge is still on the other end — the
/// client used to discard it, so "connected" meant no more than "a snapshot
/// turned up at some point", and the indicator could not go back.
public enum BridgeEvent: Equatable, Sendable {
  case snapshot(Data)
  case heartbeat
  case disconnected
}

// Streams snapshots from the bridge: SSE when reachable, else a short poll on drop.
// Yields raw Data so a decode failure never kills the stream (the store decodes).
public struct BridgeClient {
  /// The port of the bridge this app spawned, when one is running. The
  /// supervisor knows it first-hand; without it the client can only read the
  /// port file, which another bridge may have written — including an orphan
  /// left by a previous launch, which is how the menu bar ended up streaming
  /// from a bridge no hook was posting to.
  private let spawnedPort: () -> Int?

  public init(spawnedPort: @escaping () -> Int? = { nil }) {
    self.spawnedPort = spawnedPort
  }

  /// Every request resolves through here, so one half of the app can never end
  /// up talking to a different bridge than the other half.
  func base() -> URL? {
    guard let p = BridgePaths.preferredPort(spawned: spawnedPort(), filed: BridgePaths.port())
    else { return nil }
    return BridgePaths.baseURL(port: p)
  }

  /// One line of the SSE wire format. `data:` carries a snapshot; the bridge's
  /// `: ping` comment carries nothing but tells us it is still there. Anything
  /// else — blank separators, fields we do not use — is not an event.
  public static func classify(_ line: String) -> BridgeEvent? {
    if line.hasPrefix("data: ") { return .snapshot(Data(line.dropFirst(6).utf8)) }
    if line.hasPrefix(":") { return .heartbeat }
    return nil
  }

  public func stream() -> AsyncStream<BridgeEvent> {
    AsyncStream { continuation in
      let task = Task {
        while !Task.isCancelled {
          guard let root = base() else {
            continuation.yield(.disconnected)
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            continue
          }
          do {
            var req = URLRequest(url: root.appendingPathComponent("events"))
            req.timeoutInterval = .infinity
            req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
            let (bytes, _) = try await URLSession.shared.bytes(for: req)
            for try await line in bytes.lines {
              if let event = Self.classify(line) { continuation.yield(event) }
            }
            // A stream that ends without throwing is still a stream that ended.
            continuation.yield(.disconnected)
          } catch {
            continuation.yield(.disconnected)
            // SSE dropped → poll once so the UI isn't stale, then retry shortly.
            if let root = base(),
              let (data, _) = try? await URLSession.shared.data(
                from: root.appendingPathComponent("state")) {
              continuation.yield(.snapshot(data))
            }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
          }
        }
        continuation.finish()
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  /// Whether the bridge can use tmux. Starting a session, jumping to a terminal
  /// and forking all need it; without this the UI offered them anyway and failed
  /// at the moment the user clicked.
  public func tmuxAvailable() async -> Bool {
    guard let root = base() else { return false }
    var req = URLRequest(url: root.appendingPathComponent("health"))
    req.timeoutInterval = 2
    guard let (data, _) = try? await URLSession.shared.data(for: req),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return false }
    // Absent on an older bridge — assume yes rather than hiding a feature that
    // probably works.
    return obj["tmux"] as? Bool ?? true
  }

  public func decide(id: String, decision: String, updatedInput: [String: JSONValue]? = nil) async {
    guard let root = base() else { return }
    var req = URLRequest(url: root.appendingPathComponent("decision"))
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
  public func launch(cwd: String, flags: [String: Any], terminal: String) async -> String? {
    guard let root = base() else { return nil }
    var req = URLRequest(url: root.appendingPathComponent("tmux/launch"))
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(
      withJSONObject: ["cwd": cwd, "flags": flags, "terminal": terminal])
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

  public func dismiss(sessionId: String) async {
    await post("dismiss", ["sessionId": sessionId])
  }

  public func reveal(
    sessionId: String? = nil, session: String?, tier: String?,
    app: String? = nil, pid: Int? = nil, cwd: String? = nil
  ) async {
    var body: [String: Any] = [:]
    if let sessionId { body["sessionId"] = sessionId }
    if let session { body["session"] = session }
    if let tier { body["tier"] = tier }
    if let app { body["app"] = app }
    if let pid { body["pid"] = pid }
    if let cwd { body["cwd"] = cwd }
    await post("reveal", body)
  }

  private func post(_ path: String, _ body: [String: Any]) async {
    guard let root = base() else { return }
    var req = URLRequest(url: root.appendingPathComponent(path))
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: body)
    _ = try? await URLSession.shared.data(for: req)
  }
}

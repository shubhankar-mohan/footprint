import Foundation
import CCBarCore

// Spawns and watches the bundled Node bridge, restarting it if it exits.
//
// It also owns the answer to "which port is the bridge actually on?". The port
// file can't answer that — it is a mutable global any crashed bridge may have
// written last. So the supervisor reserves a free port itself and hands it to
// the bridge via CCBAR_PORT (server.js already honours it, defaulting to 0 =
// random). The port it spawned is then known first-hand, and is forgotten the
// moment that process dies.
final class BridgeSupervisor {
  private var process: Process?
  private var stopping = false
  private let lock = NSLock()
  private var port: Int?

  /// The port of the bridge *this app* spawned and believes is still running.
  /// nil when nothing has been spawned, the spawn failed, or the child exited.
  var livePort: Int? {
    lock.lock()
    defer { lock.unlock() }
    return port
  }

  private func setLivePort(_ p: Int?) {
    lock.lock()
    port = p
    lock.unlock()
  }

  func start() {
    guard let dir = BridgeLocation.dir() else { return }
    let js = dir.appendingPathComponent("server.js")
    let node = BridgeLocation.nodePath()
    // Reserved here rather than left to the bridge's own random pick, so the
    // app knows the port without re-reading a file it can't trust. If the
    // reservation loses the race to another process the bridge fails to bind
    // and exits; the restart below reserves a fresh one.
    let reserved = Self.reserveFreePort()

    let p = Process()
    p.executableURL = URL(fileURLWithPath: node)
    p.arguments = node.hasSuffix("env") ? ["node", js.path] : [js.path]
    if let reserved {
      var env = ProcessInfo.processInfo.environment
      env["CCBAR_PORT"] = String(reserved)
      p.environment = env
    }
    p.terminationHandler = { [weak self] _ in
      guard let self else { return }
      self.setLivePort(nil)
      guard !self.stopping else { return }
      DispatchQueue.global().asyncAfter(deadline: .now() + 1) { self.start() }
    }
    do { try p.run() } catch { return }
    process = p
    setLivePort(reserved)
  }

  func stop() {
    stopping = true
    setLivePort(nil)
    process?.terminationHandler = nil
    process?.terminate()
    process = nil
  }

  // MARK: - Reachability

  /// Is a bridge answering on this port right now? Deliberately short: this runs
  /// on a click, and a dead port must fail fast enough that the user reads it as
  /// an answer rather than a hang. Loopback only, so 300ms is generous.
  static func isReachable(port: Int, timeout: TimeInterval = 0.3) async -> Bool {
    guard let url = BridgePaths.baseURL(port: port)?.appendingPathComponent("health") else {
      return false
    }
    let cfg = URLSessionConfiguration.ephemeral
    cfg.timeoutIntervalForRequest = timeout
    cfg.timeoutIntervalForResource = timeout
    cfg.waitsForConnectivity = false
    let session = URLSession(configuration: cfg)
    defer { session.invalidateAndCancel() }

    var req = URLRequest(url: url)
    req.httpMethod = "GET"
    req.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    guard let (_, resp) = try? await session.data(for: req),
      let http = resp as? HTTPURLResponse
    else { return false }
    return (200..<400).contains(http.statusCode)
  }

  // MARK: - Port reservation

  /// Bind 127.0.0.1:0, read back what the kernel chose, close. The port is free
  /// at the instant we let go of it — a narrow race, and a recoverable one.
  private static func reserveFreePort() -> Int? {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    guard fd >= 0 else { return nil }
    defer { close(fd) }

    var addr = sockaddr_in()
    addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = 0
    addr.sin_addr.s_addr = INADDR_LOOPBACK.bigEndian
    let size = socklen_t(MemoryLayout<sockaddr_in>.size)

    let bound = withUnsafePointer(to: &addr) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, size) }
    }
    guard bound == 0 else { return nil }

    var out = sockaddr_in()
    var len = size
    let named = withUnsafeMutablePointer(to: &out) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &len) }
    }
    guard named == 0 else { return nil }
    let p = Int(UInt16(bigEndian: out.sin_port))
    return p > 0 ? p : nil
  }
}

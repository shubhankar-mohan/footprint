import Foundation
#if canImport(Darwin)
  import Darwin
#endif

// Where the bridge writes its live port. The app reads it to find the base URL —
// nothing is hard-coded, matching the bridge's random-port design.
//
// The port file is a mutable global with no ownership: any bridge that ever ran,
// including one that crashed, leaves its port behind. So the file is only
// believed when the process that wrote it is still alive.
public enum BridgePaths {
  public static var dir: URL {
    FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude-control-bar")
  }
  public static var portFile: URL { dir.appendingPathComponent("port") }

  /// The port recorded in the port file, or nil when there isn't a believable one.
  ///
  /// Two on-disk shapes are accepted, because the bridge is mid-migration:
  ///   • a bare integer — `54321` (the format shipped today)
  ///   • a JSON object  — `{"port":54321,"pid":900,"startedAt":1.7e12}`
  /// A JSON file whose `pid` is no longer running is stale and reports nothing;
  /// a bare integer carries no pid, so it can only be taken at face value.
  public static func port() -> Int? {
    guard let raw = try? String(contentsOf: portFile, encoding: .utf8) else { return nil }
    return parsePortFile(raw)
  }

  /// The parse, split out so it can be exercised without a real file on disk.
  public static func parsePortFile(_ raw: String) -> Int? {
    let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return nil }

    if let bare = Int(text) { return bare > 0 ? bare : nil }

    guard let data = text.data(using: .utf8),
      let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let port = (obj["port"] as? NSNumber)?.intValue, port > 0
    else { return nil }

    if let pid = (obj["pid"] as? NSNumber)?.int32Value, !isProcessAlive(pid) { return nil }
    return port
  }

  /// `kill(pid, 0)` sends no signal — it only asks whether the pid exists.
  /// 0 = alive; EPERM = alive but owned by another user; ESRCH = gone.
  public static func isProcessAlive(_ pid: pid_t) -> Bool {
    guard pid > 0 else { return false }
    if kill(pid, 0) == 0 { return true }
    return errno == EPERM
  }

  public static func baseURL() -> URL? {
    guard let p = port() else { return nil }
    return URL(string: "http://127.0.0.1:\(p)")
  }

  /// `http://127.0.0.1:<port>` for a port the caller already knows (e.g. the one
  /// the supervisor spawned), bypassing the file entirely.
  public static func baseURL(port: Int) -> URL? {
    URL(string: "http://127.0.0.1:\(port)")
  }
}

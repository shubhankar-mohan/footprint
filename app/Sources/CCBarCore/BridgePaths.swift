import Foundation

// Where the bridge writes its live port. The app reads it to find the base URL —
// nothing is hard-coded, matching the bridge's random-port design.
public enum BridgePaths {
  public static var dir: URL {
    FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude-control-bar")
  }
  public static var portFile: URL { dir.appendingPathComponent("port") }

  public static func port() -> Int? {
    guard let s = try? String(contentsOf: portFile, encoding: .utf8) else { return nil }
    return Int(s.trimmingCharacters(in: .whitespacesAndNewlines))
  }
  public static func baseURL() -> URL? {
    guard let p = port() else { return nil }
    return URL(string: "http://127.0.0.1:\(p)")
  }
}

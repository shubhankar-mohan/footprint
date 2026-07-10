import Foundation

// Shared: where the bundled Node bridge lives and which node to use. Used by the
// supervisor (to run server.js) and the hook installer (to run the scripts).
enum BridgeLocation {
  static func dir() -> URL? {
    if let res = Bundle.main.resourceURL {
      let d = res.appendingPathComponent("bridge")
      if FileManager.default.fileExists(atPath: d.appendingPathComponent("server.js").path) { return d }
    }
    if let env = ProcessInfo.processInfo.environment["CCBAR_BRIDGE"] {
      return URL(fileURLWithPath: env).deletingLastPathComponent()
    }
    return nil
  }

  static func nodePath() -> String {
    for p in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"] {
      if FileManager.default.fileExists(atPath: p) { return p }
    }
    return "/usr/bin/env"
  }
}

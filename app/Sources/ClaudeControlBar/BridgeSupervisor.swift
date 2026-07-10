import Foundation

// Spawns and watches the bundled Node bridge. In a built .app the bridge lives at
// Contents/Resources/bridge/server.js; in dev, set CCBAR_BRIDGE to the repo path.
final class BridgeSupervisor {
  private var process: Process?
  private var stopping = false

  private func serverJS() -> URL? {
    if let res = Bundle.main.resourceURL {
      let bundled = res.appendingPathComponent("bridge/server.js")
      if FileManager.default.fileExists(atPath: bundled.path) { return bundled }
    }
    if let env = ProcessInfo.processInfo.environment["CCBAR_BRIDGE"] {
      return URL(fileURLWithPath: env)
    }
    return nil
  }

  private func nodePath() -> String {
    for p in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"] {
      if FileManager.default.fileExists(atPath: p) { return p }
    }
    return "/usr/bin/env"
  }

  func start() {
    guard let js = serverJS() else { return }
    let node = nodePath()
    let p = Process()
    p.executableURL = URL(fileURLWithPath: node)
    p.arguments = node.hasSuffix("env") ? ["node", js.path] : [js.path]
    p.terminationHandler = { [weak self] _ in
      guard let self, !self.stopping else { return }
      DispatchQueue.global().asyncAfter(deadline: .now() + 1) { self.start() }
    }
    try? p.run()
    process = p
  }

  func stop() {
    stopping = true
    process?.terminationHandler = nil
    process?.terminate()
    process = nil
  }
}

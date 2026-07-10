import Foundation

// Spawns and watches the bundled Node bridge, restarting it if it exits.
final class BridgeSupervisor {
  private var process: Process?
  private var stopping = false

  func start() {
    guard let dir = BridgeLocation.dir() else { return }
    let js = dir.appendingPathComponent("server.js")
    let node = BridgeLocation.nodePath()
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

import Foundation

// Runs the bridge's proven install/uninstall scripts from inside the app, so the
// user never needs the terminal. Reuses scripts/install-hooks.mjs (backs up +
// merges + idempotent) and uninstall-hooks.mjs (surgical revert).
enum HookInstaller {
  static func isInstalled() -> Bool {
    let settings = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent(".claude/settings.json")
    guard let s = try? String(contentsOf: settings, encoding: .utf8) else { return false }
    return s.contains("cc-hook.mjs")
  }

  @discardableResult
  static func run(_ script: String, dry: Bool = false) -> String {
    guard let dir = BridgeLocation.dir() else { return "bridge scripts not found" }
    let node = BridgeLocation.nodePath()
    let p = Process()
    p.executableURL = URL(fileURLWithPath: node)
    var args = node.hasSuffix("env") ? ["node"] : []
    args.append(dir.appendingPathComponent("scripts/\(script)").path)
    if dry { args.append("--dry") }
    p.arguments = args
    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = pipe
    do { try p.run() } catch { return "failed to run \(script): \(error)" }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    return String(data: data, encoding: .utf8) ?? ""
  }

  static func install() -> String { run("install-hooks.mjs") }
  static func uninstall() -> String { run("uninstall-hooks.mjs") }
  static func previewDiff() -> String { run("install-hooks.mjs", dry: true) }
}

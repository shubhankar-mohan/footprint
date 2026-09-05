import Foundation

// Registers the bundled MCP server with Claude Code, so a live session can quote
// an earlier turn back to itself. Without this a Homebrew user gets the Bar and
// the Atlas and, silently, no MCP at all — there was no way to install it that
// didn't involve finding a path inside the .app by hand.
//
// It shells out to the `claude` CLI rather than editing config directly: the CLI
// owns that file's shape, and letting it write means we never corrupt someone's
// MCP setup.
enum MCPInstaller {
  static let serverName = "footprint"

  enum Outcome: Equatable {
    case enabled
    case alreadyEnabled
    case failed(String)
  }

  /// Where Claude Code launches the server from, inside the app bundle.
  static func serverScript() -> URL? {
    guard let dir = BridgeLocation.dir() else { return nil }
    let script = dir.appendingPathComponent("mcp-server.mjs")
    return FileManager.default.fileExists(atPath: script.path) ? script : nil
  }

  /// The `claude` CLI, looked for in the same spirit as node: known install
  /// locations first, because a GUI app inherits launchd's PATH, not a shell's.
  static func claudePath() -> String? {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    let candidates = [
      "\(home)/.claude/local/claude",
      "\(home)/.local/bin/claude",
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
    ]
    return candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
  }

  /// `claude mcp add --scope user footprint -- <node> <script>` as its parts.
  /// Scope is `user` deliberately: the CLI defaults to `local`, which registers
  /// the server only for the working directory it was run from — and a menu-bar
  /// app's working directory is `/`, so the default would install it nowhere
  /// anyone works.
  static func arguments(node: String, script: String) -> [String] {
    var args = ["mcp", "add", "--scope", "user", serverName, "--"]
    // The /usr/bin/env fallback needs the interpreter name as its first argument.
    if node.hasSuffix("env") { args.append(contentsOf: [node, "node"]) } else { args.append(node) }
    args.append(script)
    return args
  }

  /// The same thing a user would paste into a terminal — shown in the README and
  /// usable as a copyable fallback when the button can't find the CLI.
  static func shellOneLiner() -> String {
    let node = BridgeLocation.nodePath()
    let script = serverScript()?.path
      ?? "/Applications/Footprint.app/Contents/Resources/bridge/mcp-server.mjs"
    return (["claude"] + arguments(node: node, script: script)).joined(separator: " ")
  }

  static func install() -> Outcome {
    guard let script = serverScript() else {
      return .failed("The bundled MCP server wasn't found inside the app.")
    }
    guard let claude = claudePath() else {
      return .failed("Couldn't find the claude command. Install Claude Code, then try again.")
    }

    let p = Process()
    p.executableURL = URL(fileURLWithPath: claude)
    p.arguments = arguments(node: BridgeLocation.nodePath(), script: script.path)
    // The CLI is itself a node script, and its own launcher looks for node on
    // PATH — which is nearly empty for a GUI app.
    var env = ProcessInfo.processInfo.environment
    let path = env["PATH"] ?? ""
    env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" + (path.isEmpty ? "" : ":" + path)
    p.environment = env
    p.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser

    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = pipe
    do { try p.run() } catch { return .failed("Couldn't run claude: \(error.localizedDescription)") }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    let output = String(data: data, encoding: .utf8) ?? ""

    if output.localizedCaseInsensitiveContains("already exists") { return .alreadyEnabled }
    if p.terminationStatus == 0 { return .enabled }
    return .failed(firstLine(of: output))
  }

  private static func firstLine(of output: String) -> String {
    let line = output
      .split(separator: "\n")
      .first { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
      .map(String.init) ?? ""
    return line.isEmpty ? "claude mcp add did not complete." : line
  }
}

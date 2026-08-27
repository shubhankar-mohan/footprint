import Foundation
import Combine
import ServiceManagement
import CCBarCore

// What happened the last time the user enabled or removed monitoring. Drives the
// confirmation screen: enabling used to close the panel silently, so a working
// install and a failed one looked identical — and the one instruction that makes
// it work ("start a NEW session") was printed to stdout, where no GUI user sees it.
enum HookOutcome: Equatable {
  case installed
  case removed
  case failed(String)
}

// ObservableObject (not @Observable) because MenuBarExtra reliably re-renders from
// @Published via @StateObject/@ObservedObject; a nested @Observable did not update.
// Owns the bridge lifecycle + live stream, started once so the glyph/notifications
// stay current with the popover closed. SessionStore is reused purely as the
// decode + newly-needs differ.
final class AppModel: ObservableObject {
  @Published var snapshot: Snapshot = .empty
  @Published var connected = false
  @Published var hooksInstalled = false
  @Published var lastHookOutcome: HookOutcome?

  private let supervisor = BridgeSupervisor()
  private let client = BridgeClient()
  private let differ = SessionStore()
  private var streamTask: Task<Void, Never>?

  init() {
    supervisor.start()
    Notifier.requestAuth()
    hooksInstalled = HookInstaller.isInstalled()
    streamTask = Task { @MainActor [weak self] in
      guard let self else { return }
      for await raw in self.client.stream() {
        let newly = self.differ.apply(raw)
        self.snapshot = self.differ.snapshot
        self.connected = true
        for id in newly {
          let proj = self.snapshot.sessions.first { $0.id == id }?.project ?? "A session"
          Notifier.needsYou(project: proj)
        }
      }
    }
  }

  func decide(_ id: String, _ decision: String) {
    Task { [client] in await client.decide(id: id, decision: decision) }
  }

  // Phase 3: start an owned session (tmux) + open its terminal; reveal; quick input.
  func startSession(cwd: String, terminal: String, mode: String) {
    Task { [client] in
      var flags: [String: Any] = [:]
      if mode == "bypass" { flags["skip"] = true }
      else if mode != "ask" { flags["mode"] = mode }
      if let name = await client.launch(cwd: cwd, flags: flags, terminal: terminal) {
        // No placeholder session yet — pass cwd so the first Warp reveal opens in
        // the project dir. Later clicks resolve everything from the owned row.
        await client.reveal(sessionId: name, session: name, tier: "owned", app: terminal, cwd: cwd)
      }
    }
  }

  func revealSession(_ s: Session) {
    // Send only the session id; the bridge resolves the terminal identity it
    // captured from this session's hooks (tmux / tty / terminalApp).
    Task { [client] in
      await client.reveal(sessionId: s.id, session: s.tmux, tier: s.tier?.rawValue)
    }
  }

  func sendInput(_ name: String, _ text: String) {
    Task { [client] in await client.sendInput(name: name, text: text) }
  }

  func dismissSession(_ s: Session) {
    Task { [client] in await client.dismiss(sessionId: s.id) }
  }

  func setAutoResume(_ name: String, _ on: Bool) {
    Task { [client] in await client.setAutoResume(name: name, on: on) }
  }

  func setAutoResumeGlobal(_ on: Bool) {
    Task { [client] in await client.setAutoResumeGlobal(on: on) }
  }

  // Hook install/uninstall run off the main thread (they spawn node + touch disk).
  func installHooks() { runHook(expecting: true) { HookInstaller.install() } }
  func uninstallHooks() { runHook(expecting: false) { HookInstaller.uninstall() } }
  func previewDiff(_ completion: @escaping (String) -> Void) {
    DispatchQueue.global().async {
      let out = HookInstaller.previewDiff()
      DispatchQueue.main.async { completion(out) }
    }
  }

  func clearHookOutcome() { lastHookOutcome = nil }

  // Verify against the file rather than trusting the exit path: the script can
  // print an error and still exit 0 (e.g. ~/.claude missing entirely).
  private func runHook(expecting installed: Bool, _ work: @escaping () -> String) {
    DispatchQueue.global().async {
      let output = work()
      let actual = HookInstaller.isInstalled()
      DispatchQueue.main.async {
        self.hooksInstalled = actual
        self.lastHookOutcome =
          actual == installed
          ? (installed ? .installed : .removed)
          : .failed(Self.firstProblem(in: output))
      }
    }
  }

  // The scripts print a human-readable reason on the first line when they bail
  // (e.g. "~/.claude does not exist. Install & run Claude Code once first").
  private static func firstProblem(in output: String) -> String {
    let line = output
      .split(separator: "\n")
      .first { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
      .map(String.init) ?? ""
    return line.isEmpty ? "The hook script did not complete." : line
  }

  // MARK: - Launch at login

  var launchAtLogin: Bool {
    SMAppService.mainApp.status == .enabled
  }

  func setLaunchAtLogin(_ on: Bool) {
    do {
      if on { try SMAppService.mainApp.register() }
      else { try SMAppService.mainApp.unregister() }
    } catch {
      // Non-fatal: the toggle simply reflects the real status on next read.
    }
    objectWillChange.send()
  }

  static var appVersion: String {
    let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
    return v ?? "dev"
  }
}

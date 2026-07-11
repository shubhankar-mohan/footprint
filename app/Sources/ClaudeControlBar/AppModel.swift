import Foundation
import Combine
import CCBarCore

// ObservableObject (not @Observable) because MenuBarExtra reliably re-renders from
// @Published via @StateObject/@ObservedObject; a nested @Observable did not update.
// Owns the bridge lifecycle + live stream, started once so the glyph/notifications
// stay current with the popover closed. SessionStore is reused purely as the
// decode + newly-needs differ.
final class AppModel: ObservableObject {
  @Published var snapshot: Snapshot = .empty
  @Published var connected = false
  @Published var hooksInstalled = false

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
      if let name = await client.launch(cwd: cwd, flags: flags) {
        await client.reveal(session: name, tier: "owned", app: terminal, pid: nil)
      }
    }
  }

  func revealSession(_ s: Session) {
    Task { [client] in
      await client.reveal(session: s.tmux, tier: s.tier?.rawValue, app: "Terminal", pid: nil)
    }
  }

  func sendInput(_ name: String, _ text: String) {
    Task { [client] in await client.sendInput(name: name, text: text) }
  }

  func setAutoResume(_ name: String, _ on: Bool) {
    Task { [client] in await client.setAutoResume(name: name, on: on) }
  }

  // Hook install/uninstall run off the main thread (they spawn node + touch disk).
  func installHooks() { runHook { HookInstaller.install() } }
  func uninstallHooks() { runHook { HookInstaller.uninstall() } }
  func previewDiff(_ completion: @escaping (String) -> Void) {
    DispatchQueue.global().async {
      let out = HookInstaller.previewDiff()
      DispatchQueue.main.async { completion(out) }
    }
  }
  private func runHook(_ work: @escaping () -> String) {
    DispatchQueue.global().async {
      _ = work()
      let installed = HookInstaller.isInstalled()
      DispatchQueue.main.async { self.hooksInstalled = installed }
    }
  }
}

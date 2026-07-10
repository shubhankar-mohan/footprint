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

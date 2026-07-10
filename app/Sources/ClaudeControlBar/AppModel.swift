import Foundation
import CCBarCore

// Owns the bridge lifecycle and the live stream, started once at launch so the
// menu-bar glyph (and later, notifications) stay current even with the popover closed.
final class AppModel {
  let store: SessionStore
  private let supervisor = BridgeSupervisor()
  private let client = BridgeClient()
  private var streamTask: Task<Void, Never>?

  init() {
    store = SessionStore()
    supervisor.start()
    streamTask = Task { @MainActor [store, client] in
      for await raw in client.stream() {
        store.connected = true
        store.apply(raw)
      }
    }
  }

  func decide(_ id: String, _ decision: String) {
    Task { [client] in await client.decide(id: id, decision: decision) }
  }
}

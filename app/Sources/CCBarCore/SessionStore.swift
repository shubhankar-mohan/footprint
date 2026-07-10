import Foundation
import Observation

// Single source of truth for the UI. Decodes /state or SSE blobs into a Snapshot
// and reports which sessions newly entered `needs` (so the Notifier fires once).
@MainActor
@Observable
public final class SessionStore {
  public var snapshot: Snapshot = .empty
  public var connected: Bool = false
  private var previousNeeds: Set<String> = []

  public init() {}

  /// Apply a raw /state or SSE `data:` JSON blob. Returns session ids that newly
  /// entered `needs` since the last apply. A decode failure is ignored (keeps the
  /// last good snapshot) so a malformed frame never wipes the UI.
  @discardableResult
  public func apply(_ raw: Data) -> [String] {
    guard let snap = try? JSONDecoder().decode(Snapshot.self, from: raw) else { return [] }
    let nowNeeds = Set(snap.sessions.filter { $0.state == .needs }.map { $0.id })
    let newly = nowNeeds.subtracting(previousNeeds)
    previousNeeds = nowNeeds
    snapshot = snap
    return Array(newly).sorted()
  }
}

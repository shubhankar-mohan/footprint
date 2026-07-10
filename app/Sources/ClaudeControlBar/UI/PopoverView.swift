import SwiftUI
import CCBarCore

struct PopoverView: View {
  let store: SessionStore
  let onDecide: (String, String) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        Text("Claude Control Bar").font(.system(size: 12, weight: .semibold))
        Spacer()
        Circle().fill(store.connected ? Color.green : Color.secondary).frame(width: 6, height: 6)
      }
      .padding(.horizontal, 12).padding(.vertical, 8)
      Divider()

      if !store.snapshot.pending.isEmpty {
        ForEach(store.snapshot.pending) { p in
          PermissionPromptView(pending: p, onDecide: onDecide)
        }
        Divider()
      }

      if store.snapshot.sessions.isEmpty {
        Text("The map is quiet.")
          .font(.system(size: 13)).foregroundStyle(.secondary)
          .frame(maxWidth: .infinity).padding(.vertical, 28)
      } else {
        ForEach(sorted(store.snapshot.sessions)) { s in SessionRowView(session: s) }
      }

      Divider()
      HStack {
        Text("Mischief managed").font(.system(size: 10)).foregroundStyle(.tertiary)
        Spacer()
        Button("Quit") { NSApplication.shared.terminate(nil) }
          .buttonStyle(.plain).font(.system(size: 11)).foregroundStyle(.secondary)
      }
      .padding(.horizontal, 12).padding(.vertical, 6)
    }
    .frame(width: 320)
  }

  // needs > working > paused > idle, then stable by project name.
  private func sorted(_ sessions: [Session]) -> [Session] {
    sessions.sorted { a, b in
      rank(a.state) != rank(b.state) ? rank(a.state) < rank(b.state) : a.project < b.project
    }
  }
  private func rank(_ s: SessionState) -> Int {
    switch s { case .needs: 0; case .working: 1; case .paused: 2; case .idle: 3; case .ended: 4 }
  }
}

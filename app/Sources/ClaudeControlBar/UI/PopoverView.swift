import SwiftUI
import CCBarCore

struct PopoverView: View {
  @ObservedObject var model: AppModel
  let onDecide: (String, String) -> Void
  @State private var showSettings = false
  @State private var showStart = false

  var body: some View {
    if showSettings {
      SettingsView(model: model, show: $showSettings)
    } else if showStart {
      StartSessionView(model: model, show: $showStart)
    } else {
      main
    }
  }

  private var main: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        Text("Claude Control Bar").font(.system(size: 12, weight: .semibold))
        Spacer()
        Circle().fill(model.connected ? Color.green : Color.secondary).frame(width: 6, height: 6)
        Button { showStart = true } label: { Image(systemName: "plus") }
          .buttonStyle(.plain).foregroundStyle(.secondary).help("Start a session")
        Button { showSettings = true } label: { Image(systemName: "gearshape") }
          .buttonStyle(.plain).foregroundStyle(.secondary).help("Monitoring settings")
      }
      .padding(.horizontal, 12).padding(.vertical, 8)
      Divider()

      if !model.snapshot.pending.isEmpty {
        ForEach(model.snapshot.pending) { p in
          PermissionPromptView(pending: p, onDecide: onDecide)
        }
        Divider()
      }

      // Usage hourglass — hidden below 50% (calm until it matters).
      if let u = model.snapshot.usage, u.peakPercentage >= 50 {
        HourglassView(usage: u)
        Divider()
      }

      if model.snapshot.sessions.isEmpty {
        emptyState
      } else {
        ForEach(sorted(model.snapshot.sessions)) { s in
          SessionRowView(session: s, onReveal: { model.revealSession(s) })
          if s.tier == .owned, let name = s.tmux {
            OwnedInputBar(name: name, onSend: { model.sendInput($0, $1) })
          }
        }
      }

      Divider()
      HStack {
        Text("Mischief managed").font(.system(size: 10)).foregroundStyle(.tertiary)
        Spacer()
        Button("New session") { showStart = true }
          .buttonStyle(.plain).font(.system(size: 11)).foregroundStyle(Theme.color(.working))
        Text("·").foregroundStyle(.tertiary)
        Button("Quit") { NSApplication.shared.terminate(nil) }
          .buttonStyle(.plain).font(.system(size: 11)).foregroundStyle(.secondary)
      }
      .padding(.horizontal, 12).padding(.vertical, 6)
    }
    .frame(width: 320)
    .background(Theme.popoverBG)
  }

  @ViewBuilder private var emptyState: some View {
    VStack(spacing: 8) {
      Text("The map is quiet.").font(.system(size: 13)).foregroundStyle(.secondary)
      if !model.hooksInstalled {
        Text("Monitoring is off, so sessions won't appear.")
          .font(.system(size: 11)).foregroundStyle(.tertiary)
        Button("Enable monitoring") { showSettings = true }
          .font(.system(size: 12, weight: .semibold)).buttonStyle(.borderedProminent)
      } else {
        Button("Start a session") { showStart = true }
          .font(.system(size: 12, weight: .semibold)).buttonStyle(.borderedProminent)
      }
    }
    .frame(maxWidth: .infinity).padding(.vertical, 24)
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

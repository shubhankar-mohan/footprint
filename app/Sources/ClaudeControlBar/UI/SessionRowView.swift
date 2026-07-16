import SwiftUI
import CCBarCore

struct SessionRowView: View {
  let session: Session
  var onReveal: () -> Void = {}
  @State private var hovering = false
  var body: some View {
    HStack(spacing: 8) {
      Rectangle().fill(Theme.color(session.state)).frame(width: 3, height: 28)
      Image(systemName: Theme.symbol(session.state)).foregroundStyle(Theme.color(session.state))
      VStack(alignment: .leading, spacing: 1) {
        HStack(spacing: 6) {
          Text(session.title).font(.system(size: 13, weight: .semibold))
          if let tier = session.tier {
            Text(tierLabel(tier))
              .font(.system(size: 9, weight: .medium)).foregroundStyle(.secondary)
              .padding(.horizontal, 4).padding(.vertical, 1)
              .background(Color.secondary.opacity(0.12), in: Capsule())
          }
        }
        Text(Theme.label(session.state) + (session.tool.map { " · \($0)" } ?? ""))
          .font(.system(size: 11)).foregroundStyle(Theme.color(session.state))
      }
      Spacer()
      if hovering {
        HStack(spacing: 3) {
          if let app = session.terminalApp {
            Text(app).font(.system(size: 10)).foregroundStyle(.secondary)
          }
          Image(systemName: "arrow.up.forward.app").font(.system(size: 11)).foregroundStyle(.secondary)
        }
      } else if let t = session.updatedAt {
        Text(relative(t)).font(.system(size: 11)).foregroundStyle(.tertiary)
      }
    }
    .padding(.horizontal, 12).frame(height: 44)
    .background(hovering ? Theme.rowHover : Color.clear)
    .contentShape(Rectangle())
    .onHover { hovering = $0 }
    .onTapGesture { onReveal() }
    .help(session.terminalApp.map { "Click to open this session in \($0)" }
      ?? "Click to open this session's terminal")
  }

  private func tierLabel(_ t: Tier) -> String {
    switch t { case .owned: "Owned"; case .attached: "Attached"; case .bestEffort: "Best-effort" }
  }
  private func relative(_ ms: Double) -> String {
    let secs = max(0, Date().timeIntervalSince1970 - ms / 1000)
    if secs < 60 { return "just now" }
    if secs < 3600 { return "\(Int(secs / 60))m" }
    return "\(Int(secs / 3600))h"
  }
}

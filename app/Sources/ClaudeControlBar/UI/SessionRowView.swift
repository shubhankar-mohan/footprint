import SwiftUI
import AppKit
import CCBarCore

struct SessionRowView: View {
  let session: Session
  var onReveal: () -> Void = {}
  var onDismiss: () -> Void = {}
  @State private var hovering = false
  @State private var copied = false

  private var isIdle: Bool { session.state == .idle || session.state == .ended }

  var body: some View {
    HStack(spacing: 4) {
      // Reveal is the main hit target and fills the row. A .plain Button (not
      // onTapGesture) reliably registers clicks inside a MenuBarExtra window.
      Button(action: onReveal) {
        HStack(spacing: 8) {
          Rectangle().fill(Theme.color(session.state)).frame(width: 3, height: 28)
          Image(systemName: Theme.symbol(session.state)).foregroundStyle(Theme.color(session.state))
          VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 6) {
              Text(session.title).font(.system(size: 13, weight: .semibold)).lineLimit(1)
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
          Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .help(session.terminalApp.map { "Click to open this session in \($0)" }
        ?? "Click to open this session's terminal")

      // Trailing controls — siblings of the reveal button so their taps are their
      // own (not swallowed by reveal). Shown on hover.
      if hovering {
        Button { copyName() } label: {
          Image(systemName: copied ? "checkmark" : "doc.on.doc").font(.system(size: 11))
        }
        .buttonStyle(.plain).foregroundStyle(copied ? Theme.color(.working) : .secondary)
        .help("Copy session name")

        Image(systemName: "arrow.up.forward.app").font(.system(size: 11)).foregroundStyle(.tertiary)

        if isIdle {
          Button(action: onDismiss) {
            Image(systemName: "xmark").font(.system(size: 10, weight: .bold))
          }
          .buttonStyle(.plain).foregroundStyle(.secondary)
          .help("Remove this session from the list")
        }
      } else if let t = session.updatedAt {
        Text(relative(t)).font(.system(size: 11)).foregroundStyle(.tertiary)
      }
    }
    .padding(.horizontal, 12).frame(height: 44)
    .background(hovering ? Theme.rowHover : Color.clear)
    .onHover { hovering = $0 }
  }

  private func copyName() {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(session.title, forType: .string)
    copied = true
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { copied = false }
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

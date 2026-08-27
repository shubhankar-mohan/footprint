import SwiftUI
import AppKit
import CCBarCore

struct SessionRowView: View {
  let session: Session
  var onReveal: () -> Void = {}
  var onDismiss: () -> Void = {}
  @State private var hovering = false
  @State private var copied = false
  @State private var pulsing = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private var isIdle: Bool { session.state == .idle || session.state == .ended }
  private var isNeeds: Bool { session.state == .needs }
  private var isOwned: Bool { session.tier == .owned }

  var body: some View {
    HStack(spacing: 10) {
      // Reveal is the main hit target and fills the row. A .plain Button (not
      // onTapGesture) reliably registers clicks inside a MenuBarExtra window.
      Button(action: onReveal) {
        HStack(spacing: 10) {
          // One status signal: the footprint, colored by state (pulses when working).
          Image(systemName: Theme.symbol(session.state))
            .font(.system(size: 15))
            .foregroundStyle(Theme.color(session.state))
            .opacity(session.state == .working && pulsing ? 0.55 : 1)
            .frame(width: 18)
          VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 5) {
              Text(session.title).font(.system(size: 13, weight: .semibold)).lineLimit(1)
              if isOwned {
                // Owned = we launched it and can reply. Small terminal glyph; the
                // full tier name lives in the tooltip, not a jargon capsule.
                Image(systemName: "terminal")
                  .font(.system(size: 10)).foregroundStyle(.tertiary)
                  .help("Owned session — you can reply to it from here")
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
      // Without this the row reads as loose fragments — "pawprint", "footprints",
      // "Waiting on you" — and state, which is carried by color, is lost entirely.
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(rowDescription)
      .accessibilityHint(session.terminalApp.map { "Opens this session in \($0)" }
        ?? "Opens this session's terminal")

      // Trailing controls — siblings of the reveal button so their taps are their
      // own (not swallowed by reveal). Shown on hover; otherwise a relative time.
      if hovering {
        Button { copyName() } label: {
          Image(systemName: copied ? "checkmark" : "doc.on.doc").font(.system(size: 11))
        }
        .buttonStyle(.plain).foregroundStyle(copied ? Theme.color(.working) : .secondary)
        .help("Copy session name")

        if isIdle {
          Button(action: onDismiss) {
            Image(systemName: "xmark").font(.system(size: 11, weight: .bold))
          }
          .buttonStyle(.plain).foregroundStyle(.secondary)
          .help("Remove this session from the list")
        }
      } else if let t = session.updatedAt {
        Text(relative(t))
          .font(.system(size: 11)).foregroundStyle(.tertiary)
          .monospacedDigit()
      }
    }
    .padding(.horizontal, 13).frame(minHeight: 42)
    .background(rowBackground)
    .onHover { hovering = $0 }
    .onAppear {
      guard session.state == .working, !reduceMotion else { return }
      withAnimation(.easeInOut(duration: 1.3).repeatForever(autoreverses: true)) { pulsing = true }
    }
  }

  // Everything the row conveys visually, spoken in one sentence: name, state,
  // current tool, whether we own it, and how long since it moved.
  private var rowDescription: String {
    var parts = [session.title, Theme.label(session.state)]
    if let tool = session.tool { parts.append("running \(tool)") }
    if isOwned { parts.append("owned session, you can reply to it") }
    if let t = session.updatedAt {
      let r = relative(t)
      parts.append(r == "now" ? "updated just now" : "updated \(r) ago")
    }
    return parts.joined(separator: ", ")
  }

  // needs-you rows carry a soft warm tint (the one state that should pop); the
  // rest stay quiet, lifting only on hover.
  private var rowBackground: Color {
    if hovering { return Theme.rowHover }
    if isNeeds { return Theme.needsTint }
    return .clear
  }

  private func copyName() {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(session.title, forType: .string)
    copied = true
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { copied = false }
  }

  private func relative(_ ms: Double) -> String {
    let secs = max(0, Date().timeIntervalSince1970 - ms / 1000)
    if secs < 60 { return "now" }
    if secs < 3600 { return "\(Int(secs / 60))m" }
    return "\(Int(secs / 3600))h"
  }
}

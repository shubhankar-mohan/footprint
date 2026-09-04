import SwiftUI
import AppKit
import CCBarCore

struct PopoverView: View {
  @ObservedObject var model: AppModel
  let onDecide: (String, String) -> Void
  @State private var showSettings = false
  @State private var showStart = false
  @Environment(\.colorScheme) private var colorScheme

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
      header
      Divider()

      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          needsSection
          group("Working", .working, workingRows)
          group("Idle", .idle, idleRows)
          if isEmpty { emptyState }
        }
      }
      .frame(maxHeight: listMaxHeight)

      if let u = model.snapshot.usage {
        Divider()
        HourglassView(usage: u)
      }

      Divider()
      footer
    }
    .frame(width: 320)
    .background(surface)
  }

  // Warm-blue ground with a soft top light (subtle in dark).
  private var surface: some View {
    Theme.popoverBG.overlay(
      RadialGradient(
        colors: [Color.white.opacity(colorScheme == .dark ? 0.10 : 0.45), .clear],
        center: .top, startRadius: 0, endRadius: 260
      )
    )
  }

  private var header: some View {
    HStack {
      Text("Footprint").font(.system(size: 12, weight: .semibold)).lineLimit(1)
      Spacer()
      Circle().fill(model.connected ? Theme.color(.working) : Color.secondary)
        .frame(width: 6, height: 6)
        .accessibilityLabel(model.connected ? "Connected to the bridge" : "Not connected")
      // The Atlas is served by the bridge on its random port, so the URL is
      // resolved at click time rather than hard-coded.
      Button { openAtlas() } label: { Image(systemName: "map") }
        .buttonStyle(.plain).foregroundStyle(.secondary)
        .help("Open the Atlas — browse, search and graph every session")
        .accessibilityLabel("Open the Atlas in your browser")
      Button { showStart = true } label: { Image(systemName: "plus") }
        .buttonStyle(.plain).foregroundStyle(.secondary).help("Start a session")
        .accessibilityLabel("Start a session")
      Button { showSettings = true } label: { Image(systemName: "gearshape") }
        .buttonStyle(.plain).foregroundStyle(.secondary).help("Monitoring settings")
        .accessibilityLabel("Monitoring settings")
    }
    .padding(.horizontal, 13).padding(.vertical, 9)
  }

  // "Needs you" gathers pending permission prompts and any needs-state rows —
  // the one section that should draw the eye, pinned to the top.
  @ViewBuilder private var needsSection: some View {
    let pending = model.snapshot.pending
    let rows = needsRows
    if !pending.isEmpty || !rows.isEmpty {
      sectionHeader("Needs you", Theme.color(.needs), pending.count + rows.count)
      ForEach(pending) { p in
        PermissionPromptView(pending: p, onDecide: onDecide)
      }
      ForEach(rows) { s in sessionRow(s) }
    }
  }

  @ViewBuilder private func group(_ title: String, _ state: SessionState, _ rows: [Session]) -> some View {
    if !rows.isEmpty {
      sectionHeader(title, Theme.color(state), rows.count)
      ForEach(rows) { s in sessionRow(s) }
    }
  }

  @ViewBuilder private func sessionRow(_ s: Session) -> some View {
    SessionRowView(
      session: s,
      onReveal: { model.revealSession(s) },
      onDismiss: { model.dismissSession(s) }
    )
    // Inline reply only when an Owned session is actually waiting on you.
    if s.state == .needs, s.tier == .owned, let name = s.tmux {
      OwnedInputBar(name: name, lastLine: s.lastLine, onSend: { model.sendInput($0, $1) })
    }
  }

  // Serif italic label — a quiet nod to the map/document motif — plus a count.
  private func sectionHeader(_ title: String, _ color: Color, _ count: Int) -> some View {
    HStack(spacing: 7) {
      Text(title)
        .font(.system(size: 12, weight: .semibold, design: .serif)).italic()
        .foregroundStyle(color)
      Text("\(count)").font(.system(size: 11)).foregroundStyle(.tertiary)
      Spacer()
    }
    .padding(.horizontal, 13).padding(.top, 12).padding(.bottom, 5)
  }

  private var footer: some View {
    HStack {
      Text(summary).font(.system(size: 11)).foregroundStyle(.tertiary)
      Spacer()
      Button("Quit") { NSApplication.shared.terminate(nil) }
        .buttonStyle(.plain).font(.system(size: 11)).foregroundStyle(.secondary)
    }
    .padding(.horizontal, 13).padding(.vertical, 8)
  }

  // The bridge picks a random free port on boot and writes it to the port file,
  // so the Atlas URL only exists at runtime.
  private func openAtlas() {
    guard let port = BridgePaths.port(),
          let url = URL(string: "http://127.0.0.1:\(port)/atlas") else { return }
    NSWorkspace.shared.open(url)
  }

  // Warmth, context, one primary action. The line is set in the same serif italic
  // as the section headers beside it — it is the friendliest sentence in the
  // product and was the only one rendering in plain SF.
  @ViewBuilder private var emptyState: some View {
    VStack(spacing: 8) {
      Text("The map is quiet.")
        .font(.system(size: 15, design: .serif)).italic()
        .foregroundStyle(.secondary)
      if !model.hooksInstalled {
        Text("Monitoring is off, so sessions won't appear.")
          .font(.system(size: 11)).foregroundStyle(.tertiary)
        Button("Turn on monitoring") { showSettings = true }
          .font(.system(size: 12, weight: .semibold)).buttonStyle(.borderedProminent)
          .accessibilityHint("Explains what changes on your machine before anything is written")
      } else {
        Button("Start a session") { showStart = true }
          .font(.system(size: 12, weight: .semibold)).buttonStyle(.borderedProminent)
      }
    }
    .frame(maxWidth: .infinity).padding(.vertical, 28)
  }

  // Let the list breathe — up to ~2.5× the old 400pt cap, bounded by the screen
  // so a long session list never runs off the top or bottom.
  private var listMaxHeight: CGFloat {
    let screen = NSScreen.main?.visibleFrame.height ?? 900
    return min(1000, screen * 0.72)
  }

  // MARK: - Grouping

  private var needsRows: [Session] { byProject(model.snapshot.sessions.filter { $0.state == .needs }) }
  private var workingRows: [Session] { byProject(model.snapshot.sessions.filter { $0.state == .working }) }
  private var idleRows: [Session] {
    byProject(model.snapshot.sessions.filter { $0.state == .idle || $0.state == .paused || $0.state == .ended })
  }
  private var isEmpty: Bool { model.snapshot.sessions.isEmpty && model.snapshot.pending.isEmpty }

  private func byProject(_ s: [Session]) -> [Session] { s.sorted { $0.project < $1.project } }

  private var summary: String {
    var parts: [String] = []
    let n = needsRows.count + model.snapshot.pending.count
    if n > 0 { parts.append("\(n) needs you") }
    if !workingRows.isEmpty { parts.append("\(workingRows.count) working") }
    if !idleRows.isEmpty { parts.append("\(idleRows.count) idle") }
    return parts.isEmpty ? "No sessions" : parts.joined(separator: " · ")
  }
}

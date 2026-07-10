import SwiftUI
import AppKit

// Terminal-first "Start a session": pick dir + terminal + permission mode, launch
// an Owned (tmux) session, and bring the terminal forward attached to it.
struct StartSessionView: View {
  @ObservedObject var model: AppModel
  @Binding var show: Bool
  @State private var cwd = ""
  @State private var terminal = "Terminal"
  @State private var mode = "ask"

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 6) {
        Button { show = false } label: { Image(systemName: "chevron.left") }.buttonStyle(.plain)
        Text("Start a session").font(.system(size: 12, weight: .semibold))
        Spacer()
      }

      VStack(alignment: .leading, spacing: 4) {
        Text("Working directory").font(.system(size: 11)).foregroundStyle(.secondary)
        HStack {
          Text(cwd.isEmpty ? "Choose a folder…" : cwd)
            .font(.system(size: 12)).foregroundStyle(cwd.isEmpty ? .secondary : .primary)
            .lineLimit(1).truncationMode(.head)
          Spacer()
          Button("Choose…") { chooseDir() }.controlSize(.small)
        }
      }

      Picker("Terminal", selection: $terminal) {
        Text("Terminal").tag("Terminal"); Text("iTerm").tag("iTerm"); Text("Warp").tag("Warp")
      }
      .pickerStyle(.segmented).font(.system(size: 11))

      Picker("Permission", selection: $mode) {
        Text("Ask (default)").tag("ask")
        Text("Accept edits").tag("acceptEdits")
        Text("Plan").tag("plan")
        Text("Skip all permissions").tag("bypass")
      }
      .font(.system(size: 11))

      Text(preview).font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary).lineLimit(2)
      if mode == "bypass" {
        Text("⚠︎ Skips every permission prompt — use only in trusted repos.")
          .font(.system(size: 10)).foregroundStyle(Theme.color(.needs))
      }

      HStack {
        Spacer()
        Button("Start") {
          model.startSession(cwd: cwd, terminal: terminal, mode: mode)
          show = false
        }
        .buttonStyle(.borderedProminent).disabled(cwd.isEmpty)
      }
    }
    .padding(12).frame(width: 320).background(Theme.popoverBG)
  }

  private var preview: String {
    var c = "claude"
    if mode == "bypass" { c += " --dangerously-skip-permissions" }
    else if mode != "ask" { c += " --permission-mode \(mode)" }
    let dir = cwd.isEmpty ? "<dir>" : (cwd as NSString).lastPathComponent
    return "tmux new -s cc-… -c \(dir) '\(c)'"
  }

  private func chooseDir() {
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.allowsMultipleSelection = false
    if panel.runModal() == .OK, let url = panel.url { cwd = url.path }
  }
}

import SwiftUI
import AppKit
import CCBarCore

// Terminal-first "Start a session": pick dir + terminal + permission mode, launch
// an Owned (tmux) session, and bring the terminal forward attached to it.
struct StartSessionView: View {
  @ObservedObject var model: AppModel
  @Binding var show: Bool
  // Remembered across opens so you don't re-pick the same dir/mode/terminal each
  // time. Persisted in UserDefaults; the values below are only first-run defaults.
  @AppStorage("cc.start.cwd") private var cwd = ""
  @AppStorage("cc.start.mode") private var mode = "ask"
  // Terminals run `tmux attach`: Warp via a launch config, Terminal/iTerm via
  // AppleScript, the rest by bringing the app forward. The stored value is a
  // preference, not a promise — it is resolved against what is actually
  // installed every time this sheet opens, because it used to default to Warp
  // on machines that did not have Warp and failed at the moment you clicked
  // Start.
  @AppStorage("cc.start.terminal") private var terminal = ""

  private var choices: [TerminalChoice] { TerminalChoice.installed() }

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
        ForEach(choices, id: \.id) { c in Text(c.name).tag(c.id) }
      }
      .font(.system(size: 11))
      .onAppear { terminal = TerminalChoice.resolve(terminal.isEmpty ? nil : terminal).id }

      Picker("Permission", selection: $mode) {
        Text("Ask (default)").tag("ask")
        Text("Accept edits").tag("acceptEdits")
        Text("Plan").tag("plan")
        Text("Skip all permissions").tag("bypass")
      }
      .font(.system(size: 11))

      Text(preview).font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary).lineLimit(2)
      if mode == "bypass" {
        Text("⚠︎ Skips every permission prompt — use only in trusted repos.")
          .font(.system(size: 11)).foregroundStyle(Theme.color(.needs))
      }

      // tmux is what makes a session Owned — it is the channel Footprint replies
      // on. Saying so here beats letting Start fail silently at the click.
      if !model.tmuxAvailable {
        VStack(alignment: .leading, spacing: 3) {
          Text("tmux isn't installed.")
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Theme.color(.needs))
          Text("Footprint starts sessions inside tmux so it can reply to them. Install it, then reopen this.")
            .font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
          Text("brew install tmux")
            .font(.system(size: 11, design: .monospaced))
            .textSelection(.enabled)
            .padding(.horizontal, 6).padding(.vertical, 3)
            .background(Theme.rowHover, in: RoundedRectangle(cornerRadius: 4))
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("tmux is not installed. Footprint starts sessions inside tmux so it can reply to them. Install it with brew install tmux, then reopen this.")
      }

      HStack {
        Spacer()
        Button("Start") {
          model.startSession(cwd: cwd, terminal: terminal, mode: mode)
          show = false
        }
        .buttonStyle(.borderedProminent)
        .disabled(cwd.isEmpty || !model.tmuxAvailable)
        .accessibilityHint(model.tmuxAvailable ? "" : "Unavailable until tmux is installed")
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

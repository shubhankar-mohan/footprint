import SwiftUI

// In-app monitoring setup: install/remove Claude Code hooks without the terminal.
struct SettingsView: View {
  @ObservedObject var model: AppModel
  @Binding var show: Bool
  @State private var diff = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 6) {
        Button { show = false } label: { Image(systemName: "chevron.left") }
          .buttonStyle(.plain)
        Text("Monitoring").font(.system(size: 12, weight: .semibold))
        Spacer()
      }

      HStack(spacing: 6) {
        Circle().fill(model.hooksInstalled ? Color.green : Color.secondary).frame(width: 6, height: 6)
        Text(model.hooksInstalled ? "On — hooks installed" : "Off — sessions won't appear yet")
          .font(.system(size: 12))
      }

      Text("Claude Control Bar watches sessions through Claude Code's official hooks, added to ~/.claude/settings.json — backed up first, and fully reversible.")
        .font(.system(size: 11)).foregroundStyle(.secondary)

      if !diff.isEmpty {
        ScrollView {
          Text(diff).font(.system(size: 10, design: .monospaced))
            .frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
        }
        .frame(height: 120).padding(6)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
      }

      HStack {
        if model.hooksInstalled {
          Button("Remove hooks") { model.uninstallHooks() }.buttonStyle(.bordered)
        } else {
          Button("Preview changes") { model.previewDiff { diff = $0 } }.buttonStyle(.bordered)
          Button("Enable monitoring") { model.installHooks(); show = false }
            .buttonStyle(.borderedProminent)
        }
        Spacer()
      }
      .font(.system(size: 12, weight: .semibold))
    }
    .padding(12).frame(width: 320)
  }
}

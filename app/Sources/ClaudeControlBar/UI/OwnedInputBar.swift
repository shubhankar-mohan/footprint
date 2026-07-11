import SwiftUI

// Quick input for Owned (tmux) sessions: nudge chips + a one-line reply (relayed
// via tmux send-keys), plus the per-session auto-resume toggle. For one-liners —
// the terminal is for real prompts.
struct OwnedInputBar: View {
  let name: String
  let autoResumeOn: Bool
  let onSend: (String, String) -> Void // (tmux name, text)
  let onAutoResume: (Bool) -> Void
  @State private var text = ""

  var body: some View {
    VStack(spacing: 4) {
      HStack(spacing: 6) {
        ForEach(["continue", "yes", "stop"], id: \.self) { chip in
          Button(chip) { onSend(name, chip) }
            .buttonStyle(.bordered).controlSize(.small).font(.system(size: 10))
        }
        TextField("Reply…", text: $text)
          .textFieldStyle(.roundedBorder).font(.system(size: 11))
          .onSubmit {
            let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty { onSend(name, t); text = "" }
          }
      }
      HStack {
        Toggle(isOn: Binding(get: { autoResumeOn }, set: { onAutoResume($0) })) {
          Text("Auto-resume on limit").font(.system(size: 10)).foregroundStyle(.secondary)
        }
        .toggleStyle(.switch).controlSize(.mini)
        Spacer()
      }
    }
    .padding(.horizontal, 12).padding(.bottom, 6)
  }
}

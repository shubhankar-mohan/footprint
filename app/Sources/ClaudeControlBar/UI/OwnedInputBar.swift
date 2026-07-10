import SwiftUI

// Quick input for Owned (tmux) sessions: nudge chips + a one-line reply, relayed
// via tmux send-keys. Explicitly for one-liners — the terminal is for real prompts.
struct OwnedInputBar: View {
  let name: String
  let onSend: (String, String) -> Void // (tmux name, text)
  @State private var text = ""

  var body: some View {
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
    .padding(.horizontal, 12).padding(.bottom, 6)
  }
}

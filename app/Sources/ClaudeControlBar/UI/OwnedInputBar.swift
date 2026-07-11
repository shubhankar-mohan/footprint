import SwiftUI

// Quick input for an Owned session that's waiting on you: shows Claude's last
// message for context, then nudge chips + a one-line reply (via tmux send-keys).
struct OwnedInputBar: View {
  let name: String
  let lastLine: String?
  let onSend: (String, String) -> Void // (tmux name, text)
  @State private var text = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      if let ctx = lastLine, !ctx.isEmpty {
        Text(ctx).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(2)
      }
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
    }
    .padding(.horizontal, 12).padding(.bottom, 6)
  }
}

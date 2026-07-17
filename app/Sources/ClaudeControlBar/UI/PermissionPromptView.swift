import SwiftUI
import CCBarCore

// The amber "needs you" prompt: tool + exact command + Allow/Deny, wired to /decision.
struct PermissionPromptView: View {
  let pending: Pending
  let onDecide: (String, String) -> Void // (id, decision)

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 6) {
        Image(systemName: "pawprint.fill").foregroundStyle(Theme.color(.needs))
        Text("Allow \(pending.tool ?? "tool")?").font(.system(size: 13, weight: .bold))
      }
      // What Claude just said, so you know what you're approving.
      if let ctx = pending.context, !ctx.isEmpty {
        Text(ctx).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(3)
      }
      if let detail = pending.detail {
        Text(detail)
          .font(.system(size: 11, design: .monospaced))
          .lineLimit(3).textSelection(.enabled)
          .padding(6)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(Color.secondary.opacity(0.10), in: RoundedRectangle(cornerRadius: 6))
      }
      HStack {
        Button("Allow") { onDecide(pending.id, "allow") }
          .buttonStyle(.borderedProminent).tint(Theme.color(.working))
        Button("Deny") { onDecide(pending.id, "deny") }
          .buttonStyle(.bordered)
        Spacer()
      }
      .font(.system(size: 12, weight: .semibold))
    }
    .padding(10)
    .background(Theme.color(.needs).opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
    .overlay(alignment: .leading) { Rectangle().fill(Theme.color(.needs)).frame(width: 3) }
    .padding(.horizontal, 8).padding(.vertical, 4)
  }
}

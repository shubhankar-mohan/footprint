import SwiftUI
import CCBarCore

struct SessionRowView: View {
  let session: Session
  var body: some View {
    HStack(spacing: 8) {
      Rectangle().fill(Theme.color(session.state)).frame(width: 3, height: 28)
      Image(systemName: Theme.symbol(session.state)).foregroundStyle(Theme.color(session.state))
      VStack(alignment: .leading, spacing: 1) {
        Text(session.project).font(.system(size: 13, weight: .semibold))
        Text(Theme.label(session.state) + (session.tool.map { " · \($0)" } ?? ""))
          .font(.system(size: 11)).foregroundStyle(.secondary)
      }
      Spacer()
    }
    .padding(.horizontal, 12).frame(height: 44)
    .contentShape(Rectangle())
  }
}

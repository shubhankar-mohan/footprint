import SwiftUI
import CCBarCore

// The menu-bar glyph: a monochrome footprint (auto-tinted by macOS) with a small
// colored state dot, so color is never the only signal.
struct MenuBarLabel: View {
  @ObservedObject var model: AppModel
  var body: some View {
    let agg = model.snapshot.aggregate
    Image(systemName: "pawprint.fill")
      .foregroundStyle(model.connected ? Color.primary : Color.secondary)
      .overlay(alignment: .topTrailing) {
        Circle()
          .fill(Theme.color(agg))
          .frame(width: 5, height: 5)
          .opacity(agg == .idle ? 0 : 1)
      }
  }
}

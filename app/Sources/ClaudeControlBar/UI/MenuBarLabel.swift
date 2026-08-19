import SwiftUI
import CCBarCore

// The menu-bar glyph: a monochrome footprint (auto-tinted by macOS) with a small
// colored state dot, so color is never the only signal.
struct MenuBarLabel: View {
  @ObservedObject var model: AppModel
  var body: some View {
    let agg = model.snapshot.aggregate
    HStack(spacing: 3) {
      Image(systemName: "pawprint.fill")
        .foregroundStyle(model.connected ? Color.primary : Color.secondary)
        .overlay(alignment: .topTrailing) {
          Circle()
            .fill(Theme.color(agg))
            .frame(width: 5, height: 5)
            .opacity(agg == .idle ? 0 : 1)
        }
      // Usage "battery" — a compact peak %, always visible, red in the last 20%.
      if let u = model.snapshot.usage {
        Text("\(Int(u.peakPercentage.rounded()))%")
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(u.peakPercentage >= 80 ? Theme.critical : Color.primary)
      }
    }
  }
}

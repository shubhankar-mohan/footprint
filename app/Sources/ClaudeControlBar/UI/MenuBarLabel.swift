import SwiftUI
import CCBarCore

// The menu-bar glyph: a monochrome footprint (auto-tinted by macOS) with a small
// colored state dot, so color is never the only signal. Reading store.snapshot in
// the body establishes Observation, so the glyph updates live.
struct MenuBarLabel: View {
  let store: SessionStore
  var body: some View {
    let agg = store.snapshot.aggregate
    Image(systemName: "pawprint.fill")
      .foregroundStyle(store.connected ? Color.primary : Color.secondary)
      .overlay(alignment: .topTrailing) {
        Circle()
          .fill(Theme.color(agg))
          .frame(width: 5, height: 5)
          .opacity(agg == .idle ? 0 : 1)
      }
  }
}

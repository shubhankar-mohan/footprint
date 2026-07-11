import SwiftUI
import CCBarCore

// Usage as a separate hourglass — never the footprint. Two draining bars (5-hour +
// weekly) with reset countdowns; red only in the last 20% (the one color break).
struct HourglassView: View {
  let usage: Usage
  var body: some View {
    VStack(spacing: 5) {
      if let f = usage.fiveHour { bar("5-hour", f) }
      if let w = usage.sevenDay { bar("Weekly", w) }
    }
    .padding(.horizontal, 12).padding(.vertical, 6)
  }

  @ViewBuilder private func bar(_ label: String, _ w: UsageWindow) -> some View {
    let pct = min(1, max(0, (w.usedPercentage ?? 0) / 100))
    HStack(spacing: 6) {
      Image(systemName: "hourglass").font(.system(size: 10)).foregroundStyle(.secondary)
      Text(label).font(.system(size: 10)).foregroundStyle(.secondary).frame(width: 42, alignment: .leading)
      GeometryReader { geo in
        ZStack(alignment: .leading) {
          Capsule().fill(Color.secondary.opacity(0.15))
          Capsule().fill(pct >= 0.8 ? Color.red : Theme.color(.working))
            .frame(width: max(2, geo.size.width * pct))
        }
      }
      .frame(height: 6)
      Text("\(Int((w.usedPercentage ?? 0).rounded()))%")
        .font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary)
        .frame(width: 30, alignment: .trailing)
      if let r = w.resetsAt {
        Text(resetIn(r)).font(.system(size: 9)).foregroundStyle(.tertiary).frame(width: 34, alignment: .trailing)
      }
    }
  }

  private func resetIn(_ epoch: Double) -> String {
    let secs = epoch - Date().timeIntervalSince1970
    if secs <= 0 { return "now" }
    if secs < 3600 { return "\(Int(secs / 60))m" }
    return "\(Int(secs / 3600))h"
  }
}

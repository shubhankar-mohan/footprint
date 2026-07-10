import SwiftUI
import CCBarCore

// Colors + glyphs per docs/design-brief.md §8. Footprint encodes session state only.
enum Theme {
  static func color(_ s: SessionState) -> Color {
    switch s {
    case .idle, .ended: return Color(red: 0.63, green: 0.63, blue: 0.63) // #A0A0A0
    case .working: return Color(red: 0.29, green: 0.56, blue: 0.89)       // #4A90E2
    case .needs: return Color(red: 0.91, green: 0.66, blue: 0.21)         // #E8A935
    case .paused: return Color(red: 0.76, green: 0.76, blue: 0.76)        // #C1C1C1
    }
  }
  static func symbol(_ s: SessionState) -> String {
    switch s {
    case .needs, .working: return "pawprint.fill"
    default: return "pawprint"
    }
  }
  static func label(_ s: SessionState) -> String {
    switch s {
    case .idle: return "Idle"
    case .working: return "Working"
    case .needs: return "Needs you"
    case .paused: return "Paused"
    case .ended: return "Ended"
    }
  }
}

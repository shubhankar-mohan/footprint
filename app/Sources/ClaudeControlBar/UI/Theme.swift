import SwiftUI
import AppKit
import CCBarCore

// Warm-blue "harbor" palette. Cool ground, warm amber attention. Footprint
// encodes session state only; usage lives on its own hourglass bars.
enum Theme {
  static func color(_ s: SessionState) -> Color {
    switch s {
    case .idle, .ended: return idle
    case .working: return working
    case .needs: return needs
    case .paused: return paused
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
    case .needs: return "Waiting on you"
    case .paused: return "Paused"
    case .ended: return "Ended"
    }
  }

  // Semantic state colors (appearance-aware).
  static let working  = dyn(light: (0.263, 0.380, 0.498), dark: (0.498, 0.659, 0.800)) // #43617F / #7FA8CC
  static let needs    = dyn(light: (0.769, 0.451, 0.157), dark: (0.886, 0.627, 0.306)) // #C47328 / #E2A04E
  static let idle     = dyn(light: (0.529, 0.627, 0.675), dark: (0.498, 0.561, 0.612)) // #87A0AC / #7F8F9C
  static let paused   = dyn(light: (0.612, 0.678, 0.714), dark: (0.404, 0.463, 0.514))
  static let critical = dyn(light: (0.753, 0.314, 0.227), dark: (0.878, 0.478, 0.373)) // #C0503A / #E07A5F

  // Warm-blue surfaces that shift per appearance (French blue / midnight harbor).
  static let popoverBG = dyn(light: (0.827, 0.875, 0.906), dark: (0.094, 0.122, 0.149)) // #D3DFE7 / #181F26
  static let rowHover  = dyn(light: (0.780, 0.839, 0.878), dark: (0.129, 0.165, 0.200)) // #C7D6E0 / #212A33

  // Soft tint behind a "needs you" row/card — warm accent at low opacity.
  static var needsTint: Color { needs.opacity(0.12) }

  private static func dyn(light: (Double, Double, Double), dark: (Double, Double, Double)) -> Color {
    Color(nsColor: NSColor(name: nil) { appearance in
      let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
      let c = isDark ? dark : light
      return NSColor(srgbRed: c.0, green: c.1, blue: c.2, alpha: 1)
    })
  }
}

import SwiftUI
import AppKit

// The Footprint mark, loaded from the bundle as a macOS *template* image so the
// system tints it for us — dark on a light menu bar, light on a dark one, and
// correctly inverted when the menu bar is selected. A tinted PNG would be wrong
// in at least one of those three states.
//
// Everything here degrades to the old SF Symbol when the resource is absent, so
// a plain `swift run` (no .app bundle, hence no Resources) still launches.
enum Brand {
  static let markImage: NSImage? = {
    guard let dir = Bundle.main.resourcePath else { return nil }
    let img = NSImage(contentsOfFile: dir + "/MenuBarIcon.png")
    img?.isTemplate = true          // <- the whole point
    img?.size = NSSize(width: 16, height: 16)
    return img
  }()

  /// The mark at a given point size, or the SF Symbol fallback.
  @ViewBuilder
  static func mark(_ size: CGFloat = 16) -> some View {
    if let img = markImage {
      Image(nsImage: img).resizable().frame(width: size, height: size)
    } else {
      Image(systemName: "pawprint.fill").font(.system(size: size * 0.86))
    }
  }
}

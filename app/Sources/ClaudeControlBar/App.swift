import SwiftUI

@main
struct ClaudeControlBarApp: App {
  var body: some Scene {
    MenuBarExtra("Claude Control Bar", systemImage: "pawprint.fill") {
      Text("Booting…")
      Button("Quit") { NSApplication.shared.terminate(nil) }
    }
    .menuBarExtraStyle(.window)
  }
}

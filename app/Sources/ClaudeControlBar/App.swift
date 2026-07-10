import SwiftUI

@main
struct ClaudeControlBarApp: App {
  @StateObject private var model = AppModel()

  var body: some Scene {
    MenuBarExtra {
      PopoverView(model: model, onDecide: { model.decide($0, $1) })
    } label: {
      MenuBarLabel(model: model)
    }
    .menuBarExtraStyle(.window)
  }
}

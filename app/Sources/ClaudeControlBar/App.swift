import SwiftUI

@main
struct ClaudeControlBarApp: App {
  @State private var model = AppModel()

  var body: some Scene {
    MenuBarExtra {
      PopoverView(store: model.store, onDecide: { model.decide($0, $1) })
    } label: {
      MenuBarLabel(store: model.store)
    }
    .menuBarExtraStyle(.window)
  }
}

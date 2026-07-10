import Foundation
import UserNotifications

// Native "needs you" alerts. Guarded on a bundle identifier because
// UNUserNotificationCenter.current() traps when run as a bare (unbundled) binary.
enum Notifier {
  private static var available: Bool { Bundle.main.bundleIdentifier != nil }

  static func requestAuth() {
    guard available else { return }
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
  }

  static func needsYou(project: String) {
    guard available else { return }
    let c = UNMutableNotificationContent()
    c.title = "Claude needs you"
    c.body = "\(project) is waiting for a permission decision."
    c.sound = .default
    let req = UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil)
    UNUserNotificationCenter.current().add(req)
  }
}

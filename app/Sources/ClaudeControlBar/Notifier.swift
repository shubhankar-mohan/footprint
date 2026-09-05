import Foundation
import UserNotifications

// Native "needs you" alerts. Guarded on a bundle identifier because
// UNUserNotificationCenter.current() traps when run as a bare (unbundled) binary.
//
// A notification that only says "Claude needs you" and does nothing when you
// tap it is a worse interruption than none. Every one of these carries the
// session id it came from, so a tap can reveal that terminal; the ones that
// correspond to a real pending permission request also carry the request id and
// get Allow / Deny buttons, answered without opening anything.
enum Notifier {
  private static var available: Bool { Bundle.main.bundleIdentifier != nil }

  /// Only notifications in this category show Allow / Deny.
  static let permissionCategory = "footprint.permission"
  static let allowAction = "footprint.allow"
  static let denyAction = "footprint.deny"

  /// userInfo keys read back by NotificationRouter.
  static let sessionIdKey = "sessionId"
  static let requestIdKey = "requestId"

  /// Categories must be registered before the first notification is posted, so
  /// this runs alongside the authorization request at launch.
  static func requestAuth() {
    guard available else { return }
    let center = UNUserNotificationCenter.current()
    let allow = UNNotificationAction(
      identifier: allowAction, title: "Allow", options: [])
    let deny = UNNotificationAction(
      identifier: denyAction, title: "Deny", options: [])
    let category = UNNotificationCategory(
      identifier: permissionCategory,
      actions: [allow, deny],
      intentIdentifiers: [],
      options: [])
    center.setNotificationCategories([category])
    center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
  }

  /// - Parameters:
  ///   - sessionId: the session that entered `needs`; a tap reveals its terminal.
  ///   - requestId: the *pending request* id, when this needs-state is a real
  ///     permission prompt. nil for a needs-state with nothing to decide (a
  ///     Notification-driven one), which then gets no Allow / Deny.
  ///   - detail: what is actually being approved, so nobody allows blind.
  static func needsYou(
    project: String, sessionId: String, requestId: String? = nil, detail: String? = nil
  ) {
    guard available else { return }
    let c = UNMutableNotificationContent()
    c.title = "Claude needs you"
    c.sound = .default
    var info: [String: String] = [sessionIdKey: sessionId]

    if let requestId {
      info[requestIdKey] = requestId
      c.categoryIdentifier = permissionCategory
      c.body =
        detail.map { "\(project) — \(truncate($0))" }
        ?? "\(project) is waiting for a permission decision."
    } else {
      c.body = "\(project) is waiting on you."
    }

    c.userInfo = info
    let req = UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil)
    UNUserNotificationCenter.current().add(req)
  }

  private static func truncate(_ s: String, limit: Int = 120) -> String {
    let one = s.replacingOccurrences(of: "\n", with: " ")
    return one.count <= limit ? one : String(one.prefix(limit)) + "…"
  }
}

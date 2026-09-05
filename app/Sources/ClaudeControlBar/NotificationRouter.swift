import Foundation
import UserNotifications

// Turns a tapped notification back into the same action the popover would have
// taken. Nothing here is new behaviour: a tap runs the row's reveal, and the
// Allow / Deny buttons run the prompt's decide.
//
// A dedicated object rather than AppModel itself: UNUserNotificationCenterDelegate
// inherits NSObjectProtocol, and AppModel is a plain ObservableObject class that
// nothing else requires to be an NSObject. Sixty lines of routing don't justify
// dragging the whole model into the Objective-C runtime. AppModel holds this
// strongly because UNUserNotificationCenter.delegate is weak — an unowned router
// is silently collected and taps stop arriving with no error anywhere.
final class NotificationRouter: NSObject, UNUserNotificationCenterDelegate {
  weak var model: AppModel?

  init(model: AppModel) {
    self.model = model
    super.init()
  }

  // Without this, macOS suppresses notifications while the app is frontmost —
  // which for a menu-bar app with an open popover is exactly when a session
  // starts waiting on you.
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .list, .sound])
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let info = response.notification.request.content.userInfo
    // Two different ids, never interchangeable: the session id addresses a
    // terminal to reveal, the request id addresses one held-open permission
    // request to answer.
    let sessionId = info[Notifier.sessionIdKey] as? String
    let requestId = info[Notifier.requestIdKey] as? String
    let action = response.actionIdentifier

    DispatchQueue.main.async { [weak self] in
      defer { completionHandler() }
      guard let model = self?.model else { return }
      switch action {
      case Notifier.allowAction:
        if let requestId { model.decide(requestId, "allow") }
      case Notifier.denyAction:
        if let requestId { model.decide(requestId, "deny") }
      case UNNotificationDismissActionIdentifier:
        break  // Cleared, not answered. Deciding for the user here would be wrong.
      default:
        // Default tap (and anything unrecognised): go to the session.
        if let sessionId { model.revealSession(id: sessionId) }
      }
    }
  }
}

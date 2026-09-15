import Foundation
#if canImport(AppKit)
  import AppKit
#endif

/// A terminal Footprint can start an owned session in.
///
/// The Start sheet used to offer Warp, Terminal and iTerm unconditionally and
/// default to Warp — because that was the author's own setup. On a Mac without
/// Warp that made the default a terminal the machine did not have, and "Start a
/// session" failed at the moment of clicking Start. Offer what is actually
/// there, and nothing else.
public struct TerminalChoice: Sendable, Equatable {
  /// The identifier passed to the bridge; must match `matchTerminalComm` in
  /// `bridge/scripts/reveal.mjs`, which is the allowlist the reveal path checks.
  public let id: String
  /// What the user sees.
  public let name: String
  /// Bundle identifiers to look for. Some terminals ship under more than one
  /// (Warp has separate stable and preview builds).
  public let bundleIDs: [String]

  public init(id: String, name: String, bundleIDs: [String]) {
    self.id = id
    self.name = name
    self.bundleIDs = bundleIDs
  }

  /// Every terminal the reveal path knows how to drive. Order is the preference
  /// order for picking a default: the ones that can focus an exact tab first,
  /// then app-activate-only, then Apple's Terminal as the guaranteed floor.
  public static let allKnown: [TerminalChoice] = [
    .init(id: "Warp", name: "Warp", bundleIDs: ["dev.warp.Warp-Stable", "dev.warp.Warp-Preview"]),
    .init(id: "iTerm", name: "iTerm", bundleIDs: ["com.googlecode.iterm2"]),
    .init(id: "Ghostty", name: "Ghostty", bundleIDs: ["com.mitchellh.ghostty"]),
    .init(id: "WezTerm", name: "WezTerm", bundleIDs: ["com.github.wez.wezterm"]),
    .init(id: "kitty", name: "kitty", bundleIDs: ["net.kovidgoyal.kitty"]),
    .init(id: "Alacritty", name: "Alacritty", bundleIDs: ["org.alacritty"]),
    .init(id: "Hyper", name: "Hyper", bundleIDs: ["co.zeit.hyper"]),
    .init(id: "Tabby", name: "Tabby", bundleIDs: ["org.tabby"]),
    .init(id: "Terminal", name: "Terminal", bundleIDs: ["com.apple.Terminal"]),
  ]

  public static func isInstalled(_ choice: TerminalChoice) -> Bool {
    #if canImport(AppKit)
      for id in choice.bundleIDs {
        if NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) != nil { return true }
      }
      return false
    #else
      return choice.id == "Terminal"
    #endif
  }

  /// The terminals present on this machine, in preference order.
  ///
  /// Apple's Terminal ships with macOS, so this can never be empty — but it is
  /// appended defensively rather than assumed, because a caller that gets an
  /// empty list would render a picker with nothing in it.
  public static func installed() -> [TerminalChoice] {
    let found = allKnown.filter(isInstalled)
    if found.isEmpty, let apple = allKnown.first(where: { $0.id == "Terminal" }) {
      return [apple]
    }
    return found
  }

  public static func defaultChoice() -> TerminalChoice {
    installed().first ?? allKnown[allKnown.count - 1]
  }

  /// Resolve a remembered choice against what is installed *now*.
  ///
  /// The stored preference outlives the app that backed it: uninstalling Warp
  /// must not leave Start permanently pointed at something that is gone.
  public static func resolve(_ storedID: String?) -> TerminalChoice {
    guard let storedID,
          let match = installed().first(where: { $0.id == storedID })
    else { return defaultChoice() }
    return match
  }
}

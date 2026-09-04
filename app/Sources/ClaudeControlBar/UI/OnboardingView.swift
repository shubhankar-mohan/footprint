import SwiftUI

// First run, before anything has been written to the user's home directory.
//
// The ask is unusual — let a menu-bar app edit ~/.claude/settings.json — so the
// screen leads with the real, unedited output of `install-hooks.mjs --dry`
// rather than a summary of it. Consent to a described change isn't consent to
// the change; showing the actual lines is the whole point of the screen.
//
//   first launch ──[Turn on monitoring]──▶ installHooks() ──▶ Monitoring (outcome)
//                └─[Not now]────────────▶ sessions list
//
// Either exit sets hasSeenOnboarding, so this appears exactly once.
struct OnboardingView: View {
  @ObservedObject var model: AppModel
  @Binding var hasSeen: Bool
  // Enabling hands off to SettingsView, which already owns the "installed /
  // failed / now start a new session" reporting. Duplicating it here would mean
  // two copies of the one message that makes a correct install look correct.
  var onEnable: () -> Void

  // The preview is fetched once on appear; the script spawns node, so the box
  // has a real waiting state instead of appearing empty and looking broken.
  private enum Preview {
    case loading
    case ready(String)
    case unavailable(String)
  }
  @State private var preview: Preview = .loading

  private let minType: CGFloat = 11 // design system floor

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      mark
      headline
      explanation
      previewBox
      reassurance
      actions
    }
    .padding(14).frame(width: 320)
    .background(Theme.popoverBG)
    .onAppear(perform: loadPreview)
  }

  // The paw is the product's own mark, not decoration, so it carries the
  // neutral working blue — amber is reserved for "this needs you".
  private var mark: some View {
    Image(systemName: "pawprint.fill")
      .font(.system(size: 22))
      .foregroundStyle(Theme.color(.working))
      .accessibilityHidden(true)
  }

  private var headline: some View {
    Text("Footprint watches your sessions.")
      .font(.system(size: 15, design: .serif)).italic()
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityAddTraits(.isHeader)
  }

  private var explanation: some View {
    Text("To see them, it adds hooks to Claude Code's settings at ~/.claude/settings.json. Here is exactly what changes.")
      .font(.system(size: 12))
      .foregroundStyle(.secondary)
      .fixedSize(horizontal: false, vertical: true)
  }

  @ViewBuilder private var previewBox: some View {
    switch preview {
    case .loading:
      framed {
        Text("Reading the change…")
          .font(.system(size: minType, design: .monospaced))
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      .accessibilityLabel("Reading the change that will be made to your settings file")

    case .ready(let text):
      framed {
        ScrollView {
          Text(text)
            .font(.system(size: minType, design: .monospaced))
            .frame(maxWidth: .infinity, alignment: .leading)
            .textSelection(.enabled)
            .accessibilityLabel("The change to settings.json: \(text)")
        }
      }

    // Say what went wrong in the same place the diff would have been, rather
    // than showing an empty box and letting the user assume nothing changes.
    case .unavailable(let why):
      framed {
        VStack(alignment: .leading, spacing: 4) {
          Text("Footprint couldn't read the change in advance.")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Theme.critical)
          Text(why)
            .font(.system(size: minType, design: .monospaced))
            .foregroundStyle(.secondary)
            .textSelection(.enabled)
          Text("Nothing has been written yet. You can close this and turn monitoring on later from the gear icon.")
            .font(.system(size: minType))
            .foregroundStyle(.secondary)
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .accessibilityElement(children: .combine)
      .accessibilityLabel("Footprint couldn't read the change in advance. \(why). Nothing has been written yet.")
    }
  }

  private func framed<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
    content()
      .padding(7)
      .frame(height: 138, alignment: .topLeading)
      .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
      .overlay(
        RoundedRectangle(cornerRadius: 6)
          .strokeBorder(Color.secondary.opacity(0.28), lineWidth: 1)
      )
  }

  private var reassurance: some View {
    Text("Your settings file is backed up first. Nothing else on your machine is touched, and the hooks can be removed at any time from Monitoring.")
      .font(.system(size: minType))
      .foregroundStyle(.secondary)
      .fixedSize(horizontal: false, vertical: true)
  }

  private var actions: some View {
    HStack(spacing: 8) {
      // Secondary then primary, matching the Preview / Enable order in Monitoring.
      Button("Not now") { hasSeen = true }
        .buttonStyle(.bordered)
        .accessibilityLabel("Not now")
        .accessibilityHint("Leaves your settings unchanged. Monitoring stays off until you turn it on from the gear icon.")

      Button("Turn on monitoring") {
        hasSeen = true
        model.installHooks()
        onEnable()
      }
      .buttonStyle(.borderedProminent)
      .accessibilityLabel("Turn on monitoring")
      .accessibilityHint("Adds the hooks shown above to your Claude Code settings")

      Spacer()
    }
    .font(.system(size: 12, weight: .semibold))
  }

  // Nothing in this path throws: HookInstaller.run() returns its own failures as
  // plain strings ("bridge scripts not found"), and install-hooks.mjs bails with
  // a single explanatory line ("~/.claude does not exist…") that stderr folds
  // into the same output. Either would otherwise be rendered as though it were
  // the change itself. A real preview prints the before block, the after block
  // and the hook command — many lines — so a one- or two-line answer is a
  // message about why there is no preview, and is shown as one.
  private func loadPreview() {
    model.previewDiff { out in
      let text = out.trimmingCharacters(in: .whitespacesAndNewlines)
      let lines = text.split(separator: "\n").filter {
        !$0.trimmingCharacters(in: .whitespaces).isEmpty
      }
      if text.isEmpty {
        preview = .unavailable("The preview returned nothing.")
      } else if lines.count < 3 {
        preview = .unavailable(text)
      } else {
        preview = .ready(text)
      }
    }
  }
}

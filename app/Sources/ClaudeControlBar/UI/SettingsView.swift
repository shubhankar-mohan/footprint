import SwiftUI

// In-app monitoring setup: install/remove Claude Code hooks without the terminal.
//
// Enabling used to call installHooks() and immediately dismiss, which meant a
// successful install and a failed one looked identical (an empty list), and the
// one instruction that actually makes it work — start a NEW Claude Code session,
// printed by install-hooks.mjs to stdout — never reached a GUI user. Now the
// panel stays and reports what happened.
//
//   off ──[Enable]──▶ .installed ──▶ "start a new session"  ──[Got it]──▶ off/on
//                 └─▶ .failed(why) ─▶ reason + retry
//
struct SettingsView: View {
  @ObservedObject var model: AppModel
  @Binding var show: Bool
  @State private var diff = ""

  private let minType: CGFloat = 11 // design system floor; 10pt is badges only

  var body: some View {
    VStack(alignment: .leading, spacing: 9) {
      header

      if let outcome = model.lastHookOutcome {
        outcomeView(outcome)
      } else {
        statusRow
        whatHappens
        if !diff.isEmpty { diffView }
        actions
      }

      Divider().padding(.vertical, 2)
      preferences
      footer
    }
    .padding(12).frame(width: 320)
    .background(Theme.popoverBG)
  }

  private var header: some View {
    HStack(spacing: 6) {
      Button {
        model.clearHookOutcome()
        show = false
      } label: { Image(systemName: "chevron.left") }
        .buttonStyle(.plain)
        .accessibilityLabel("Back to sessions")
      Text("Monitoring").font(.system(size: 12, weight: .semibold))
      Spacer()
    }
  }

  private var statusRow: some View {
    HStack(spacing: 6) {
      Circle().fill(model.hooksInstalled ? Theme.color(.working) : Color.secondary)
        .frame(width: 6, height: 6)
      Text(model.hooksInstalled ? "On — hooks installed" : "Off — sessions won't appear yet")
        .font(.system(size: 12))
    }
    .accessibilityElement(children: .combine)
    .accessibilityLabel(
      model.hooksInstalled ? "Monitoring is on" : "Monitoring is off, sessions won't appear yet"
    )
  }

  // Informed consent BEFORE the click, not an explanation after it. Three things
  // change on the user's machine, and the third is the one that makes a correct
  // install look broken if it isn't said out loud.
  @ViewBuilder private var whatHappens: some View {
    if !model.hooksInstalled {
      VStack(alignment: .leading, spacing: 8) {
        fact("1", "Adds hooks to Claude Code",
             "Written to ~/.claude/settings.json. Backed up first, fully reversible.")
        fact("2", "Reads your usage",
             "macOS will ask once for Keychain access so the 5-hour and weekly bars can fill in.")
        fact("!", "Start a new session after",
             "Hooks load when a Claude Code session starts. Sessions already running stay invisible.",
             warn: true)
      }
      .padding(.vertical, 2)
    }
  }

  private func fact(_ mark: String, _ title: String, _ body: String, warn: Bool = false) -> some View {
    let tint = warn ? Theme.color(.needs) : Theme.color(.working)
    return HStack(alignment: .top, spacing: 8) {
      Text(mark)
        .font(.system(size: minType, weight: .bold))
        .foregroundStyle(tint)
        .frame(width: 15, height: 15)
        .background(tint.opacity(0.16), in: RoundedRectangle(cornerRadius: 4))
      VStack(alignment: .leading, spacing: 1) {
        Text(title).font(.system(size: 12, weight: .semibold)).foregroundStyle(warn ? tint : .primary)
        Text(body).font(.system(size: minType)).foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(title). \(body)")
  }

  private var diffView: some View {
    ScrollView {
      Text(diff)
        .font(.system(size: minType, design: .monospaced))
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
    }
    .frame(height: 120).padding(6)
    .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
    .accessibilityLabel("Preview of changes to settings.json")
  }

  private var actions: some View {
    HStack {
      if model.hooksInstalled {
        Button("Remove hooks") { model.uninstallHooks() }.buttonStyle(.bordered)
      } else {
        Button("Preview changes") { model.previewDiff { diff = $0 } }.buttonStyle(.bordered)
        Button("Enable monitoring") { model.installHooks() }
          .buttonStyle(.borderedProminent)
      }
      Spacer()
    }
    .font(.system(size: 12, weight: .semibold))
  }

  @ViewBuilder private func outcomeView(_ outcome: HookOutcome) -> some View {
    VStack(alignment: .leading, spacing: 9) {
      switch outcome {
      case .installed:
        Text("Monitoring is on.")
          .font(.system(size: 15, design: .serif)).italic()
        VStack(alignment: .leading, spacing: 8) {
          fact("✓", "Hooks installed",
               "Your previous settings.json was backed up. Remove them any time from this screen.")
          fact("!", "Now start a new Claude Code session",
               "This list stays quiet until one begins. Sessions already open won't appear.",
               warn: true)
        }
      case .removed:
        Text("Monitoring is off.")
          .font(.system(size: 15, design: .serif)).italic()
        Text("Your hooks were removed from ~/.claude/settings.json. Everything else was left untouched.")
          .font(.system(size: minType)).foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      case .failed(let why):
        Text("That didn't work.")
          .font(.system(size: 15, design: .serif)).italic()
          .foregroundStyle(Theme.critical)
        Text(why)
          .font(.system(size: minType, design: .monospaced))
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
          .textSelection(.enabled)
        Text("Your settings.json was not changed.")
          .font(.system(size: minType)).foregroundStyle(.secondary)
      }

      HStack {
        Button("Got it") { model.clearHookOutcome() }.buttonStyle(.bordered)
        if case .failed = outcome {
          Button("Try again") { model.clearHookOutcome(); model.installHooks() }
            .buttonStyle(.borderedProminent)
        }
        Spacer()
      }
      .font(.system(size: 12, weight: .semibold))
    }
  }

  private var preferences: some View {
    VStack(alignment: .leading, spacing: 7) {
      Toggle(isOn: Binding(
        get: { model.launchAtLogin },
        set: { model.setLaunchAtLogin($0) }
      )) {
        Text("Open at login").font(.system(size: 12))
      }
      .toggleStyle(.switch).controlSize(.small)

      Toggle(isOn: Binding(
        get: { model.snapshot.autoResumeGlobal ?? false },
        set: { model.setAutoResumeGlobal($0) }
      )) {
        Text("Auto-resume Owned sessions on limit").font(.system(size: 12))
      }
      .toggleStyle(.switch).controlSize(.small)
      Text("Injects “continue” into a tmux-owned session when its usage limit resets.")
        .font(.system(size: minType)).foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
    }
  }

  // A version the user can read back is the difference between a usable bug
  // report and a guess — this app ships no telemetry by design.
  private var footer: some View {
    HStack {
      Text("Footprint \(AppModel.appVersion)")
        .font(.system(size: minType, design: .monospaced))
        .foregroundStyle(.tertiary)
        .textSelection(.enabled)
      Spacer()
    }
  }
}

cask "footprint" do
  version "0.1.0"
  sha256 "86da52ef52679e3b2954b3fffbd16c24a47036ab639383254ee2f445900e75fe"

  url "https://github.com/shubhankar-mohan/footprint/releases/download/v#{version}/Footprint-#{version}.zip"
  name "Footprint"
  desc "Menu-bar control panel for local Claude Code sessions"
  homepage "https://github.com/shubhankar-mohan/footprint"

  # The app spawns a small Node bridge at runtime.
  depends_on formula: "node"
  depends_on macos: :sonoma # macOS 14+, for the Observation framework

  app "Footprint.app"

  # Unsigned + ad-hoc signed (free — no Apple Developer account), so macOS would
  # otherwise refuse to open it. Homebrew has already verified the sha256 above
  # against the published artifact before we get here, which is the actual
  # integrity check; stripping the quarantine flag skips the "unidentified
  # developer" wall for a download brew just validated. This is a deliberate
  # tradeoff and the caveats below state it plainly. It is also why we ship from
  # our OWN tap: homebrew/cask requires notarization.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/Footprint.app"]
    # Launch it once. Footprint is LSUIElement (no Dock icon), so without this the
    # install finishes with no visible sign that anything happened, and the user
    # has to know to hunt the menu bar for an icon they have never seen.
    system_command "/usr/bin/open",
                   args: ["-a", "#{appdir}/Footprint.app"],
                   must_succeed: false
  end

  uninstall quit:   "com.shubhankarmohan.footprint",
            script: {
              # Remove our hooks from ~/.claude/settings.json BEFORE the bundle is
              # deleted. Without this, uninstalling leaves every PreToolUse, Stop,
              # Notification and PermissionRequest hook pointing at a binary that
              # no longer exists — so Claude Code errors on every tool call, in
              # every session, forever. The uninstaller has always existed; it was
              # simply never wired up here.
              executable:   "/usr/bin/env",
              args:         ["node", "#{appdir}/Footprint.app/Contents/Resources/bridge/scripts/uninstall-hooks.mjs"],
              must_succeed: false,
            }

  zap trash: [
    "~/.claude-control-bar",
  ]

  caveats <<~EOS
    Footprint watches your Claude Code sessions through Claude Code's official
    hooks. Open it from the menu bar (it has no Dock icon) and choose
    "Turn on monitoring". Before anything is written, it shows you exactly what
    changes:

      1. Hooks are merged into ~/.claude/settings.json — backed up first, and
         removable from the same screen or by uninstalling.
      2. macOS asks once for Keychain access, so Footprint can read your Claude
         usage for the 5-hour and weekly bars. Nothing is sent anywhere.
      3. Hooks load when a Claude Code session STARTS, so start a new one after
         enabling. Sessions already running stay invisible until restarted.

    This build is unsigned and not notarized (it is free and has no Apple
    Developer account behind it). Homebrew verifies its checksum, and the install
    step then removes the macOS quarantine flag so it will open. If you would
    rather Gatekeeper kept its prompt, remove the app and run it from source.
  EOS
end

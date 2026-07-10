cask "claude-control-bar" do
  version "0.1.0"
  sha256 "REPLACE_WITH_SHA256_FROM_build-release.sh"

  url "https://github.com/shubhankar/claude-control-bar/releases/download/v#{version}/ClaudeControlBar-#{version}.zip"
  name "Claude Control Bar"
  desc "Menu-bar control panel for local Claude Code sessions"
  homepage "https://github.com/shubhankar/claude-control-bar"

  # The app spawns a small Node bridge at runtime.
  depends_on formula: "node"
  depends_on macos: ">= :sonoma" # macOS 14+, for the Observation framework

  app "ClaudeControlBar.app"

  # Unsigned/ad-hoc build (free — no Apple Developer account). Strip the quarantine
  # xattr so Gatekeeper opens it without the "unidentified developer" block. This
  # is why we ship from our OWN tap: the official homebrew/cask tap requires
  # notarization. See dist/README.md.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/ClaudeControlBar.app"]
  end

  uninstall quit: "com.shubhankarmohan.footprint"

  zap trash: [
    "~/.claude-control-bar",
  ]

  caveats <<~EOS
    Claude Control Bar watches your Claude Code sessions via official hooks.
    Enable monitoring from the app's menu (gear → Enable monitoring); it edits
    ~/.claude/settings.json (backed up first) and is fully reversible.
  EOS
end

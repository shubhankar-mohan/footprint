#!/usr/bin/env bash
# Assemble Footprint.app from the SPM build (no Xcode). Bundles the Node bridge
# under Contents/Resources/bridge so a shipped app is self-contained (system
# `node` is still required at runtime; bundling node is a later nicety).
#
# The version comes from the repo-root VERSION file — the ONLY place it is
# written. It used to be hardcoded here AND in dist/build-release.sh, so the zip
# name, the cask, and the app's own Info.plist could disagree with each other.
set -euo pipefail
cd "$(dirname "$0")/.."
CONFIG="${1:-release}"

VERSION="$(tr -d '[:space:]' < ../VERSION)"
[ -n "$VERSION" ] || { echo "VERSION file is empty" >&2; exit 1; }

swift build -c "$CONFIG"

APP="Footprint.app"
BUILT=".build/$CONFIG/ClaudeControlBar"   # SPM product name (internal)
EXEC="Footprint"                          # what the user sees in Activity Monitor

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/bridge"
cp "$BUILT" "$APP/Contents/MacOS/$EXEC"

# Only the pieces the running app needs. The bridge is dependency-free by design,
# so there is no node_modules to copy — keep it that way.
cp -R ../bridge/server.js ../bridge/mcp-server.mjs ../bridge/lib ../bridge/hooks ../bridge/scripts ../bridge/package.json \
  "$APP/Contents/Resources/bridge/"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Footprint</string>
  <key>CFBundleDisplayName</key><string>Footprint</string>
  <key>CFBundleExecutable</key><string>${EXEC}</string>
  <key>CFBundleIdentifier</key><string>com.shubhankarmohan.footprint</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST

codesign --force --deep --sign - "$APP" 2>/dev/null || true
echo "built $APP (version $VERSION)"

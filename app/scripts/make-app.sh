#!/usr/bin/env bash
# Assemble ClaudeControlBar.app from the SPM build (no Xcode). Bundles the Node
# bridge under Contents/Resources/bridge so a shipped app is self-contained
# (system `node` is still required at runtime; bundling node is a Phase 5 nicety).
set -euo pipefail
cd "$(dirname "$0")/.."
CONFIG="${1:-release}"

swift build -c "$CONFIG"
APP="ClaudeControlBar.app"
BIN=".build/$CONFIG/ClaudeControlBar"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/bridge"
cp "$BIN" "$APP/Contents/MacOS/ClaudeControlBar"
cp -R ../bridge/server.js ../bridge/lib ../bridge/hooks ../bridge/scripts ../bridge/package.json \
  "$APP/Contents/Resources/bridge/"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Claude Control Bar</string>
  <key>CFBundleExecutable</key><string>ClaudeControlBar</string>
  <key>CFBundleIdentifier</key><string>com.shubhankarmohan.footprint</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST

codesign --force --deep --sign - "$APP" 2>/dev/null || true
echo "built $APP"

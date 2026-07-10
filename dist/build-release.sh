#!/usr/bin/env bash
# Build a release ClaudeControlBar.app and package it as a zip for a GitHub
# release + Homebrew cask. Prints the version and sha256 to paste into the cask.
# Free path: unsigned + ad-hoc, quarantine stripped by the cask postflight.
set -euo pipefail
cd "$(dirname "$0")/../app"
VERSION="${1:-0.1.0}"

bash scripts/make-app.sh release
OUT="../dist/ClaudeControlBar-$VERSION.zip"
rm -f "$OUT"
# ditto preserves the .app bundle structure + symlinks (unlike plain zip).
ditto -c -k --keepParent ClaudeControlBar.app "$OUT"

echo ""
echo "artifact: dist/ClaudeControlBar-$VERSION.zip"
echo "version:  $VERSION"
echo "sha256:   $(shasum -a 256 "$OUT" | awk '{print $1}')"
echo ""
echo "Next: create a GitHub release v$VERSION, upload the zip, then paste the"
echo "version + sha256 into dist/Casks/claude-control-bar.rb (see dist/README.md)."

#!/usr/bin/env bash
# Build a release Footprint.app, package it as a zip, and write the real sha256
# straight into the cask. The checksum used to be a hand-copy step, which is why
# the shipped cask still read REPLACE_WITH_SHA256_FROM_build-release.sh — the one
# integrity check on an unsigned download, left unset.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
[ -n "$VERSION" ] || { echo "VERSION file is empty" >&2; exit 1; }

cd "$ROOT/app"
bash scripts/make-app.sh release

OUT="$ROOT/dist/Footprint-$VERSION.zip"
rm -f "$OUT"
# ditto preserves the .app bundle structure + symlinks (unlike plain zip).
ditto -c -k --keepParent Footprint.app "$OUT"

SHA="$(shasum -a 256 "$OUT" | awk '{print $1}')"
CASK="$ROOT/dist/Casks/footprint.rb"

# Patch the cask in place so version and checksum can never drift from the artifact.
/usr/bin/sed -i '' \
  -e "s|^  version \".*\"|  version \"$VERSION\"|" \
  -e "s|^  sha256 \".*\"|  sha256 \"$SHA\"|" \
  "$CASK"

echo ""
echo "artifact: dist/Footprint-$VERSION.zip"
echo "version:  $VERSION   (from VERSION)"
echo "sha256:   $SHA       (written into dist/Casks/footprint.rb)"
echo ""
grep -E '^  (version|sha256) ' "$CASK"
echo ""
echo "Next: create the GitHub release v$VERSION, upload the zip, push the tap."

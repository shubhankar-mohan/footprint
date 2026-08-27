# Distribution — free, no Apple Developer account

Footprint ships **unsigned** from our **own Homebrew tap**. The only
things behind Apple's $99/yr wall are Developer-ID signing and notarization, and
neither is required: the cask's `postflight` strips the `com.apple.quarantine`
attribute, so Gatekeeper opens the unsigned app without the "unidentified
developer" block. (This is why we can't use the *official* `homebrew/cask` tap —
it requires notarization — but a personal tap has no such rule.)

## One-time: create the tap

1. Create a public GitHub repo named **`homebrew-tap`** under your account
   (e.g. `github.com/shubhankar/homebrew-tap`).
2. Copy `dist/Casks/footprint.rb` into `Casks/` in that repo.

## Each release

```bash
# 1. Build + package (prints the version + sha256)
bash dist/build-release.sh 0.1.0

# 2. Create a GitHub release on the app repo and upload the zip:
gh release create v0.1.0 dist/ClaudeControlBar-0.1.0.zip --title "v0.1.0" --notes "..."

# 3. Copy Casks/footprint.rb into the tap (build-release.sh already wrote the sha256):
#    - version "0.1.0"
#    - sha256 "<the sha256 build-release.sh printed>"
#    - confirm the url matches your GitHub user/repo
#    Commit + push the tap.
```

Adjust `shubhankar` in the cask `url`/`homepage` to your actual GitHub user if
different.

## Users install with

```bash
brew install shubhankar-mohan/tap/footprint
```

This launches with **no Gatekeeper prompt** (quarantine stripped in postflight),
pulls in `node` as a dependency, and puts the footprint in the menu bar. First
run: open the menu → gear → **Enable monitoring**.

## Fallback: direct DMG/zip

You can also attach the zip to a GitHub release for manual download. On
**macOS 15 (Sequoia)+** an unsigned app can't be opened via right-click → Open
anymore; users must go to **System Settings → Privacy & Security → Open Anyway**,
or run `xattr -dr com.apple.quarantine /Applications/ClaudeControlBar.app`.

## If you later want the smoother path

Paying the $99/yr Apple Developer Program lets you sign + notarize, which enables
silent installs from the official Homebrew tap and clean Sparkle auto-updates.
Not required — purely a UX upgrade.

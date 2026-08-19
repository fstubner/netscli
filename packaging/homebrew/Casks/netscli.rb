# Homebrew Cask for the netscli desktop app (Tauri 2 + React).
#
# Lives alongside Formula/netscli.rb (the CLI) in fstubner/homebrew-tap.
# Two architectures because Tauri builds are not universal -- Apple Silicon
# and Intel get distinct .dmg artifacts on every release.
#
# Nothing installs this file. `scripts/release/publish-homebrew-cask.sh`
# regenerates the tap's copy wholesale from its own heredoc, substituting
# digests it has re-hashed from the downloaded assets. This copy is the
# reference for what that output should look like.
#
# The digests are `@@...@@` placeholders on purpose. They used to be
# real-looking 64-hex values left over from an old release, which is the
# worst of both: too plausible to notice, too stale to work. A placeholder
# fails loudly if it ever reaches a tap.
cask "netscli" do
  version "0.3.0"

  on_arm do
    sha256 "@@SHA256_MACOS_AARCH64@@"
    url "https://github.com/fstubner/netscli/releases/download/v#{version}/netscli-gui-macos-aarch64.dmg"
  end
  on_intel do
    sha256 "@@SHA256_MACOS_X86_64@@"
    url "https://github.com/fstubner/netscli/releases/download/v#{version}/netscli-gui-macos-x86_64.dmg"
  end

  name "NetsCLI"
  desc "NetsCLI desktop app for reviewing network scans, DNS, ARP, and local inventory"
  homepage "https://netscli.com"

  app "NetsCLI.app"

  # Bundle identifier must match tauri.conf.json's `identifier`
  # (com.netscli.gui). It previously read com.netscli.app, which matches
  # nothing the app ever writes, so `brew uninstall --zap` left every
  # file behind.
  zap trash: [
    "~/Library/Application Support/com.netscli.gui",
    "~/Library/Caches/com.netscli.gui",
    "~/Library/Preferences/com.netscli.gui.plist",
  ]
end

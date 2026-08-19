# Homebrew Cask for the netscli desktop app (Tauri 2 + React).
#
# Lives alongside Formula/netscli.rb (the CLI) in fstubner/homebrew-tap.
# Two architectures because Tauri builds are not universal -- Apple Silicon
# and Intel get distinct .dmg artifacts on every release.
#
# The values below are a template, not what users install.
# `scripts/release/publish-homebrew.sh` rewrites `version` and every `sha256`
# from the published release's .sha256 sidecars and pushes that to the tap.
# What is committed here is whatever the last edit left behind.
#
# Edit by hand only when bootstrapping the tap or when the publish job is
# broken; take each digest from the `.sha256` asset on the release page.
cask "netscli" do
  version "0.3.0"

  on_arm do
    sha256 "faf62fe3f56709b46865a6f35b5bcda4db6a37c4395eb904d1b73214f497e69e"
    url "https://github.com/fstubner/netscli/releases/download/v#{version}/netscli-gui-macos-aarch64.dmg"
  end
  on_intel do
    sha256 "28354f51e623f9be5a875c6284df9ee1207ae182e0667293475d485a1bb41675"
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

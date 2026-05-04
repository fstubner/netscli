# Homebrew Cask for the netscli desktop app (Tauri 2 + React).
#
# Lives alongside Formula/netscli.rb (the CLI) in fstubner/homebrew-tap.
# Two architectures because Tauri builds are not universal — Apple
# Silicon and Intel get distinct .dmg artifacts on every release.
#
# After cutting release vX.Y.Z, update `version` and replace each
# sha256 with the value from the matching `.sha256` asset on the
# release page (or let publish.yml's homebrew-cask job do it
# automatically).

cask "netscli" do
  version "0.2.4"

  on_arm do
    sha256 "a240ec0ce5a0bbe00226fc078a22a0acede4d320b05fce1d2a80690a136b6bd3"
    url "https://github.com/fstubner/netscli/releases/download/v#{version}/netscli-gui-macos-aarch64.dmg"
  end
  on_intel do
    sha256 "4dc2c7e76348165624fa4d26f8e78e7892b4f0b8d2762fd9884df524d19a8bdb"
    url "https://github.com/fstubner/netscli/releases/download/v#{version}/netscli-gui-macos-x86_64.dmg"
  end

  name "NetsCLI"
  desc "Network scanner desktop app: discover hosts, scan ports, DNS, ARP"
  homepage "https://netscli.com"

  app "NetsCLI.app"

  zap trash: [
    "~/Library/Application Support/com.netscli.app",
    "~/Library/Caches/com.netscli.app",
    "~/Library/Preferences/com.netscli.app.plist",
  ]
end

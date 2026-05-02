#!/usr/bin/env bash
# Updates fstubner/homebrew-tap's Formula/netscli.rb to point at the new
# release. Computes SHA256 for each platform asset, sed's the formula in
# place, and pushes a single commit to the tap.
#
# Required environment:
#   GH_TOKEN — PAT with `repo` scope on fstubner/homebrew-tap.
# Required argument:
#   $1 — tag, e.g. "v0.2.1".

set -euo pipefail

TAG="${1:?usage: publish-homebrew.sh <tag>}"
VERSION="${TAG#v}"

BASE="https://github.com/fstubner/netscli/releases/download/${TAG}"
ASSETS=(
  "netscli-macos-aarch64"
  "netscli-macos-x86_64"
  "netscli-linux-aarch64"
  "netscli-linux-x86_64"
)

# Wait for each .sha256 to materialise. release.yml runs in parallel with
# publish.yml — the homebrew job can race past the cosign-sign step on
# release builds that take 3-5 minutes (musl, ARM64 cross-compile). Up to
# 15 minutes of polling is enough for the slowest matrix entry.
wait_for_asset() {
  local url="$1"
  local i
  for i in {1..30}; do
    if curl -fsSL --head "$url" >/dev/null 2>&1; then
      return 0
    fi
    echo "  not yet; retry in 30s ($i/30)"
    sleep 30
  done
  echo "ERROR: $url never became available" >&2
  return 1
}

declare -A SHA
for asset in "${ASSETS[@]}"; do
  url="${BASE}/${asset}.sha256"
  echo "→ ${url}"
  wait_for_asset "$url"
  SHA[$asset]=$(curl -fsSL "$url" | awk '{print $1}')
done

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
git clone --depth 1 \
  "https://x-access-token:${GH_TOKEN}@github.com/fstubner/homebrew-tap.git" \
  "$WORKDIR/tap"
cd "$WORKDIR/tap"
git config user.name  "netscli release bot"
git config user.email "noreply@netscli.com"

formula="Formula/netscli.rb"

# Bump the version line.
sed -i -E "s|^  version \"[^\"]+\"|  version \"${VERSION}\"|" "$formula"

# Replace the sha256 line that follows each url line containing the asset.
# awk reads url line, prints it, reads the sha256 line, substitutes its
# value, prints it. Other lines pass through.
for asset in "${ASSETS[@]}"; do
  awk -v asset="$asset" -v new="${SHA[$asset]}" '
    $0 ~ asset {
      print
      getline
      sub(/sha256 "[^"]+"/, "sha256 \"" new "\"")
      print
      next
    }
    { print }
  ' "$formula" > "$formula.tmp" && mv "$formula.tmp" "$formula"
done

# Sanity check: formula has exactly 4 sha256 lines after editing.
got=$(grep -c '^      sha256 "' "$formula" || true)
if [[ "$got" -ne 4 ]]; then
  echo "ERROR: expected 4 sha256 lines in formula, got ${got}" >&2
  cat "$formula" >&2
  exit 1
fi

git diff
git add "$formula"
git commit -m "netscli ${VERSION}"
git push origin HEAD

echo "✓ Homebrew tap updated to ${VERSION}"

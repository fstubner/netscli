#!/usr/bin/env bash
# Updates fstubner/homebrew-tap's Formula/netscli.rb to point at the new
# release. Verifies SHA256 for each platform asset against the actual
# downloaded bytes, sed's the formula in place, and pushes a single
# commit to the tap.
#
# Required environment:
#   GH_TOKEN — PAT with `repo` scope on fstubner/homebrew-tap.
# Required argument:
#   $1 — tag, e.g. "v0.2.1".

set -euo pipefail

# shellcheck source=scripts/release/lib.sh
. "$(dirname "$0")/lib.sh"

TAG="${1:?usage: publish-homebrew.sh <tag>}"
validate_tag "$TAG"
VERSION="${TAG#v}"

BASE="https://github.com/fstubner/netscli/releases/download/${TAG}"
ASSETS=(
  "netscli-macos-aarch64"
  "netscli-macos-x86_64"
  "netscli-linux-aarch64"
  "netscli-linux-x86_64"
)

declare -A SHA
for asset in "${ASSETS[@]}"; do
  echo "→ verifying ${asset}"
  SHA[$asset]=$(verified_sha "$BASE" "$asset")
done

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
clone_tap "fstubner/homebrew-tap" "$WORKDIR/tap"
cd "$WORKDIR/tap"

formula="Formula/netscli.rb"

# Bump the version line. VERSION is validated above, so it cannot contain
# the `|` or `&` that would otherwise be metacharacters in this
# replacement.
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

# Sanity check: exactly 4 sha256 lines, each a real 64-char hex digest.
# The old check counted `^      sha256 "`, which also matches `sha256 ""` —
# a blank hash would have sailed through.
got=$(grep -cE '^      sha256 "[0-9a-f]{64}"$' "$formula" || true)
if [[ "$got" -ne 4 ]]; then
  echo "ERROR: expected 4 valid sha256 lines in formula, got ${got}" >&2
  cat "$formula" >&2
  exit 1
fi
if ! grep -q "^  version \"${VERSION}\"$" "$formula"; then
  echo "ERROR: formula version was not updated to ${VERSION}" >&2
  cat "$formula" >&2
  exit 1
fi

git diff
git add "$formula"
commit_and_push "netscli ${VERSION}"

echo "✓ Homebrew tap updated to ${VERSION}"

#!/usr/bin/env bash
# Updates fstubner/scoop-bucket's bucket/netscli.json to point at the new
# release. Single-asset (windows-x86_64.exe), so simpler than the Homebrew
# script — version + url + hash, all swapped via jq.
#
# Required environment:
#   GH_TOKEN — PAT with `repo` scope on fstubner/scoop-bucket.
# Required argument:
#   $1 — tag, e.g. "v0.2.1".

set -euo pipefail

# shellcheck source=scripts/release/lib.sh
. "$(dirname "$0")/lib.sh"

TAG="${1:?usage: publish-scoop.sh <tag>}"
validate_tag "$TAG"
VERSION="${TAG#v}"

BASE="https://github.com/fstubner/netscli/releases/download/${TAG}"
ASSET="netscli-windows-x86_64.exe"

echo "→ verifying ${ASSET}"
sha=$(verified_sha "$BASE" "$ASSET")

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
clone_tap "fstubner/scoop-bucket" "$WORKDIR/bucket"
cd "$WORKDIR/bucket"

manifest="bucket/netscli.json"
asset_url="${BASE}/${ASSET}#/netscli.exe"

jq --arg ver "$VERSION" \
   --arg url "$asset_url" \
   --arg sha "$sha" '
     .version = $ver
     | .architecture["64bit"].url  = $url
     | .architecture["64bit"].hash = $sha
   ' "$manifest" > "$manifest.tmp" && mv "$manifest.tmp" "$manifest"

# Sanity check: jq wrote what we asked, and the hash is a real digest.
if ! jq -e --arg ver "$VERSION" --arg sha "$sha" '
       .version == $ver
       and .architecture["64bit"].hash == $sha
       and (.architecture["64bit"].hash | test("^[0-9a-f]{64}$"))
     ' "$manifest" >/dev/null; then
  echo "ERROR: scoop manifest render check failed" >&2
  cat "$manifest" >&2
  exit 1
fi

git diff
git add "$manifest"
commit_and_push "netscli ${VERSION}"

echo "✓ Scoop bucket updated to ${VERSION}"

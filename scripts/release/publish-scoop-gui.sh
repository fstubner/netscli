#!/usr/bin/env bash
# Updates fstubner/scoop-bucket's bucket/netscli-gui.json to point at the
# new release. Sibling to publish-scoop.sh (the CLI). Different asset
# (.msi instead of .exe) and different manifest file, but the same
# version+url+hash jq edit.
#
# Required environment:
#   GH_TOKEN — PAT with `repo` scope on fstubner/scoop-bucket.
# Required argument:
#   $1 — tag, e.g. "v0.2.5".

set -euo pipefail

TAG="${1:?usage: publish-scoop-gui.sh <tag>}"
VERSION="${TAG#v}"

BASE="https://github.com/fstubner/netscli/releases/download/${TAG}"
ASSET="netscli-gui-windows-x86_64.msi"

url="${BASE}/${ASSET}.sha256"
echo "→ ${url}"
for i in {1..30}; do
  if curl -fsSL --head "$url" >/dev/null 2>&1; then
    break
  fi
  echo "  not yet; retry in 30s ($i/30)"
  sleep 30
done

sha=$(curl -fsSL "$url" | awk '{print $1}')

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
git clone --depth 1 \
  "https://x-access-token:${GH_TOKEN}@github.com/fstubner/scoop-bucket.git" \
  "$WORKDIR/bucket"
cd "$WORKDIR/bucket"
git config user.name  "netscli release bot"
git config user.email "noreply@netscli.com"

manifest="bucket/netscli-gui.json"
asset_url="${BASE}/${ASSET}"

jq --arg ver "$VERSION" \
   --arg url "$asset_url" \
   --arg sha "$sha" '
     .version = $ver
     | .architecture["64bit"].url  = $url
     | .architecture["64bit"].hash = $sha
   ' "$manifest" > "$manifest.tmp" && mv "$manifest.tmp" "$manifest"

git diff
git add "$manifest"
git commit -m "netscli-gui ${VERSION}"
git push origin HEAD

echo "✓ Scoop bucket netscli-gui updated to ${VERSION}"

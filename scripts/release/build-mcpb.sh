#!/usr/bin/env bash
# Build one MCP bundle (.mcpb) per platform from a published release.
#
#   scripts/release/build-mcpb.sh v0.3.3 <output-dir>
#
# An .mcpb is a zip holding a manifest and the server itself. A client
# installs it in one action: no config file to edit, no netscli on PATH, no
# Node. That is the whole reason it exists alongside the npm package --
# packaging/npm/netscli/README.md covers who should use which.
#
# The binary is vendored, so a bundle is per-platform and there are five of
# them. `compatibility.platforms` in the manifest only distinguishes
# darwin/win32/linux with no architecture, so the two Linux bundles are
# indistinguishable to a client and are told apart by their filename alone.
# Someone on arm64 who downloads the x64 bundle gets a binary that will not
# exec, with nothing in the format able to warn them first.
#
# Packet capture is absent for the same reason it is absent from npm: it
# needs libpcap or Npcap installed, which a self-contained bundle cannot
# provide.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=scripts/release/lib.sh
. "${SCRIPT_DIR}/lib.sh"

# Pinned rather than floating. `mcpb pack` decides the archive layout and
# what it will accept in a manifest; a minor bump changing either would
# first be noticed during a release.
MCPB_VERSION="2.1.2"

# How the mcpb CLI is invoked. `npx` in CI and for anyone running this
# normally; overridable because npx cannot run under the sandbox on the
# maintainer's Windows machine, and a script that can only ever be executed
# inside a release is one that gets its first real test during a release.
# Set it to an installed binary to exercise the whole path locally:
#   MCPB_CMD="node_modules/.bin/mcpb" scripts/release/build-mcpb.sh v0.3.3 out/
MCPB_CMD="${MCPB_CMD:-npx --yes @anthropic-ai/mcpb@${MCPB_VERSION}}"

TAG="${1:-}"
OUT_DIR="${2:-}"

if [[ -z "$TAG" || -z "$OUT_DIR" ]]; then
  echo "usage: $0 vX.Y.Z <output-dir>" >&2
  exit 2
fi
validate_tag "$TAG"
VERSION="${TAG#v}"

mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"

BASE="https://github.com/fstubner/netscli/releases/download/${TAG}"
TEMPLATE="${REPO_ROOT}/packaging/mcpb/manifest.json"

# bundle suffix : manifest platform : release asset
#
# The same asset choices as publish-npm.sh, and the same caveat: linux-x64
# takes the static musl build, linux-arm64 the gnu one, which needs glibc
# 2.39 or newer because that is what the arm64 runner builds against.
PLATFORMS=(
  "linux-x64:linux:netscli-linux-x86_64-musl"
  "linux-arm64:linux:netscli-linux-aarch64"
  "darwin-x64:darwin:netscli-macos-x86_64"
  "darwin-arm64:darwin:netscli-macos-aarch64"
  "win32-x64:win32:netscli-windows-x86_64.exe"
)

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

for entry in "${PLATFORMS[@]}"; do
  suffix="${entry%%:*}"
  rest="${entry#*:}"
  platform="${rest%%:*}"
  asset="${rest#*:}"

  exe="netscli"
  [[ "$platform" == "win32" ]] && exe="netscli.exe"

  echo "Building netscli-${VERSION}-${suffix}.mcpb  <-  ${asset}"

  stage="${WORK}/${suffix}"
  mkdir -p "${stage}/server"

  sha="$(verified_sha "$BASE" "$asset")"
  curl -fsSL "${BASE}/${asset}" -o "${stage}/server/${exe}"
  chmod +x "${stage}/server/${exe}"

  local_sha="$(sha256sum "${stage}/server/${exe}" | awk '{print $1}')"
  if [[ "$local_sha" != "$sha" ]]; then
    echo "ERROR: ${suffix} binary does not match the verified digest for ${asset}" >&2
    echo "       expected ${sha}" >&2
    echo "       got      ${local_sha}" >&2
    exit 1
  fi

  sed -e "s/@@VERSION@@/${VERSION}/g" \
      -e "s/@@PLATFORM@@/${platform}/g" \
      -e "s/@@EXE@@/${exe}/g" \
      "$TEMPLATE" > "${stage}/manifest.json"

  if grep -q '@@' "${stage}/manifest.json"; then
    echo "ERROR: unsubstituted placeholder left in the ${suffix} manifest:" >&2
    grep -n '@@' "${stage}/manifest.json" >&2
    exit 1
  fi

  # Rejects a manifest the format does not accept, before it is zipped.
  # shellcheck disable=SC2086  # MCPB_CMD is a command line, not one word
  $MCPB_CMD validate "${stage}/manifest.json"

  # shellcheck disable=SC2086  # as above
  $MCPB_CMD pack "${stage}" "${OUT_DIR}/netscli-${VERSION}-${suffix}.mcpb"
done

# `pack` reporting success is not proof the archive holds what the manifest
# points at: entry_point is a path inside the zip, and a staging mistake
# would produce a bundle that installs and then fails to start, in a client,
# on someone else's machine.
echo
echo "Verifying bundle contents"
for entry in "${PLATFORMS[@]}"; do
  suffix="${entry%%:*}"
  bundle="${OUT_DIR}/netscli-${VERSION}-${suffix}.mcpb"
  entry_point="$(unzip -p "$bundle" manifest.json | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d));
    process.stdin.on("end", () => process.stdout.write(JSON.parse(s).server.entry_point));
  ')"
  if ! unzip -l "$bundle" | grep -qF " ${entry_point}"; then
    echo "ERROR: ${bundle} declares entry_point '${entry_point}', which is not in the archive" >&2
    exit 1
  fi
  printf '  %-34s %s\n' "$(basename "$bundle")" "$entry_point"
done

echo
echo "Wrote $(find "$OUT_DIR" -name '*.mcpb' | wc -l) bundles to ${OUT_DIR}"

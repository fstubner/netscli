#!/usr/bin/env bash
# Publish netscli to npm: one launcher package plus one binary package per
# platform.
#
#   scripts/release/publish-npm.sh v0.3.3              # build and publish
#   scripts/release/publish-npm.sh v0.3.3 --build-only # assemble, publish nothing
#
# --build-only leaves the staged packages in place and prints the directory.
# It needs no npm token and no network beyond the release assets, so it is
# how this script is exercised outside a real publish -- see the npm section
# of packaging/README.md.
#
# Layout produced under the staging directory:
#
#   netscli/                     the launcher, from packaging/npm/netscli/
#   netscli-linux-x64/           one prebuilt binary + a generated manifest
#   netscli-linux-arm64/
#   netscli-darwin-x64/
#   netscli-darwin-arm64/
#   netscli-windows-x64/
#
# The launcher declares the five as optionalDependencies pinned to the exact
# same version; their `os`/`cpu` fields make npm install exactly one.
#
# Publish order matters and is not cosmetic. The launcher goes LAST: it is
# the only name a user types, so if a platform package fails to upload, the
# version of `netscli` that would depend on it was never published and
# nobody can install a launcher whose binary does not exist. The reverse
# order leaves exactly that.
#
# Packet-capture builds are deliberately absent. They need libpcap or Npcap
# present at runtime, which an npm install cannot arrange and `npx` users
# will not have -- a package that installs cleanly and then fails inside
# capture_pcap is worse than one that never claimed to offer it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=scripts/release/lib.sh
. "${SCRIPT_DIR}/lib.sh"

TAG="${1:-}"
MODE="${2:-publish}"

if [[ -z "$TAG" ]]; then
  echo "usage: $0 vX.Y.Z [--build-only]" >&2
  exit 2
fi
validate_tag "$TAG"
VERSION="${TAG#v}"

if [[ "$MODE" != "publish" && "$MODE" != "--build-only" ]]; then
  echo "ERROR: second argument must be --build-only or omitted, got '${MODE}'" >&2
  exit 2
fi

BASE="https://github.com/fstubner/netscli/releases/download/${TAG}"
TEMPLATE_DIR="${REPO_ROOT}/packaging/npm/netscli"

# package-name suffix : npm `os` : npm `cpu` : release asset
#
# linux-x64 takes the musl build and linux-arm64 the gnu one, which is an
# inconsistency worth stating rather than hiding. musl is statically linked
# and runs on any glibc vintage; the gnu builds are produced on
# ubuntu-24.04 and therefore need glibc 2.39 or newer. There is no
# aarch64-musl leg in release.yml to take instead, so arm64 carries that
# floor until one is added.
#
# The name suffix and the `os` value are separate fields because they
# disagree on exactly one platform. npm's `os` vocabulary is Node's
# `process.platform`, where Windows is `win32` -- but npm's registry rejects
# a package called `netscli-win32-x64` outright:
#
#   403 Forbidden - Package name triggered spam detection
#
# The four sibling names went up seconds earlier without complaint and a
# re-run was rejected identically, so it is the string and not a rate limit.
# Why that string is not knowable from here: the heuristic is undocumented,
# and scoped names carrying it (`@esbuild/win32-x64`) exist happily, so it
# is not the substring alone.
#
# So the package is `netscli-windows-x64` while its `os` field stays
# `win32`, and bin/netscli.js maps the one to the other.
PLATFORMS=(
  "linux-x64:linux:x64:netscli-linux-x86_64-musl"
  "linux-arm64:linux:arm64:netscli-linux-aarch64"
  "darwin-x64:darwin:x64:netscli-macos-x86_64"
  "darwin-arm64:darwin:arm64:netscli-macos-aarch64"
  "windows-x64:win32:x64:netscli-windows-x86_64.exe"
)

STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

echo "Staging npm packages for ${TAG} in ${STAGING}"

published_names=()

for entry in "${PLATFORMS[@]}"; do
  IFS=: read -r suffix os cpu asset <<< "$entry"
  pkg="netscli-${suffix}"
  exe="netscli"
  [[ "$os" == "win32" ]] && exe="netscli.exe"

  echo "  ${pkg}  <-  ${asset}"
  mkdir -p "${STAGING}/${pkg}"

  # Hashes the downloaded bytes and requires them to match the published
  # .sha256 sidecar. A mismatch aborts before anything reaches npm, which
  # is the point of doing it here rather than trusting the sidecar.
  sha="$(verified_sha "$BASE" "$asset")"
  curl -fsSL "${BASE}/${asset}" -o "${STAGING}/${pkg}/${exe}"
  chmod +x "${STAGING}/${pkg}/${exe}"

  # Re-check the file that actually landed in the package directory, not
  # the temporary copy verified_sha hashed. They are separate downloads.
  local_sha="$(sha256sum "${STAGING}/${pkg}/${exe}" | awk '{print $1}')"
  if [[ "$local_sha" != "$sha" ]]; then
    echo "ERROR: ${pkg}/${exe} does not match the verified digest for ${asset}" >&2
    echo "       expected ${sha}" >&2
    echo "       got      ${local_sha}" >&2
    exit 1
  fi

  cat > "${STAGING}/${pkg}/package.json" <<EOF
{
  "name": "${pkg}",
  "version": "${VERSION}",
  "description": "Prebuilt netscli binary for ${os} ${cpu}. Installed automatically by the 'netscli' package.",
  "homepage": "https://netscli.com",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/fstubner/netscli.git"
  },
  "license": "MIT",
  "author": "Felix Stubner",
  "os": ["${os}"],
  "cpu": ["${cpu}"],
  "files": ["${exe}"],
  "preferUnplugged": true
}
EOF

  published_names+=("$pkg")
done

# The launcher, with @@VERSION@@ substituted in its own version and in each
# pinned optionalDependency.
mkdir -p "${STAGING}/netscli/bin"
cp "${TEMPLATE_DIR}/bin/netscli.js" "${STAGING}/netscli/bin/netscli.js"
cp "${TEMPLATE_DIR}/README.md" "${STAGING}/netscli/README.md"
sed "s/@@VERSION@@/${VERSION}/g" "${TEMPLATE_DIR}/package.json" > "${STAGING}/netscli/package.json"

if grep -q '@@' "${STAGING}/netscli/package.json"; then
  echo "ERROR: unsubstituted placeholder left in the launcher package.json:" >&2
  grep -n '@@' "${STAGING}/netscli/package.json" >&2
  exit 1
fi

# Every optionalDependency must name a package this run actually staged.
# Adding a platform to the template and forgetting to add it to PLATFORMS
# above would otherwise publish a launcher that depends on a version that
# does not exist, and npm would report it as an install failure on one
# platform only.
mapfile -t declared < <(node -e '
  const p = require(process.argv[1]);
  for (const name of Object.keys(p.optionalDependencies ?? {})) console.log(name);
' "${STAGING}/netscli/package.json")

for name in "${declared[@]}"; do
  if [[ ! -d "${STAGING}/${name}" ]]; then
    echo "ERROR: launcher depends on ${name}, which this script did not build." >&2
    echo "       Add it to PLATFORMS in $0 or remove it from the template." >&2
    exit 1
  fi
done
if [[ "${#declared[@]}" -ne "${#published_names[@]}" ]]; then
  echo "ERROR: launcher declares ${#declared[@]} platform packages, ${#published_names[@]} were built." >&2
  exit 1
fi

# Prove the launcher can find and run the binary for THIS machine before
# publishing anything, rather than discovering it from a user's bug report.
#
# Every staged package is linked in and the launcher is left to resolve its
# own name. The obvious alternative -- work out which package this machine
# needs and link only that one -- means writing the platform-to-package
# mapping a second time, and the two promptly disagreed: this test built
# `netscli-win32-x64` from process.platform while the launcher had moved to
# `netscli-windows-x64`, so nothing matched and the check skipped itself on
# the one platform that could have run it. A skip reads almost exactly like
# a pass in a log.
#
# There is no skip now. If the launcher cannot resolve a binary for the
# machine running this, that is a failure worth seeing: every platform this
# script publishes is one it just staged.
echo "Smoke test: the launcher resolving its own platform package"
mkdir -p "${STAGING}/netscli/node_modules"
for pkg in "${published_names[@]}"; do
  ln -sfn "../../${pkg}" "${STAGING}/netscli/node_modules/${pkg}"
done
if ! got="$(node "${STAGING}/netscli/bin/netscli.js" --version 2>&1)"; then
  echo "ERROR: the launcher could not run a binary on this machine." >&2
  while IFS= read -r line; do printf '       %s\n' "$line" >&2; done <<< "$got"
  exit 1
fi
if [[ "$got" != *"${VERSION}"* ]]; then
  echo "ERROR: launcher ran but reported '${got}', which does not contain ${VERSION}" >&2
  exit 1
fi
echo "  ${got}"
rm -rf "${STAGING}/netscli/node_modules"

if [[ "$MODE" == "--build-only" ]]; then
  KEEP="$(mktemp -d)"
  cp -r "${STAGING}/." "${KEEP}/"
  echo
  echo "Built, published nothing. Packages are in:"
  echo "  ${KEEP}"
  exit 0
fi

# Two ways in, and the preferred one needs nothing set here.
#
# npm trusted publishing: the CLI notices it is running in GitHub Actions
# with an OIDC token available and exchanges that for a short-lived
# credential scoped to this workflow. Nothing long-lived exists to leak, and
# provenance is attested automatically. It needs npm >= 11.5.1, `id-token:
# write` on the job, and a trusted publisher configured for EACH package on
# npmjs.com.
#
# That last requirement is why NPM_TOKEN is still honoured rather than
# removed. A trusted publisher is configured on a package's settings page,
# which does not exist until the package does, so the first ever publish of
# each of these six cannot use OIDC. It is a bootstrap step, not a permanent
# fallback -- see the npm section of packaging/README.md.
if [[ -n "${NPM_TOKEN:-}" ]]; then
  echo "Authenticating with NPM_TOKEN (trusted publishing not configured yet?)"
  npm config set //registry.npmjs.org/:_authToken "${NPM_TOKEN}"
  # Explicit with a token; trusted publishing attests without being asked.
  export NPM_CONFIG_PROVENANCE=true
else
  echo "No NPM_TOKEN set; relying on trusted publishing via OIDC"
  if [[ -z "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ]]; then
    echo "ERROR: no NPM_TOKEN and no OIDC token available." >&2
    echo "       In CI this means the job is missing 'permissions: id-token: write'." >&2
    echo "       Outside CI, set NPM_TOKEN or use --build-only." >&2
    exit 1
  fi
  # Publishing silently as the wrong identity is not a failure mode worth
  # leaving open, and the version requirement is exact enough to check.
  npm_version="$(npm --version)"
  # Required version first: `sort -C` succeeds only if already ordered, so
  # this passes exactly when 11.5.1 <= installed.
  if ! printf '11.5.1\n%s\n' "$npm_version" | sort -V -C; then
    echo "ERROR: trusted publishing needs npm >= 11.5.1, this is ${npm_version}." >&2
    echo "       Node 22 ships npm 10.x, so the workflow upgrades it explicitly." >&2
    exit 1
  fi
fi

# Platform packages first, launcher last. See the header.
for pkg in "${published_names[@]}"; do
  if npm view "${pkg}@${VERSION}" version >/dev/null 2>&1; then
    echo "  ${pkg}@${VERSION} already published; skipping"
    continue
  fi
  echo "  publishing ${pkg}@${VERSION}"
  npm publish "${STAGING}/${pkg}" --access public
done

if npm view "netscli@${VERSION}" version >/dev/null 2>&1; then
  echo "  netscli@${VERSION} already published; skipping"
else
  echo "  publishing netscli@${VERSION}"
  npm publish "${STAGING}/netscli" --access public
fi

echo "npm publish complete for ${TAG}"

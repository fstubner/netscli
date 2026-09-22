#!/usr/bin/env bash
# Authenticode-sign every Windows artifact in a directory.
#
#   CERTUM_EMAIL=... CERTUM_OTP=... scripts/release/sign-windows.sh <dir>
#
# Signs in place: each .exe and .msi directly under <dir> comes back signed
# and timestamped, and the script fails if any of them does not verify
# afterwards.
#
# Why this runs on Linux rather than on the Windows runners that built the
# binaries: the signing key is a Certum cloud certificate, not a file. Since
# June 2023 a publicly trusted code-signing key has to live on a token, an
# HSM or a cloud service -- there is no .pfx to hand `signtool`. Reaching
# Certum's cloud is plain HTTPS, so where it runs from stops mattering, and
# doing it in one job means one place holds the credentials instead of
# three matrix legs.
#
# Two tools, because one does not yet cover both formats:
#
#   - `ssign` signs PE files (.exe/.dll/.sys) natively.
#   - MSI goes through `osslsigncode` with `ssign-pkcs11`, which presents
#     the same cloud key as a PKCS#11 module. ssign's own native MSI support
#     is still in progress: its CFB (OLE2) pre-hash does not yet match
#     osslsigncode's.
#
# Both read the credentials from the environment themselves, so neither
# ever takes them on a command line where they would reach the process
# table or a CI log.

set -euo pipefail

SSIGN_VERSION="v0.1.6"
SSIGN_SHA256="9bcd249c7250a9ee38bd68c28aadf662dd714854b3355647b3f55b30162b5b6b"
PKCS11_SHA256="88a96a3e0bfe3fd6a83e347c8841169a22dfd2020484995b773b07fdfafda165"
BASE="https://github.com/Le-Syl21/ssign/releases/download/${SSIGN_VERSION}"

# Certum's own RFC3161 server. A signature without a timestamp stops
# verifying the day the certificate expires; with one it keeps verifying for
# the life of the timestamp, which is the whole point of buying a
# three-year certificate to sign a release that outlives it.
TIMESTAMP_URL="http://time.certum.pl/"

ART_DIR="${1:-}"
if [[ -z "$ART_DIR" || ! -d "$ART_DIR" ]]; then
  echo "usage: $0 <directory of .exe/.msi to sign>" >&2
  exit 2
fi
ART_DIR="$(cd "$ART_DIR" && pwd)"

: "${CERTUM_EMAIL:?CERTUM_EMAIL must be set}"
: "${CERTUM_OTP:?CERTUM_OTP must be set (base32 TOTP seed or otpauth:// URI)}"

for tool in curl tar osslsigncode openssl; do
  command -v "$tool" >/dev/null 2>&1 || { echo "ERROR: $tool is not installed" >&2; exit 1; }
done

# The pkcs11 engine has no binary, so the loop above cannot see whether it is
# there. It is a separate package (libengine-pkcs11-openssl on Debian and
# Ubuntu) and it is absent from a stock ubuntu-latest runner. Checking it
# here rather than letting osslsigncode discover it means the failure names
# the package instead of the engine, and it happens before the executables
# have been signed -- otherwise a release gets two signed .exe files and no
# installer, which is the split this whole job exists to prevent.
if ! openssl engine pkcs11 >/dev/null 2>&1; then
  echo "ERROR: OpenSSL has no 'pkcs11' engine, which osslsigncode needs for the MSI." >&2
  echo "       Install libengine-pkcs11-openssl (Debian/Ubuntu) or your" >&2
  echo "       distribution's equivalent." >&2
  exit 1
fi

TOOLS="$(mktemp -d)"
trap 'rm -rf "$TOOLS"' EXIT

# Pinned by version AND by digest. The tarball is fetched over the network
# and then handed the signing key, so "the tag moved" and "the asset was
# replaced" are both worth refusing rather than discovering afterwards.
fetch() {
  local name="$1" want="$2" out="${TOOLS}/$1"
  curl -fsSL -o "$out" "${BASE}/${name}"
  local got
  got="$(sha256sum "$out" | awk '{print $1}')"
  if [[ "$got" != "$want" ]]; then
    echo "ERROR: ${name} does not match its pinned digest" >&2
    echo "       expected ${want}" >&2
    echo "       got      ${got}" >&2
    exit 1
  fi
  tar xzf "$out" -C "$TOOLS"
}

shopt -s nullglob
exes=("${ART_DIR}"/*.exe)
msis=("${ART_DIR}"/*.msi)
shopt -u nullglob

# Before downloading anything: nothing to sign is a failure, not a no-op.
if [[ ${#exes[@]} -eq 0 && ${#msis[@]} -eq 0 ]]; then
  echo "ERROR: no .exe or .msi in ${ART_DIR}. Nothing to sign, which is not a" >&2
  echo "       success -- the artifacts this job exists for never arrived." >&2
  exit 1
fi

echo "Fetching ssign ${SSIGN_VERSION}"
fetch "ssign-linux-x86_64.tar.gz" "$SSIGN_SHA256"
fetch "ssign-pkcs11-linux-x86_64.tar.gz" "$PKCS11_SHA256"
chmod +x "${TOOLS}/ssign"

# `ssign` caches the cloud session, so the first file pays for the login and
# the rest do not. Signing the executables together is what keeps this to one
# authentication rather than one per artifact.
for exe in "${exes[@]}"; do
  echo "Signing $(basename "$exe")"
  "${TOOLS}/ssign" "$exe"
done

for msi in "${msis[@]}"; do
  echo "Signing $(basename "$msi")"
  # `-pkcs11module` does not load the module directly: it goes through
  # OpenSSL's pkcs11 engine, which on Ubuntu lives in the separate
  # libengine-pkcs11-openssl package and is absent by default. The tool
  # check above catches a missing osslsigncode; this one has no binary to
  # look for, so the workflow installs it explicitly and the failure it
  # prevents -- `Failed to find and load 'pkcs11' engine` -- names the
  # engine rather than the package.
  # No `-ac`: that flag embeds the issuing CA certificate in the signature,
  # and the correct intermediate is named by the signing certificate's own
  # Authority Information Access extension rather than by anything knowable
  # here. Without it the signature is still valid and timestamped, and a
  # verifier builds the chain by following that same AIA, which is what
  # Windows does by default. Worth revisiting once the real certificate can
  # be read: an embedded chain also verifies on a machine with no outbound
  # network.
  osslsigncode sign \
    -pkcs11module "${TOOLS}/libssign_pkcs11.so" \
    -pkcs11cert 'pkcs11:type=cert' \
    -key 'pkcs11:type=private' \
    -h sha256 \
    -t "$TIMESTAMP_URL" \
    -in "$msi" \
    -out "${msi}.signed"
  mv "${msi}.signed" "$msi"
done

# Read every signature back rather than trusting three exit codes.
#
# This is the check that matters: a silently unsigned artifact looks exactly
# like a signed one until someone downloads it, and the whole point of the
# job is that no Windows artifact ships without a signature.
#
# Both CA files are needed and neither is optional. `verify` builds the
# chain from the signing certificate to a trusted root, and the chain the
# signature carries ends at Certum Trusted Network CA -- a root that is in
# the distribution's CA store but NOT in whatever default osslsigncode
# falls back to. Without `-CAfile` it reports
#
#   PKCS7_verify:certificate verify error: unable to get local issuer certificate
#
# after printing the full, correct, valid chain, so the artifact is signed
# and the check fails anyway. `-TSA-CAfile` is the same story for the
# timestamp chain, which roots at Certum Trusted Network CA 2.
#
# That is what happened on the first real run of this job, at v0.3.3: every
# artifact signed correctly and the release got none of them.
CA_BUNDLE=""
for candidate in /etc/ssl/certs/ca-certificates.crt /etc/pki/tls/certs/ca-bundle.crt; do
  [[ -f "$candidate" ]] && { CA_BUNDLE="$candidate"; break; }
done
if [[ -z "$CA_BUNDLE" ]]; then
  echo "ERROR: no system CA bundle found; cannot verify the signatures produced." >&2
  echo "       Looked for /etc/ssl/certs/ca-certificates.crt and" >&2
  echo "       /etc/pki/tls/certs/ca-bundle.crt." >&2
  exit 1
fi

echo
echo "Verifying signatures against ${CA_BUNDLE}"
failed=0
for f in "${exes[@]}" "${msis[@]}"; do
  if osslsigncode verify -CAfile "$CA_BUNDLE" -TSA-CAfile "$CA_BUNDLE" "$f" >/dev/null 2>&1; then
    printf '  %-44s signed\n' "$(basename "$f")"
  else
    printf '  %-44s NO VALID SIGNATURE\n' "$(basename "$f")"
    osslsigncode verify -CAfile "$CA_BUNDLE" -TSA-CAfile "$CA_BUNDLE" "$f" 2>&1 | sed 's/^/      /' >&2 || true
    failed=1
  fi
done

if [[ "$failed" -ne 0 ]]; then
  echo "ERROR: at least one artifact came back without a valid signature." >&2
  exit 1
fi

echo
echo "Signed ${#exes[@]} executable(s) and ${#msis[@]} installer(s)."

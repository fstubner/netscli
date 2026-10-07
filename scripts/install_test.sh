#!/usr/bin/env bash
# Tests for install.sh against a fake release.
#
# install.sh is what netscli.com's one-liner pipes into bash, and what it
# checks before installing is exactly where a mistake hides: a check that
# passes when it should refuse looks the same as one that works. A fake
# `curl` serves a release from a temporary directory, and fake `uname` and
# `cosign` stand in for the real ones, so nothing here touches the network.
#
# Run: bash scripts/install_test.sh

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

failures=0
ok() { echo "  ok   - $1"; }
bad() { echo "  FAIL - $1" >&2; failures=$((failures + 1)); }

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# --- the fake release -------------------------------------------------------

ASSET="netscli-linux-x86_64"
RELEASE="$TMP/release"
mkdir -p "$RELEASE" "$TMP/bin" "$TMP/cosign-bin"
printf 'fake netscli binary\n' >"$RELEASE/$ASSET"
printf '%s  %s\n' "$(sha256_of "$RELEASE/$ASSET")" "$ASSET" >"$RELEASE/$ASSET.sha256"
printf 'fake signature\n' >"$RELEASE/$ASSET.sig"
printf 'fake certificate\n' >"$RELEASE/$ASSET.pem"

# Serves any URL from $FAKE_RELEASE by its last path segment, and fails the
# way `curl -f` does when there is no such file. Every call is logged.
cat >"$TMP/bin/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >>"$FAKE_LOG"
out="" url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift ;;
    https://*|http://*) url="$1" ;;
  esac
  shift
done
src="$FAKE_RELEASE/${url##*/}"
[ -f "$src" ] || exit 22
if [ -n "$out" ]; then cp "$src" "$out"; else cat "$src"; fi
EOF

# install.sh only installs on Linux and macOS, and the test also runs on
# Windows under Git Bash, so the platform is fixed here.
cat >"$TMP/bin/uname" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  -s) echo Linux ;;
  -m) echo x86_64 ;;
  *) echo Linux ;;
esac
EOF

# Logs its arguments and answers with $FAKE_COSIGN_EXIT.
cat >"$TMP/cosign-bin/cosign" <<'EOF'
#!/usr/bin/env bash
echo "cosign $*" >>"$FAKE_LOG"
exit "${FAKE_COSIGN_EXIT:-0}"
EOF
chmod +x "$TMP/bin/curl" "$TMP/bin/uname" "$TMP/cosign-bin/cosign"

# Runs a script (install.sh by default) with the fake release. Sets $status
# and $out, and leaves the call log in $FAKE_LOG and the install in $DEST.
# Extra arguments are environment assignments; COSIGN=1 puts the fake
# cosign on PATH.
run() {
  local script="$HERE/install.sh" path="$TMP/bin:$PATH"
  local -a env_args=()
  local arg
  for arg in "$@"; do
    case "$arg" in
      COSIGN=1) path="$TMP/cosign-bin:$path" ;;
      SCRIPT=*) script="${arg#SCRIPT=}" ;;
      *) env_args+=("$arg") ;;
    esac
  done
  DEST="$(mktemp -d "$TMP/install.XXXX")"
  FAKE_LOG="$DEST.log"
  : >"$FAKE_LOG"
  set +e
  out=$(env PATH="$path" FAKE_RELEASE="$RELEASE" FAKE_LOG="$FAKE_LOG" \
    INSTALL_DIR="$DEST" NETSCLI_LINUX_VARIANT=gnu "${env_args[@]}" \
    bash "$script" 2>&1)
  status=$?
  set -e
}

installed() { cmp -s "$RELEASE/$ASSET" "$DEST/netscli"; }

# The harness itself: a cosign already on this machine would make the
# "without cosign" cases test nothing.
if env PATH="$TMP/bin:$PATH" bash -c 'command -v cosign' >/dev/null 2>&1; then
  bad "setup: a real cosign is on PATH, so the cases without cosign prove nothing"
fi

echo "install.sh"

# --- checksum ---------------------------------------------------------------

run
if [ "$status" = 0 ] && installed; then ok "installs a binary whose checksum matches"; else bad "good release: status $status, $out"; fi
if grep -q "Not checked: the Sigstore signature, because cosign is not installed" <<<"$out" &&
   grep -q "Checked: the SHA-256 published with this release" <<<"$out"; then
  ok "says what it checked and what it did not, without cosign"
else
  bad "summary without cosign: $out"
fi
if grep -q -- "--proto =https --proto-redir =https --tlsv1.2" "$FAKE_LOG"; then
  ok "downloads over HTTPS only, redirects included"
else
  bad "curl options: $(cat "$FAKE_LOG")"
fi

cp "$RELEASE/$ASSET.sha256" "$TMP/good.sha256"
printf 'some other build\n' >"$TMP/other"
printf '%s  %s\n' "$(sha256_of "$TMP/other")" "$ASSET" >"$RELEASE/$ASSET.sha256"
run
if [ "$status" != 0 ] && ! installed; then ok "refuses a binary whose checksum does not match"; else bad "bad checksum: status $status, $out"; fi
cp "$TMP/good.sha256" "$RELEASE/$ASSET.sha256"

# --- signature ----------------------------------------------------------------

run COSIGN=1
if [ "$status" = 0 ] && installed && grep -q "and the Sigstore signature" <<<"$out"; then
  ok "installs when cosign verifies the signature"
else
  bad "cosign verifies: status $status, $out"
fi
# The single quotes are the point: this is the literal regexp cosign must get.
# shellcheck disable=SC2016
want='--certificate-identity-regexp ^https://github\.com/fstubner/netscli/\.github/workflows/release\.yml@refs/(heads/main|tags/v[0-9.]+)$ --certificate-oidc-issuer https://token.actions.githubusercontent.com'
if grep -qF -- "$want" "$FAKE_LOG"; then
  ok "asks cosign for release.yml on main or a release tag, and nothing looser"
else
  bad "cosign arguments: $(grep cosign "$FAKE_LOG" || true)"
fi

run COSIGN=1 FAKE_COSIGN_EXIT=1
if [ "$status" != 0 ] && ! installed; then ok "refuses when the signature does not verify"; else bad "cosign fails: status $status, $out"; fi

mv "$RELEASE/$ASSET.sig" "$TMP/kept.sig"
run COSIGN=1
if [ "$status" != 0 ] && ! installed; then ok "refuses when the signature cannot be fetched"; else bad "no .sig: status $status, $out"; fi
mv "$TMP/kept.sig" "$RELEASE/$ASSET.sig"

run COSIGN=1 FAKE_COSIGN_EXIT=1 NETSCLI_SKIP_SIGNATURE=1
if [ "$status" = 0 ] && installed && ! grep -q "^cosign" "$FAKE_LOG"; then
  ok "NETSCLI_SKIP_SIGNATURE=1 skips the signature and says so"
else
  bad "skip: status $status, $out"
fi

# --- a download cut short -----------------------------------------------------
#
# Piped from curl, bash runs what has arrived. Both cuts below must install
# nothing and download nothing.

head -n "$(($(wc -l <"$HERE/install.sh") - 1))" "$HERE/install.sh" >"$TMP/cut-before-call.sh"
run SCRIPT="$TMP/cut-before-call.sh"
if ! installed && [ ! -s "$FAKE_LOG" ]; then ok "a script cut before its last line does nothing"; else bad "cut before call: status $status, $out"; fi

main_line=$(grep -n '^main() {' "$HERE/install.sh" | cut -d: -f1 || true)
if [ -z "$main_line" ]; then
  bad "install.sh has no main() to cut inside"
else
  head -n "$((main_line + 30))" "$HERE/install.sh" >"$TMP/cut-inside-main.sh"
  run SCRIPT="$TMP/cut-inside-main.sh"
  if ! installed && [ ! -s "$FAKE_LOG" ]; then ok "a script cut inside main() does nothing"; else bad "cut inside main: status $status, $out"; fi
fi

if [ "$failures" -gt 0 ]; then
  echo "$failures failed" >&2
  exit 1
fi
echo "all install.sh tests passed"

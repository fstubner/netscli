#!/usr/bin/env bash
# Regression tests for lib.sh.
#
# These exist because of a specific incident: `wait_for_asset` printed its
# retry progress to stdout, `verified_sha` calls it, and every caller does
# `sha=$(verified_sha ...)` — so the progress lines were captured as part of
# the checksum and written into the Homebrew/Scoop manifests. The retry
# always engages on a real release, so all four publish jobs would have
# failed, with an error naming the manifest rather than the cause.
#
# Nothing in shellcheck catches that, and the publish path only runs during
# a release, so a silent reintroduction would not surface until the next one.
#
# Run: bash scripts/release/lib_test.sh

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh disable=SC1091
. "${HERE}/lib.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

failures=0

ok() { echo "  ok   - $1"; }
bad() { echo "  FAIL - $1" >&2; failures=$((failures + 1)); }

sha256_of_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

# --- verified_sha returns the digest and nothing else ---------------------
#
# The stub forces the retry path: the first availability probe fails, so
# wait_for_asset emits one progress line before succeeding. That line is the
# contamination the real bug shipped.

ASSET_BYTES='netscli-fake-binary'
DIGEST="$(printf '%s' "$ASSET_BYTES" | sha256_of_stdin)"
PROBES="${TMP}/probe-count"
: >"$PROBES"

# These two shadow the real commands for the duration of the test. lib.sh
# calls them by name, which shellcheck cannot see, hence the SC2317s.
# shellcheck disable=SC2317
curl() {
  local args=("$@") i
  for ((i = 0; i < ${#args[@]}; i++)); do
    if [[ "${args[i]}" == "--head" ]]; then
      echo x >>"$PROBES"
      # Fail the first probe, succeed afterwards.
      [[ "$(wc -l <"$PROBES")" -ge 2 ]] && return 0
      return 1
    fi
    if [[ "${args[i]}" == "-o" ]]; then
      printf '%s' "$ASSET_BYTES" >"${args[i + 1]}"
      return 0
    fi
  done
  # No --head and no -o: this is the sidecar fetch.
  printf '%s  netscli-fake\n' "$DIGEST"
}

# Keep the retry from actually waiting 30 seconds.
# shellcheck disable=SC2317
sleep() { :; }

captured="$(verified_sha "https://example.invalid/download/v0.0.0" "netscli-fake")"

if [[ "$(wc -l <"$PROBES")" -lt 2 ]]; then
  bad "test setup: the retry path never engaged, so nothing was proven"
else
  ok "retry path engaged (the condition that triggered the original bug)"
fi

if [[ "$captured" =~ ^[0-9a-f]{64}$ ]]; then
  ok "verified_sha output is exactly one 64-char hex digest"
else
  bad "verified_sha output was contaminated: '${captured}'"
fi

if [[ "$captured" == "$DIGEST" ]]; then
  ok "verified_sha returned the digest of the downloaded bytes"
else
  bad "expected '${DIGEST}', got '${captured}'"
fi

unset -f curl sleep

# --- validate_tag ---------------------------------------------------------
#
# The tag reaches sed replacements and commit messages, so the rejection
# side matters more than the acceptance side.

for good in v0.3.0 v1.2.3 v10.20.30 v0.3.0-rc.1; do
  if validate_tag "$good" 2>/dev/null; then
    ok "accepts ${good}"
  else
    bad "rejected a valid tag: ${good}"
  fi
done

# The single quotes are the point: these are the literal strings an
# attacker would supply, and they must never be expanded here.
# shellcheck disable=SC2016
for evil in \
  'v0.3.0; rm -rf /' \
  'v0.3.0|p\nrm' \
  '$(id)' \
  'main' \
  '0.3.0' \
  'v0.3' \
  ''; do
  if validate_tag "$evil" 2>/dev/null; then
    bad "accepted a malformed tag: '${evil}'"
  else
    ok "rejects '${evil}'"
  fi
done

if [[ "$failures" -gt 0 ]]; then
  echo "${failures} failure(s)" >&2
  exit 1
fi
echo "all lib.sh tests passed"

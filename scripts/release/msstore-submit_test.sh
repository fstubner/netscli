#!/usr/bin/env bash
# Tests for msstore-submit.sh against a fake Store API.
#
# The script only runs for real once per release, against an API nobody can
# call from CI without the Store secrets, so a mistake in it would surface
# at release time as a half-made submission. A fake `curl` on PATH answers
# like the API does and records each request.
#
# Run: bash scripts/release/msstore-submit_test.sh

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

failures=0
ok() { echo "  ok   - $1"; }
bad() { echo "  FAIL - $1" >&2; failures=$((failures + 1)); }

mkdir -p "$TMP/bin"
printf '#!/bin/sh\n' >"$TMP/bin/sleep"
cat >"$TMP/bin/curl" <<'EOF'
#!/usr/bin/env bash
# The draft is ready from the third status check onwards.
echo "$*" >>"$FAKE/log"
case "$*" in
  *--head*) printf '%s' "${FAKE_HEAD:-200}" ;;
  *oauth2*) echo '{"access_token":"tok"}' ;;
  *"-X GET"*/status*)
    n=$(cat "$FAKE/n" 2>/dev/null || echo 0)
    echo $((n + 1)) >"$FAKE/n"
    ongoing=""
    [ "$n" = 0 ] && ongoing="${FAKE_ONGOING:-}"
    ready=false
    [ "$n" -ge 3 ] && ready=true
    echo "{\"isSuccess\":true,\"responseData\":{\"isReady\":$ready,\"ongoingSubmissionId\":\"$ongoing\"}}" ;;
  *"-X GET"*/packages*)
    echo '{"isSuccess":true,"responseData":{"packages":[{"packageId":"p1","packageUrl":"https://netscli.com/download/v0.3.4/netscli-gui-windows-x86_64.msi","languages":["en-us"],"architectures":["X64"],"isSilentInstall":true,"packageType":"msi"}]}}' ;;
  *"-X PUT"*)
    prev=""
    for a in "$@"; do [ "$prev" = "--data" ] && printf '%s' "$a" >"$FAKE/put"; prev="$a"; done
    if [ -n "${FAKE_PUT_FAIL:-}" ]; then
      echo '{"isSuccess":false,"errors":[{"code":"badrequest","message":"bad package"}]}'
    else
      echo '{"isSuccess":true}'
    fi ;;
  *"-X POST"*/packages/commit*) echo '{"isSuccess":true}' ;;
  *"-X POST"*/submit*) echo '{"isSuccess":true,"responseData":{"submissionId":"999"}}' ;;
  *) echo "fake curl: unexpected request: $*" >&2; exit 9 ;;
esac
EOF
chmod +x "$TMP/bin/curl" "$TMP/bin/sleep"

# Runs the script with the given extra environment. Sets $status and $out,
# and leaves the request log in $FAKE.
run() {
  FAKE="$(mktemp -d "$TMP/run.XXXX")"
  set +e
  out=$(env PATH="$TMP/bin:$PATH" FAKE="$FAKE" \
    MSSTORE_TENANT_ID=t MSSTORE_CLIENT_ID=c MSSTORE_CLIENT_SECRET=s \
    MSSTORE_SELLER_ID=seller MSSTORE_PRODUCT_ID=prod "$@" \
    bash "$HERE/msstore-submit.sh" v0.3.5 2>&1)
  status=$?
  set -e
}

echo "msstore-submit.sh"

run
if [ "$status" = 0 ] && grep -q "submission 999" <<<"$out"; then ok "submits"; else bad "submits: $out"; fi
want="https://netscli.com/download/v0.3.5/netscli-gui-windows-x86_64.msi"
if [ "$(jq -r '.packages[0].packageUrl' "$FAKE/put")" = "$want" ]; then
  ok "points the package at the release's MSI"
else
  bad "package URL: $(cat "$FAKE/put")"
fi
if [ "$(jq -c '.packages[0] | del(.packageUrl)' "$FAKE/put")" = \
  '{"packageId":"p1","languages":["en-us"],"architectures":["X64"],"isSilentInstall":true,"packageType":"msi"}' ]; then
  ok "keeps every other package field"
else
  bad "other fields changed: $(cat "$FAKE/put")"
fi
if grep -q "X-Seller-Account-Id: seller" "$FAKE/log"; then ok "sends the seller id"; else bad "no seller header"; fi
order=$(grep -oE -- '-X [A-Z]+ [^ ]+' "$FAKE/log" | sed 's|https://api.store.microsoft.com/submission/v1/product/prod||' | uniq | tr '\n' ' ')
if [ "$order" = "-X GET /status -X GET /packages -X PUT /packages -X POST /packages/commit -X GET /status -X POST /submit " ]; then
  ok "calls the API in order, waiting until the draft is ready"
else
  bad "call order: $order"
fi

run FAKE_HEAD=302
if [ "$status" != 0 ] && ! grep -q "oauth2" "$FAKE/log"; then
  ok "stops before the API when the installer URL redirects"
else
  bad "redirect: status $status, $out"
fi

run FAKE_ONGOING=123
if [ "$status" != 0 ] && grep -q "123 is still in progress" <<<"$out" && ! grep -q -- "-X PUT" "$FAKE/log"; then
  ok "changes nothing while a submission is in certification"
else
  bad "ongoing: status $status, $out"
fi

run FAKE_PUT_FAIL=1
if [ "$status" != 0 ] && grep -q "badrequest: bad package" <<<"$out" && ! grep -q "/submit" "$FAKE/log"; then
  ok "prints the API's errors and does not submit"
else
  bad "PUT failure: status $status, $out"
fi

run MSSTORE_READY_ATTEMPTS=2
if [ "$status" != 0 ] && grep -q "not ready after 2 checks" <<<"$out" && ! grep -q "/submit" "$FAKE/log"; then
  ok "gives up when the draft never becomes ready"
else
  bad "never ready: status $status, $out"
fi

if [ "$failures" -gt 0 ]; then
  echo "$failures failed" >&2
  exit 1
fi

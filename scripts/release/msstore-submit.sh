#!/usr/bin/env bash
# Point the Microsoft Store listing at a release's installer and submit it
# for certification, through the Store submission API.
#
# Why: the Store does not pick up new MSI releases by itself. Each release
# needs a submission whose package URL names that release's MSI, served by
# netscli.com (see stage-store-downloads.sh). Done by hand in Partner Center
# that is five screens per release.
#
# What it does, in the order the API requires:
#   1. checks the installer URL answers 200 without a redirect, because the
#      Store refuses one that redirects and would only say so days later
#   2. refuses to start while another submission is still in certification
#   3. rewrites the packageUrl of the draft's packages, keeping every other
#      field, and commits them
#   4. waits until the draft reports ready, then submits it
# It does not wait for certification, which takes days. Partner Center shows
# the result.
#
# Usage: msstore-submit.sh <tag>
# Needs curl and jq, and these from an Entra app linked to the Partner Center
# account (docs/MICROSOFT-STORE.md, "Automating later releases"):
#   MSSTORE_TENANT_ID MSSTORE_CLIENT_ID MSSTORE_CLIENT_SECRET
#   MSSTORE_SELLER_ID MSSTORE_PRODUCT_ID
set -euo pipefail

tag="${1:?usage: msstore-submit.sh <tag>}"
: "${MSSTORE_TENANT_ID:?}" "${MSSTORE_CLIENT_ID:?}" "${MSSTORE_CLIENT_SECRET:?}"
: "${MSSTORE_SELLER_ID:?}" "${MSSTORE_PRODUCT_ID:?}"

api="https://api.store.microsoft.com/submission/v1/product/${MSSTORE_PRODUCT_ID}"
package_url="https://netscli.com/download/${tag}/netscli-gui-windows-x86_64.msi"
ready_attempts="${MSSTORE_READY_ATTEMPTS:-60}"

status=$(curl -s -o /dev/null -w '%{http_code}' --head "${package_url}")
if [ "${status}" != "200" ]; then
  echo "${package_url} answered ${status}, not 200. Deploy the site after the release, then retry." >&2
  exit 1
fi

token=$(curl -sf "https://login.microsoftonline.com/${MSSTORE_TENANT_ID}/oauth2/v2.0/token" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "client_id=${MSSTORE_CLIENT_ID}" \
  --data-urlencode "client_secret=${MSSTORE_CLIENT_SECRET}" \
  --data-urlencode "scope=https://api.store.microsoft.com/.default" | jq -r '.access_token')
if [ -z "${token}" ] || [ "${token}" = "null" ]; then
  echo "No token from Entra. Check the MSSTORE_* secrets, and whether the client secret has expired." >&2
  exit 1
fi

# Every API answer carries isSuccess and errors. Print the errors and stop on
# a failure, otherwise print the body for the caller.
call() {
  local method="$1" path="$2" response
  local args=(-s -X "${method}" "${api}${path}"
    -H "Authorization: Bearer ${token}"
    -H "X-Seller-Account-Id: ${MSSTORE_SELLER_ID}"
    -H "Content-Type: application/json")
  if [ -n "${3:-}" ]; then args+=(--data "$3"); fi
  response=$(curl "${args[@]}")
  if [ "$(jq -r '.isSuccess' <<<"${response}")" != "true" ]; then
    echo "${method} ${path} failed:" >&2
    jq -r '.errors[]? | "  \(.code): \(.message)"' <<<"${response}" >&2 || echo "${response}" >&2
    return 1
  fi
  echo "${response}"
}

ongoing=$(call GET /status | jq -r '.responseData.ongoingSubmissionId // ""')
if [ -n "${ongoing}" ]; then
  echo "Submission ${ongoing} is still in progress. Wait for it to finish in Partner Center, then retry." >&2
  exit 1
fi

packages=$(call GET /packages | jq --arg url "${package_url}" \
  '{packages: [.responseData.packages[] | .packageUrl = $url]}')
echo "Packages now:"
jq -r '.packages[] | "  \(.packageType) \(.architectures | join(",")) \(.packageUrl)"' <<<"${packages}"
call PUT /packages "${packages}" >/dev/null
call POST /packages/commit >/dev/null

# The Store downloads and checks the installer before the draft is ready.
for ((i = 1; ; i++)); do
  [ "$(call GET /status | jq -r '.responseData.isReady')" = "true" ] && break
  if [ "${i}" -ge "${ready_attempts}" ]; then
    echo "The draft was not ready after ${ready_attempts} checks. Look at Packages in Partner Center." >&2
    exit 1
  fi
  sleep 10
done

submission=$(call POST /submit | jq -r '.responseData.submissionId')
echo "Submitted ${tag} to the Microsoft Store as submission ${submission}."

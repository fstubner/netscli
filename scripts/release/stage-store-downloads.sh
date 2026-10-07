#!/usr/bin/env bash
# Copy the Windows desktop installer of the latest releases into the built
# site, at /download/<tag>/netscli-gui-windows-x86_64.msi.
#
# Why: the Microsoft Store takes an MSI by URL and refuses one that redirects.
# A GitHub release download answers 302 to a signed, expiring address on
# release-assets.githubusercontent.com, so it cannot be the Store's URL.
# netscli.com serves files directly, and the path carries the tag, so each
# URL names one release and its bytes never change.
#
# Each file is checked against the .sha256 published with its release before
# it goes into the site. Only the last few releases are kept: the Store needs
# the URL of the version it was last given, not the whole history.
#
# Usage: stage-store-downloads.sh <site dist dir> [count]
# Needs `gh` with read access to the repository (GH_TOKEN in CI).
set -euo pipefail

dist="${1:?usage: stage-store-downloads.sh <site dist dir> [count]}"
count="${2:-3}"
asset="netscli-gui-windows-x86_64.msi"
repo="${GITHUB_REPOSITORY:-fstubner/netscli}"

[ -d "${dist}" ] || { echo "no such directory: ${dist}" >&2; exit 1; }

tags=$(gh release list --repo "${repo}" --exclude-drafts --exclude-pre-releases \
  --limit 20 --json tagName --jq '.[].tagName')

staged=0
for tag in ${tags}; do
  [ "${staged}" -lt "${count}" ] || break
  # Ask which assets the release has, rather than read a failed download as
  # "this release has no MSI". That used to hide every other failure too:
  # with the error output thrown away, a network or API error skipped the
  # newest release, the job staged older ones and passed, and the Store's
  # URL for the newest went missing with nothing failing.
  names=$(gh release view "${tag}" --repo "${repo}" --json assets --jq '.assets[].name')
  if ! grep -qxF "${asset}" <<<"${names}"; then
    echo "${tag}: no ${asset}, skipped"
    continue
  fi
  if ! grep -qxF "${asset}.sha256" <<<"${names}"; then
    echo "${tag}: has ${asset} but no ${asset}.sha256 to check it against" >&2
    exit 1
  fi
  dir="${dist}/download/${tag}"
  mkdir -p "${dir}"
  gh release download "${tag}" --repo "${repo}" --dir "${dir}" \
    --pattern "${asset}" --pattern "${asset}.sha256"
  (cd "${dir}" && sha256sum --check --status "${asset}.sha256") || {
    echo "${tag}: ${asset} does not match its published checksum" >&2
    exit 1
  }
  echo "${tag}: staged ${asset} ($(wc -c < "${dir}/${asset}") bytes, checksum ok)"
  staged=$((staged + 1))
done

[ "${staged}" -gt 0 ] || { echo "no release installer staged" >&2; exit 1; }

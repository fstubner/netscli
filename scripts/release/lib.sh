#!/usr/bin/env bash
# Shared helpers for the four publish-*.sh scripts.
#
# Source this, don't execute it:
#   . "$(dirname "$0")/lib.sh"
#
# Everything here exists because the same four bugs were copy-pasted
# across all four publish scripts. Keeping one implementation means a
# fix lands everywhere at once.

# --- Tag validation ------------------------------------------------------
#
# Every publish script interpolates the tag into shell strings, sed
# replacements, and commit messages. `workflow_dispatch` lets a caller
# supply an arbitrary tag input, so validate before it reaches any of
# those. Accepts `v1.2.3` and `v1.2.3-rc.1`; rejects everything else,
# including anything containing shell metacharacters.
validate_tag() {
  local tag="$1"
  if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$ ]]; then
    echo "ERROR: refusing to publish malformed tag: '${tag}'" >&2
    echo "       expected vMAJOR.MINOR.PATCH[-prerelease]" >&2
    return 1
  fi
}

# --- Asset availability --------------------------------------------------
#
# release.yml and publish.yml both fire on `release: published`, so the
# publish jobs routinely start before release.yml's matrix has finished
# uploading. Poll for up to 15 minutes, which covers the slowest matrix
# entry (Tauri bundle on Windows).
#
# Progress goes to stderr, deliberately. `verified_sha` calls this, and every
# caller of `verified_sha` uses a command substitution — so anything written
# to stdout here is captured *as part of the checksum*. That is not
# hypothetical: with the retry engaged, `sha` became
#
#   "  not yet; retry in 30s (1/30)\n<the real digest>"
#
# which the downstream awk/sed patch wrote into the formula, and the render
# check then rejected with "expected 4 valid sha256 lines, got 0". The retry
# always engages on a real release, because release.yml and publish.yml fire
# on the same event and the binaries take minutes to build — so this broke
# all four Homebrew/Scoop publishes, with an error naming the manifest rather
# than the cause. `lib_test.sh` pins it.
wait_for_asset() {
  local url="$1"
  local i
  for i in {1..30}; do
    if curl -fsSL --head "$url" >/dev/null 2>&1; then
      return 0
    fi
    echo "  not yet; retry in 30s ($i/30)" >&2
    sleep 30
  done
  echo "ERROR: $url never became available" >&2
  return 1
}

# --- Checksum verification -----------------------------------------------
#
# Print the SHA256 for an asset, having actually verified it.
#
# The previous implementation read the `.sha256` sidecar and trusted it.
# That is circular: the sidecar and the asset come from the same origin,
# so a bad sidecar produces a bad manifest and nothing notices. It also
# accepted an empty value — the downstream `grep -c 'sha256 "'` guards
# match `sha256 ""` happily — so a truncated sidecar could publish a
# formula with blank hashes.
#
# Now: fetch the sidecar, fetch the asset, hash the asset locally, and
# require all three of (sidecar is 64 hex chars), (local hash is 64 hex
# chars), (they match). Any failure aborts the publish.
#
# Usage: sha=$(verified_sha "$BASE" "netscli-linux-x86_64")
verified_sha() {
  local base="$1" asset="$2"
  local sidecar_url="${base}/${asset}.sha256"
  local asset_url="${base}/${asset}"
  local workdir expected actual

  wait_for_asset "$sidecar_url" || return 1

  expected=$(curl -fsSL "$sidecar_url" | awk 'NR==1 {print $1}')
  if [[ ! "$expected" =~ ^[0-9a-fA-F]{64}$ ]]; then
    echo "ERROR: ${asset}.sha256 is not a 64-char hex digest: '${expected}'" >&2
    return 1
  fi
  expected=$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')

  workdir=$(mktemp -d)
  # shellcheck disable=SC2064  # intentional: expand workdir now, not at trap time
  trap "rm -rf '$workdir'" RETURN

  if ! curl -fsSL "$asset_url" -o "$workdir/asset"; then
    echo "ERROR: could not download ${asset_url} to verify its checksum" >&2
    return 1
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$workdir/asset" | awk '{print $1}')
  else
    actual=$(shasum -a 256 "$workdir/asset" | awk '{print $1}')
  fi
  actual=$(printf '%s' "$actual" | tr '[:upper:]' '[:lower:]')

  if [[ ! "$actual" =~ ^[0-9a-f]{64}$ ]]; then
    echo "ERROR: could not compute a SHA256 for ${asset}" >&2
    return 1
  fi
  if [[ "$actual" != "$expected" ]]; then
    echo "ERROR: checksum mismatch for ${asset}" >&2
    echo "       sidecar says: ${expected}" >&2
    echo "       actual bytes: ${actual}" >&2
    return 1
  fi

  printf '%s' "$actual"
}

# --- Repo checkout -------------------------------------------------------
#
# Clone without putting GH_TOKEN in the remote URL. A token in the URL is
# written to .git/config and can surface in git's error output on a
# failed push. `http.extraheader` keeps it in the config as a header
# value that git redacts.
#
# Usage: clone_tap "fstubner/homebrew-tap" "$WORKDIR/tap"
clone_tap() {
  local repo="$1" dest="$2"
  : "${GH_TOKEN:?GH_TOKEN must be set}"
  local auth
  auth=$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\n')

  git -c "http.https://github.com/.extraheader=Authorization: Basic ${auth}" \
    clone --depth 1 "https://github.com/${repo}.git" "$dest"

  git -C "$dest" config "http.https://github.com/.extraheader" \
    "Authorization: Basic ${auth}"
  git -C "$dest" config user.name  "netscli release bot"
  git -C "$dest" config user.email "noreply@netscli.com"
}

# --- Commit and push -----------------------------------------------------
#
# Idempotent: re-running a publish for the same tag (the recovery path in
# docs/RELEASE.md) previously died here, because `git commit` exits
# non-zero with nothing staged and `set -e` turned that into a failure.
# Retries the push so a concurrent sibling job racing on the same repo
# doesn't lose the update.
commit_and_push() {
  local message="$1"
  local i

  if git diff --cached --quiet; then
    echo "No changes to commit — already up to date for ${message}."
    return 0
  fi

  git commit -m "$message"

  for i in 1 2 3; do
    if git push origin HEAD; then
      return 0
    fi
    echo "  push failed (attempt ${i}/3); rebasing on origin and retrying"
    git pull --rebase origin HEAD || true
    sleep 5
  done

  echo "ERROR: could not push ${message} after 3 attempts" >&2
  return 1
}

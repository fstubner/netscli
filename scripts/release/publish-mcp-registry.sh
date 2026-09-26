#!/usr/bin/env bash
# List a release in the official MCP Registry (registry.modelcontextprotocol.io).
#
#   scripts/release/publish-mcp-registry.sh v0.3.4                  # publish
#   scripts/release/publish-mcp-registry.sh v0.3.4 --validate-only  # check only
#
# The registry hosts metadata, not artifacts: packaging/mcp-registry/server.json
# says "run the npm package `netscli` with `serve`", and clients that browse
# the registry (VS Code, Cursor, ...) turn that into an `npx` command. So this
# runs after the npm job, and waits for the npm version to be visible first:
# the registry checks the published package's `mcpName` against the server
# name, and rejects the listing if npm does not have that version yet.
#
# Authentication is GitHub Actions OIDC: the io.github.fstubner namespace is
# proven by the workflow's own identity token, so no secret exists. Outside
# Actions only --validate-only works, which needs no login.
#
# Re-runnable. A version the registry already lists is reported and skipped,
# because publishing the same version twice is an error there.
#
# MCP_PUBLISHER overrides the pinned binary, for running --validate-only on a
# machine that is not linux/amd64.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=scripts/release/lib.sh
. "${SCRIPT_DIR}/lib.sh"

TAG="${1:-}"
MODE="${2:-publish}"

if [[ -z "$TAG" ]]; then
  echo "usage: $0 vX.Y.Z [--validate-only]" >&2
  exit 2
fi
validate_tag "$TAG"
VERSION="${TAG#v}"

if [[ "$MODE" != "publish" && "$MODE" != "--validate-only" ]]; then
  echo "ERROR: second argument must be --validate-only or omitted, got '${MODE}'" >&2
  exit 2
fi

REGISTRY="https://registry.modelcontextprotocol.io"
NAME="io.github.fstubner/netscli"
NPM_PACKAGE="netscli"

# Pinned, with the tarball's digest, like every other tool this pipeline
# downloads. Bumping it means updating both lines.
PUBLISHER_VERSION="v1.8.1"
PUBLISHER_SHA256="a06c9096dcb9727c13555b6be26c7effa707b01f06a4c561ba7a3635443cf2cc"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

sed "s/@@VERSION@@/${VERSION}/g" "${REPO_ROOT}/packaging/mcp-registry/server.json" \
  > "${WORK}/server.json"
if grep -q '@@' "${WORK}/server.json"; then
  echo "ERROR: server.json still has a placeholder after rendering" >&2
  exit 1
fi

if [[ -n "${MCP_PUBLISHER:-}" ]]; then
  PUBLISHER="$MCP_PUBLISHER"
else
  tarball="mcp-publisher_linux_amd64.tar.gz"
  curl -fsSL -o "${WORK}/${tarball}" \
    "https://github.com/modelcontextprotocol/registry/releases/download/${PUBLISHER_VERSION}/${tarball}"
  echo "${PUBLISHER_SHA256}  ${WORK}/${tarball}" | sha256sum -c -
  tar -xzf "${WORK}/${tarball}" -C "$WORK" mcp-publisher
  PUBLISHER="${WORK}/mcp-publisher"
fi

cd "$WORK"
"$PUBLISHER" validate

if [[ "$MODE" == "--validate-only" ]]; then
  echo "server.json for ${VERSION} is valid; --validate-only, so nothing published."
  exit 0
fi

# Is this version already listed? The search matches on name; the filter
# picks the exact version out of however many are listed.
listed() {
  curl -fsSL --get "${REGISTRY}/v0.1/servers" --data-urlencode "search=${NAME}" --data-urlencode "limit=100" \
    | jq -e --arg n "$NAME" --arg v "$VERSION" \
        '[.servers[].server | select(.name == $n and .version == $v)] | length > 0' \
        >/dev/null
}

if listed; then
  echo "${NAME} ${VERSION} is already in the MCP Registry; nothing to do."
  exit 0
fi

# npm can take a minute to serve a version it has just accepted. Checking
# mcpName, not just the version, also catches a launcher template that lost
# the field: the registry would refuse the listing for that anyway, with a
# less direct message.
for attempt in $(seq 1 20); do
  got="$(npm view "${NPM_PACKAGE}@${VERSION}" mcpName 2>/dev/null || true)"
  if [[ "$got" == "$NAME" ]]; then
    break
  fi
  if [[ "$attempt" -eq 20 ]]; then
    echo "ERROR: npm has no ${NPM_PACKAGE}@${VERSION} with mcpName ${NAME} (got '${got}')" >&2
    exit 1
  fi
  sleep 15
done

"$PUBLISHER" login github-oidc
"$PUBLISHER" publish

for attempt in $(seq 1 10); do
  if listed; then
    echo "${NAME} ${VERSION} is listed in the MCP Registry."
    exit 0
  fi
  sleep 6
done
echo "ERROR: publish reported success but ${REGISTRY} does not list ${NAME} ${VERSION}" >&2
exit 1

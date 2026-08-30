#!/usr/bin/env bash
#
# Compile and test the Linux side of the Rust crates, from a Windows checkout.
#
#   ./scripts/check-linux.sh              # clippy + tests
#   ./scripts/check-linux.sh clippy       # clippy only
#   ./scripts/check-linux.sh test         # tests only
#   ./scripts/check-linux.sh shell        # a prompt inside the image
#
# Why this exists: netscli-core carries 37 platform-conditional blocks, and
# the ones that matter most are the least forgiving code in the project --
# ARP table reads and mutations, and raw ICMP:
#
#   crates/netscli-core/src/arp/platform/table.rs
#   crates/netscli-core/src/arp/platform/mutate.rs
#   crates/netscli-core/src/ping/raw_icmp.rs
#
# On a Windows machine `cargo clippy` compiles only the `cfg(windows)` arms.
# The Linux arms are not type-checked, not linted, and not tested locally at
# all, so a mistake in them is invisible until CI runs -- which is where you
# find out, rather than where you would want to.
#
# This does NOT replace CI. It skips netscli-gui entirely (see the Dockerfile)
# and it is not the macOS path, which stays CI-only.
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE=netscli-linux-check
MODE="${1:-all}"

# Git Bash rewrites anything that looks like a Unix path in an argument into a
# Windows one before the process sees it, so `-w /work` reached docker as
# 'C:/Program Files/Git/work'. Turning that off is only half the fix: the
# host side of `-v` then needs a real Windows path, which is what `pwd -W`
# gives and plain $PWD (/h/projects/...) does not. Both are no-ops elsewhere.
export MSYS_NO_PATHCONV=1
HOST_ROOT="$(pwd -W 2>/dev/null || pwd)"

# A target directory of its own, for the same reason /target-pcap has one: the
# container writes Linux objects, and pointing it at ./target would mean the
# two platforms evict each other's artifacts on every alternating run. Named
# volume for the registry so crates are downloaded once, not per run.
TARGET_DIR=/work/target-linux
REGISTRY_VOLUME=netscli-linux-check-registry

if ! command -v docker >/dev/null 2>&1; then
    echo "check-linux: docker is not on PATH." >&2
    exit 1
fi

# Linux containers only. Under Windows-container mode this image cannot even
# be pulled, and the error that produces is opaque enough to be worth pre-empting.
os_type=$(docker info --format '{{.OSType}}' 2>/dev/null || echo unknown)
if [ "$os_type" != "linux" ]; then
    echo "check-linux: Docker is in '$os_type' container mode; this needs Linux containers." >&2
    exit 1
fi

echo "==> Building $IMAGE (cached after the first run)"
docker build -q -f scripts/linux-check.Dockerfile -t "$IMAGE" scripts/ >/dev/null

docker volume create "$REGISTRY_VOLUME" >/dev/null

run_in_container() {
    docker run --rm \
        -v "$HOST_ROOT:/work" \
        -v "$REGISTRY_VOLUME:/usr/local/cargo/registry" \
        -e CARGO_TARGET_DIR="$TARGET_DIR" \
        -w /work \
        "$IMAGE" \
        bash -eu -o pipefail -c "$1"
}

# netscli-gui is excluded, not forgotten: it is a Tauri app whose Linux build
# needs the whole GTK/WebKit stack, and none of the platform code this script
# exists for lives there.
CRATES="-p netscli-core -p netscli-mcp -p netscli"

case "$MODE" in
clippy)
    echo "==> clippy (Linux, all features)"
    run_in_container "cargo clippy $CRATES --all-features --all-targets -- -D warnings"
    ;;
test)
    echo "==> tests (Linux, all features)"
    run_in_container "cargo test $CRATES --all-features"
    ;;
shell)
    docker run --rm -it \
        -v "$HOST_ROOT:/work" \
        -v "$REGISTRY_VOLUME:/usr/local/cargo/registry" \
        -e CARGO_TARGET_DIR="$TARGET_DIR" \
        -w /work "$IMAGE" bash
    ;;
all)
    echo "==> clippy (Linux, all features)"
    run_in_container "cargo clippy $CRATES --all-features --all-targets -- -D warnings"
    echo "==> tests (Linux, all features)"
    run_in_container "cargo test $CRATES --all-features"
    ;;
*)
    echo "check-linux: unknown mode '$MODE' (use clippy, test, shell, or nothing)" >&2
    exit 1
    ;;
esac

echo "==> Linux check passed"

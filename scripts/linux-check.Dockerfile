# Compile-and-test image for the Linux side of the Rust crates.
#
# Built by scripts/check-linux.sh. It exists so the apt install below happens
# once rather than on every run.
#
# The toolchain is pinned to match rust-toolchain.toml. Keep the two in step:
# the image ships 1.96.0 as its default, so a mismatch means rustup silently
# downloads the pinned version on first use and every run pays for it.
FROM rust:1.96-bookworm

# libpcap-dev + pkg-config: netscli-core's `pcap` feature links against
# libpcap, so --all-features does not build without it.
#
# Deliberately NOT the GTK/WebKit set that ci.yml installs. That workflow runs
# `cargo test --all`, which pulls in netscli-gui and needs a desktop stack to
# link. This image never builds the GUI -- see the crate list in
# check-linux.sh -- so those packages would be several hundred MB bought for
# nothing.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpcap-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work

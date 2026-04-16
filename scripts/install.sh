#!/usr/bin/env bash
# NetsCLI Installer
#
# Remote usage:
#   curl -fsSL https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.sh | bash
#
# Local usage:
#   ./scripts/install.sh
#
# Optional environment variables:
#   - INSTALL_DIR: install directory (default: ~/.local/bin)
#   - REPO: GitHub repo ("owner/name", default: fstubner/netscli)
#   - NETSCLI_VERSION: release tag (e.g. v0.1.0; default: latest)
#   - NETSCLI_SHA256 / NETSCLI_SHA256_URL: checksum verification (optional)
#   - NETSCLI_PCAP=1: install the PCAP-enabled binary AND libpcap system lib
#   - NETSCLI_SKIP_LIBPCAP=1: with NETSCLI_PCAP=1, skip installing libpcap
#     (for users who already manage libpcap themselves)
#   - NETSCLI_LINUX_VARIANT=gnu|musl (Linux only; default: auto-detect)

set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
BINARY_NAME="netscli"
REPO="${REPO:-fstubner/netscli}"
NETSCLI_VERSION="${NETSCLI_VERSION:-}" # e.g. v0.1.0 (defaults to latest)
NETSCLI_SHA256="${NETSCLI_SHA256:-}" # optional checksum for the binary
NETSCLI_SHA256_URL="${NETSCLI_SHA256_URL:-}" # optional URL to fetch checksum
# Single flag for "I want packet capture support":
#   - selects the -pcap release asset (contains a netscli binary built with
#     the pcap feature)
#   - attempts to install libpcap from the system package manager
# Users who manage libpcap themselves can set NETSCLI_SKIP_LIBPCAP=1.
NETSCLI_PCAP="${NETSCLI_PCAP:-}"
NETSCLI_SKIP_LIBPCAP="${NETSCLI_SKIP_LIBPCAP:-}"

# Backwards-compat: a previous revision exposed NETSCLI_INSTALL_PCAP as a
# separate toggle. If set, fold it into NETSCLI_PCAP so old invocations
# keep working.
if [ -n "${NETSCLI_INSTALL_PCAP:-}" ]; then
    NETSCLI_PCAP="${NETSCLI_PCAP:-${NETSCLI_INSTALL_PCAP}}"
fi

have_cmd() { command -v "$1" >/dev/null 2>&1; }

is_true() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|y|Y) return 0 ;;
    *) return 1 ;;
  esac
}

echo "NetsCLI Installer"
echo "================="
echo ""

# Detect OS/arch and pick the correct release asset.
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS" in
  linux|darwin) ;;
  *) echo "Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64) ARCH="x86_64" ;;
  aarch64|arm64) ARCH="aarch64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

PCAP_SUFFIX=""
if is_true "$NETSCLI_PCAP"; then
  PCAP_SUFFIX="-pcap"
fi

download() {
  local url="$1"
  local out="$2"

  if have_cmd curl; then
    curl -fsSL "$url" -o "$out"
    return 0
  fi

  if have_cmd wget; then
    wget -qO "$out" "$url"
    return 0
  fi

  echo "Neither curl nor wget found."
  echo "Install curl (recommended) or wget and retry."
  exit 1
}

download_optional() {
  local url="$1"
  local out="$2"

  if have_cmd curl; then
    if curl -fsSL "$url" -o "$out"; then
      return 0
    fi
    return 1
  fi

  if have_cmd wget; then
    if wget -qO "$out" "$url"; then
      return 0
    fi
    return 1
  fi

  return 1
}

detect_linux_variant() {
  # Default to glibc builds for feature completeness.
  # Alpine/musl users can override with NETSCLI_LINUX_VARIANT=musl.
  if [[ "${NETSCLI_LINUX_VARIANT:-}" == "gnu" || "${NETSCLI_LINUX_VARIANT:-}" == "musl" ]]; then
    echo "${NETSCLI_LINUX_VARIANT}"
    return
  fi

  if have_cmd ldd; then
    # `ldd --version` prints "musl" on Alpine.
    local out
    out="$(ldd --version 2>&1 || true)"
    if [[ "$out" == *musl* || "$out" == *Musl* ]]; then
      echo "musl"
      return
    fi
  fi

  # Fallback heuristic: if musl loader exists, assume musl.
  if compgen -G "/lib/ld-musl-*.so.1" >/dev/null; then
    echo "musl"
    return
  fi

  echo "gnu"
}

have_libpcap() {
  if have_cmd tcpdump; then
    return 0
  fi

  if have_cmd pcap-config; then
    return 0
  fi

  if have_cmd pkg-config && pkg-config --exists libpcap; then
    return 0
  fi

  if [[ "$OS" == "linux" ]] && have_cmd ldconfig; then
    if ldconfig -p 2>/dev/null | grep -q libpcap; then
      return 0
    fi
  fi

  return 1
}

install_libpcap() {
  if [[ "$OS" == "darwin" ]] && have_cmd brew; then
    brew install libpcap tcpdump
    return $?
  fi

  if [[ "$OS" == "linux" ]]; then
    if have_cmd apt-get; then
      if ! have_cmd sudo; then
        echo "sudo not found; cannot auto-install libpcap."
        return 1
      fi
      sudo apt-get update && sudo apt-get install -y libpcap-dev tcpdump
      return $?
    fi
    if have_cmd dnf; then
      if ! have_cmd sudo; then
        echo "sudo not found; cannot auto-install libpcap."
        return 1
      fi
      sudo dnf install -y libpcap libpcap-devel tcpdump
      return $?
    fi
    if have_cmd yum; then
      if ! have_cmd sudo; then
        echo "sudo not found; cannot auto-install libpcap."
        return 1
      fi
      sudo yum install -y libpcap libpcap-devel tcpdump
      return $?
    fi
    if have_cmd pacman; then
      if ! have_cmd sudo; then
        echo "sudo not found; cannot auto-install libpcap."
        return 1
      fi
      sudo pacman -S --noconfirm libpcap tcpdump
      return $?
    fi
  fi

  return 1
}

ASSET=""
if [[ "$OS" == "linux" ]]; then
  variant="$(detect_linux_variant)"
  if [[ "$variant" == "musl" && -n "$PCAP_SUFFIX" ]]; then
    echo "PCAP-enabled musl builds are not available."
    echo "Use a glibc distro or build from source with --features pcap."
    exit 1
  fi
  if [[ "$variant" == "musl" && "$ARCH" != "x86_64" ]]; then
    echo "Linux ${ARCH} musl release assets are not available."
    echo "Use a glibc distro (NETSCLI_LINUX_VARIANT=gnu) or build from source."
    exit 1
  fi
  case "$variant" in
    gnu)  ASSET="netscli-linux-${ARCH}${PCAP_SUFFIX}" ;;
    musl) ASSET="netscli-linux-${ARCH}-musl${PCAP_SUFFIX}" ;;
    *) echo "Unsupported NETSCLI_LINUX_VARIANT: $variant (use 'gnu' or 'musl')"; exit 1 ;;
  esac
else
  # darwin
  ASSET="netscli-macos-${ARCH}${PCAP_SUFFIX}"
fi

DOWNLOAD_BASE="https://github.com/${REPO}/releases"
if [[ -n "$NETSCLI_VERSION" ]]; then
  DOWNLOAD_URL="${DOWNLOAD_BASE}/download/${NETSCLI_VERSION}/${ASSET}"
else
  DOWNLOAD_URL="${DOWNLOAD_BASE}/latest/download/${ASSET}"
fi

TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t netscli)"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "Downloading release asset: ${DOWNLOAD_URL}"
download "${DOWNLOAD_URL}" "${TMP_DIR}/${BINARY_NAME}"
chmod +x "${TMP_DIR}/${BINARY_NAME}"

if [[ -n "$NETSCLI_SHA256_URL" ]]; then
  echo "Fetching checksum from ${NETSCLI_SHA256_URL}"
  download "${NETSCLI_SHA256_URL}" "${TMP_DIR}/${BINARY_NAME}.sha256"
  NETSCLI_SHA256="$(awk '{print $1}' "${TMP_DIR}/${BINARY_NAME}.sha256" | head -n 1)"
elif [[ -z "$NETSCLI_SHA256" ]]; then
  # Best-effort: if the release publishes "<asset>.sha256", use it automatically.
  if download_optional "${DOWNLOAD_URL}.sha256" "${TMP_DIR}/${BINARY_NAME}.sha256"; then
    NETSCLI_SHA256="$(awk '{print $1}' "${TMP_DIR}/${BINARY_NAME}.sha256" | head -n 1)"
  fi
fi

if [[ -n "$NETSCLI_SHA256" ]]; then
  echo "Verifying checksum..."
  if have_cmd sha256sum; then
    echo "${NETSCLI_SHA256}  ${TMP_DIR}/${BINARY_NAME}" | sha256sum -c -
  elif have_cmd shasum; then
    echo "${NETSCLI_SHA256}  ${TMP_DIR}/${BINARY_NAME}" | shasum -a 256 -c -
  else
    echo "sha256sum or shasum not found; cannot verify checksum."
    exit 1
  fi
else
  echo "Warning: no checksum verification performed (set NETSCLI_SHA256 or NETSCLI_SHA256_URL)."
fi

if [[ "$OS" == "linux" && "${ASSET}" == *"-musl" ]]; then
  echo ""
  echo "NOTE: You are installing the musl build."
  echo "      PCAP capture is disabled in the musl release artifact."
  echo "      If you need PCAP, use a glibc distro or build from source."
fi

if ! is_true "$NETSCLI_PCAP"; then
  echo ""
  echo "NOTE: Default release builds do not include packet capture."
  echo "      Set NETSCLI_PCAP=1 to install the PCAP-enabled release asset."
fi

echo "Installing to ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}"
cp "${TMP_DIR}/${BINARY_NAME}" "${INSTALL_DIR}/${BINARY_NAME}"
chmod +x "${INSTALL_DIR}/${BINARY_NAME}"

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    echo ""
    echo "NOTE: ${INSTALL_DIR} is not in your PATH."
    echo "Add this to your shell profile:"
    echo "  export PATH=\"\$PATH:${INSTALL_DIR}\""
    ;;
esac

echo ""
echo "Installed successfully."

if is_true "$NETSCLI_PCAP"; then
  if have_libpcap; then
    echo "libpcap detected — no system install needed."
  elif is_true "$NETSCLI_SKIP_LIBPCAP"; then
    echo "libpcap not detected; skipping install as requested (NETSCLI_SKIP_LIBPCAP=1)."
  else
    echo "libpcap not detected. Attempting installation..."
    if install_libpcap; then
      echo "libpcap installation completed."
    else
      echo "libpcap installation failed — install it manually:"
      if [[ "$OS" == "darwin" ]]; then
        echo "  brew install libpcap tcpdump"
      else
        echo "  sudo apt-get install -y libpcap-dev tcpdump   # (or your distro's equivalent)"
      fi
      echo "Or run: netscli setup"
    fi
  fi
fi

echo "Try:"
echo "  ${BINARY_NAME} --help"
echo "  ${BINARY_NAME} doctor --json"
echo "  ${BINARY_NAME} serve"

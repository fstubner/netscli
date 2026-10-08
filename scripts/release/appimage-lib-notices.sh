#!/usr/bin/env bash
#
# Write the licenses of the system libraries bundled into an AppDir, and
# where to get their source, into the AppDir itself.
#
# linuxdeploy copies GTK, WebKitGTK, GLib, libsoup and the rest of what the
# app links against from the build machine into the AppImage. Many of them
# are under the GNU LGPL, which asks whoever passes on a copy to pass on the
# license too and say where the source is. THIRD-PARTY-NOTICES.txt covers
# the Rust crates and npm packages only. The .deb, MSI and DMG use the
# system's own copies of these libraries, so only the AppImage needs this.
#
# Each library is traced to the Ubuntu package it came from on the runner
# that built the image, and that package's copyright file is copied in.
# Ubuntu publishes the exact source of every package version it ships, and
# the list says which version that is.
#
# Usage: appimage-lib-notices.sh <AppDir>
#
# Fails if a bundled library belongs to no installed package, since then
# nothing says what its license is. Run by fix-appimage-host-libs.sh, on the
# machine that built the AppImage, before it repacks the image.

set -euo pipefail

if [ $# -ne 1 ] || [ ! -d "$1/usr/lib" ]; then
  echo "usage: $0 <AppDir>" >&2
  exit 2
fi

appdir=$1
out="$appdir/usr/share/doc/netscli-bundled-libraries"
rm -rf "$out"
mkdir -p "$out/copyright"

# shellcheck source=/dev/null
. /etc/os-release
list="$out/LIBRARIES.txt"
{
  echo "Libraries in this AppImage that come from ${PRETTY_NAME}"
  echo
  echo "The NetsCLI AppImage carries copies of these libraries from the"
  echo "${PRETTY_NAME} machine it was built on. The license of each one is"
  echo "in copyright/<package>. Several are under the GNU LGPL."
  echo
  echo "Their source, at exactly the version used here, is published by"
  echo "Ubuntu. On Ubuntu, run apt-get source <source>=<version>. Or download it"
  echo "from https://launchpad.net/ubuntu/+source/<source>/<version>."
  echo
  printf '%-44s %-32s %-24s %s\n' library package source version
} > "$list"

missing=()
while IFS= read -r lib; do
  # The owning package of any installed file with this name. dpkg answers
  # "package:arch: /path", one line per owner.
  owner=$(dpkg -S "*/$lib" 2>/dev/null | head -n 1 | cut -d: -f1 || true)
  if [ -z "$owner" ]; then
    missing+=("$lib")
    continue
  fi
  read -r version source source_version < <(
    dpkg-query -W -f '${Version} ${source:Package} ${source:Version}\n' "$owner" | head -n 1
  )
  printf '%-44s %-32s %-24s %s\n' "$lib" "$owner" "$source" "$source_version" >> "$list"
  if [ ! -e "$out/copyright/$owner" ]; then
    if [ ! -f "/usr/share/doc/$owner/copyright" ]; then
      missing+=("$lib (package $owner $version has no copyright file)")
      continue
    fi
    cp -L "/usr/share/doc/$owner/copyright" "$out/copyright/$owner"
  fi
done < <(find "$appdir/usr/lib" -name '*.so*' \( -type f -o -type l \) -printf '%f\n' | sort -u)

if [ ${#missing[@]} -gt 0 ]; then
  echo "error: no license found for these bundled libraries:" >&2
  printf '  %s\n' "${missing[@]}" >&2
  exit 1
fi

echo "wrote the licenses of $(find "$out/copyright" -type f | wc -l) packages to ${out#"$appdir"/}"

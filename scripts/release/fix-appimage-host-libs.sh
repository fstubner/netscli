#!/usr/bin/env bash
#
# Remove the display-stack libraries from a built .AppImage and repack it.
#
# Tauri builds the AppImage through linuxdeploy, whose AppRun puts
# $APPDIR/usr/lib first on LD_LIBRARY_PATH. Anything bundled there wins over
# the host's copy. That is the point for most libraries and wrong for this
# handful: they have to match the host's Mesa and display server, not the
# machine the release was built on. When they do not, eglGetPlatformDisplay
# fails and the app aborts before a window appears:
#
#   Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...
#
# Reported in #378 against v0.2.6 on Mesa 26.2.2; v0.3.1 bundles the same
# nine libraries. Upstream has the same bug open as tauri-apps/tauri#15976.
#
# Why this runs here rather than being configured on the bundler: Tauri's
# linuxdeploy invocation takes no exclusion arguments (tauri-bundler
# 2.9.4, src/bundle/linux/appimage/linuxdeploy.rs), and its bundled GTK
# plugin deploys with `--library=`, which is the flag that overrides
# linuxdeploy's own exclude list. libwayland-client.so.0 is ON the official
# AppImage exclude list and is bundled anyway, which is how we know the list
# is not being consulted on this path. So the AppImage is corrected after it
# is built, which is the first point this repository controls.
#
# Usage: fix-appimage-host-libs.sh <path-to-.AppImage>
#
# Repacks in place. Idempotent: re-running on an already-fixed image removes
# nothing and repacks the same contents.

set -euo pipefail

# Pinned by tag and digest. `continuous` is overwritten in place, so it can
# be neither pinned nor checked.
APPIMAGETOOL_URL="https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage"
APPIMAGETOOL_SHA256="ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0"

# The libraries that must come from the host. The wayland ones are what
# breaks EGL; the xkbcommon/xcb/X11 ones are the rest of the same client
# stack, and mixing bundled and host copies of one library family is the
# general form of the same fault. libxcb.so.1 itself is already not bundled,
# so libxcb-render and libxcb-shm are host-side halves of a split family.
HOST_LIBS=(
  libwayland-client.so.0
  libwayland-cursor.so.0
  libwayland-egl.so.1
  libwayland-server.so.0
  libxkbcommon.so.0
  libxcb-render.so.0
  libxcb-shm.so.0
  libXau.so.6
  libXdmcp.so.6
)

if [ $# -ne 1 ]; then
  echo "usage: $0 <path-to-.AppImage>" >&2
  exit 2
fi

appimage=$(readlink -f "$1")
if [ ! -f "$appimage" ]; then
  echo "error: no such file: $appimage" >&2
  exit 1
fi

# The AppImage runtime wants FUSE, which no CI runner has.
export APPIMAGE_EXTRACT_AND_RUN=1

workdir=$(mktemp -d)
cleanup() { rm -rf "$workdir"; }
trap cleanup EXIT

tool="$workdir/appimagetool"
curl -fsSL -o "$tool" "$APPIMAGETOOL_URL"
actual=$(sha256sum "$tool" | cut -d' ' -f1)
if [ "$actual" != "$APPIMAGETOOL_SHA256" ]; then
  echo "error: appimagetool digest mismatch" >&2
  echo "  expected $APPIMAGETOOL_SHA256" >&2
  echo "  actual   $actual" >&2
  exit 1
fi
chmod +x "$tool"

size_before=$(stat -c %s "$appimage")
chmod +x "$appimage"
(cd "$workdir" && "$appimage" --appimage-extract >/dev/null)
appdir="$workdir/squashfs-root"
if [ ! -d "$appdir/usr/lib" ]; then
  echo "error: extracted AppDir has no usr/lib; is $appimage an AppImage?" >&2
  exit 1
fi

libs_before=$(find "$appdir/usr/lib" -maxdepth 1 -name '*.so*' | wc -l)
removed=0
for lib in "${HOST_LIBS[@]}"; do
  if [ -e "$appdir/usr/lib/$lib" ]; then
    rm -f "$appdir/usr/lib/$lib"
    echo "removed $lib"
    removed=$((removed + 1))
  else
    # Not a failure. If a future Tauri or linuxdeploy stops bundling these,
    # this script should quietly become a no-op rather than block a release.
    echo "not bundled, nothing to remove: $lib"
  fi
done
echo "removed $removed of ${#HOST_LIBS[@]} libraries"

out="$workdir/repacked.AppImage"
ARCH=x86_64 "$tool" "$appdir" "$out" >/dev/null 2>&1 || {
  echo "error: appimagetool failed to repack" >&2
  exit 1
}

# Check the repacked image rather than the directory we just edited: the
# thing that ships is the image, and a repack that silently dropped content
# would still leave a correct-looking AppDir behind.
verify="$workdir/verify"
mkdir -p "$verify"
chmod +x "$out"
(cd "$verify" && "$out" --appimage-extract >/dev/null)
still_there=()
for lib in "${HOST_LIBS[@]}"; do
  if [ -e "$verify/squashfs-root/usr/lib/$lib" ]; then
    still_there+=("$lib")
  fi
done
if [ ${#still_there[@]} -gt 0 ]; then
  echo "error: still bundled after repack: ${still_there[*]}" >&2
  exit 1
fi
if [ ! -x "$verify/squashfs-root/AppRun" ]; then
  echo "error: repacked image has no executable AppRun" >&2
  exit 1
fi

libs_after=$(find "$verify/squashfs-root/usr/lib" -maxdepth 1 -name '*.so*' | wc -l)
if [ "$libs_after" -ne $((libs_before - removed)) ]; then
  echo "error: expected $((libs_before - removed)) libraries after repack, found $libs_after" >&2
  exit 1
fi

cp "$out" "$appimage"
chmod +x "$appimage"
echo "libraries: $libs_before -> $libs_after"
echo "size: $size_before -> $(stat -c %s "$appimage") bytes"

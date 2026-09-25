#!/bin/bash
# Assembles AIOStreams.app from a release build, on a Mac:
#   ./scripts/make-app-macos.sh <version> <output dir>
# The web app is expected in jellyfin-web/dist-standalone.
set -euo pipefail

version=$1
out=$2
desktop=$(cd "$(dirname "$0")/.." && pwd)
app="$out/AIOStreams.app"

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Frameworks" "$app/Contents/Resources"
cp "$desktop/target/release/aiostreams-desktop" "$app/Contents/MacOS/"
cp -R "$desktop/../jellyfin-web/dist-standalone" "$app/Contents/Resources/web"
cp "$desktop/THIRD-PARTY.md" "$app/Contents/Resources/"
# From `cargo about`, when the caller generated it.
if [ -f "$desktop/target/third-party-licenses.html" ]; then
  cp "$desktop/target/third-party-licenses.html" "$app/Contents/Resources/"
fi

# libmpv and the libraries it loads, which find each other through the app's run path.
arch=$(uname -m)
if [ ! -f "$desktop/vendor/macos-$arch/libmpv.2.dylib" ]; then
  "$desktop/scripts/fetch-libmpv-macos.sh" "$arch"
fi
cp "$desktop/vendor/macos-$arch/"*.dylib "$app/Contents/Frameworks/"
rpaths() { otool -l "$1" | awk '$2 == "LC_RPATH" { getline; getline; print $2 }'; }
if ! rpaths "$app/Contents/MacOS/aiostreams-desktop" | grep -qxF '@executable_path/../Frameworks'; then
  echo "the app has no run path to its Frameworks" >&2
  exit 1
fi
# Every library loaded is part of macOS or in the bundle. The first two lines
# `otool -L` prints are the file and its own name.
for lib in "$app/Contents/Frameworks/"*.dylib; do
  otool -L "$lib" | tail -n +3 | awk '{print $1}' | while read -r dep; do
    case "$dep" in
      /usr/lib/* | /System/*) ;;
      @rpath/* | @loader_path/*)
        [ -f "$app/Contents/Frameworks/${dep#*/}" ] ||
          { echo "$lib loads $dep, which is not in the bundle" >&2 && false; }
        ;;
      *) echo "$lib loads $dep from outside the bundle" >&2 && false ;;
    esac
  done
  # dyld refuses a library that lists a run path twice.
  if rpaths "$lib" | sort | uniq -d | grep .; then
    echo "$lib lists a run path twice" >&2
    exit 1
  fi
done
# The oldest macOS the bundle runs on is the newest minimum among its binaries.
min_macos=$(
  for bin in "$app/Contents/MacOS/"* "$app/Contents/Frameworks/"*.dylib; do
    otool -l "$bin" | awk '/minos/ { print $2 }'
  done | sort -V | tail -1
)
echo "minimum macOS: $min_macos"

iconset=$(mktemp -d)/AppIcon.iconset
mkdir -p "$iconset"
logo="$desktop/../frontend/public/logo.png"
for size in 16 32 128 256 512; do
  sips -z $size $size "$logo" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) "$logo" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$app/Contents/Resources/AppIcon.icns"

sed -e "s/@VERSION@/$version/" -e "s/@SHORT_VERSION@/${version%%-*}/" -e "s/@MIN_MACOS@/$min_macos/" \
  "$desktop/macos/Info.plist" >"$app/Contents/Info.plist"
plutil -lint "$app/Contents/Info.plist"

# Ad hoc: Apple silicon runs no unsigned code.
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"
echo "$app"

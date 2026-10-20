#!/bin/bash
# Links the static libraries mpvkit-macos.pin names into one libmpv, in
# vendor/macos-<arch>/libmpv-mpvkit.dylib, for the Metal and AVFoundation outputs.
# fetch-libs-macos.sh runs it; it needs Xcode 26:
#   ./scripts/link-mpvkit-macos.sh [arm64|x86_64]
set -euo pipefail

arch=${1:-$(uname -m)}
desktop=$(cd "$(dirname "$0")/.." && pwd)
out="$desktop/vendor/macos-$arch/libmpv-mpvkit.dylib"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/zip" "$work/xc" "$work/lib" "$(dirname "$out")"

while read -r name sum url; do
  curl -fsSL --retry 3 -o "$work/zip/$name.zip" "$url"
  echo "$sum  $work/zip/$name.zip" | shasum -a 256 -c --quiet -
  ditto -x -k "$work/zip/$name.zip" "$work/xc/$name"
  slice=$(find "$work/xc/$name" -maxdepth 2 -type d -name 'macos-*' | head -1)
  [ -n "$slice" ] || { echo "$name has no macOS library" >&2 && exit 1; }
  # A static library on its own, or the binary of a static framework.
  framework=$(find "$slice" -maxdepth 1 -name '*.framework' | head -1)
  if [ -n "$framework" ]; then
    base=$(basename "$framework" .framework)
    lib="$framework/Versions/A/$base"
    [ -f "$lib" ] || lib="$framework/$base"
  else
    lib=$(find "$slice" -maxdepth 1 -name '*.a' | head -1)
  fi
  [ -f "$lib" ] || { echo "$name: no library in $slice" >&2 && exit 1; }
  if [ "$(lipo -archs "$lib")" = "$arch" ]; then
    cp "$lib" "$work/lib/$name.a"
  else
    lipo "$lib" -thin "$arch" -output "$work/lib/$name.a"
  fi
done < <(grep -v '^#' "$desktop/mpvkit-macos.pin")

libs=()
for lib in "$work"/lib/*.a; do
  [ "$(basename "$lib")" = Libmpv.a ] || libs+=("$lib")
done
printf '_mpv_*\n' >"$work/exports"
frameworks=(AppKit AudioToolbox AVFoundation Cocoa CoreAudio CoreFoundation CoreGraphics
  CoreImage CoreMedia CoreServices CoreText CoreVideo Foundation IOKit IOSurface MediaPlayer
  Metal OpenGL QuartzCore Security VideoToolbox)
# Swift's runtime libraries, which mpv's Cocoa code needs, come from the system.
sdk=$(xcrun --sdk macosx --show-sdk-path)
toolchain_swift="$(dirname "$(xcrun -f swiftc)")/../lib/swift/macosx"
xcrun clang -dynamiclib -arch "$arch" -mmacosx-version-min=11.0 \
  -install_name @rpath/libmpv-mpvkit.dylib \
  -Wl,-force_load,"$work/lib/Libmpv.a" "${libs[@]}" \
  -Wl,-exported_symbols_list,"$work/exports" -Wl,-dead_strip_dylibs \
  -L"$sdk/usr/lib/swift" -L"$toolchain_swift" -Wl,-rpath,/usr/lib/swift \
  "${frameworks[@]/#/-Wl,-framework,}" \
  -lbz2 -liconv -lexpat -lresolv -lxml2 -lz -lc++ \
  -o "$out"

otool -L "$out"
echo "$(nm -gU "$out" | grep -c ' _mpv_') mpv functions in $out"

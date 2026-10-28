#!/bin/bash
# Downloads the libraries libs-macos.pin names into vendor/macos-<arch>/, where
# debug builds and packaging look for them:
#   ./scripts/fetch-libs-macos.sh [arm64|x86_64]
set -euo pipefail

arch=${1:-$(uname -m)}
desktop=$(cd "$(dirname "$0")/.." && pwd)
pin() { sed -n "s/^$1=//p" "$desktop/libs-macos.pin"; }
libs=$(pin libs)
expected=$(pin "libs_$arch")
[ -n "$expected" ] || { echo "libs-macos.pin has no $arch" >&2 && exit 1; }

zip=$(mktemp)
trap 'rm -f "$zip"' EXIT
curl -fsSL --retry 3 -o "$zip" \
  "https://github.com/AIOStreams/libs/releases/download/$libs/libs-macos-$arch.zip"
echo "$expected  $zip" | shasum -a 256 -c --quiet - ||
  { echo "libs-macos-$arch.zip from $libs isn't the pinned file" >&2 && exit 1; }
vendor="$desktop/vendor/macos-$arch"
rm -rf "$vendor"
mkdir -p "$vendor"
ditto -x -k "$zip" "$vendor"
echo "libmpv ($libs) for $arch is in $vendor"

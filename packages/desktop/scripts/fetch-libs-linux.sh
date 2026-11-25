#!/bin/bash
# Downloads the libraries libs-linux.pin names into vendor/linux-<arch>/, where
# debug builds and packaging look for them:
#   ./scripts/fetch-libs-linux.sh [x86_64|aarch64]
set -euo pipefail

arch=${1:-$(uname -m)}
desktop=$(cd "$(dirname "$0")/.." && pwd)
pin() { sed -n "s/^$1=//p" "$desktop/libs-linux.pin"; }
libs=$(pin libs)
expected=$(pin "libs_$arch")
[ -n "$expected" ] || { echo "libs-linux.pin has no $arch" >&2 && exit 1; }

zip=$(mktemp)
trap 'rm -f "$zip"' EXIT
curl -fsSL --retry 3 -o "$zip" \
  "https://github.com/AIOStreams/libs/releases/download/$libs/libs-linux-$arch.zip"
echo "$expected  $zip" | sha256sum -c --quiet - ||
  { echo "libs-linux-$arch.zip from $libs isn't the pinned file" >&2 && exit 1; }
vendor="$desktop/vendor/linux-$arch"
rm -rf "$vendor"
mkdir -p "$vendor"
unzip -q "$zip" -d "$vendor"
echo "libmpv ($libs) for $arch is in $vendor"

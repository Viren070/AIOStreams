#!/bin/bash
# Downloads the libraries libmpv-macos.pin names into vendor/macos-<arch>/, where
# debug builds and packaging look for them:
#   ./scripts/fetch-libmpv-macos.sh [arm64|x86_64]
set -euo pipefail

arch=${1:-$(uname -m)}
desktop=$(cd "$(dirname "$0")/.." && pwd)
pin() { sed -n "s/^$1=//p" "$desktop/libmpv-macos.pin"; }
version=$(pin version)
expected=$(pin "$arch")
[ -n "$expected" ] || { echo "libmpv-macos.pin has no $arch" >&2 && exit 1; }

base="https://iina.io/dylibs/$version/$arch"
vendor="$desktop/vendor/macos-$arch"
rm -rf "$vendor"
mkdir -p "$vendor"
files=$(curl -fsS --retry 3 "$base/filelist.txt" | tr -d '\r' | grep . | LC_ALL=C sort)
for file in $files; do
  curl -fsS --retry 3 -o "$vendor/$file" "$base/$file"
done

actual=$(
  cd "$vendor"
  for file in $files; do
    printf '%s  %s\n' "$(shasum -a 256 "$file" | cut -d' ' -f1)" "$file"
  done | shasum -a 256 | cut -d' ' -f1
)
if [ "$actual" != "$expected" ]; then
  echo "IINA's $version libraries for $arch hash to $actual, not the pinned $expected" >&2
  exit 1
fi
echo "$(echo "$files" | wc -l | tr -d ' ') libraries in $vendor"

#!/bin/sh
# Builds the Linux app as a Flatpak bundle, from the standalone web app built beforehand:
#   pnpm -F jellyfin-web build:standalone && packages/desktop/scripts/make-flatpak.sh
set -e
desktop=$(cd "$(dirname "$0")/.." && pwd)
linux="$desktop/linux"
# Builder state wants a native Linux filesystem.
work=${FLATPAK_WORK:-$linux}
id=io.github.viren070.aiostreams

if [ ! -f "$desktop/../jellyfin-web/dist-standalone/index.html" ]; then
  echo "Build the web app first: pnpm -F jellyfin-web build:standalone" >&2
  exit 1
fi

# Flatpak builds offline, so every crate is listed as a source.
generator="$linux/flatpak-cargo-generator.py"
[ -f "$generator" ] || curl -fsSL -o "$generator" \
  https://raw.githubusercontent.com/flatpak/flatpak-builder-tools/master/cargo/flatpak-cargo-generator.py
python3 "$generator" "$desktop/Cargo.lock" -o "$linux/cargo-sources.json"

flatpak-builder --user --install-deps-from=flathub --force-clean \
  --state-dir="$work/.flatpak-builder" --repo="$work/repo" "$work/build" "$linux/$id.yml"
# Lets the bundle install where Flathub, which has its runtime, is not set up.
flatpak build-bundle --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo \
  "$work/repo" "$work/$id.flatpak" "$id"
echo "$work/$id.flatpak"

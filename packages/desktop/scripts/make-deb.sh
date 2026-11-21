#!/bin/bash
# Packs the release build as a .deb with the libs and the standalone web app; GTK and
# WebKitGTK come from the system. Run on Ubuntu 24.04 after `cargo build --release`, with
# libmpv's runtime libraries installed so dpkg-shlibdeps can name their packages:
#   ./scripts/make-deb.sh <out.deb>
set -euo pipefail

desktop=$(cd "$(dirname "$0")/.." && pwd)
out=$(realpath -m "$1")
arch=$(uname -m)
id=io.github.viren070.aiostreams
version=$(sed -n 's/^version = "\(.*\)"/\1/p' "$desktop/Cargo.toml" | head -1)
libs=$desktop/vendor/linux-$arch
web=$desktop/../web/dist-standalone
[ -f "$libs/libmpv.so.2" ] || { echo "Fetch the libs first: scripts/fetch-libs-linux.sh" >&2 && exit 1; }
[ -f "$web/index.html" ] || { echo "Build the web app first: pnpm -F web build:standalone" >&2 && exit 1; }

root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
lib=$root/usr/lib/aiostreams-desktop
install -Dm755 "$desktop/target/release/aiostreams-desktop" "$lib/aiostreams-desktop"
strip "$lib/aiostreams-desktop"
cp -r "$libs"/. "$lib/"
cp -r "$web" "$lib/web"
mkdir -p "$root/usr/bin"
ln -s ../lib/aiostreams-desktop/aiostreams-desktop "$root/usr/bin/aiostreams-desktop"
install -Dm644 "$desktop/linux/$id.desktop" -t "$root/usr/share/applications"
install -Dm644 "$desktop/linux/$id.metainfo.xml" -t "$root/usr/share/metainfo"
install -Dm644 "$desktop/app/icons/aiostreams.png" "$root/usr/share/icons/hicolor/512x512/apps/$id.png"
doc=$root/usr/share/doc/aiostreams-desktop
install -Dm644 "$desktop/THIRD-PARTY.md" -t "$doc"
cat >"$doc/copyright" <<EOF
AIOStreams desktop app, licensed under the AGPL-3.0-only: https://github.com/Viren070/AIOStreams
The libraries in /usr/lib/aiostreams-desktop keep their own licences, in licenses/ there.
EOF
crates=$desktop/licences/$arch-unknown-linux-gnu
if [ -f "$crates.json" ]; then
  install -Dm644 "$crates.json" "$lib/third-party-licenses.json"
  install -Dm644 "$crates.html" "$doc/third-party-licenses.html"
fi

# Ubuntu 24.04 and later let a program create user namespaces only with an AppArmor
# profile allowing it, and WebKit's sandbox needs them.
mkdir -p "$root/DEBIAN" "$root/etc/apparmor.d"
cat >"$root/etc/apparmor.d/aiostreams-desktop" <<'EOF'
abi <abi/4.0>,
include <tunables/global>

profile aiostreams-desktop /usr/lib/aiostreams-desktop/aiostreams-desktop flags=(unconfined) {
  userns,

  include if exists <local/aiostreams-desktop>
}
EOF
echo /etc/apparmor.d/aiostreams-desktop >"$root/DEBIAN/conffiles"
cat >"$root/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
if [ "$1" = configure ] && command -v apparmor_parser >/dev/null && [ -d /sys/kernel/security/apparmor ]; then
	apparmor_parser -r -T -W /etc/apparmor.d/aiostreams-desktop || true
fi
EOF
cat >"$root/DEBIAN/prerm" <<'EOF'
#!/bin/sh
set -e
if [ "$1" = remove ] && command -v apparmor_parser >/dev/null && [ -d /sys/kernel/security/apparmor ]; then
	apparmor_parser -R /etc/apparmor.d/aiostreams-desktop 2>/dev/null || true
fi
EOF
chmod 755 "$root/DEBIAN/postinst" "$root/DEBIAN/prerm"

shlib=$(mktemp -d)
mkdir "$shlib/debian"
printf 'Source: aiostreams-desktop\n\nPackage: aiostreams-desktop\nArchitecture: any\n' >"$shlib/debian/control"
depends=$(cd "$shlib" && dpkg-shlibdeps -O --ignore-missing-info "-l$lib" "$lib/aiostreams-desktop" "$lib"/*.so.* |
  sed -n 's/^shlibs:Depends=//p')
rm -rf "$shlib"
[ -n "$depends" ] || { echo "dpkg-shlibdeps found no dependencies" >&2 && exit 1; }
# mpv's TLS needs the system's certificates, which nothing else here depends on.
cat >"$root/DEBIAN/control" <<EOF
Package: aiostreams-desktop
Version: $version
Architecture: $(dpkg --print-architecture)
Maintainer: Viren070 <viren070@protonmail.com>
Installed-Size: $(du -sk --exclude=DEBIAN "$root" | cut -f1)
Depends: $depends, ca-certificates
Section: video
Priority: optional
Homepage: https://github.com/Viren070/AIOStreams
Description: AIOStreams in a native window, playing through mpv
 The AIOStreams app as a desktop app: browse your servers and libraries and
 play them with libmpv, with hardware decoding through VA-API or NVDEC.
EOF
mkdir -p "$(dirname "$out")"
dpkg-deb --root-owner-group -Zxz --build "$root" "$out"

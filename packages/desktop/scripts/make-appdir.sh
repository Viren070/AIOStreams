#!/bin/bash
# Builds the app in an Arch container and bundles it, with GTK, WebKitGTK and every
# library they load, into an AppImage folder for vpk to pack. Needs the libs and the
# standalone web app beforehand:
#   docker run --rm -v "$PWD:/src" ghcr.io/pkgforge-dev/archlinux:latest \
#     /src/packages/desktop/scripts/make-appdir.sh /src/stage/AIOStreams.AppDir
set -euo pipefail

# quick-sharun, and the slimmed Arch packages of Mesa and GTK it bundles.
anylinux=https://raw.githubusercontent.com/pkgforge-dev/Anylinux-AppImages/cd66fadf079bb9084538f8fd82b5b544c25bc897/useful-tools
desktop=$(cd "$(dirname "$0")/.." && pwd)
out=$(realpath -m "$1")
id=io.github.viren070.aiostreams
libs=$desktop/vendor/linux-$(uname -m)
web=$(realpath "$desktop/../web/dist-standalone")
[ -f "$libs/libmpv.so.2" ] || { echo "Fetch the libs first: scripts/fetch-libs-linux.sh" >&2 && exit 1; }
[ -f "$web/index.html" ] || { echo "Build the web app first: pnpm -F web build:standalone" >&2 && exit 1; }

pacman -Syu --noconfirm --needed base-devel rust gtk4 webkitgtk-6.0 bubblewrap xdg-dbus-proxy \
  libva libpulse alsa-lib fontconfig libdrm libglvnd patchelf strace wget xorg-server-xvfb
curl -fsSL -o /tmp/get-debloated-pkgs "$anylinux/get-debloated-pkgs.sh"
sh /tmp/get-debloated-pkgs --add-common --prefer-nano
curl -fsSL -o /tmp/quick-sharun "$anylinux/quick-sharun.sh"
chmod +x /tmp/quick-sharun

cargo build --release --manifest-path "$desktop/Cargo.toml" -p aiostreams-desktop
install -Dm755 "$desktop/target/release/aiostreams-desktop" /usr/bin/aiostreams-desktop
rm -rf /usr/lib/aiostreams-desktop
install -Dm755 "$libs"/*.so.* -t /usr/lib/aiostreams-desktop
install -Dm644 "$desktop/linux/$id.desktop" -t /usr/share/applications
install -Dm644 "$desktop/app/icons/aiostreams.png" "/usr/share/icons/hicolor/512x512/apps/$id.png"

rm -rf "$out"
# Under usr, so the app runs from usr/bin, where Velopack finds itself.
export APPDIR=$out/usr DEPLOY_GTK=1
# The system's GPU drivers, which match its kernel and GPU, instead of bundled Mesa.
export USE_HOST_DRIVERS=1
export DESKTOP=/usr/share/applications/$id.desktop ICON=/usr/share/icons/hicolor/512x512/apps/$id.png
# quick-sharun runs the app to see what it loads.
export AIOSTREAMS_WEB_DIR=$web AIOSTREAMS_LIBMPV=/usr/lib/aiostreams-desktop/libmpv.so.2
/tmp/quick-sharun /usr/bin/aiostreams-desktop /usr/lib/aiostreams-desktop/*.so.*

mkdir -p "$APPDIR/share/aiostreams-desktop"
cp -r "$web" "$APPDIR/share/aiostreams-desktop/web"
cp -r "$libs/licenses" "$APPDIR/lib/aiostreams-desktop/licenses"
crates=$desktop/licences/$(uname -m)-unknown-linux-gnu.json
[ -f "$crates" ] && install -Dm644 "$crates" "$APPDIR/lib/aiostreams-desktop/third-party-licenses.json"
# The bundled libva looks only in Arch's driver folder, and sandboxed processes see the
# system's libraries only under /lib and /lib64.
cat >>"$APPDIR/.env" <<'EOF'
AIOSTREAMS_WEB_DIR=${SHARUN_DIR}/share/aiostreams-desktop/web
AIOSTREAMS_LIBMPV=${SHARUN_DIR}/lib/aiostreams-desktop/libmpv.so.2
LIBVA_DRIVERS_PATH=${LIBVA_DRIVERS_PATH}:/usr/lib/x86_64-linux-gnu/dri:/usr/lib/aarch64-linux-gnu/dri:/usr/lib64/dri:/usr/lib/dri:/run/opengl-driver/lib/dri
GBM_BACKENDS_PATH=/lib/x86_64-linux-gnu/gbm:/lib/aarch64-linux-gnu/gbm:/lib64/gbm:/lib/gbm
LIBGL_DRIVERS_PATH=/usr/lib/x86_64-linux-gnu/dri:/usr/lib/aarch64-linux-gnu/dri:/usr/lib64/dri:/usr/lib/dri:/lib/x86_64-linux-gnu/dri:/lib/aarch64-linux-gnu/dri:/lib64/dri:/lib/dri
EOF
ln -s usr/AppRun "$out/AppRun"
cp "$APPDIR/$id.desktop" "$APPDIR/$id.png" "$APPDIR/.DirIcon" "$out/"
chown -R "$(stat -c %u:%g "$desktop")" "$out" "$desktop/target"

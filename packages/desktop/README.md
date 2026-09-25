# AIOStreams Desktop

AIOStreams' Jellyfin web app (`packages/jellyfin-web`) in a native window, playing through mpv. It
runs on Windows and Linux; macOS is not started.

The window shows the web app's standalone build, which picks its own server: any Jellyfin server
works, and AIOStreams servers get the extras. Switching servers happens in the page.

## How it fits together

```
┌──────────────────────────── window ────────────────────────────┐
│  web view, transparent: the web app, its title bar and the     │
│  player controls                                               │
│             ▲  page ⇄ app: JSON messages over the bridge       │
│  video surface: mpv's frames                                   │
└────────────────────────────────────────────────────────────────┘
```

- **The page** is the web app's standalone build: React, the same code a server hosts at `/web`. The
  app serves its files itself through a custom scheme (`http://aiostreams.localhost/` on Windows,
  `aiostreams://localhost/` on Linux), so the page has an origin of its own and keeps sign-ins and
  settings like any site. It draws everything except the video, including the window's title bar and
  buttons, and the player UI is the same one a browser tab gets.
- **Rust** runs the rest: one process that opens the window, starts mpv, serves the page and carries
  messages between them.
- **The window and web view** come from each platform's own toolkit, so no browser engine ships with
  the app.
  - Windows: [tao](https://github.com/tauri-apps/tao) opens the window and runs the event loop, and
    [wry](https://github.com/tauri-apps/wry) puts WebView2, the Edge engine built into Windows, in it.
  - Linux: GTK 4 and WebKitGTK 6, the toolkit and web engine GNOME apps use. tao and wry are built on
    GTK 3 there, so the app uses GTK directly.
- **mpv** plays the video. The app loads libmpv at runtime instead of linking it, so it can say when
  it is missing and a user can swap in another build. mpv keeps its own config, scripts and shaders.
  - Windows: mpv draws with Direct3D 11 straight into a child window under the web view.
  - Linux: Wayland does not let one app's window sit inside another's, so mpv draws each frame with
    OpenGL through libmpv's render API into a `GtkGLArea`, and GTK composites the web view over it.
    mpv is given the Wayland or X11 display, which lets VA-API hand decoded frames to OpenGL without
    copying them through the CPU.
- **The bridge** carries the page's mpv commands and property changes to the app, and sends back the
  properties the page watches: position, tracks, pause and the rest. See [Bridge](#bridge).
- **[Velopack](https://velopack.io)** installs and updates the Windows app, and
  **[cargo-about](https://github.com/EmbarkStudios/cargo-about)** lists the licences it ships under.

The code is a Cargo workspace, outside the pnpm build:

- `core/`: libmpv, the bridge protocol and its checks, and the render API. No OS code.
- `app/`: the window, the web view and the video surface. `src/shell/` holds the window and web view
  for each toolkit, and `src/platform/` the rest of the per-OS code.

## Build and run

The page comes first on every platform:

```sh
pnpm -F @aiostreams/jellyfin-web build:standalone   # into jellyfin-web/dist-standalone
```

A debug build finds the page in the repo, and on Windows libmpv too. A release build looks next to
the executable: the page in a `web` folder, and libmpv beside it.

### Windows

Needs Rust (MSVC toolchain), the WebView2 runtime (part of Windows 10 and 11) and 7-Zip on `PATH`.

```powershell
./scripts/fetch-libmpv.ps1   # libmpv-2.dll into vendor/x86_64 (-Arch aarch64 for ARM)
cargo run
```

`libmpv.pin` names the libmpv build the app ships and each archive's checksum, and the script checks
them. shinchiro keeps about four months of builds, so bump the pin when its tag disappears.

### Linux

Needs Rust, GTK 4.14 or later, WebKitGTK 6 and libmpv 0.38 or later: Ubuntu 25.04, Fedora 41 or
newer.

```sh
sudo apt install libgtk-4-dev libwebkitgtk-6.0-dev libmpv-dev   # Fedora: gtk4-devel webkitgtk6.0-devel mpv-libs-devel
cargo run
```

The app looks for `libmpv.so.2` next to the binary, then in the system library folders. Ubuntu
24.04's libmpv is 0.37, which is too old; build a newer one and point `AIOSTREAMS_LIBMPV` at it.
There are no Linux packages yet.

### Flags

| Flag                          | Does                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `--web <url>`                 | Loads this page instead, e.g. `pnpm -F @aiostreams/jellyfin-web dev:standalone` |
| `--web-dir <dir>`             | Serves the standalone build from this folder                                    |
| `--devtools`                  | Allows DevTools in a release build                                              |
| `--remote-debugging-port <n>` | Opens the web view's debugging port, for driving tests                          |

`AIOSTREAMS_LIBMPV` and `AIOSTREAMS_WEB_DIR` point at libmpv and the standalone build too.

## mpv config

mpv reads `mpv.conf`, `input.conf`, scripts and shaders from:

- Windows: `%APPDATA%\AIOStreams Desktop\mpv`, or `data\mpv` in a portable copy.
- Linux: `~/.config/AIOStreams Desktop/mpv`.

A commented `mpv.conf` is written on first run. Keys the page does not use are passed to mpv, so
`input.conf` bindings such as shader toggles work. The app keeps `idle`, `keep-open`, `force-window`,
`osc`, `osd-bar`, `ytdl`, the idle background and the default key bindings fixed, since it drives
playback itself.

## Logs

Each day the app runs gets a log file, and the last seven are kept:

- Windows: `%LOCALAPPDATA%\AIOStreams Desktop\logs`, or `data\logs` in a portable copy.
- Linux: `~/.local/share/AIOStreams Desktop/logs`.

There is a line per event: startup versions and paths, each file loaded and how it played and ended,
changes to tracks and decoding settings, mpv's warnings and errors (repeats collapsed), and errors
from the page. `AIOSTREAMS_LOG=debug` adds every command and property the page sends. Settings →
Desktop app opens the folder, or copies the versions and recent log for a bug report.

## Portable copy

The Windows portable zip keeps everything beside itself, in a `data` folder: sign-ins and settings
(the WebView2 profile), the mpv config and the logs. It updates itself like an installed copy.

## Releases and updates

Velopack packs the Windows app and updates it. Each architecture has two channels, `win-x64` and
`win-x64-nightly` (`win-arm64` likewise), and each channel's feed lives on one release that every
build replaces, so the app always finds it at the same address:

| Channel | Built by                                              | Feed and latest installers    |
| ------- | ----------------------------------------------------- | ----------------------------- |
| Stable  | a `desktop-v*` release, cut by release-please         | the `desktop` release         |
| Nightly | every push to `main` that changes the app or its page | the `desktop-nightly` release |

The installer is `aiostreams-desktop-win-<arch>.exe` and the portable copy
`aiostreams-desktop-win-<arch>.zip`, with `-nightly` added for nightlies; a stable release also gets
them attached. release-please treats `packages/desktop` as its own component, so commits here bump
the desktop version, not AIOStreams'. A nightly's version is the next patch with
`-nightly.<UTC timestamp>`, so it updates past the last release, and moving back to stable is allowed
to go down a version.

A copy follows the channel it was installed from; Settings → Desktop app switches it. It checks at
start and every six hours, downloads in the background, and applies on the next start or when asked.
A failed check only shows in Settings and never holds up the app. `AIOSTREAMS_UPDATE_FEED` points it
at another feed, such as a local folder served over HTTP, for testing.

## Licences

Each package carries `THIRD-PARTY.md` and `third-party-licenses.html`, which cargo-about generates
from `about.toml` and `about.hbs`. A crate under a licence `about.toml` does not accept fails the
check and the build; accept it there once it is known to be fine to ship. To look at the page
locally: `cargo about generate about.hbs -o third-party-licenses.html`.

## Bridge

The page sees `window.aiostreamsDesktop` (`protocol`, `version`, `platform`, `send`, `subscribe`) on
the app's own origin only. Messages from any other origin are dropped, navigation away from it opens
the default browser, and every mpv command, property and `loadfile` option is checked against an
allowlist in `core/src/bridge.rs`: pages can play http(s) URLs, not local files or scripts.

## Acknowledgements

The design follows Stremio's shells. On Windows,
[stremio-shell-ng](https://github.com/Stremio/stremio-shell-ng): mpv drawing into the window beneath
a transparent WebView2, and the `mpv-command` / `mpv-set-prop` message names. On Linux,
[stremio-linux-shell](https://github.com/Stremio/stremio-linux-shell): a `GtkGLArea` under a
transparent WebKitGTK view, given the Wayland display. Passing unused keys to mpv comes from
[stremio-community-v5](https://github.com/Zaarrg/stremio-community-v5). No code is taken from any of
them.

# AIOStreams Desktop

The Jellyfin web app (`packages/jellyfin-web`) in a native window, playing through mpv. mpv draws into
the window and a transparent WebView2 sits on top; the page drives mpv over a small JSON bridge.
Windows only for now.

The window shows the web app's standalone build, served by the app itself at
`http://aiostreams.localhost/`. That build picks its server (any Jellyfin server; AIOStreams ones get
the extras), so switching servers happens in the page.

It is a Cargo workspace, outside the pnpm build:

- `core/`: libmpv (loaded at runtime), the bridge protocol and its checks. No OS code.
- `app/`: the window, the web view and the video surface, with per-OS code in `src/platform/`.

## Build and run

Needs Rust (MSVC toolchain), the WebView2 runtime (part of Windows 10 and 11) and 7-Zip on `PATH`.

```powershell
./scripts/fetch-libmpv.ps1                          # libmpv-2.dll into vendor/
pnpm -F @aiostreams/jellyfin-web build:standalone   # the page, into jellyfin-web/dist-standalone
cargo run
```

A debug build finds both in the repo. A release build looks next to the exe: `libmpv-2.dll`, and the
standalone build in a `web` folder.

| Flag                          | Does                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `--web <url>`                 | Loads this page instead, e.g. `pnpm -F @aiostreams/jellyfin-web dev:standalone` |
| `--web-dir <dir>`             | Serves the standalone build from this folder                                    |
| `--devtools`                  | Allows DevTools in a release build                                              |
| `--remote-debugging-port <n>` | Opens WebView2's DevTools protocol port, for driving tests                      |

`AIOSTREAMS_LIBMPV` and `AIOSTREAMS_WEB_DIR` point at libmpv and the standalone build too.

## mpv config

mpv reads `mpv.conf`, `input.conf`, scripts and shaders from `%APPDATA%\AIOStreams Desktop\mpv`, or from
a `portable_config` folder next to the exe if there is one. A commented `mpv.conf` is written on first
run. Keys the page does not use are passed to mpv, so `input.conf` bindings (shader toggles and the
like) work. The app keeps `idle`, `keep-open`, `force-window`, `osc`, `osd-bar`, `ytdl`, the idle
background and the default key bindings fixed, since it drives playback itself.

## Logs

Each day the app runs gets a file in `%LOCALAPPDATA%\AIOStreams Desktop\logs`, and the last seven are
kept. A line per event: startup versions and paths, each file loaded and how it played and ended,
changes to tracks and decoding settings, mpv's warnings and errors (repeats collapsed), and errors
from the page. `AIOSTREAMS_LOG=debug` adds every command and property the page sends. Settings →
Desktop app opens the folder, or copies the versions and recent log for a bug report.

## Acknowledgements

The design follows Stremio's Windows shell, [stremio-shell-ng](https://github.com/Stremio/stremio-shell-ng):
mpv drawing into the window beneath a transparent WebView2, and the `mpv-command` / `mpv-set-prop`
message names. The `portable_config` folder and passing unused keys to mpv come from
[stremio-community-v5](https://github.com/Zaarrg/stremio-community-v5). No code is taken from either.

## Bridge

The page sees `window.aiostreamsDesktop` (`protocol`, `version`, `platform`, `send`, `subscribe`) on the
app's own origin only. Messages from any other origin are dropped, navigation away from it opens the
default browser, and every mpv command, property and `loadfile` option is checked against an
allowlist in `core/src/bridge.rs`: pages can play http(s) URLs, not local files or scripts.

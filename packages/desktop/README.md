# AIOStreams Desktop

The Jellyfin web app (`packages/jellyfin-web`) in a native window, playing through mpv. mpv draws into
the window and a transparent WebView2 sits on top; the page drives mpv over a small JSON bridge.
Windows only for now.

It is a Cargo workspace, outside the pnpm build:

- `core/`: libmpv (loaded at runtime), the bridge protocol and its checks, settings. No OS code.
- `app/`: the window, the web view and the video surface, with per-OS code in `src/platform/`.

## Build and run

Needs Rust (MSVC toolchain), the WebView2 runtime (part of Windows 10 and 11) and 7-Zip on `PATH`.

```powershell
./scripts/fetch-libmpv.ps1        # libmpv-2.dll into vendor/, where debug builds look
cargo run -- --server http://localhost:21455
```

A release build looks for `libmpv-2.dll` next to the exe, or at `AIOSTREAMS_LIBMPV`.

| Flag                          | Does                                                       |
| ----------------------------- | ---------------------------------------------------------- |
| `--server <url>`              | Connects to this server and remembers it                   |
| `--reset`                     | Forgets the server and shows the address screen            |
| `--devtools`                  | Allows DevTools in a release build                         |
| `--remote-debugging-port <n>` | Opens WebView2's DevTools protocol port, for driving tests |

The server address can be a bare host (meaning AIOStreams' `/jellyfin` mount), a Jellyfin base or the
web app's own address. Ctrl+Shift+Home returns to the address screen.

## mpv config

mpv reads `mpv.conf`, `input.conf`, scripts and shaders from `%APPDATA%\AIOStreams Desktop\mpv`, or from
a `portable_config` folder next to the exe if there is one. A commented `mpv.conf` is written on first
run. Keys the page does not use are passed to mpv, so `input.conf` bindings (shader toggles and the
like) work. The app keeps `idle`, `keep-open`, `force-window`, `osc`, `osd-bar`, `ytdl` and the default
key bindings fixed, since it drives playback itself.

## Bridge

The page sees `window.aiostreamsDesktop` (`protocol`, `version`, `platform`, `send`, `subscribe`) on
the chosen server's origin only. Messages from any other origin are dropped, and every mpv command,
property and `loadfile` option is checked against an allowlist in `core/src/bridge.rs`: pages can play
http(s) URLs, not local files or scripts.

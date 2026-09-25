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
./scripts/fetch-libmpv.ps1                          # libmpv-2.dll into vendor/x86_64 (-Arch aarch64 for ARM)
pnpm -F @aiostreams/jellyfin-web build:standalone   # the page, into jellyfin-web/dist-standalone
cargo run
```

`libmpv.pin` names the libmpv build the app ships and each archive's checksum; the script checks
it. shinchiro keeps about four months of builds, so bump the pin when the tag disappears.

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

mpv reads `mpv.conf`, `input.conf`, scripts and shaders from `%APPDATA%\AIOStreams Desktop\mpv`
(`data\mpv` in a portable copy). A commented `mpv.conf` is written on first run. Keys the page does
not use are passed to mpv, so `input.conf` bindings (shader toggles and the like) work. The app keeps `idle`, `keep-open`, `force-window`, `osc`, `osd-bar`, `ytdl`, the idle
background and the default key bindings fixed, since it drives playback itself.

## Logs

Each day the app runs gets a file in `%LOCALAPPDATA%\AIOStreams Desktop\logs` (`data\logs` in a
portable copy), and the last seven are kept. A line per event: startup versions and paths, each file
loaded and how it played and ended, changes to tracks and decoding settings, mpv's warnings and
errors (repeats collapsed), and errors from the page. `AIOSTREAMS_LOG=debug` adds every command and property the page sends. Settings →
Desktop app opens the folder, or copies the versions and recent log for a bug report.

## Portable copy

The portable zip keeps everything beside itself, in a `data` folder: sign-ins and settings (the
WebView2 profile), the mpv config and the logs. It updates itself like an installed copy.

## Releases and updates

[Velopack](https://velopack.io) packs the app and updates it. Each architecture has two channels,
`win-x64` and `win-x64-nightly` (`win-arm64` likewise), and each channel's feed lives on one release
that every build replaces, so the app always finds it at the same address:

| Channel | Built by                                               | Feed and latest installers   |
| ------- | ------------------------------------------------------ | ---------------------------- |
| Stable  | a `desktop-v*` release, cut by release-please          | the `desktop` release        |
| Nightly | every push to `main` that changes the app or its page  | the `desktop-nightly` release |

The installer is `aiostreams-desktop-win-<arch>.exe` and the portable copy
`aiostreams-desktop-win-<arch>.zip` (`-nightly` added for nightlies); a stable release also gets them
attached. release-please treats
`packages/desktop` as its own component, so commits here bump the desktop version, not AIOStreams'.
A nightly's version is the next patch with `-nightly.<UTC timestamp>`, so it updates past the last
release, and moving back to stable is allowed to go down a version.

A copy follows the channel it was installed from; Settings → Desktop app switches it. It checks at
start and every six hours, downloads in the background, and applies on the next start or when asked.
A failed check only shows in Settings, and never holds up the app. `AIOSTREAMS_UPDATE_FEED` points it
at another feed, e.g. a local folder served over HTTP, for testing.

Each package carries `THIRD-PARTY.md` and `third-party-licenses.html`, which
[cargo-about](https://github.com/EmbarkStudios/cargo-about) generates from `about.toml` and `about.hbs`.
A crate under a licence `about.toml` does not accept fails the check and the build; accept it there
once it is known to be fine to ship. To look at the page locally:
`cargo about generate about.hbs -o third-party-licenses.html`.

## Acknowledgements

The design follows Stremio's Windows shell, [stremio-shell-ng](https://github.com/Stremio/stremio-shell-ng):
mpv drawing into the window beneath a transparent WebView2, and the `mpv-command` / `mpv-set-prop`
message names. Passing unused keys to mpv comes from
[stremio-community-v5](https://github.com/Zaarrg/stremio-community-v5). No code is taken from either.

## Bridge

The page sees `window.aiostreamsDesktop` (`protocol`, `version`, `platform`, `send`, `subscribe`) on the
app's own origin only. Messages from any other origin are dropped, navigation away from it opens the
default browser, and every mpv command, property and `loadfile` option is checked against an
allowlist in `core/src/bridge.rs`: pages can play http(s) URLs, not local files or scripts.

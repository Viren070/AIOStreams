# AIOStreams for Android

The AIOStreams app (`packages/web`) in a WebView over native video. The page draws every screen,
including the player's controls; the app plays through libmpv beneath it and speaks the desktop
app's bridge as `window.aiostreamsApp`, so `src/lib/hosts/shell` in the web app drives both.

## Building

Needs JDK 17 or later (Android Studio's own works) and the Android SDK with platform 37.2, found
through `ANDROID_HOME`.

```sh
pnpm -F @aiostreams/web build:standalone   # bundled into the APK from web/dist-standalone
cd packages/android
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-arm64-v8a-debug.apk
```

Each build is an APK per processor (`arm64-v8a`, `armeabi-v7a`, `x86_64`). Debug builds install as
`io.github.viren070.aiostreams.debug`, named "AIOStreams Debug", beside a released copy.

## Releases

release-please versions the app in `version.txt` and tags `android-v*`; Android Release builds that
tag, and Android Nightly builds every change to `main`. Both publish to a release that every build of
their channel replaces (`android`, `android-nightly`), with an `update.json` naming each APK and its
SHA-256, which installed copies check for updates. Version codes count minutes since 2024, so any
newer build installs over an older one.

The release builds are signed with a key the repository keeps as secrets:

| Secret                      | Value                        |
| --------------------------- | ---------------------------- |
| `ANDROID_KEYSTORE_BASE64`   | The keystore, base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | Its password                 |
| `ANDROID_KEY_ALIAS`         | The key's alias              |
| `ANDROID_KEY_PASSWORD`      | The key's password           |

```sh
keytool -genkeypair -keystore release.keystore -alias aiostreams -keyalg RSA -keysize 4096 -validity 36500
base64 -w0 release.keystore   # the value of ANDROID_KEYSTORE_BASE64
```

Keep a copy of the keystore: installed copies only update to builds signed with the same key.

## Layout

| Module        | What it holds                                                                |
| ------------- | ---------------------------------------------------------------------------- |
| `app`         | The activity: video surface, WebView, window state                           |
| `bridge`      | The WebView setup, the bundled page's origin, and `window.aiostreamsApp`     |
| `playback`    | The engine interface in mpv's terms, the page's allowlist, the `mpv-*` relay |
| `engine-mpv`  | libmpv                                                                       |
| `build-logic` | The SDK levels and Java version every module shares                          |

## Debugging

- The page: `edge://inspect` or `chrome://inspect` lists debug builds' WebViews.
- A dev server instead of the bundled page: set `aiostreams.webUrl` in `gradle.properties` (or pass
  `-Paiostreams.webUrl=...`) and run `adb reverse` for its port.
- mpv's log goes to Logcat under the `mpv` tag.
- A release build to inspect: `-Paiostreams.inspectable=true`; one that updates from a local feed:
  `-Paiostreams.updateFeed=http://localhost:<port>`, serving `android/update.json` and its APKs.

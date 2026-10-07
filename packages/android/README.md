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
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

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

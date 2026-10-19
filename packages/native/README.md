# packages/native

Rust shared by the desktop and Android apps. A Cargo workspace outside the pnpm build.

| Crate | Path | What it is |
| --- | --- | --- |
| `aiostreams-container` | `container/` | Container indexes read over bounded HTTP ranges: Matroska (SeekHead, Info, Tracks, Cues of every track) and MP4 sample tables, keyframe lookup. No FFmpeg. |
| `aiostreams-thumbs` | `thumbs/` | Seek-bar thumbnails: one keyframe decoded with libavcodec, multi-slice HEVC decoded as parallel strips, scaled and tone mapped to a JPEG. Bench binary `thumbs-bench` (feature `bench`). |
| `aiostreams-native-android` | `android/` | The Android app's one native library, `libaiostreams_native.so`: every feature's JNI exports. |

## Linking

- Desktop: path dependencies from `packages/desktop`, e.g. `aiostreams-container = { path = "../../native/container" }`.
- Android: `cargo ndk --platform 24 -t arm64-v8a -t armeabi-v7a -t x86_64 -o <jniLibs dir> build --release -p aiostreams-native-android`, with the Rust targets `aarch64-linux-android`, `armv7-linux-androideabi` and `x86_64-linux-android` installed.
- `thumbs` loads libavcodec and libavutil at runtime, from the folders given to `library_dirs` and then the system's search path, so building it needs no FFmpeg.

## JNI

Kotlin package `io.github.viren070.aiostreams.natives`, one `object` per feature with `@JvmStatic external fun`s, and one module per feature in `android/src`, exporting `Java_io_github_viren070_aiostreams_natives_<Object>_<method>`. Calls block, so call them off the main thread. Structured results go back as JSON strings, images as `ByteArray`.

`android::http::reader` builds a reader from a player's URL, its request headers (name, value, name, value, ...) and the device's trusted roots as PEM, so user-installed CAs work as they do for the players.

## Bench

    cargo run --release -p aiostreams-thumbs --features bench --bin thumbs-bench -- <command>

with FFmpeg's libraries on the library search path.

- `fetch <url|file> --out <dir> [--n 12]` saves evenly spread keyframes as decoder packets.
- `decode <dir> [--split N] [--threads N] [--idle] [--sheet out.jpg]` times decoding them.
- `verify <dir>` decodes each keyframe whole and as strips and compares every sample.
- `scrub <url> [--workers N]` simulates a held seek key.

# Third-party software

AIOStreams Desktop is licensed under the AGPL-3.0. It ships with:

- **libmpv**, from [mpv](https://mpv.io), licensed under the GPL-2.0-or-later.
  - Windows: `libmpv-2.dll`, built by
    [shinchiro/mpv-winbuild-cmake](https://github.com/shinchiro/mpv-winbuild-cmake), whose tag
    is in `libmpv.pin` in the AIOStreams repository. Source:
    [mpv-player/mpv](https://github.com/mpv-player/mpv) and the build scripts in that repository.
  - macOS: `libmpv.2.dylib` and the libraries it uses, such as FFmpeg, libass, libplacebo and
    Rubber Band, in `Contents/Frameworks`. They are the builds [IINA](https://iina.io) publishes
    for its releases, and the release is in `libmpv-macos.pin` in the AIOStreams repository. Each
    is under its own project's licence (GPL, LGPL or permissive). Source:
    [mpv-player/mpv](https://github.com/mpv-player/mpv), [FFmpeg](https://ffmpeg.org) and each
    library's own project.
- **Rust crates** built into the app, under MIT, Apache-2.0 and other permissive licences.
  `third-party-licenses.html` lists each crate with its licence text.
- **JavaScript libraries** built into the web app in `web` (`Contents/Resources/web` on macOS).
  Their licence notices are in the `.LICENSE.txt` files beside its scripts in `web/static/js`.

It uses the system's web view, which it does not ship: the Microsoft Edge WebView2 Runtime on
Windows and WebKit on macOS. On Linux it uses the system's libmpv, GTK 4 and WebKitGTK, and ships
none of them.

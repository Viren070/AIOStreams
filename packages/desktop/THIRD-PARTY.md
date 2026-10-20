# Third-party software

AIOStreams Desktop is licensed under the AGPL-3.0. It ships with:

- **libmpv**, from [mpv](https://mpv.io), licensed under the GPL-2.0-or-later.
  - Windows: `libmpv-2.dll`, built by
    [shinchiro/mpv-winbuild-cmake](https://github.com/shinchiro/mpv-winbuild-cmake), whose tag
    is in `libs.pin` in the AIOStreams repository. Source:
    [mpv-player/mpv](https://github.com/mpv-player/mpv) and the build scripts in that repository.
  - macOS: `libmpv.2.dylib` and the libraries it uses, such as FFmpeg, libass, libplacebo and
    Rubber Band, in `Contents/Frameworks`. They are the builds [IINA](https://iina.io) publishes
    for its releases, and the release is in `libs-macos.pin` in the AIOStreams repository. Each
    is under its own project's licence (GPL, LGPL or permissive). Source:
    [mpv-player/mpv](https://github.com/mpv-player/mpv), [FFmpeg](https://ffmpeg.org) and each
    library's own project.
  - macOS: `libmpv-mpvkit.dylib` in `Contents/Frameworks`, for the video outputs that draw with
    Metal or AVFoundation: mpv with its MoltenVK and AVFoundation patches, linked with FFmpeg,
    libass, libplacebo, MoltenVK, dav1d and the other libraries it uses into one library. They are
    the builds [edde746/MPVKit](https://github.com/edde746/MPVKit) publishes, licensed under the
    GPL-3.0-only, and each archive is in `mpvkit-macos.pin` in the AIOStreams repository. Source:
    that repository's build scripts and patches, and each library's own project.
- **FFmpeg** on Windows, which makes the seek bar's thumbnails: `avcodec-*.dll` and `avutil-*.dll`,
  licensed under the LGPL-2.1-or-later, with [dav1d](https://code.videolan.org/videolan/dav1d)
  (BSD-2-Clause) built in. Their licence texts are beside them in `FFmpeg-COPYING.LGPLv2.1` and
  `dav1d-COPYING`. They are built from pinned sources and patches by
  [Viren070/aiostreams-libs](https://github.com/Viren070/aiostreams-libs), whose release is in
  `libs.pin` in the AIOStreams repository. Source: [FFmpeg](https://ffmpeg.org), dav1d and that
  repository's build script and patches.
- **The Vulkan loader** on Windows: `vulkan/vulkan-1.dll`, from the
  [LunarG Vulkan Runtime](https://vulkan.lunarg.com/sdk/home), whose version is in `libs.pin` in
  the AIOStreams repository. Licensed under the Apache-2.0; its licence text is beside it in
  `vulkan/VulkanRT-License.txt`. Source:
  [KhronosGroup/Vulkan-Loader](https://github.com/KhronosGroup/Vulkan-Loader).
- **Rust crates** built into the app, under MIT, Apache-2.0 and other permissive licences.
  `third-party-licenses.html` lists each crate with its licence text.
- **JavaScript libraries** built into the web app in `web` (`Contents/Resources/web` on macOS).
  Their licence notices are in the `.LICENSE.txt` files beside its scripts in `web/static/js`.

It uses the system's web view, which it does not ship: the Microsoft Edge WebView2 Runtime on
Windows and WebKit on macOS. On Linux it uses the system's libmpv, GTK 4 and WebKitGTK, and ships
none of them.

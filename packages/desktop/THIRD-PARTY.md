# Third-party software

AIOStreams Desktop is licensed under the AGPL-3.0. It ships with:

- **libmpv**, from [mpv](https://mpv.io), licensed under the GPL-2.0-or-later.
  - Windows: `libmpv-2.dll` and FFmpeg's DLLs beside it. macOS: `libmpv.2.dylib` with FFmpeg's,
    libdovi's and [MoltenVK](https://github.com/KhronosGroup/MoltenVK)'s dylibs in
    `Contents/Frameworks`. libass, libplacebo, dav1d and the other libraries they use are built in.
    mpv and FFmpeg carry [edde746's MPVKit](https://github.com/edde746/MPVKit) patches, licensed
    under the GPL-3.0-only, and FFmpeg is built with its GPL-3.0 parts, so together they are
    licensed under the GPL-3.0. Each library's licence text is in `licenses`
    (`Contents/Resources/licenses` on macOS). They are built from pinned sources by
    [AIOStreams/libs](https://github.com/AIOStreams/libs), whose release is in `libs.pin` and
    `libs-macos.pin` in the AIOStreams repository. Source: that repository's build scripts, its
    forks of mpv, FFmpeg and libass, and each library's own project.
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

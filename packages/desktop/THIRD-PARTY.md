# Third-party software

AIOStreams Desktop is licensed under the AGPL-3.0. It ships with:

- **libmpv** (`libmpv-2.dll`), from [mpv](https://mpv.io), licensed under the GPL-2.0-or-later.
  The build comes from [shinchiro/mpv-winbuild-cmake](https://github.com/shinchiro/mpv-winbuild-cmake),
  and its tag is in `libmpv.pin` in the AIOStreams repository. Source:
  [mpv-player/mpv](https://github.com/mpv-player/mpv) and the build scripts in that repository.

It uses the Microsoft Edge WebView2 Runtime installed with Windows, which it does not ship.

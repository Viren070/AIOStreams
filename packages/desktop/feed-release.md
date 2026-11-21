The latest AIOStreams desktop app. Pick the download for your computer; once installed, the app keeps itself up to date.

### Windows

| Your PC | Download |
| --- | --- |
| Most PCs (Intel or AMD) | [Installer](@BASE@/aiostreams-desktop-win-x64@SUFFIX@.exe) · [Portable](@BASE@/aiostreams-desktop-win-x64@SUFFIX@.zip) |
| Arm PCs, such as Snapdragon laptops | [Installer](@BASE@/aiostreams-desktop-win-arm64@SUFFIX@.exe) · [Portable](@BASE@/aiostreams-desktop-win-arm64@SUFFIX@.zip) |

Not sure which? Settings → System → About shows "ARM-based processor" on an Arm PC. The portable copy keeps its data in a folder beside itself.

### macOS

| Your Mac | Download |
| --- | --- |
| Apple silicon (M1 and later) | [Installer](@BASE@/aiostreams-desktop-osx-arm64@SUFFIX@.pkg) · [App](@BASE@/aiostreams-desktop-osx-arm64@SUFFIX@.zip) |
| Intel | [Installer](@BASE@/aiostreams-desktop-osx-x64@SUFFIX@.pkg) · [App](@BASE@/aiostreams-desktop-osx-x64@SUFFIX@.zip) |

Not sure which? Apple menu → About This Mac shows "Chip" on Apple silicon and "Processor" on an Intel Mac. The app is not signed by Apple yet, so macOS refuses it the first time: allow it in System Settings → Privacy & Security → Open Anyway.

### Linux

| Your PC | Download |
| --- | --- |
| Most PCs (Intel or AMD) | [AppImage](@BASE@/aiostreams-desktop-linux-x64@SUFFIX@.AppImage) · [.deb](@BASE@/aiostreams-desktop-linux-x64@SUFFIX@.deb) · [Flatpak](@BASE@/aiostreams-desktop-linux-x64@SUFFIX@.flatpak) |
| Arm PCs, such as Apple silicon Macs running Asahi Linux | [AppImage](@BASE@/aiostreams-desktop-linux-arm64@SUFFIX@.AppImage) · [.deb](@BASE@/aiostreams-desktop-linux-arm64@SUFFIX@.deb) · [Flatpak](@BASE@/aiostreams-desktop-linux-arm64@SUFFIX@.flatpak) |

- **AppImage:** runs on any distribution and keeps itself up to date. Make the file executable (`chmod +x` and its name, or Properties → Permissions), then open it.
- **.deb:** for Ubuntu 24.04, Linux Mint 22, Debian 13 and later. Install it with `sudo apt install ./` and the file's name; download the newer file and install it the same way to update.
- **Flatpak:** install it with `flatpak install --user` and the file's name, or open it in your software centre. It does not update itself yet: install the newer file over it to update.

The other files are what installed copies update from.

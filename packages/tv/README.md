# AIOStreams TV apps

The AIOStreams app (`packages/jellyfin-web`) packaged for LG (webOS) and Samsung (Tizen) TVs. Each
package holds the web app's standalone build, which picks its own server, plus the platform's
manifest and icons, and `boot.js`, which runs first. The TV loads the files from the package. LG
TVs play through the page's `<video>` element, Samsung TVs through Samsung's own player (AVPlay),
drawn beneath the page. The web app finds out which TV it's on from what the TV injects
(`window.webOSSystem` or `window.tizen`); see `src/lib/hosts/webos.ts` and `tizen/` there.

Expect 2023 or newer TVs (webOS 23, Tizen 7). Older engines lack CSS the app uses, but the packages
install on them anyway: `boot.js` says the TV is too old and offers to try. It also shows what
stopped the app starting, as a TV has no console.

## Build

```sh
pnpm -F @aiostreams/tv build:webos   # out/io.github.viren070.aiostreams_<version>_all.ipk
pnpm -F @aiostreams/tv build:tizen   # out/AIOStreams.wgt
```

Both build the web app first. The version comes from `package.json` and is written into the
manifest (`webos/appinfo.json`, `tizen/config.xml`), which carries none itself.

The `.wgt` is unsigned. A Samsung TV only installs a package signed for that TV, so whatever
installs it signs it first (below). With `TIZEN_PROFILE` set to a Tizen Studio security profile,
the build signs it with that profile instead, through Tizen Studio's `tizen` command.

## Releases

release-please releases this package on its own (`tv-v*` tags, `chore(tv): release` pull
requests), and the TV Release workflow attaches `aiostreams-webos-<version>.ipk` and
`aiostreams-tizen-<version>.wgt` to each release. Like the desktop app, page changes reach the
changelog through the `chore(tv): update the web app` pull request that moves `web-app.lock`
forward. The TV Check workflow builds both packages when anything here changes; run it by hand to
get them as artifacts of the run.

Each release also refreshes the rolling `tv` release, which holds the newest packages as
`aiostreams-webos.ipk` and `aiostreams-tizen.wgt` (its notes come from `feed-release.md`), and the
`tv-feed` branch, whose one file is the Homebrew Channel repository for the webOS package.

## Install

### webOS

1. Install **Developer Mode** from the LG Content Store, sign in with an LG account and turn it on.
   It shows the TV's IP address and a passphrase. The session runs out after a while; extend it in
   the same app.
2. Install the `.ipk` with [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop), or
   with the CLI this package already depends on:

```sh
cd packages/tv
pnpm exec ares-setup-device   # add the TV: IP, port 9922, the passphrase
pnpm exec ares-install --device <name> out/io.github.viren070.aiostreams_<version>_all.ipk
```

With the [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel) on the TV, add
`https://raw.githubusercontent.com/Viren070/AIOStreams/tv-feed/apps.json` as a repository in its
settings instead: the app then installs and updates from the channel.

### Tizen

A Samsung TV in developer mode installs a `.wgt` only when it is signed with a Samsung certificate
that lists that TV's device ID (DUID), so releases ship it unsigned.

- **Apps2Samsung** does all of it: pick **Custom WGT File** in its release list and choose the
  `.wgt`. It signs the app with a certificate made from your Samsung account for that TV.
- **Tizen Studio**: in Certificate Manager, create a Samsung certificate with the TV's DUID, and use
  that profile as `TIZEN_PROFILE`. Then turn on developer mode on the TV (Apps, type `12345`, enter
  the computer's IP) and run:

```sh
sdb connect <tv-ip>
tizen install -n out/AIOStreams.wgt -t <device-name>   # name from `sdb devices`
```
